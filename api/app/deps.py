import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Membership, User
from app.security import decode_access_token

# auto_error=False: we raise our own 401 so every auth failure has the same shape. Declaring the
# scheme here is also what puts the Authorize button in /docs.
bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(code: str) -> HTTPException:
    return HTTPException(status_code=401, detail=code, headers={"WWW-Authenticate": "Bearer"})


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Resolve the Bearer token in the request to a User, or raise 401.

    Token checks (signature, expiry) need no DB; the lookup afterwards only loads the account.
    Codes: not_authenticated = no usable header, token_expired = refresh, invalid_token = log in again.
    """
    if credentials is None:
        raise _unauthorized("not_authenticated")
    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("token_expired")  # the app can refresh (step 13) instead of logging out
    except jwt.InvalidTokenError:
        raise _unauthorized("invalid_token")

    # A valid signature only proves we issued the token; the user may have been deleted since.
    user = await session.get(User, user_id)
    if user is None:
        raise _unauthorized("invalid_token")
    return user


# Endpoints write `user: CurrentUser` to require a logged-in user.
CurrentUser = Annotated[User, Depends(current_user)]


@dataclass(frozen=True)
class TenantContext:
    """Who is acting, in which studio, and with which role there. Only built after the membership
    was checked, so `tenant_id` and `role` can be trusted."""

    user: User
    tenant_id: uuid.UUID
    role: str  # the stored role: "owner", "coach" or "member"


async def tenant_ctx(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    x_tenant_id: Annotated[str | None, Header()] = None,
) -> TenantContext:
    """Resolve the studio named by the `X-Tenant-Id` header into a TenantContext, or raise.

    The client names the studio, so the header is only a claim: the membership lookup is the
    check. 401 comes first (current_user), then 400 for a missing or malformed header, then 403
    when the user has no membership there. A studio that does not exist gets the same 403, so
    ids cannot be probed. The role is not in the token: removing a membership takes effect on
    the very next request.
    """
    if x_tenant_id is None:
        raise HTTPException(status_code=400, detail="missing_tenant_id")
    try:
        tenant_id = uuid.UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_tenant_id")

    role = await session.scalar(
        select(Membership.role).where(
            Membership.user_id == user.id, Membership.tenant_id == tenant_id
        )
    )
    if role is None:
        raise HTTPException(status_code=403, detail="not_a_member")
    return TenantContext(user=user, tenant_id=tenant_id, role=role)


# Tenant-scoped endpoints write `ctx: TenantCtx`; every query in them must filter by ctx.tenant_id.
TenantCtx = Annotated[TenantContext, Depends(tenant_ctx)]
