import logging
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
logger = logging.getLogger(__name__)


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
    session: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID | None = None
) -> str:
    """Create a refresh token for the user, in the given family or (login) a new one. Returns the
    raw token (shown once, to the client); only its hash is stored. The caller commits."""
    raw = generate_refresh_token()
    row = RefreshToken(
        user_id=user_id,
        family_id=family_id or uuid.uuid4(),
        token_hash=hash_refresh_token(raw),
        expires_at=datetime.now(UTC) + REFRESH_TOKEN_TTL,
    )
    session.add(row)
    await session.flush()
    return raw


async def find_token_owner(session: AsyncSession, token_hash: str):
    """(user_id, family_id) of a token, or None. A plain read: both are fixed for a token's whole
    life, so it is safe to read before taking the lock; everything that can change is decided
    after the lock."""
    result = await session.execute(
        select(RefreshToken.user_id, RefreshToken.family_id).where(
            RefreshToken.token_hash == token_hash
        )
    )
    return result.first()


async def lock_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Make this user's token operations (refresh, logout) take turns until the transaction ends.

    FOR NO KEY UPDATE rather than FOR UPDATE: it does not block inserts that merely reference the
    user (a login creating a token), but it still conflicts with another such lock. Always take it
    before modifying any token row, so every operation locks in the same order.
    ponytail: one lock per user serializes all of a user's devices; use a per-family lock if
    contention ever matters.
    """
    await session.execute(select(User.id).where(User.id == user_id).with_for_update(key_share=True))


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


async def revoke_family(session: AsyncSession, family_id: uuid.UUID, now: datetime) -> int:
    """Revoke every still-usable token of one login (family); returns how many were revoked.

    `revoked_at IS NULL` keeps earlier revocation times and makes a repeat a no-op. Callers must
    hold the user lock (lock_user), so a refresh in flight cannot add a token this misses.
    """
    result = await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
        .returning(RefreshToken.id)
    )
    return len(result.all())


async def revoke_all_families(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> int:
    """Revoke every still-usable token of every login of this user (all devices); returns how many.

    Same rules as `revoke_family`: callers must hold the user lock, and `revoked_at IS NULL` keeps
    earlier revocation times. For account deletion now, and password reset (step 51) later.
    """
    result = await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
        .returning(RefreshToken.id)
    )
    return len(result.all())


def _invalid_refresh_token() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="invalid_refresh_token",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/login")
async def login(
    body: LoginRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> TokenResponse:
    """Exchange email + password for tokens.

    Returns a short-lived access token (JWT, 15 min) to send as `Authorization: Bearer ...`, and
    a long-lived refresh token (30 days). Any failure (unknown email, wrong password, account
    without a password) gives the same `401 invalid_credentials`.
    """
    email = body.email.strip().lower()
    # A NUL cannot be in any stored email (and Postgres would raise on the lookup): same as unknown.
    user = (
        None if "\x00" in email else await session.scalar(select(User).where(User.email == email))
    )
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
    refresh_token = await issue_refresh_token(session, user.id)
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
    expired. The old refresh token is used up (revoked and replaced), so the client must store
    the new one. Unknown, expired and already-used tokens all give the same
    `401 invalid_refresh_token`.

    Presenting an already-used token again counts as theft: the whole login (every token of that
    device) is revoked and the user must log in again. This includes two simultaneous refreshes
    with the same token, so clients must send one refresh at a time. Reuse is only noticed when the
    old token is presented; a thief who refreshes first and is never contradicted stays signed in
    until the tokens expire.
    """
    token_hash = hash_refresh_token(body.refresh_token)
    owner = await find_token_owner(session, token_hash)
    if owner is None:
        raise _invalid_refresh_token()
    user_id, family_id = owner
    await lock_user(session, user_id)  # a logout racing this refresh now waits for it to finish
    now = datetime.now(UTC)
    # The claim runs after the lock, so it sees the token as it is now, not as it was before waiting.
    claimed = await claim_refresh_token(session, token_hash, now)
    if claimed is None:
        revoked_at = await session.scalar(
            select(RefreshToken.revoked_at).where(RefreshToken.token_hash == token_hash)
        )
        if revoked_at is not None:
            # An already-used token came back, so two parties hold it and one may be a thief.
            # Every revocation except rotation revokes a whole family, so a revoked token whose
            # family still has usable tokens was rotated away: end the whole login.
            revoked = await revoke_family(session, family_id, now)
            # Commit BEFORE raising: an exception makes the session roll back, which would undo
            # the revocation and leave the thief's replacement token usable.
            await session.commit()
            if revoked:
                logger.warning(
                    "refresh token reuse: revoked %d token(s) of family %s (user %s)",
                    revoked,
                    family_id,
                    user_id,
                )
        raise _invalid_refresh_token()

    # Claim and replacement are one transaction with one commit at the end: if anything
    # below raises, nothing is committed and the session closing rolls the claim back too, so the
    # original token stays usable.
    # ponytail: sliding expiry, the replacement gets a fresh 30 days, so a chain used at least
    # monthly never ends (one family, many tokens); add an absolute cap if sessions should not live forever.
    new_raw = await issue_refresh_token(session, user_id, family_id)
    access_token = create_access_token(user_id)
    await session.commit()
    return TokenResponse(access_token=access_token, refresh_token=new_raw)


@router.post("/logout", status_code=204)
async def logout(
    body: LogoutRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> Response:
    """Log out: end this login by revoking the refresh token's whole family (the token itself and
    any it was rotated into or from), so none of them can be used again. Other devices' logins are
    not affected.

    Send the refresh token in the body; no Bearer header is needed, since the access token has
    often expired by now. Always `204` for a well-formed request, including unknown or already
    revoked tokens. The access token stays valid until it expires, so the client should discard it.
    """
    owner = await find_token_owner(session, hash_refresh_token(body.refresh_token))
    if owner is not None:
        user_id, family_id = owner
        # Wait for any refresh in flight for this user, so the UPDATE below also sees the
        # replacement token that refresh created.
        await lock_user(session, user_id)
        await revoke_family(session, family_id, datetime.now(UTC))
    await session.commit()
    return Response(status_code=204)
