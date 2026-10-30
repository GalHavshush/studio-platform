"""The reports a coach or owner can write: classes that already took place, each with whether its
report exists yet. It is a list for the app to show "reports to write"; writing is `PUT
/sessions/{id}/report` (reports.py), and this file lists exactly the sessions that route accepts."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import ClassReport, ClassSession, ClassType
from app.sessions import CoachCtx, check_range

# Its own path, not under /sessions: "/sessions/report-queue" would be read as a session id.
router = APIRouter(prefix="/report-queue", tags=["reports"])


class QueueItem(BaseModel):
    session_id: uuid.UUID
    class_type_name: str
    starts_at: datetime
    ends_at: datetime
    # A report that holds only notes counts: a row exists, so the class has been written up.
    has_report: bool


class Queue(BaseModel):
    items: list[QueueItem]
    # True when a class this caller could write a report for started before `from`: the app shows
    # "Show earlier" only while there is something to show.
    has_earlier: bool


@router.get("")
async def report_queue(
    ctx: CoachCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
    from_: Annotated[AwareDatetime, Query(alias="from")],
    to: AwareDatetime,
) -> Queue:
    """The classes starting in `[from, to)` whose report the caller may write, newest first. A
    coach gets their own classes, an owner every class of the studio (the rule of `PUT
    /sessions/{id}/report`); a member gets `403 insufficient_role`.

    Only classes that have started and were not cancelled are listed, because those are the ones
    that route accepts (`409 session_not_started`, `409 session_cancelled` otherwise). The range
    follows the schedule's rules: `from` included, `to` not, at most 62 days (`422 invalid_range`,
    `422 range_too_long`). The class type's name and whether a report exists come from joins, so a
    long list costs no more round trips than a short one; `has_earlier` is one more `EXISTS` query.
    """
    check_range(from_, to)
    # What makes a class one this caller may write a report for, wherever it falls in time.
    eligible = [
        ClassSession.tenant_id == ctx.tenant_id,
        ClassSession.starts_at <= datetime.now(UTC),
        ClassSession.status != "cancelled",
    ]
    if ctx.role == "coach":  # the same rule as `own_session`; an owner sees every class
        eligible.append(ClassSession.coach_id == ctx.user.id)
    query = (
        select(
            ClassSession.id,
            ClassType.name,
            ClassSession.starts_at,
            ClassSession.ends_at,
            ClassReport.session_id.is_not(None),
        )
        .join(
            ClassType,
            (ClassType.tenant_id == ClassSession.tenant_id)
            & (ClassType.id == ClassSession.class_type_id),
        )
        .outerjoin(ClassReport, ClassReport.session_id == ClassSession.id)
        .where(*eligible, ClassSession.starts_at >= from_, ClassSession.starts_at < to)
        .order_by(ClassSession.starts_at.desc(), ClassSession.id)
    )
    rows = await session.execute(query)
    has_earlier = await session.scalar(
        select(exists().where(*eligible, ClassSession.starts_at < from_))
    )
    return Queue(
        items=[
            QueueItem(
                session_id=r[0], class_type_name=r[1], starts_at=r[2], ends_at=r[3], has_report=r[4]
            )
            for r in rows
        ],
        has_earlier=bool(has_earlier),
    )
