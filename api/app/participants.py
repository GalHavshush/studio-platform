"""What the studio knows about a participant. Today: the notes coaches wrote about them."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Participant, ParticipantNote
from app.sessions import CoachCtx

router = APIRouter(prefix="/participants", tags=["participants"])


class NoteDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID | None
    author_id: uuid.UUID
    body: str
    created_at: datetime


@router.get("/{participant_id}/notes")
async def list_notes(
    participant_id: uuid.UUID, ctx: CoachCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[NoteDetail]:
    """Every note written about this participant, newest first. Coach or owner: any coach reads all
    notes (the permissions table). Members get `403 insufficient_role` until step 30 gives them
    the notes that were shared with them. A participant of another studio gets the same
    `404 participant_not_found` as a missing one.
    ponytail: no pagination yet; the timeline (step 32) brings cursor pagination.
    """
    known = await session.scalar(
        select(Participant.id).where(
            Participant.id == participant_id, Participant.tenant_id == ctx.tenant_id
        )
    )
    if known is None:
        raise HTTPException(status_code=404, detail="participant_not_found")
    rows = await session.scalars(
        select(ParticipantNote)
        .where(
            ParticipantNote.participant_id == participant_id,
            ParticipantNote.tenant_id == ctx.tenant_id,
        )
        .order_by(ParticipantNote.created_at.desc(), ParticipantNote.id)
    )
    return [NoteDetail.model_validate(row) for row in rows]
