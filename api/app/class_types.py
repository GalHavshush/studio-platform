import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import TenantContext, TenantCtx, require_role
from app.models import ClassType

router = APIRouter(prefix="/class-types", tags=["class types"])

# Only owners change class types; anyone in the studio can read them.
OwnerCtx = Annotated[TenantContext, Depends(require_role("owner"))]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ClassTypeIn(BaseModel):
    name: Name


class ClassTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


@router.get("")
async def list_class_types(
    ctx: TenantCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[ClassTypeOut]:
    """The class types of the studio named by `X-Tenant-Id`, ordered by name. Any member."""
    rows = await session.scalars(
        select(ClassType).where(ClassType.tenant_id == ctx.tenant_id).order_by(ClassType.name)
    )
    return [ClassTypeOut.model_validate(row) for row in rows]


@router.post("", status_code=201)
async def create_class_type(
    body: ClassTypeIn, ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> ClassTypeOut:
    """Create a class type in the studio named by `X-Tenant-Id`. Owner only.

    The studio comes from the verified header, never from the body.
    """
    row = ClassType(tenant_id=ctx.tenant_id, name=body.name)
    session.add(row)
    await session.flush()  # assigns the id
    created = ClassTypeOut.model_validate(row)  # read before commit, which expires `row`
    await session.commit()
    return created


@router.put("/{class_type_id}")
async def rename_class_type(
    class_type_id: uuid.UUID,
    body: ClassTypeIn,
    ctx: OwnerCtx,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ClassTypeOut:
    """Rename a class type of this studio. Owner only.

    A class type of another studio gets the same `404 class_type_not_found` as one that does not
    exist, so ids cannot be probed.
    """
    row = await session.scalar(
        select(ClassType).where(ClassType.id == class_type_id, ClassType.tenant_id == ctx.tenant_id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="class_type_not_found")
    row.name = body.name
    renamed = ClassTypeOut.model_validate(row)
    await session.commit()
    return renamed
