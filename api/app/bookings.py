"""Booking a seat: RSVPs, the seat limit of booking-mode classes, and the waitlist.

Changing a session's bookings takes the session-row lock described above `own_session` in
sessions.py (`FOR NO KEY UPDATE`), so a seat check and its write cannot interleave with another
request's. The RSVP route takes it in its first query; `PATCH` and cancel take it through
`own_session`.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantContext, TenantCtx, require_role, studio_has_module
from app.models import ClassSession, ClassType, Participant, Rsvp

router = APIRouter(prefix="/sessions", tags=["bookings"])

CoachCtx = Annotated[TenantContext, Depends(require_role("coach"))]


async def booking_applies(
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


async def promote_waitlist(
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


class RsvpEntry(BaseModel):
    participant_id: uuid.UUID
    name: str
    status: str
    # 1, 2, 3... for people on the waiting list, null for everyone else
    waitlist_position: int | None


@router.get("/{session_id}/rsvps")
async def list_rsvps(
    session_id: uuid.UUID,
    ctx: CoachCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[RsvpEntry]:
    """Who is coming to a session, for coaches and owners (a member gets `403 insufficient_role`).

    One entry per person with a plan, by name and never by email: going first, then the waiting
    list in queue order, then maybe, then not going; by name inside each of the others. People with
    no plan (attendance recorded without an RSVP) are left out. A cancelled session can still be
    read. A session of another studio gets the same `404 session_not_found` as a missing one.

    The waiting list is ordered as `promote_waitlist` picks people (`waitlisted_at`, ties by
    participant id), so position 1 is who gets the next free seat.
    ponytail: no pagination, the list is bounded by the studio's size; add a cursor if a studio
    ever has thousands of RSVPs on one class.
    """
    exists = await session.scalar(
        select(ClassSession.id).where(
            ClassSession.id == session_id, ClassSession.tenant_id == ctx.tenant_id
        )
    )
    if exists is None:
        raise HTTPException(status_code=404, detail="session_not_found")

    group = case(
        (Rsvp.status == "going", 0),
        (Rsvp.status == "waitlist", 1),
        (Rsvp.status == "maybe", 2),
        else_=3,
    )
    # Counted over the whole session (the filter is in the WHERE below), so only waiting people
    # get a number: for everyone else the CASE gives null.
    position = case(
        (
            Rsvp.status == "waitlist",
            func.row_number().over(
                partition_by=Rsvp.status == "waitlist",
                order_by=(Rsvp.waitlisted_at, Rsvp.participant_id),
            ),
        )
    )
    rows = await session.execute(
        select(Rsvp.participant_id, Participant.name, Rsvp.status, position.label("position"))
        .join(Participant, Participant.id == Rsvp.participant_id)
        .where(
            Rsvp.session_id == session_id,
            Rsvp.tenant_id == ctx.tenant_id,
            Rsvp.status.is_not(None),
        )
        .order_by(group, position, Participant.name, Rsvp.participant_id)
    )
    return [
        RsvpEntry(
            participant_id=r.participant_id,
            name=r.name,
            status=r.status,
            waitlist_position=r.position,
        )
        for r in rows
    ]


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

    booking = await booking_applies(session, ctx.tenant_id, found.attendance_mode)
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
        await promote_waitlist(session, session_id, found.capacity)  # their seat is free
    await session.commit()
    return RsvpOut(session_id=session_id, status=status)
