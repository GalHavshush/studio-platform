"""The coach's report on a session."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StringConstraints
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import ClassReport
from app.sessions import CoachCtx, own_session

router = APIRouter(prefix="/sessions", tags=["reports"])


ReportText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]


class ReportIn(BaseModel):
    """The whole report. A field that is left out is cleared (this is a PUT, a full replace)."""

    summary: ReportText | None = None
    went_well: ReportText | None = None
    needs_work: ReportText | None = None
    observations: ReportText | None = None


class ReportOut(BaseModel):
    session_id: uuid.UUID
    summary: str | None
    went_well: str | None
    needs_work: str | None
    observations: str | None
    author_id: uuid.UUID
    submitted_at: datetime


@router.put("/{session_id}/report")
async def write_report(
    session_id: uuid.UUID,
    body: ReportIn,
    ctx: CoachCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReportOut:
    """Write the report of a session, or replace the one that is there. The owner writes any
    session's report, a coach only their own sessions' (`403 not_your_session`).

    There is one report per session, and a PUT replaces all of it: a field that is not sent is
    cleared. At least one field must have text (`422 empty_report`). A cancelled session gets
    `409 session_cancelled`; a session of another studio `404 session_not_found`. The author and
    time are those of the latest save. Attendees will only see `summary` (step 31).
    """
    target = await own_session(session_id, ctx, session)
    if target.status == "cancelled":
        raise HTTPException(status_code=409, detail="session_cancelled")

    fields = {name: (text or None) for name, text in body.model_dump().items()}  # blank = left out
    if not any(fields.values()):
        raise HTTPException(status_code=422, detail="empty_report")

    now = datetime.now(UTC)
    saved = {**fields, "author_id": ctx.user.id, "submitted_at": now}
    await session.execute(
        insert(ClassReport)
        .values(tenant_id=ctx.tenant_id, session_id=session_id, **saved)
        .on_conflict_do_update(index_elements=[ClassReport.session_id], set_=saved)
    )
    await session.commit()
    return ReportOut(session_id=session_id, **saved)
