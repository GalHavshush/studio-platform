import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import find_token_owner, lock_user
from app.models import RefreshToken
from app.security import hash_refresh_token
from app.seed import PILOT_PASSWORD


async def login(client) -> str:
    response = await client.post(
        "/auth/login", json={"email": "owner@example.com", "password": PILOT_PASSWORD}
    )
    return response.json()["refresh_token"]


async def refresh(client, token):
    return await client.post("/auth/refresh", json={"refresh_token": token})


async def test_the_revocation_survives_the_401(real_client, committed_engine):
    original = await login(real_client)
    replacement = (await refresh(real_client, original)).json()["refresh_token"]

    reuse = await refresh(real_client, original)  # the old token comes back

    assert reuse.status_code == 401
    # A fresh connection sees only committed data: the revocation was committed before the 401
    # was raised, not rolled back with it.
    async with AsyncSession(committed_engine) as session:
        row = await session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(replacement))
        )
    assert row.revoked_at is not None


async def test_two_simultaneous_refreshes_with_one_token_log_the_device_out(
    real_client, committed_engine, wait_for_lock_wait
):
    token = await login(real_client)
    async with AsyncSession(committed_engine) as session:
        user_id, _ = await find_token_owner(session, hash_refresh_token(token))

    async with AsyncSession(committed_engine) as holder:
        await lock_user(holder, user_id)  # both requests queue up behind this lock
        first = asyncio.create_task(refresh(real_client, token))
        second = asyncio.create_task(refresh(real_client, token))
        await wait_for_lock_wait(committed_engine)
    # leaving the block closes the session and releases the lock

    responses = await asyncio.wait_for(asyncio.gather(first, second), timeout=10)

    assert sorted(r.status_code for r in responses) == [200, 401]
    winner = next(r for r in responses if r.status_code == 200).json()["refresh_token"]
    # The loser looked like reuse, so the winner's brand-new token was revoked too. This is why
    # clients must send one refresh at a time.
    assert (await refresh(real_client, winner)).status_code == 401
