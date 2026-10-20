import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    PositiveInt,
    StringConstraints,
    model_validator,
)
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantContext, TenantCtx, require_role, studio_has_module
from app.models import ClassSession, ClassType, Membership, Participant, Rsvp

router = APIRouter(prefix="/sessions", tags=["sessions"])

# So a schedule query cannot pull the whole table. ponytail: fixed cap; add pagination if a studio needs more.
MAX_RANGE = timedelta(days=62)

# Check-in opens this long before a session starts and stays open afterwards. Not a studio
# setting yet. ponytail: make it per-studio if studios need different windows.
CHECKIN_OPENS_BEFORE = timedelta(minutes=15)

# Coaches and owners create sessions (owners can do everything coaches can).
CoachCtx = Annotated[TenantContext, Depends(require_role("coach"))]


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


Preview = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


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


async def _is_staff(session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
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
async def _own_session(
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
    coach_id = body.coach_id or ctx.user.id
    if ctx.role == "coach" and coach_id != ctx.user.id:
        raise HTTPException(status_code=403, detail="not_your_session")

    class_type = (
        await session.execute(
            select(ClassType.archived_at).where(
                ClassType.id == body.class_type_id, ClassType.tenant_id == ctx.tenant_id
            )
        )
    ).first()
    if class_type is None:
        raise HTTPException(status_code=404, detail="class_type_not_found")
    if class_type.archived_at is not None:
        raise HTTPException(status_code=422, detail="class_type_archived")

    if not await _is_staff(session, ctx.tenant_id, coach_id):
        raise HTTPException(status_code=422, detail="invalid_coach")

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
) -> list[SessionOut]:
    """The studio's sessions that start in `[from, to)`, earliest first. Any member.

    Both times need an offset. `from` is included and `to` is not, so back-to-back ranges neither
    overlap nor miss a session. Invalid ranges get `422 invalid_range` (`to` not after `from`) or
    `422 range_too_long` (over 62 days).
    """
    if to <= from_:
        raise HTTPException(status_code=422, detail="invalid_range")
    if to - from_ > MAX_RANGE:
        raise HTTPException(status_code=422, detail="range_too_long")
    rows = await session.scalars(
        select(ClassSession)
        .where(
            ClassSession.tenant_id == ctx.tenant_id,
            ClassSession.starts_at >= from_,
            ClassSession.starts_at < to,
        )
        .order_by(ClassSession.starts_at, ClassSession.id)  # id: a stable order for equal times
    )
    return [SessionOut.model_validate(row) for row in rows]


@router.get("/{session_id}")
async def get_session_by_id(
    session_id: uuid.UUID, ctx: TenantCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> SessionOut:
    """One session of this studio. Any member.

    A session of another studio gets the same `404 session_not_found` as one that does not exist,
    so ids cannot be probed.
    """
    row = await session.scalar(
        select(ClassSession).where(
            ClassSession.id == session_id, ClassSession.tenant_id == ctx.tenant_id
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionOut.model_validate(row)


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
    row = await _own_session(session_id, ctx, session)
    changes = body.model_dump(exclude_unset=True)
    if "coach_id" in changes and ctx.role == "coach":
        raise HTTPException(status_code=403, detail="insufficient_role")
    if row.status == "cancelled":
        raise HTTPException(status_code=409, detail="session_cancelled")

    if "coach_id" in changes and not await _is_staff(session, ctx.tenant_id, changes["coach_id"]):
        raise HTTPException(status_code=422, detail="invalid_coach")
    # Check the result, not the request: sending only ends_at must still end after the stored start.
    if changes.get("ends_at", row.ends_at) <= changes.get("starts_at", row.starts_at):
        raise HTTPException(status_code=422, detail="invalid_times")

    for field, value in changes.items():
        setattr(row, field, value.astimezone(UTC) if isinstance(value, datetime) else value)
    await session.flush()
    if "capacity" in changes:  # more seats (or unlimited) may let waiting people in
        mode = await session.scalar(
            select(ClassType.attendance_mode).where(ClassType.id == row.class_type_id)
        )
        if await _booking_applies(session, ctx.tenant_id, mode):
            await _promote_waitlist(session, row.id, row.capacity)
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
    row = await _own_session(session_id, ctx, session)
    await session.execute(
        update(ClassSession).where(ClassSession.id == session_id).values(status="cancelled")
    )
    await session.refresh(row)  # the UPDATE bypassed the loaded object
    cancelled = SessionOut.model_validate(row)
    await session.commit()
    return cancelled


async def _booking_applies(
    session: AsyncSession, tenant_id: uuid.UUID, attendance_mode: str
) -> bool:
    """Seats and the waitlist only exist for a booking-mode class in a studio that has the module on;
    otherwise the session behaves as a plain RSVP one."""
    return attendance_mode == "booking" and await studio_has_module(session, tenant_id, "booking")


async def _count_going(session: AsyncSession, session_id: uuid.UUID) -> int:
    return await session.scalar(
        select(func.count())
        .select_from(Rsvp)
        .where(Rsvp.session_id == session_id, Rsvp.status == "going")
    )


async def _promote_waitlist(
    session: AsyncSession, session_id: uuid.UUID, capacity: int | None
) -> None:
    """Move the earliest waitlisted people to `going` until the seats are full again (everyone if
    the session is unlimited). Called whenever a seat may have freed up; the single place where a
    promotion happens, so step 46 can notify the promoted people from here, after the commit.
    ponytail: ties on waitlisted_at are broken by participant id, which is stable but arbitrary."""
    waiting = (
        select(Rsvp.participant_id)
        .where(Rsvp.session_id == session_id, Rsvp.status == "waitlist")
        .order_by(Rsvp.waitlisted_at, Rsvp.participant_id)
    )
    if capacity is not None:
        free = capacity - await _count_going(session, session_id)
        if free <= 0:
            return
        waiting = waiting.limit(free)
    promoted = list(await session.scalars(waiting))
    if promoted:
        await session.execute(
            update(Rsvp)
            .where(Rsvp.session_id == session_id, Rsvp.participant_id.in_(promoted))
            .values(status="going", waitlisted_at=None)
        )


class RsvpIn(BaseModel):
    status: Literal["going", "not_going", "maybe"]


class RsvpOut(BaseModel):
    session_id: uuid.UUID
    status: str


@router.put("/{session_id}/rsvp")
async def rsvp_to_session(
    session_id: uuid.UUID,
    body: RsvpIn,
    ctx: TenantCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RsvpOut:
    """Set the caller's own plan for a session: going, not_going or maybe. Any member.

    An upsert: the first call creates the RSVP and later calls change it, so repeating a request is
    fine. It is only an intention; attendance after the class is a separate step. The RSVP belongs
    to the caller's participant in this studio, never to one named by the client. A session of
    another studio gets `404 session_not_found`; a cancelled one gets `409 session_cancelled`.

    In a booking-mode class (module on) a `going` takes one of `capacity` seats. When all are taken
    the answer is still 200 but the status is `waitlist`: the person waits in line, and the earliest
    waiting person is promoted to `going` when a seat frees up. `maybe` and `not_going` never take
    a seat (and take you off the waitlist), and repeating `going` keeps your seat or your place.
    """
    # Locks the session row: if someone else is booking this session, wait here for them to finish.
    found = (
        await session.execute(
            select(ClassSession.status, ClassSession.capacity, ClassType.attendance_mode)
            .join(ClassType, ClassType.id == ClassSession.class_type_id)
            .where(ClassSession.id == session_id, ClassSession.tenant_id == ctx.tenant_id)
            .with_for_update(of=ClassSession, key_share=True)
        )
    ).first()
    if found is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    if found.status == "cancelled":
        raise HTTPException(status_code=409, detail="session_cancelled")

    participant_id = await session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == ctx.tenant_id, Participant.user_id == ctx.user.id
        )
    )
    if participant_id is None:  # every membership gets a participant, so this should not happen
        raise HTTPException(status_code=409, detail="no_participant")

    booking = await _booking_applies(session, ctx.tenant_id, found.attendance_mode)
    previous = (
        await session.execute(
            select(Rsvp.status, Rsvp.waitlisted_at).where(
                Rsvp.session_id == session_id, Rsvp.participant_id == participant_id
            )
        )
    ).first()
    previous_status = previous.status if previous else None

    status, waitlisted_at = body.status, None
    # The session row is locked since the first query, so the count below cannot go stale before
    # the write (step 27; see the note above `_own_session`).
    wants_a_seat = booking and found.capacity is not None and body.status == "going"
    full = (
        wants_a_seat
        and previous_status != "going"  # someone who holds a seat keeps it
        and await _count_going(session, session_id) >= found.capacity
    )
    if full:  # wait in line; someone already waiting keeps their place
        status = "waitlist"
        waitlisted_at = (previous.waitlisted_at if previous else None) or datetime.now(UTC)

    # One atomic statement: a read-then-insert could race with the same member's other request.
    await session.execute(
        insert(Rsvp)
        .values(
            tenant_id=ctx.tenant_id,
            session_id=session_id,
            participant_id=participant_id,
            status=status,
            waitlisted_at=waitlisted_at,
        )
        .on_conflict_do_update(
            index_elements=[Rsvp.session_id, Rsvp.participant_id],
            set_={"status": status, "waitlisted_at": waitlisted_at},
        )
    )
    if booking and previous_status == "going" and status != "going":
        await _promote_waitlist(session, session_id, found.capacity)  # their seat is free
    await session.commit()
    return RsvpOut(session_id=session_id, status=status)


class AttendanceIn(BaseModel):
    attended: bool
    # Staff only: whose attendance this is. Omitted = the caller's own.
    participant_id: uuid.UUID | None = None


class AttendanceOut(BaseModel):
    session_id: uuid.UUID
    participant_id: uuid.UUID
    attended: bool
    confirmed_at: datetime


@router.post("/{session_id}/attendance")
async def record_attendance(
    session_id: uuid.UUID,
    body: AttendanceIn,
    ctx: TenantCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AttendanceOut:
    """Record whether someone actually came (`attended`), as opposed to their RSVP plan.

    Members record their own. An owner can record anyone's on any session, a coach anyone's on
    sessions they teach (`403 not_your_session` otherwise); a member naming someone else gets
    `403 insufficient_role`. The person must be in this studio (`404 participant_not_found`).
    Allowed from 15 minutes before the session starts, with no end (`409 checkin_not_open`
    before that) and not on a cancelled session (`409 session_cancelled`). Sending it again
    changes the answer and refreshes `confirmed_at`. A session of another studio gets
    `404 session_not_found`.
    """
    found = (
        await session.execute(
            select(ClassSession.status, ClassSession.coach_id, ClassSession.starts_at).where(
                ClassSession.id == session_id, ClassSession.tenant_id == ctx.tenant_id
            )
        )
    ).first()
    if found is None:
        raise HTTPException(status_code=404, detail="session_not_found")

    own_id = await session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == ctx.tenant_id, Participant.user_id == ctx.user.id
        )
    )
    if body.participant_id is None or body.participant_id == own_id:
        participant_id = own_id
        if participant_id is None:  # every membership gets a participant, so this should not happen
            raise HTTPException(status_code=409, detail="no_participant")
    else:
        if ctx.role == "member":
            raise HTTPException(status_code=403, detail="insufficient_role")
        if ctx.role == "coach" and found.coach_id != ctx.user.id:
            raise HTTPException(status_code=403, detail="not_your_session")
        participant_id = await session.scalar(
            select(Participant.id).where(
                Participant.id == body.participant_id, Participant.tenant_id == ctx.tenant_id
            )
        )
        if participant_id is None:
            raise HTTPException(status_code=404, detail="participant_not_found")

    if found.status == "cancelled":
        raise HTTPException(status_code=409, detail="session_cancelled")
    now = datetime.now(UTC)
    if now < found.starts_at - CHECKIN_OPENS_BEFORE:
        raise HTTPException(status_code=409, detail="checkin_not_open")

    # Touches only the attendance columns, so it never overwrites the RSVP plan (and vice versa).
    await session.execute(
        insert(Rsvp)
        .values(
            tenant_id=ctx.tenant_id,
            session_id=session_id,
            participant_id=participant_id,
            attended=body.attended,
            confirmed_at=now,
        )
        .on_conflict_do_update(
            index_elements=[Rsvp.session_id, Rsvp.participant_id],
            set_={"attended": body.attended, "confirmed_at": now},
        )
    )
    await session.commit()
    return AttendanceOut(
        session_id=session_id,
        participant_id=participant_id,
        attended=body.attended,
        confirmed_at=now,
    )
