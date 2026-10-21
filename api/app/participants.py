"""What the studio knows about a participant. Today: the notes coaches wrote about them."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantCtx, is_staff
from app.models import Participant, ParticipantNote

router = APIRouter(prefix="/participants", tags=["participants"])


class StaffNote(BaseModel):
    """A note as staff see it: everything, including who wrote it and whether it is shared."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID | None
    author_id: uuid.UUID
    body: str
    shared_with_member: bool
    created_at: datetime


class MemberNote(BaseModel):
    """A note as the member it is about sees it. Only shared notes ever reach this model, so it has
    no flag, and no author: the member needs neither."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID | None
    body: str
    created_at: datetime


@router.get("/{participant_id}/notes")
async def list_notes(
    participant_id: uuid.UUID,
    ctx: TenantCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[StaffNote] | list[MemberNote]:
    """The notes written about a participant, newest first. What you get depends on your role:

    - **Coach or owner:** every note about any participant of the studio (any coach reads all
      notes), with who wrote each and whether it is shared.
    - **Member:** only their own participant, and only the notes a coach shared with them, without
      author or flag. The filter is in the query, so a private note is never even fetched.

    A participant of another studio, a missing one, and (for a member) anyone but themselves all
    get the same `404 participant_not_found`, so ids cannot be probed. A member with nothing shared
    gets `200 []`, which looks the same as having no notes at all.
    ponytail: no pagination yet; the timeline (step 32) brings cursor pagination.
    """
    staff = is_staff(ctx)
    known = select(Participant.id).where(
        Participant.id == participant_id, Participant.tenant_id == ctx.tenant_id
    )
    notes = (
        select(ParticipantNote)
        .where(
            ParticipantNote.participant_id == participant_id,
            ParticipantNote.tenant_id == ctx.tenant_id,
        )
        .order_by(ParticipantNote.created_at.desc(), ParticipantNote.id)
    )
    if not staff:
        known = known.where(Participant.user_id == ctx.user.id)  # only about themselves
        notes = notes.where(ParticipantNote.shared_with_member.is_(True))  # only what was shared
    if await session.scalar(known) is None:
        raise HTTPException(status_code=404, detail="participant_not_found")
    rows = await session.scalars(notes)
    if staff:
        return [StaffNote.model_validate(row) for row in rows]
    return [MemberNote.model_validate(row) for row in rows]
