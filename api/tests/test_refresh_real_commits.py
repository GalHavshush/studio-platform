import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.auth
from app.auth import claim_refresh_token
from app.models import RefreshToken, User
from app.security import hash_refresh_token
from app.seed import PILOT_PASSWORD


async def test_failed_replacement_rolls_back_everything(real_client, committed_engine, monkeypatch):
    engine = committed_engine
    login = await real_client.post(
        "/auth/login", json={"email": "owner@example.com", "password": PILOT_PASSWORD}
    )
    original = login.json()["refresh_token"]

    async def boom(*args, **kwargs):
        raise RuntimeError("could not create the replacement token")

    with monkeypatch.context() as patched:
        patched.setattr(app.auth, "issue_refresh_token", boom)  # fails after the claim ran
        failed = await real_client.post("/auth/refresh", json={"refresh_token": original})
    assert failed.status_code == 500

    async with AsyncSession(engine) as session:  # a fresh connection sees only committed data
        row = await session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(original))
        )
        assert row.revoked_at is None
        assert len((await session.scalars(select(RefreshToken))).all()) == 1
    # And the original token still works.
    retry = await real_client.post("/auth/refresh", json={"refresh_token": original})
    assert retry.status_code == 200


async def test_two_simultaneous_claims_only_one_wins(committed_engine, wait_for_lock_wait):
    engine = committed_engine
    token_hash = hash_refresh_token("the-one-token")
    async with AsyncSession(engine) as session:
        user_id = await session.scalar(select(User.id).where(User.email == "owner@example.com"))
        session.add(
            RefreshToken(
                user_id=user_id,
                family_id=uuid.uuid4(),
                token_hash=token_hash,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await session.commit()

    now = datetime.now(UTC)
    async with AsyncSession(engine) as first, AsyncSession(engine) as second:
        won = await claim_refresh_token(first, token_hash, now)  # holds the row lock, uncommitted
        assert won is not None

        loser = asyncio.create_task(claim_refresh_token(second, token_hash, now))
        await wait_for_lock_wait(engine)
        assert not loser.done()  # blocked behind the first claim

        await first.commit()  # releases the lock; the second UPDATE re-checks revoked_at IS NULL
        assert await asyncio.wait_for(loser, timeout=5) is None
