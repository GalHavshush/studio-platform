"""Weekly class series: a rule (this class, this coach, every Tuesday at 18:00) and the sessions
generated from it. Only owners create and change them; a coach can read the ones they teach."""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PositiveInt, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.bookings import booking_applies, promote_waitlist
from app.class_types import OwnerCtx
from app.db import get_session
from app.models import ClassSeries, ClassSession, ClassType, Rsvp, Tenant
from app.sessions import CoachCtx, check_class_and_coach, is_staff, sessions_with_history

router = APIRouter(prefix="/series", tags=["series"])

# How far ahead sessions are generated. ponytail: a constant, and topped up by hand (`/extend`)
# until scheduled work exists.
HORIZON = timedelta(weeks=4)


def occurrences(series: ClassSeries, tz: ZoneInfo, today: date) -> list[tuple[datetime, datetime]]:
    """The (starts_at, ends_at) UTC instants a series has from `today` (a date in the studio's
    timezone) up to its horizon: four weeks after the later of today and `first_date`, or
    `last_date` if that comes first. Past dates are never generated.

    Each date is combined with `start_time` on the studio's wall clock, so "18:00" stays 18:00
    when the clocks change. A local time that does not exist (the clocks jumped over it) lands an
    hour later; one that happens twice takes its first occurrence (zoneinfo's defaults).
    """
    first = max(today, series.first_date)
    end = first + HORIZON
    if series.last_date is not None:
        end = min(end, series.last_date + timedelta(days=1))
    day = first + timedelta(days=(series.weekday - first.weekday()) % 7)
    result = []
    while day < end:
        starts = datetime.combine(day, series.start_time, tzinfo=tz).astimezone(UTC)
        result.append((starts, starts + timedelta(minutes=series.duration_minutes)))
        day += timedelta(days=7)
    return result


async def generate_sessions(session: AsyncSession, series: ClassSeries) -> int:
    """Create the series' sessions that do not exist yet, within the horizon; returns how many.

    Safe to repeat: `unique (series_id, starts_at)` plus ON CONFLICT DO NOTHING means a session
    that exists (even a cancelled or edited one) is left exactly as it is.
    """
    timezone = await session.scalar(select(Tenant.timezone).where(Tenant.id == series.tenant_id))
    tz = ZoneInfo(timezone)
    rows = [
        {
            "tenant_id": series.tenant_id,
            "class_type_id": series.class_type_id,
            "coach_id": series.coach_id,
            "capacity": series.capacity,
            "series_id": series.id,
            "starts_at": starts,
            "ends_at": ends,
        }
        for starts, ends in occurrences(series, tz, datetime.now(tz).date())
    ]
    if not rows:
        return 0
    inserted = await session.scalars(
        insert(ClassSession)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["series_id", "starts_at"])
        .returning(ClassSession.id)
    )
    return len(inserted.all())


def _no_offset(value: time) -> time:
    if value.tzinfo is not None:
        raise ValueError("start_time is the studio's wall clock: no offset")
    return value


# The studio's wall clock: an offset is refused (422), as a missing one is for a session's times.
WallClock = Annotated[time, AfterValidator(_no_offset)]


class SeriesIn(BaseModel):
    class_type_id: uuid.UUID
    # Omitted = the caller teaches it.
    coach_id: uuid.UUID | None = None
    weekday: Annotated[int, Field(ge=0, le=6)]  # 0 = Monday ... 6 = Sunday
    start_time: WallClock
    duration_minutes: PositiveInt
    # Omitted = unlimited.
    capacity: PositiveInt | None = None
    first_date: date
    # Omitted = no end.
    last_date: date | None = None

    @model_validator(mode="after")
    def last_not_before_first(self) -> "SeriesIn":
        if self.last_date is not None and self.last_date < self.first_date:
            raise ValueError("last_date must not be before first_date")
        return self


class SeriesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_type_id: uuid.UUID
    coach_id: uuid.UUID
    weekday: int
    start_time: time
    duration_minutes: int
    capacity: int | None
    first_date: date
    last_date: date | None


@router.post("", status_code=201)
async def create_series(
    body: SeriesIn, ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SeriesOut:
    """Create a series in the studio named by `X-Tenant-Id`. Owner only (`403 insufficient_role`).

    The class type and coach follow the rules of `POST /sessions`. `first_date` must fall on
    `weekday` (`422 first_date_not_on_weekday`). The first four weeks of sessions are created with it.
    """
    coach_id = await check_class_and_coach(session, ctx, body.class_type_id, body.coach_id)
    if body.first_date.weekday() != body.weekday:
        raise HTTPException(status_code=422, detail="first_date_not_on_weekday")

    row = ClassSeries(
        tenant_id=ctx.tenant_id,
        coach_id=coach_id,
        **body.model_dump(exclude={"coach_id"}),
    )
    session.add(row)
    await session.flush()
    await generate_sessions(session, row)
    created = SeriesOut.model_validate(row)  # read before commit, which expires `row`
    await session.commit()
    return created


@router.get("")
async def list_series(
    ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[SeriesOut]:
    """The studio's series: an owner sees all of them, a coach only their own."""
    query = select(ClassSeries).where(ClassSeries.tenant_id == ctx.tenant_id)
    if ctx.role == "coach":
        query = query.where(ClassSeries.coach_id == ctx.user.id)
    rows = await session.scalars(
        query.order_by(ClassSeries.weekday, ClassSeries.start_time, ClassSeries.id)
    )
    return [SeriesOut.model_validate(row) for row in rows]


async def readable_series(
    session: AsyncSession, ctx: CoachCtx, series_id: uuid.UUID
) -> ClassSeries:
    """The series if this caller may read it: 404 if it is not in this studio, 403
    `not_your_series` if a coach (not an owner) is not its coach."""
    row = await session.scalar(
        select(ClassSeries).where(
            ClassSeries.id == series_id, ClassSeries.tenant_id == ctx.tenant_id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="series_not_found")
    if ctx.role == "coach" and row.coach_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="not_your_series")
    return row


@router.get("/{series_id}")
async def get_series_by_id(
    series_id: uuid.UUID, ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SeriesOut:
    """One series: 404 if it is not in this studio, 403 `not_your_series` if a coach (not an
    owner) is not its coach."""
    return SeriesOut.model_validate(await readable_series(session, ctx, series_id))


class SeriesSessionOut(BaseModel):
    """One coming class of a series, with how many people said they are going (a count, never who)."""

    id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    status: str
    capacity: int | None
    going: int


@router.get("/{series_id}/sessions")
async def list_series_sessions(
    series_id: uuid.UUID, ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[SeriesSessionOut]:
    """The series' sessions that have not started yet, earliest first, cancelled ones included
    (`status`), each with its `going` count. Read by whoever may read the series: an owner, or the
    coach who teaches it (`403 not_your_series` for another coach; 404 if it is not in this studio)."""
    await readable_series(session, ctx, series_id)
    rows = await session.execute(
        select(ClassSession, func.count(Rsvp.session_id))
        .outerjoin(
            Rsvp,
            (Rsvp.session_id == ClassSession.id)
            & (Rsvp.tenant_id == ClassSession.tenant_id)
            & (Rsvp.status == "going"),
        )
        .where(
            ClassSession.series_id == series_id,
            ClassSession.tenant_id == ctx.tenant_id,
            ClassSession.starts_at >= datetime.now(UTC),
        )
        .group_by(ClassSession.id)
        .order_by(ClassSession.starts_at, ClassSession.id)
    )
    return [
        SeriesSessionOut(
            id=row.id,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
            status=row.status,
            capacity=row.capacity,
            going=going,
        )
        for row, going in rows
    ]


class ExtendOut(BaseModel):
    created: int


@router.post("/{series_id}/extend")
async def extend_series(
    series_id: uuid.UUID, ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> ExtendOut:
    """Create the sessions the series is missing up to its horizon (four weeks from today, or
    `last_date`). Owner only; 404 `series_not_found` if it is not in this studio. Repeating it
    creates nothing new."""
    row = await session.scalar(
        select(ClassSeries)
        .where(ClassSeries.id == series_id, ClassSeries.tenant_id == ctx.tenant_id)
        .with_for_update()  # an edit or an end running now finishes first: new sessions get its rule
    )
    if row is None:
        raise HTTPException(status_code=404, detail="series_not_found")
    created = await generate_sessions(session, row)
    await session.commit()
    return ExtendOut(created=created)


class SeriesPatch(BaseModel):
    """A field that is left out stays unchanged; `capacity: null` makes the sessions unlimited.
    Anything else (weekday, dates, class type) is refused with 422: end the series and make a new one."""

    model_config = ConfigDict(extra="forbid")

    coach_id: uuid.UUID | None = None
    start_time: WallClock | None = None
    duration_minutes: PositiveInt | None = None
    capacity: PositiveInt | None = None

    @model_validator(mode="after")
    def only_capacity_can_be_cleared(self) -> "SeriesPatch":
        for field in ("coach_id", "start_time", "duration_minutes"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class SeriesEditOut(SeriesOut):
    sessions_updated: int  # future scheduled sessions that took the change
    sessions_kept: int  # future scheduled sessions left alone because they were changed by hand


@router.patch("/{series_id}")
async def update_series(
    series_id: uuid.UUID,
    body: SeriesPatch,
    ctx: OwnerCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SeriesEditOut:
    """Change the rule and every future session that follows it. Owner only.

    Only sessions that are still to come, scheduled and not changed by hand follow the rule: past
    and cancelled ones, and ones whose times, coach or capacity someone changed, are left as they
    are (`sessions_kept` counts the last kind). A new start time keeps each session on its own
    date, in the studio's timezone. A new coach must be staff (`422 invalid_coach`); a start time
    that lands on an instant another session of the series already has is `409 session_time_clash`
    and nothing is changed. Raising the capacity lets waiting people in, like editing one session.
    """
    row = await session.scalar(
        select(ClassSeries)
        .where(ClassSeries.id == series_id, ClassSeries.tenant_id == ctx.tenant_id)
        .with_for_update()  # an `extend` running now waits for this edit
    )
    if row is None:
        raise HTTPException(status_code=404, detail="series_not_found")
    changes = body.model_dump(exclude_unset=True)
    if "coach_id" in changes and not await is_staff(session, ctx.tenant_id, changes["coach_id"]):
        raise HTTPException(status_code=422, detail="invalid_coach")
    future = list(
        await session.scalars(
            select(ClassSession)
            .where(
                ClassSession.series_id == row.id,
                ClassSession.status == "scheduled",
                ClassSession.starts_at > datetime.now(UTC),
            )
            .order_by(ClassSession.starts_at)
        )
    )
    follow = [s for s in future if not s.is_overridden]
    timezone = await session.scalar(select(Tenant.timezone).where(Tenant.id == row.tenant_id))
    tz = ZoneInfo(timezone)
    try:
        # A savepoint, so a clash undoes the whole edit (the rule too) even if the caller goes on.
        async with session.begin_nested():
            for field, value in changes.items():
                setattr(row, field, value)
            for s in follow:
                if "coach_id" in changes:
                    s.coach_id = row.coach_id
                if "capacity" in changes:
                    s.capacity = row.capacity
                if "start_time" in changes or "duration_minutes" in changes:
                    day = s.starts_at.astimezone(tz).date()
                    s.starts_at = datetime.combine(day, row.start_time, tzinfo=tz).astimezone(UTC)
                    s.ends_at = s.starts_at + timedelta(minutes=row.duration_minutes)
    except IntegrityError as error:
        if "uq_class_sessions_series_id_starts_at" not in str(error.orig):
            raise
        raise HTTPException(status_code=409, detail="session_time_clash")

    if "capacity" in changes and follow:  # more seats (or unlimited) may let waiting people in
        mode = await session.scalar(
            select(ClassType.attendance_mode).where(ClassType.id == row.class_type_id)
        )
        if await booking_applies(session, ctx.tenant_id, mode):
            for s in follow:
                await promote_waitlist(session, s.id, s.capacity)
    result = SeriesEditOut(
        **SeriesOut.model_validate(row).model_dump(),
        sessions_updated=len(follow),
        sessions_kept=len(future) - len(follow),
    )
    await session.commit()
    return result


class SeriesEndOut(SeriesOut):
    sessions_deleted: int  # future sessions nobody had RSVP'd to: gone from the schedule
    sessions_cancelled: int  # future sessions with RSVPs: kept, as cancelled


@router.post("/{series_id}/end")
async def end_series(
    series_id: uuid.UUID, ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SeriesEndOut:
    """Stop a series from today (the studio's date). Owner only.

    `last_date` becomes today (never later than it already was), so no more sessions are
    generated. Everything that already happened is untouched. Sessions of later dates that are
    still scheduled go: the ones nobody RSVP'd to are deleted, the ones with an RSVP are
    cancelled so those people see it. Today's class stays, and already cancelled ones are left
    as they are. A series whose `first_date` is still ahead gets `409 series_not_started` (it
    never ran: that is a mistake to delete). Repeating it changes nothing (200, zeros).
    """
    row = await session.scalar(
        select(ClassSeries)
        .where(ClassSeries.id == series_id, ClassSeries.tenant_id == ctx.tenant_id)
        .with_for_update()  # an `extend` or an edit running now waits for this
    )
    if row is None:
        raise HTTPException(status_code=404, detail="series_not_found")
    timezone = await session.scalar(select(Tenant.timezone).where(Tenant.id == row.tenant_id))
    tz = ZoneInfo(timezone)
    today = datetime.now(tz).date()
    if row.first_date > today:
        raise HTTPException(status_code=409, detail="series_not_started")

    tomorrow = datetime.combine(today + timedelta(days=1), time.min, tzinfo=tz).astimezone(UTC)
    # The lock a booking takes first (see `own_session`): once we hold it nobody can add an RSVP
    # to these sessions, and the RSVP query below sees every one that was committed before.
    ids = list(
        await session.scalars(
            select(ClassSession.id)
            .where(
                ClassSession.series_id == row.id,
                ClassSession.status == "scheduled",
                ClassSession.starts_at >= tomorrow,
            )
            .order_by(ClassSession.id)
            .with_for_update(key_share=True)
        )
    )
    booked = set(await session.scalars(select(Rsvp.session_id).where(Rsvp.session_id.in_(ids))))
    empty = [i for i in ids if i not in booked]
    await session.execute(delete(ClassSession).where(ClassSession.id.in_(empty)))
    await session.execute(
        update(ClassSession).where(ClassSession.id.in_(booked)).values(status="cancelled")
    )
    row.last_date = min(row.last_date or today, today)
    result = SeriesEndOut(
        **SeriesOut.model_validate(row).model_dump(),
        sessions_deleted=len(empty),
        sessions_cancelled=len(booked),
    )
    await session.commit()
    return result


@router.delete("/{series_id}", status_code=204)
async def delete_series(
    series_id: uuid.UUID, ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> None:
    """Remove a series and all its sessions completely: for one created by mistake. Owner only;
    404 if it is not in this studio.

    All or nothing: if any of its sessions has anything recorded on it (an RSVP, a booking,
    attendance, a report or a note) it is `409 series_has_history` and nothing is deleted. Use
    `end` for a series that has really run.
    """
    row = await session.scalar(
        select(ClassSeries)
        .where(ClassSeries.id == series_id, ClassSeries.tenant_id == ctx.tenant_id)
        .with_for_update()  # an edit, an extend or an end running now finishes first
    )
    if row is None:
        raise HTTPException(status_code=404, detail="series_not_found")
    ids = list(
        await session.scalars(
            select(ClassSession.id)
            .where(ClassSession.series_id == row.id)
            .order_by(ClassSession.id)
            .with_for_update(key_share=True)  # the lock a booking takes first
        )
    )
    if await sessions_with_history(session, ids):
        raise HTTPException(status_code=409, detail="series_has_history")
    try:
        await session.execute(delete(ClassSession).where(ClassSession.series_id == row.id))
        await session.execute(delete(ClassSeries).where(ClassSeries.id == row.id))
    except IntegrityError:  # something was recorded between the check and the delete
        raise HTTPException(status_code=409, detail="series_has_history")
    await session.commit()
