"""Who can teach a class: the studio's coaches and owners. For the owner's "choose the coach" picker;
the same rule as `is_staff` in sessions.py, so every name listed is accepted as `coach_id`."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.class_types import OwnerCtx
from app.db import get_session
from app.models import Membership, User

router = APIRouter(prefix="/staff", tags=["staff"])


class StaffOut(BaseModel):
    id: uuid.UUID  # the user id, what `coach_id` takes
    name: str
    role: str


@router.get("")
async def list_staff(
    ctx: OwnerCtx, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[StaffOut]:
    """The coaches and owners of this studio, by name. Owner only: nobody else may name a coach.
    No emails: the picker needs only a name to show and an id to send."""
    rows = await session.execute(
        select(User.id, User.name, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == ctx.tenant_id, Membership.role.in_(["coach", "owner"]))
        .order_by(User.name, User.id)  # id: a stable order for equal names
    )
    return [StaffOut(id=i, name=n, role=r) for i, n, r in rows]
