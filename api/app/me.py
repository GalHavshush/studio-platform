import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import CurrentUser
from app.models import Membership, Tenant

router = APIRouter(tags=["me"])


# These are the only fields that ever leave the API. Returning the User row directly would send
# every column, password_hash included; a response model makes the public shape explicit.
class TenantOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str


class MembershipOut(BaseModel):
    tenant: TenantOut
    role: str


class MeResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    locale: str
    memberships: list[MembershipOut]


@router.get("/me")
async def me(
    user: CurrentUser, session: Annotated[AsyncSession, Depends(get_session)]
) -> MeResponse:
    """The logged-in user's profile and the studios they belong to, with their role in each.

    Requires `Authorization: Bearer <access token>`; otherwise `401`.
    """
    # A join instead of ORM relationship()s: one query, and no new concept yet.
    rows = await session.execute(
        select(Tenant, Membership.role)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .where(Membership.user_id == user.id)
        .order_by(Tenant.name)
    )
    return MeResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        locale=user.locale,
        memberships=[
            MembershipOut(tenant=TenantOut.model_validate(tenant, from_attributes=True), role=role)
            for tenant, role in rows
        ],
    )
