"""Class sessions: creating, listing, reading, changing and cancelling them. Booking, attendance
and reports hang off a session too but live in their own files (bookings.py, attendance.py,
reports.py); this file holds what they share (`own_session`, `is_staff`, `CoachCtx`)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    PositiveInt,
    StringConstraints,
    model_validator,
)
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.bookings import _count_going, booking_applies, promote_waitlist
from app.class_types import OwnerCtx
from app.db import get_session
from app.deps import TenantContext, TenantCtx, require_role
from app.models import (
    ClassReport,
    ClassSession,
    ClassType,
    Membership,
    Participant,
    ParticipantNote,
    Rsvp,
    User,
)
from app.text import NoNul

router = APIRouter(prefix="/sessions", tags=["sessions"])

# So a schedule query cannot pull the whole table. ponytail: fixed cap; add pagination if a studio needs more.
MAX_RANGE = timedelta(days=62)

# The fields of a series' session whose change by hand marks it as overridden (a preview is not one:
# the series never writes it).
HAND_EDITED_FIELDS = {"starts_at", "ends_at", "coach_id", "capacity"}

# Coaches and owners create sessions (owners can do everything coaches can).
CoachCtx = Annotated[TenantContext, Depends(require_role("coach"))]


def check_range(from_: datetime, to: datetime) -> None:
    """The rule for any `[from, to)` query: `to` is after `from` (`422 invalid_range`) and the
    range is at most `MAX_RANGE` (`422 range_too_long`). The schedule and the report queue share it."""
    if to <= from_:
        raise HTTPException(status_code=422, detail="invalid_range")
    if to - from_ > MAX_RANGE:
        raise HTTPException(status_code=422, detail="range_too_long")


class SessionIn(BaseModel):
    class_type_id: uuid.UUID
    # AwareDatetime rejects a time without an offset (422): we never guess the studio's timezone.
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    # Omitted = the caller teaches it.
    coach_id: uuid.UUID | None = None
    # Seats, for booking-mode classes. Omitted = unlimited.
    capacity: PositiveInt | None = None

    @model_validator(mode="after")
    def ends_after_start(self) -> "SessionIn":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


Preview = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000), NoNul]


class SessionPatch(BaseModel):
    """A field that is left out stays unchanged; `preview: null` clears the preview and
    `capacity: null` makes the session unlimited."""

    preview: Preview | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    coach_id: uuid.UUID | None = None
    capacity: PositiveInt | None = None

    @model_validator(mode="after")
    def only_preview_and_capacity_can_be_cleared(self) -> "SessionPatch":
        for field in ("starts_at", "ends_at", "coach_id"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_type_id: uuid.UUID
    coach_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    status: str
    preview: str | None
    capacity: int | None
    series_id: uuid.UUID | None  # the weekly class it was made from, or null for a single class


class SessionListItem(SessionOut):
    """A session as the schedule lists it: the caller's own plan too (`going`, `maybe`,
    `not_going`, `waitlist`, or null when they have not answered), so a screen can ask for answers
    without opening every class. The same fact as `SessionDetail.my_rsvp`."""

    my_rsvp: str | None


class RsvpCounts(BaseModel):
    """How many people chose each plan. Counts only: never who."""

    going: int = 0
    maybe: int = 0
    not_going: int = 0
    waitlist: int = 0


class SessionDetail(SessionOut):
    """One session with what a screen needs to show it: names instead of ids, and the caller's
    own plan and own attendance (`my_attended`: true, false, or null when nothing is recorded; kept
    apart from the plan, so someone can have attended without ever answering). `rsvp_counts` is for
    coaches and owners; a member gets null, so nobody learns what the others chose, not even as a
    total. `seats_left` is the one number every member gets: free
    seats in a booking class with a seat limit, null when there are no seats to count."""

    class_type_name: str
    attendance_mode: str
    coach_name: str
    my_rsvp: str | None
    my_attended: bool | None
    rsvp_counts: RsvpCounts | None
    seats_left: int | None


async def is_staff(session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Whether this user is a coach or owner of the studio, so they can teach a session."""
    found = await session.scalar(
        select(Membership.id).where(
            Membership.tenant_id == tenant_id,
            Membership.user_id == user_id,
            Membership.role.in_(["coach", "owner"]),
        )
    )
    return found is not None


# Booking changes (RSVP, capacity edits, cancelling) take this lock on the session row first, so
# the seat check and the write that follows it cannot interleave with another request's:
# `FOR NO KEY UPDATE` makes a second one wait until the first commits, and its next statement
# (the count) then sees the committed result (READ COMMITTED gives each statement a fresh view).
# "No key" is the weaker variant: it does not block the plain inserts that reference this row
# through a foreign key (an attendance record), only other changers. One lock type and one row
# per request, so there is no lock ordering to get wrong.
# ponytail: it serializes everything that changes one session, RSVP-mode ones too; fine for
# studio-sized classes, narrow it to booking sessions if contention ever shows up.
async def own_session(
    session_id: uuid.UUID, ctx: TenantContext, session: AsyncSession
) -> ClassSession:
    """The session to change, or raise: 404 if it is not in this studio, 403 `not_your_session`
    if a coach (not an owner) is not its coach."""
    row = await session.scalar(
        select(ClassSession)
        .where(ClassSession.id == session_id, ClassSession.tenant_id == ctx.tenant_id)
        .with_for_update(key_share=True)  # the lock described above
    )
    if row is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    if ctx.role == "coach" and row.coach_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="not_your_session")
    return row


async def check_class_and_coach(
    session: AsyncSession,
    ctx: TenantContext,
    class_type_id: uuid.UUID,
    coach_id: uuid.UUID | None,
) -> uuid.UUID:
    """The rules for naming a class type and a coach on something new (a session, a series);
    returns the coach's id (the caller when none is named).

    A coach can only name themselves (`403 not_your_session`); an owner can name any coach or
    owner of the studio (`422 invalid_coach` otherwise). A class type of another studio is
    `404 class_type_not_found`; an archived one is `422 class_type_archived`.
    """
    coach_id = coach_id or ctx.user.id
    if ctx.role == "coach" and coach_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="not_your_session")

    class_type = (
        await session.execute(
            select(ClassType.archived_at).where(
                ClassType.id == class_type_id, ClassType.tenant_id == ctx.tenant_id
            )
        )
    ).first()
    if class_type is None:
        raise HTTPException(status_code=404, detail="class_type_not_found")
    if class_type.archived_at is not None:
        raise HTTPException(status_code=422, detail="class_type_archived")

    if not await is_staff(session, ctx.tenant_id, coach_id):
        raise HTTPException(status_code=422, detail="invalid_coach")
    return coach_id


@router.post("", status_code=201)
async def create_session(
    body: SessionIn, ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SessionOut:
    """Create a session in the studio named by `X-Tenant-Id`. Coach or owner.

    A coach can only create their own sessions (`403 not_your_session` if they name someone
    else); an owner can name any coach or owner of the studio (`422 invalid_coach` otherwise).
    Times are stored in UTC. A class type of another studio gets `404 class_type_not_found`; an
    archived one gets `422 class_type_archived`.
    """
    coach_id = await check_class_and_coach(session, ctx, body.class_type_id, body.coach_id)

    row = ClassSession(
        tenant_id=ctx.tenant_id,
        class_type_id=body.class_type_id,
        coach_id=coach_id,
        starts_at=body.starts_at.astimezone(UTC),
        ends_at=body.ends_at.astimezone(UTC),
        capacity=body.capacity,
    )
    session.add(row)
    await session.flush()
    created = SessionOut.model_validate(row)  # read before commit, which expires `row`
    await session.commit()
    return created


@router.get("")
async def list_sessions(
    ctx: TenantCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
    # `from` is a Python keyword, so the parameter is named from_ and exposed as ?from=.
    from_: Annotated[AwareDatetime, Query(alias="from")],
    to: AwareDatetime,
) -> list[SessionListItem]:
    """The studio's sessions that start in `[from, to)`, earliest first, each with the caller's own
    plan (`my_rsvp`, null when unanswered). Any member.

    Both times need an offset. `from` is included and `to` is not, so back-to-back ranges neither
    overlap nor miss a session. Invalid ranges get `422 invalid_range` (`to` not after `from`) or
    `422 range_too_long` (over 62 days).
    """
    check_range(from_, to)
    # The caller's own answer, through their participant in this studio (never an id from the
    # client), outer-joined so a class they have not answered still appears, with null.
    rows = await session.execute(
        select(ClassSession, Rsvp.status)
        .outerjoin(
            Rsvp,
            (Rsvp.session_id == ClassSession.id)
            & (Rsvp.tenant_id == ClassSession.tenant_id)
            & Rsvp.participant_id.in_(
                select(Participant.id).where(
                    Participant.tenant_id == ctx.tenant_id, Participant.user_id == ctx.user.id
                )
            ),
        )
        .where(
            ClassSession.tenant_id == ctx.tenant_id,
            ClassSession.starts_at >= from_,
            ClassSession.starts_at < to,
        )
        .order_by(ClassSession.starts_at, ClassSession.id)  # id: a stable order for equal times
    )
    return [
        SessionListItem(**SessionOut.model_validate(row).model_dump(), my_rsvp=mine)
        for row, mine in rows
    ]


@router.get("/{session_id}")
async def get_session_by_id(
    session_id: uuid.UUID, ctx: TenantCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SessionDetail:
    """One session of this studio, with its class type's name, the coach's name, the caller's own
    RSVP and attendance, the seats left (booking classes with a limit) and, for coaches and owners, how many chose
    each plan. Any member.

    The coach's name is visible to every member; their email never is. `my_rsvp` is the caller's
    own plan (`going`, `not_going`, `maybe`, `waitlist`) or null; `my_attended` is whether they
    themselves said they came (true, false, or null when not recorded), a separate fact from the
    plan, and never anyone else's. A session of another studio gets
    the same `404 session_not_found` as one that does not exist, so ids cannot be probed.
    """
    found = (
        await session.execute(
            select(ClassSession, ClassType.name, ClassType.attendance_mode, User.name)
            .join(
                ClassType,
                (ClassType.id == ClassSession.class_type_id)
                & (ClassType.tenant_id == ClassSession.tenant_id),
            )
            .join(User, User.id == ClassSession.coach_id)
            .where(ClassSession.id == session_id, ClassSession.tenant_id == ctx.tenant_id)
        )
    ).first()
    if found is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    row, class_type_name, attendance_mode, coach_name = found

    # The caller's own plan and attendance, through their own participant in this studio (never an
    # id from the client). No row at all means neither was ever recorded.
    mine = (
        await session.execute(
            select(Rsvp.status, Rsvp.attended)
            .join(Participant, Participant.id == Rsvp.participant_id)
            .where(
                Rsvp.session_id == session_id,
                Rsvp.tenant_id == ctx.tenant_id,
                Participant.user_id == ctx.user.id,
            )
        )
    ).first()

    counts = None
    if ctx.role in ("coach", "owner"):
        rows = await session.execute(
            select(Rsvp.status, func.count())
            .where(
                Rsvp.session_id == session_id,
                Rsvp.tenant_id == ctx.tenant_id,
                Rsvp.status.is_not(None),  # someone who attended without a plan has no status
            )
            .group_by(Rsvp.status)
        )
        counts = RsvpCounts(**dict(rows.all()))

    # Seats exist only in a booking class (module on) with a limit. A plain read: the RSVP route
    # decides under the row lock, so a number a moment old here does no harm.
    seats_left = None
    if row.capacity is not None and await booking_applies(session, ctx.tenant_id, attendance_mode):
        seats_left = max(row.capacity - await _count_going(session, session_id), 0)

    return SessionDetail(
        **SessionOut.model_validate(row).model_dump(),
        class_type_name=class_type_name,
        attendance_mode=attendance_mode,
        coach_name=coach_name,
        my_rsvp=mine.status if mine else None,
        my_attended=mine.attended if mine else None,
        rsvp_counts=counts,
        seats_left=seats_left,
    )


@router.patch("/{session_id}")
async def update_session(
    session_id: uuid.UUID,
    body: SessionPatch,
    ctx: CoachCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SessionOut:
    """Change a session's preview, times or coach. The owner edits any session, a coach only their own.

    Only the fields in the body change. Changing the coach is owner-only (`403 insufficient_role`)
    and the new coach must be staff of the studio (`422 invalid_coach`). The resulting times must
    still satisfy start < end (`422 invalid_times`). A cancelled session gets `409 session_cancelled`.
    """
    row = await own_session(session_id, ctx, session)
    changes = body.model_dump(exclude_unset=True)
    if "coach_id" in changes and ctx.role == "coach":
        raise HTTPException(status_code=403, detail="insufficient_role")
    if row.status == "cancelled":
        raise HTTPException(status_code=409, detail="session_cancelled")

    if "coach_id" in changes and not await is_staff(session, ctx.tenant_id, changes["coach_id"]):
        raise HTTPException(status_code=422, detail="invalid_coach")
    # Check the result, not the request: sending only ends_at must still end after the stored start.
    if changes.get("ends_at", row.ends_at) <= changes.get("starts_at", row.starts_at):
        raise HTTPException(status_code=422, detail="invalid_times")

    values = {k: v.astimezone(UTC) if isinstance(v, datetime) else v for k, v in changes.items()}
    if row.series_id is not None and any(
        getattr(row, field) != value
        for field, value in values.items()
        if field in HAND_EDITED_FIELDS
    ):
        row.is_overridden = True  # from now on a series edit leaves this session alone
    for field, value in values.items():
        setattr(row, field, value)
    await session.flush()
    if "capacity" in changes:  # more seats (or unlimited) may let waiting people in
        mode = await session.scalar(
            select(ClassType.attendance_mode).where(ClassType.id == row.class_type_id)
        )
        if await booking_applies(session, ctx.tenant_id, mode):
            await promote_waitlist(session, row.id, row.capacity)
    updated = SessionOut.model_validate(row)  # read before commit, which expires `row`
    await session.commit()
    return updated


@router.post("/{session_id}/cancel")
async def cancel_session(
    session_id: uuid.UUID, ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SessionOut:
    """Cancel a session. The owner cancels any, a coach only their own. Repeating it is fine (200).

    The session stays (reports and notes point at it) with `status: cancelled`.
    """
    row = await own_session(session_id, ctx, session)
    await session.execute(
        update(ClassSession).where(ClassSession.id == session_id).values(status="cancelled")
    )
    await session.refresh(row)  # the UPDATE bypassed the loaded object
    cancelled = SessionOut.model_validate(row)
    await session.commit()
    return cancelled


async def sessions_with_history(session: AsyncSession, ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """Which of these sessions have anything recorded on them: an RSVP row (a plan, a booking or an
    attendance mark), a class report or a note. Those can no longer be deleted, only cancelled."""
    found = set()
    for column in (Rsvp.session_id, ClassReport.session_id, ParticipantNote.session_id):
        found |= set(await session.scalars(select(column).where(column.in_(ids))))
    return found


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID, ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> None:
    """Remove a session completely, as if it had never been made: for a class created by mistake.
    Owner only; 404 if it is not in this studio.

    Refused while anything is recorded on it (`409 session_has_history`: an RSVP, a booking,
    attendance, a report or a note; cancel it instead) and when it belongs to a series
    (`409 session_in_series`: the next `extend` would just recreate it; cancel it, or delete or end
    the series). The database's foreign keys refuse the same deletes, so a record written at the
    last moment is a 409 too, never a half-deleted session.
    """
    row = await own_session(session_id, ctx, session)  # the lock a booking takes first
    if row.series_id is not None:
        raise HTTPException(status_code=409, detail="session_in_series")
    if await sessions_with_history(session, [row.id]):
        raise HTTPException(status_code=409, detail="session_has_history")
    try:
        await session.execute(delete(ClassSession).where(ClassSession.id == row.id))
    except IntegrityError:
        raise HTTPException(status_code=409, detail="session_has_history")
    await session.commit()
