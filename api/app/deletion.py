"""Deleting an account: what is erased, what is kept, and in which order (step 32b).

The policy lives here, in one place, so a change of advice (what to keep about a deleted member)
is a change to this file only.

- **Anonymized in place, not deleted:** the `users` row stays with its id, so every record that
  points at it keeps working (sessions they taught, reports and notes they wrote, RSVPs), and shows
  a non-identifying author. Email, name and password are overwritten.
- **Erased:** every token (so nobody stays logged in), their memberships, the notes written ABOUT
  them (coaching content about a person), and their bookings and waitlist places for classes that
  have not started (so a dead account cannot hold a seat).
- **Kept, anonymously:** their participant rows (renamed), their past RSVPs and attendance, and the
  class-level reports. These are the studio's own history of its classes.
- **Refused:** the only owner of a studio that still has other members.
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth import lock_user, revoke_all_families
from app.bookings import booking_applies, promote_waitlist
from app.models import ClassSession, ClassType, Membership, Participant, ParticipantNote, Rsvp, User

DELETED_NAME = "Deleted user"


async def _refuse_if_last_owner(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Deleting the only owner of a studio that still has other members would leave it without
    anyone in charge. They must hand over ownership first (`409 transfer_ownership_first`).
    ponytail: ownership cannot be transferred yet (roles are set by the seed), so until it can, a
    studio's only owner cannot delete their account while the studio has other members."""
    other_owner, other_member = aliased(Membership), aliased(Membership)
    stranded = await session.scalar(
        select(Membership.tenant_id)
        .where(
            Membership.user_id == user_id,
            Membership.role == "owner",
            ~exists().where(
                other_owner.tenant_id == Membership.tenant_id,
                other_owner.role == "owner",
                other_owner.user_id != user_id,
            ),
            exists().where(
                other_member.tenant_id == Membership.tenant_id, other_member.user_id != user_id
            ),
        )
        .limit(1)
    )
    if stranded is not None:
        raise HTTPException(status_code=409, detail="transfer_ownership_first")


async def _leave_upcoming_classes(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    """Remove the user's bookings and waitlist places for classes that have not started, and let
    the waitlist in where they held a seat. Past classes keep their rows (the studio's history).

    Each affected session is locked first, in id order, like every other change to a session's
    bookings (step 27); the user lock is always taken before any session lock, and nothing takes
    them the other way round, so these cannot deadlock.
    """
    mine = select(Participant.id).where(Participant.user_id == user_id)
    upcoming = await session.execute(
        select(
            ClassSession.id,
            ClassSession.tenant_id,
            ClassSession.capacity,
            ClassType.attendance_mode,
        )
        .join(ClassType, ClassType.id == ClassSession.class_type_id)
        .where(
            ClassSession.starts_at > now,
            ClassSession.id.in_(select(Rsvp.session_id).where(Rsvp.participant_id.in_(mine))),
        )
        .order_by(ClassSession.id)
        .with_for_update(of=ClassSession, key_share=True)
    )
    for row in upcoming.all():
        removed = await session.scalars(
            delete(Rsvp)
            .where(Rsvp.session_id == row.id, Rsvp.participant_id.in_(mine))
            .returning(Rsvp.status)
        )
        held_a_seat = "going" in list(removed)
        if held_a_seat and await booking_applies(session, row.tenant_id, row.attendance_mode):
            await promote_waitlist(session, row.id, row.capacity)


async def delete_account(session: AsyncSession, user: User) -> None:
    """Delete the account: everything below happens in the caller's transaction, which the caller
    commits last, so it is all or nothing. Takes the per-user lock (13d) first, so a refresh in
    flight cannot create a token that survives."""
    now = datetime.now(UTC)
    await lock_user(session, user.id)
    await _refuse_if_last_owner(session, user.id)
    await revoke_all_families(session, user.id, now)
    await _leave_upcoming_classes(session, user.id, now)

    mine = select(Participant.id).where(Participant.user_id == user.id)
    # Coaching content about the person is erased (the "middle" option of the legal decision).
    await session.execute(delete(ParticipantNote).where(ParticipantNote.participant_id.in_(mine)))
    await session.execute(
        update(Participant).where(Participant.user_id == user.id).values(name=DELETED_NAME)
    )
    await session.execute(delete(Membership).where(Membership.user_id == user.id))

    # Last, the account itself: a unique address that cannot receive mail (".invalid" is reserved),
    # so the real email is free to register again.
    user.email = f"deleted-{user.id}@deleted.invalid"
    user.name = DELETED_NAME
    user.password_hash = None
    user.deleted_at = now
    await session.flush()
