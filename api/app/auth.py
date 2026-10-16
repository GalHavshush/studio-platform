from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import RefreshToken, User
from app.security import (
    DUMMY_HASH,
    REFRESH_TOKEN_TTL,
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LogoutRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@router.post("/login")
async def login(
    body: LoginRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> TokenResponse:
    """Exchange email + password for tokens.

    Returns a short-lived access token (JWT, 15 min) to send as `Authorization: Bearer ...`, and
    a long-lived refresh token (30 days). Any failure (unknown email, wrong password, account
    without a password) gives the same `401 invalid_credentials`.
    """
    user = await session.scalar(select(User).where(User.email == body.email.strip().lower()))
    # Always run one argon2 verify, in a thread: it is deliberately slow and would otherwise
    # block the event loop (every other request) while it runs.
    stored = user.password_hash if user and user.password_hash else DUMMY_HASH
    password_ok = await run_in_threadpool(verify_password, body.password, stored)

    # One identical error for unknown email, wrong password and no-password users: no enumeration.
    if not (user and user.password_hash and password_ok):
        raise HTTPException(
            status_code=401,
            detail="invalid_credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(user.id)
    refresh_token = generate_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(refresh_token),
            expires_at=datetime.now(UTC) + REFRESH_TOKEN_TTL,
        )
    )
    # First endpoint that writes: nothing is saved until commit. Commit last, after everything
    # that reads `user`, because commit expires loaded objects (reading them again would query).
    await session.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/logout", status_code=204)
async def logout(
    body: LogoutRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> Response:
    """Log out: revoke a refresh token so it can no longer be used.

    Send the refresh token in the body; no Bearer header is needed, since the access token has
    often expired by now. Always `204` for a well-formed request, including unknown or already
    revoked tokens. The access token stays valid until it expires, so the client should discard it.
    """
    # One atomic UPDATE. `revoked_at IS NULL` makes it a no-op the second time, so the original
    # revocation time is kept (idempotent) and there is no read-then-write gap to race through.
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_refresh_token(body.refresh_token),
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    await session.commit()
    return Response(status_code=204)
