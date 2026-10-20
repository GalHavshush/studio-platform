import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Membership, Tenant, User
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


# Roles are cumulative: an owner can do everything a coach can, and a coach everything a member can.
ROLE_RANK = {"member": 0, "coach": 1, "owner": 2}


def require_role(min_role: str) -> Callable[[TenantContext], Awaitable[TenantContext]]:
    """Build a dependency that passes when the user's role in the studio is `min_role` or higher.

    Authentication (token) and tenancy (membership) are already settled by TenantCtx; this adds
    authorization: what that role may do. Too low a role gives 403 `insufficient_role`. A role
    missing from ROLE_RANK ranks below everyone, so an unknown role is refused, never let through.
    """
    needed = ROLE_RANK[min_role]  # a typo in min_role fails when the app loads, not per request

    async def dependency(ctx: TenantCtx) -> TenantContext:
        if ROLE_RANK.get(ctx.role, -1) < needed:
            raise HTTPException(status_code=403, detail="insufficient_role")
        return ctx

    return dependency


# The optional modules a studio can switch on (tenants.modules). Add a name here with its feature.
KNOWN_MODULES = {"booking"}


async def studio_has_module(session: AsyncSession, tenant_id: uuid.UUID, name: str) -> bool:
    """Whether the studio has switched `name` on. For handlers that serve studios with and without
    the module; a route that exists only for a module uses `require_module` instead."""
    modules = await session.scalar(select(Tenant.modules).where(Tenant.id == tenant_id))
    return name in (modules or [])


def require_module(name: str) -> Callable[[TenantContext], Awaitable[TenantContext]]:
    """Build a dependency that passes only when the studio has switched `name` on.

    Sits on top of TenantCtx, so the membership check comes first (a stranger still gets
    `not_a_member`). A disabled module gives 403 `module_disabled`. For routes that exist only for
    a module; a route that also serves studios without it checks `tenants.modules` itself.
    """
    if name not in KNOWN_MODULES:  # a typo fails when the app loads, not per request
        raise ValueError(f"unknown module: {name}")

    async def dependency(
        ctx: TenantCtx, session: Annotated[AsyncSession, Depends(get_session)]
    ) -> TenantContext:
        if not await studio_has_module(session, ctx.tenant_id, name):
            raise HTTPException(status_code=403, detail="module_disabled")
        return ctx

    return dependency
