"""The coach's report on a session, with a private note per attendee."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StringConstraints, model_validator
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import ClassReport, Participant, ParticipantNote
from app.sessions import CoachCtx, own_session

router = APIRouter(prefix="/sessions", tags=["reports"])


ReportText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]


REPORT_FIELDS = ("summary", "went_well", "needs_work", "observations")


class NoteIn(BaseModel):
    participant_id: uuid.UUID
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
    # Whether the member the note is about may read it. Fails private: a note that is sent without
    # the flag (including one that was shared before) becomes staff-only.
    shared_with_member: bool = False


class ReportIn(BaseModel):
    """The whole report. A field that is left out is cleared (this is a PUT, a full replace).

    `notes` is the exception: left out, the session's existing notes stay as they are (so fixing the
    summary cannot wipe them); a list means exactly these notes for this session, which adds,
    changes and removes (`[]` removes them all).
    """

    summary: ReportText | None = None
    went_well: ReportText | None = None
    needs_work: ReportText | None = None
    observations: ReportText | None = None
    notes: list[NoteIn] | None = None

    @model_validator(mode="after")
    def one_note_per_participant(self) -> "ReportIn":
        ids = [note.participant_id for note in self.notes or []]
        if len(ids) != len(set(ids)):
            raise ValueError("a participant can have only one note per session")
        return self


class NoteOut(BaseModel):
    participant_id: uuid.UUID
    body: str
    shared_with_member: bool


class ReportOut(BaseModel):
    session_id: uuid.UUID
    summary: str | None
    went_well: str | None
    needs_work: str | None
    observations: str | None
    author_id: uuid.UUID
    submitted_at: datetime
    notes: list[NoteOut]


@router.put("/{session_id}/report")
async def write_report(
    session_id: uuid.UUID,
    body: ReportIn,
    ctx: CoachCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReportOut:
    """Write the report of a session, with a private note per attendee, or replace what is there.
    The owner writes any session's, a coach only their own sessions' (`403 not_your_session`).

    There is one report per session, and a PUT replaces all of it: a field that is not sent is
    cleared. Notes are different: left out they stay, a list replaces them (see `ReportIn`). The
    report and its notes are saved in one transaction, so a rejected note means nothing is saved.
    A report needs text in at least one field or at least one note (`422 empty_report`); a note
    about someone who is not in this studio is `422 participant_not_found`. A cancelled session
    gets `409 session_cancelled`; a session of another studio `404 session_not_found`. The author
    and time are those of the latest save. Attendees will only see `summary` (step 31).
    """
    target = await own_session(session_id, ctx, session)
    if target.status == "cancelled":
        raise HTTPException(status_code=409, detail="session_cancelled")

    fields = {name: (getattr(body, name) or None) for name in REPORT_FIELDS}  # blank = left out
    if not any(fields.values()) and not body.notes:
        raise HTTPException(status_code=422, detail="empty_report")

    # Everything is checked before anything is written; the writes below share one transaction.
    wanted = {note.participant_id for note in body.notes or []}
    if wanted:
        known = await session.scalars(
            select(Participant.id).where(
                Participant.tenant_id == ctx.tenant_id, Participant.id.in_(wanted)
            )
        )
        if set(known) != wanted:
            raise HTTPException(status_code=422, detail="participant_not_found")

    now = datetime.now(UTC)
    saved = {**fields, "author_id": ctx.user.id, "submitted_at": now}
    await session.execute(
        insert(ClassReport)
        .values(tenant_id=ctx.tenant_id, session_id=session_id, **saved)
        .on_conflict_do_update(index_elements=[ClassReport.session_id], set_=saved)
    )
    if body.notes is not None:
        await session.execute(
            delete(ParticipantNote).where(
                ParticipantNote.session_id == session_id,
                ParticipantNote.participant_id.not_in(wanted),
            )
        )
        if body.notes:
            new = insert(ParticipantNote).values(
                [
                    {
                        "tenant_id": ctx.tenant_id,
                        "participant_id": note.participant_id,
                        "session_id": session_id,
                        "author_id": ctx.user.id,
                        "body": note.body,
                        "shared_with_member": note.shared_with_member,
                        "created_at": now,  # the app clock, like every other timestamp
                    }
                    for note in body.notes
                ]
            )
            await session.execute(
                new.on_conflict_do_update(
                    index_elements=[ParticipantNote.session_id, ParticipantNote.participant_id],
                    set_={
                        "body": new.excluded.body,
                        "shared_with_member": new.excluded.shared_with_member,
                        "author_id": new.excluded.author_id,
                    },
                )
            )
    notes = await session.execute(
        select(
            ParticipantNote.participant_id,
            ParticipantNote.body,
            ParticipantNote.shared_with_member,
        )
        .where(ParticipantNote.session_id == session_id)
        .order_by(ParticipantNote.created_at, ParticipantNote.id)
    )
    result = ReportOut(
        session_id=session_id,
        **saved,
        notes=[
            NoteOut(participant_id=p, body=b, shared_with_member=shared) for p, b, shared in notes
        ],
    )
    await session.commit()
    return result
