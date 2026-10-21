import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import func, select, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantContext, TenantCtx, require_role, studio_has_module
from app.models import ClassType
from app.text import NoNul

router = APIRouter(prefix="/class-types", tags=["class types"])

# Only owners change class types; anyone in the studio can read them.
OwnerCtx = Annotated[TenantContext, Depends(require_role("owner"))]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NoNul]


class ClassTypeIn(BaseModel):
    name: Name
    # Omitted: `rsvp` when creating, unchanged when updating.
    attendance_mode: Literal["rsvp", "booking"] | None = None


class ClassTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    attendance_mode: str
    archived_at: datetime | None


async def _require_booking_module(
    session: AsyncSession, ctx: TenantContext, new_mode: str | None, current_mode: str
) -> None:
    """Switching a class type TO `booking` needs the studio's booking module (403 `module_disabled`).

    Only a change is checked: renaming a booking type or sending `booking` again is fine even if
    the module was switched off since, and going back to `rsvp` is always allowed.
    """
    if (
        new_mode == "booking"
        and current_mode != "booking"
        and not await studio_has_module(session, ctx.tenant_id, "booking")
    ):
        raise HTTPException(status_code=403, detail="module_disabled")


async def _require_free_name(
    session: AsyncSession, ctx: TenantContext, name: str, own_id: uuid.UUID | None = None
) -> None:
    """A name another class type of the studio has (any letter case, archived or not) is a 409.

    The common case, answered before anything is written. The unique index is what really
    guarantees it: see `_flush_or_name_taken` for two requests that pass this check together.
    """
    taken = await session.scalar(
        select(ClassType.id).where(
            ClassType.tenant_id == ctx.tenant_id,
            func.lower(ClassType.name) == name.lower(),
            ClassType.id != own_id if own_id else true(),
        )
    )
    if taken is not None:
        raise HTTPException(status_code=409, detail="class_type_name_taken")


async def _flush_or_name_taken(session: AsyncSession) -> None:
    """Write pending changes; if the unique index refuses the name (a simultaneous request got
    there between `_require_free_name` and now) it is the same 409."""
    try:
        await session.flush()
    except IntegrityError as error:
        if "uq_class_types_tenant_id_lower_name" not in str(error.orig):
            raise
        raise HTTPException(status_code=409, detail="class_type_name_taken")


@router.get("")
async def list_class_types(
    ctx: TenantCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
    include_archived: bool = False,
) -> list[ClassTypeOut]:
    """The class types of the studio named by `X-Tenant-Id`, ordered by name. Any member.

    Archived ones are hidden unless `?include_archived=true`.
    """
    query = select(ClassType).where(ClassType.tenant_id == ctx.tenant_id)
    if not include_archived:
        query = query.where(ClassType.archived_at.is_(None))
    rows = await session.scalars(query.order_by(ClassType.name))
    return [ClassTypeOut.model_validate(row) for row in rows]


@router.post("", status_code=201)
async def create_class_type(
    body: ClassTypeIn, ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> ClassTypeOut:
    """Create a class type in the studio named by `X-Tenant-Id`. Owner only.

    The studio comes from the verified header, never from the body. `attendance_mode` defaults to
    `rsvp`; `booking` needs the studio's booking module (`403 module_disabled`). A name the studio
    already has, in any letter case and even on an archived type, is `409 class_type_name_taken`.
    """
    await _require_booking_module(session, ctx, body.attendance_mode, current_mode="rsvp")
    await _require_free_name(session, ctx, body.name)
    row = ClassType(
        tenant_id=ctx.tenant_id, name=body.name, attendance_mode=body.attendance_mode or "rsvp"
    )
    session.add(row)
    await _flush_or_name_taken(session)  # also assigns the id
    created = ClassTypeOut.model_validate(row)  # read before commit, which expires `row`
    await session.commit()
    return created


@router.put("/{class_type_id}")
async def update_class_type(
    class_type_id: uuid.UUID,
    body: ClassTypeIn,
    ctx: OwnerCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ClassTypeOut:
    """Rename a class type of this studio, and optionally change its attendance mode. Owner only.

    An omitted `attendance_mode` leaves the mode as it is; switching to `booking` needs the booking
    module (`403 module_disabled`). A name another class type of the studio has is
    `409 class_type_name_taken` (renaming to its own name, or only changing its case, is fine).

    A class type of another studio gets the same `404 class_type_not_found` as one that does not
    exist, so ids cannot be probed.
    """
    row = await session.scalar(
        select(ClassType).where(ClassType.id == class_type_id, ClassType.tenant_id == ctx.tenant_id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="class_type_not_found")
    await _require_booking_module(session, ctx, body.attendance_mode, row.attendance_mode)
    await _require_free_name(session, ctx, body.name, own_id=row.id)
    row.name = body.name
    if body.attendance_mode is not None:
        row.attendance_mode = body.attendance_mode
    await _flush_or_name_taken(session)
    renamed = ClassTypeOut.model_validate(row)
    await session.commit()
    return renamed


async def _set_archived(
    class_type_id: uuid.UUID, ctx: TenantContext, session: AsyncSession, archived: bool
) -> ClassTypeOut:
    """Archive or unarchive a class type of this studio, and return it.

    The guarded UPDATE only touches a row that is not already in the target state, so repeating a
    request changes nothing and an archived type keeps its first `archived_at`.
    """
    row = await session.scalar(
        select(ClassType).where(ClassType.id == class_type_id, ClassType.tenant_id == ctx.tenant_id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="class_type_not_found")
    await session.execute(
        update(ClassType)
        .where(
            ClassType.id == class_type_id,
            ClassType.archived_at.is_(None) if archived else ClassType.archived_at.is_not(None),
        )
        .values(archived_at=datetime.now(UTC) if archived else None)
    )
    await session.refresh(row)  # the UPDATE bypassed the loaded object
    result = ClassTypeOut.model_validate(row)
    await session.commit()
    return result


@router.post("/{class_type_id}/archive")
async def archive_class_type(
    class_type_id: uuid.UUID,
    ctx: OwnerCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ClassTypeOut:
    """Hide a class type and stop new sessions from using it. Owner only; repeating is fine (200).

    Existing sessions, reports and notes are untouched. Another studio's class type gets the same
    `404 class_type_not_found` as a missing one.
    """
    return await _set_archived(class_type_id, ctx, session, archived=True)


@router.post("/{class_type_id}/unarchive")
async def unarchive_class_type(
    class_type_id: uuid.UUID,
    ctx: OwnerCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ClassTypeOut:
    """Make an archived class type active again. Owner only; repeating is fine (200)."""
    return await _set_archived(class_type_id, ctx, session, archived=False)
