import uuid
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


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


async def issue_refresh_token(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[str, RefreshToken]:
    """Create a refresh token for the user. Returns the raw token (shown once, to the client)
    and its stored row. Flushes, so the row has its id; the caller commits."""
    raw = generate_refresh_token()
    row = RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw),
        expires_at=datetime.now(UTC) + REFRESH_TOKEN_TTL,
    )
    session.add(row)
    await session.flush()
    return raw, row


async def claim_refresh_token(session: AsyncSession, token_hash: str, now: datetime):
    """Atomically mark a usable token as revoked and return its (id, user_id), or None.

    One UPDATE does the check and the write, so of two simultaneous claims on the same token the
    second waits for the first's row lock, then re-checks `revoked_at IS NULL` and matches nothing.
    """
    result = await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
        )
        .values(revoked_at=now)
        .returning(RefreshToken.id, RefreshToken.user_id)
    )
    return result.first()


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
    refresh_token, _ = await issue_refresh_token(session, user.id)
    # First endpoint that writes: nothing is saved until commit. Commit last, after everything
    # that reads `user`, because commit expires loaded objects (reading them again would query).
    await session.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh")
async def refresh(
    body: RefreshRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> TokenResponse:
    """Trade a refresh token for a new access token and a new refresh token.

    Send the refresh token in the body; no Bearer header is needed, since the access token has
    expired. The old refresh token is used up (revoked and linked to its replacement), so the
    client must store the new one. Unknown, expired and already-used tokens all give the same
    `401 invalid_refresh_token`. Note: rotation alone does not stop a thief who refreshes before the
    real user; detecting reuse and revoking the whole login is step 13d.
    """
    claimed = await claim_refresh_token(
        session, hash_refresh_token(body.refresh_token), datetime.now(UTC)
    )
    if claimed is None:
        raise HTTPException(
            status_code=401,
            detail="invalid_refresh_token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    old_id, user_id = claimed

    # Claim, replacement and link are one transaction with one commit at the end: if anything
    # below raises, nothing is committed and the session closing rolls the claim back too, so the
    # original token stays usable.
    # ponytail: sliding expiry, the replacement gets a fresh 30 days, so a chain used at least
    # monthly never ends; add an absolute cap if sessions should not live forever.
    new_raw, new_row = await issue_refresh_token(session, user_id)
    await session.execute(
        update(RefreshToken).where(RefreshToken.id == old_id).values(replaced_by_id=new_row.id)
    )
    access_token = create_access_token(user_id)
    await session.commit()
    return TokenResponse(access_token=access_token, refresh_token=new_raw)


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
