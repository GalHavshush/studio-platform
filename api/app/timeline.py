"""A participant's history: the classes they are connected to, newest first, with what the studio
knows about them for each, filtered by who is looking."""

import base64
import binascii
import json
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantCtx, is_staff
from app.models import ClassReport, ClassSession, ClassType, Participant, ParticipantNote, Rsvp
from app.reports import member_visible_summaries

router = APIRouter(prefix="/participants", tags=["timeline"])


class TimelineNote(BaseModel):
    id: uuid.UUID
    body: str
    created_at: datetime


class StaffTimelineNote(TimelineNote):
    author_id: uuid.UUID
    shared_with_member: bool


class TimelineItem(BaseModel):
    """One class: when, what, and what is known about the participant for it."""

    session_id: uuid.UUID
    starts_at: datetime
    class_type_name: str
    status: str  # scheduled | cancelled
    booking: str | None  # going | not_going | maybe | waitlist; None if they never RSVPed
    attended: bool | None  # None = not recorded
    summary: str | None


class StaffTimelineItem(TimelineItem):
    notes: list[StaffTimelineNote]


class MemberTimelineItem(TimelineItem):
    notes: list[TimelineNote]


class StaffTimeline(BaseModel):
    items: list[StaffTimelineItem]
    next_cursor: str | None


class MemberTimeline(BaseModel):
    items: list[MemberTimelineItem]
    next_cursor: str | None


def encode_cursor(starts_at: datetime, session_id: uuid.UUID) -> str:
    """The position after the last entry of a page. Only a position: it grants nothing, so a client
    that edits it can at most jump to another place in what it may already see."""
    raw = json.dumps({"s": starts_at.isoformat(), "i": str(session_id)}).encode()
    return base64.urlsafe_b64encode(raw).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        position = datetime.fromisoformat(data["s"]), uuid.UUID(data["i"])
    except (binascii.Error, ValueError, KeyError, TypeError):
        raise HTTPException(status_code=422, detail="invalid_cursor")
    if position[0].tzinfo is None:  # a position must be a real instant
        raise HTTPException(status_code=422, detail="invalid_cursor")
    return position


@router.get("/{participant_id}/timeline")
async def timeline(
    participant_id: uuid.UUID,
    ctx: TenantCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: str | None = None,
) -> StaffTimeline | MemberTimeline:
    """The classes a participant is connected to, newest first (upcoming ones first), a page at a
    time: pass the previous response's `next_cursor` to continue (`null` = the last page).

    - **Coach or owner:** any participant of the studio. A class appears when the participant has
      an RSVP or attendance row for it, or a note. Every note is shown with its author and whether
      it is shared, and so is the summary of any class that has a report.
    - **Member:** only their own participant, otherwise `404 participant_not_found` (the same as
      for an id that does not exist). A class appears only through their own RSVP or attendance
      row, or a note shared with them, so a class with nothing but a private note never shows up
      (even an empty entry would reveal that such a note exists). Only shared notes are shown, and
      the summary only for classes they attended (`member_visible_summaries`).

    The page is found by position (`starts_at`, `id`) and not by counting rows (`OFFSET`), so it
    stays correct when new classes appear while someone scrolls, and it costs the same on page 50
    as on page 1. A malformed `cursor` is `422 invalid_cursor`.
    """
    staff = is_staff(ctx)
    known = select(Participant.id).where(
        Participant.id == participant_id, Participant.tenant_id == ctx.tenant_id
    )
    if not staff:
        known = known.where(Participant.user_id == ctx.user.id)  # only their own timeline
    if await session.scalar(known) is None:
        raise HTTPException(status_code=404, detail="participant_not_found")

    # Which notes may this caller see? A member: only the shared ones.
    note_filter = [
        ParticipantNote.participant_id == participant_id,
        ParticipantNote.tenant_id == ctx.tenant_id,
    ]
    if not staff:
        note_filter.append(ParticipantNote.shared_with_member.is_(True))

    connected = or_(
        select(Rsvp.session_id)
        .where(Rsvp.session_id == ClassSession.id, Rsvp.participant_id == participant_id)
        .exists(),
        select(ParticipantNote.session_id)
        .where(ParticipantNote.session_id == ClassSession.id, *note_filter)
        .exists(),
    )
    page = (
        select(ClassSession.id, ClassSession.starts_at, ClassSession.status, ClassType.name)
        .join(ClassType, ClassType.id == ClassSession.class_type_id)
        .where(ClassSession.tenant_id == ctx.tenant_id, connected)
        .order_by(ClassSession.starts_at.desc(), ClassSession.id.desc())
        .limit(limit + 1)  # one more than asked, to learn whether there is a next page
    )
    if cursor is not None:
        starts_at, session_id = decode_cursor(cursor)
        page = page.where(tuple_(ClassSession.starts_at, ClassSession.id) < (starts_at, session_id))
    rows = (await session.execute(page)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    ids = [row.id for row in rows]

    # Everything else for the page in one query each, not one per entry.
    bookings = {
        r.session_id: r
        for r in await session.execute(
            select(Rsvp.session_id, Rsvp.status, Rsvp.attended).where(
                Rsvp.participant_id == participant_id, Rsvp.session_id.in_(ids)
            )
        )
    }
    if staff:
        summary_rows = await session.execute(
            select(ClassReport.session_id, ClassReport.summary).where(
                ClassReport.tenant_id == ctx.tenant_id, ClassReport.session_id.in_(ids)
            )
        )
    else:
        summary_rows = await session.execute(member_visible_summaries(ctx, ids))
    summaries = {r.session_id: r.summary for r in summary_rows}
    notes: dict[uuid.UUID, list[ParticipantNote]] = {}
    for note in await session.scalars(
        select(ParticipantNote)
        .where(*note_filter, ParticipantNote.session_id.in_(ids))
        .order_by(ParticipantNote.created_at, ParticipantNote.id)
    ):
        notes.setdefault(note.session_id, []).append(note)

    def entry(row) -> dict:
        booking = bookings.get(row.id)
        return {
            "session_id": row.id,
            "starts_at": row.starts_at,
            "class_type_name": row.name,
            "status": row.status,
            "booking": booking.status if booking else None,
            "attended": booking.attended if booking else None,
            "summary": summaries.get(row.id),
        }

    next_cursor = encode_cursor(rows[-1].starts_at, rows[-1].id) if has_more else None
    if staff:
        return StaffTimeline(
            items=[
                StaffTimelineItem(
                    **entry(row),
                    notes=[
                        StaffTimelineNote(
                            id=n.id,
                            body=n.body,
                            created_at=n.created_at,
                            author_id=n.author_id,
                            shared_with_member=n.shared_with_member,
                        )
                        for n in notes.get(row.id, [])
                    ],
                )
                for row in rows
            ],
            next_cursor=next_cursor,
        )
    return MemberTimeline(
        items=[
            MemberTimelineItem(
                **entry(row),
                notes=[
                    TimelineNote(id=n.id, body=n.body, created_at=n.created_at)
                    for n in notes.get(row.id, [])
                ],
            )
            for row in rows
        ],
        next_cursor=next_cursor,
    )
