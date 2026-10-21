import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deletion import delete_account
from app.deps import CurrentUser
from app.models import Membership, Tenant
from app.security import verify_password

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


class DeleteAccountRequest(BaseModel):
    password: str


@router.delete("/me", status_code=204)
async def delete_me(
    body: DeleteAccountRequest,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Delete the logged-in user's own account, confirmed with their current password.

    This cannot be undone. Everything that identifies them is erased or anonymized in one
    transaction (see `app/deletion.py` for exactly what), and every login of theirs stops working
    at once. A wrong password is `403 invalid_password`; an account without a password cannot be
    confirmed yet (`409 reauthentication_unavailable`; Google/Apple accounts, step 53); the only
    owner of a studio that still has other members gets `409 transfer_ownership_first`.
    """
    if user.password_hash is None:
        raise HTTPException(status_code=409, detail="reauthentication_unavailable")
    # Argon2 is deliberately slow: run it off the event loop, as login does.
    if not await run_in_threadpool(verify_password, body.password, user.password_hash):
        raise HTTPException(status_code=403, detail="invalid_password")
    await delete_account(session, user)
    await session.commit()
