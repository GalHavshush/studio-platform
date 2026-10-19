import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, ConfigDict, StringConstraints, model_validator
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantContext, TenantCtx, require_role
from app.models import ClassSession, ClassType, Membership

router = APIRouter(prefix="/sessions", tags=["sessions"])

# So a schedule query cannot pull the whole table. ponytail: fixed cap; add pagination if a studio needs more.
MAX_RANGE = timedelta(days=62)

# Coaches and owners create sessions (owners can do everything coaches can).
CoachCtx = Annotated[TenantContext, Depends(require_role("coach"))]


class SessionIn(BaseModel):
    class_type_id: uuid.UUID
    # AwareDatetime rejects a time without an offset (422): we never guess the studio's timezone.
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    # Omitted = the caller teaches it.
    coach_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def ends_after_start(self) -> "SessionIn":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


Preview = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class SessionPatch(BaseModel):
    """A field that is left out stays unchanged; `preview: null` clears the preview."""

    preview: Preview | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    coach_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def only_preview_can_be_cleared(self) -> "SessionPatch":
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


async def _own_session(
    session_id: uuid.UUID, ctx: TenantContext, session: AsyncSession
) -> ClassSession:
    """The session to change, or raise: 404 if it is not in this studio, 403 `not_your_session`
    if a coach (not an owner) is not its coach."""
    row = await session.scalar(
        select(ClassSession).where(
            ClassSession.id == session_id, ClassSession.tenant_id == ctx.tenant_id
        )
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
