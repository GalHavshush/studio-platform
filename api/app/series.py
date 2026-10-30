"""Weekly class series: the rule only (this class, this coach, every Tuesday at 18:00). Generating
the sessions from it is a later step. Only owners create them; a coach can read the ones they teach."""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, PositiveInt, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.class_types import OwnerCtx
from app.db import get_session
from app.models import ClassSeries, ClassSession, Tenant
from app.sessions import CoachCtx, check_class_and_coach

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


class SeriesIn(BaseModel):
    class_type_id: uuid.UUID
    # Omitted = the caller teaches it.
    coach_id: uuid.UUID | None = None
    weekday: Annotated[int, Field(ge=0, le=6)]  # 0 = Monday ... 6 = Sunday
    # The studio's wall clock: an offset is refused (422), as a missing one is for a session's times.
    start_time: time
    duration_minutes: PositiveInt
    # Omitted = unlimited.
    capacity: PositiveInt | None = None
    first_date: date
    # Omitted = no end.
    last_date: date | None = None

    @field_validator("start_time")
    @classmethod
    def no_offset(cls, value: time) -> time:
        if value.tzinfo is not None:
            raise ValueError("start_time is the studio's wall clock: no offset")
        return value

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


@router.get("/{series_id}")
async def get_series_by_id(
    series_id: uuid.UUID, ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SeriesOut:
    """One series: 404 if it is not in this studio, 403 `not_your_series` if a coach (not an
    owner) is not its coach."""
    row = await session.scalar(
        select(ClassSeries).where(
            ClassSeries.id == series_id, ClassSeries.tenant_id == ctx.tenant_id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="series_not_found")
    if ctx.role == "coach" and row.coach_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="not_your_series")
    return SeriesOut.model_validate(row)


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
        select(ClassSeries).where(
            ClassSeries.id == series_id, ClassSeries.tenant_id == ctx.tenant_id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="series_not_found")
    created = await generate_sessions(session, row)
    await session.commit()
    return ExtendOut(created=created)
