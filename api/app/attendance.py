"""Attendance: whether someone actually came, kept apart from their RSVP plan."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantCtx
from app.models import ClassSession, Participant, Rsvp

router = APIRouter(prefix="/sessions", tags=["attendance"])

# Check-in opens this long before a session starts and stays open afterwards. Not a studio
# setting yet. ponytail: make it per-studio if studios need different windows.
CHECKIN_OPENS_BEFORE = timedelta(minutes=15)


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
