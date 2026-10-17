import asyncio
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import claim_refresh_token, find_token_owner, issue_refresh_token, lock_user
from app.models import RefreshToken
from app.security import hash_refresh_token
from app.seed import PILOT_PASSWORD


async def login(client) -> str:
    response = await client.post(
        "/auth/login", json={"email": "owner@example.com", "password": PILOT_PASSWORD}
    )
    return response.json()["refresh_token"]


async def owner_of(engine, raw_token):
    async with AsyncSession(engine) as session:
        return await find_token_owner(session, hash_refresh_token(raw_token))


async def test_logout_waits_for_an_in_flight_refresh_and_revokes_its_replacement(
    real_client, committed_engine, wait_for_lock_wait
):
    original = await login(real_client)
    user_id, family_id = await owner_of(committed_engine, original)

    # A refresh "in flight": it holds the user lock and has created the replacement, uncommitted.
    async with AsyncSession(committed_engine) as in_flight:
        await lock_user(in_flight, user_id)
        await claim_refresh_token(in_flight, hash_refresh_token(original), datetime.now(UTC))
        replacement = await issue_refresh_token(in_flight, user_id, family_id)

        logout = asyncio.create_task(
            real_client.post("/auth/logout", json={"refresh_token": original})
        )
        await wait_for_lock_wait(committed_engine)
        assert not logout.done()  # logout is waiting for the refresh, not racing it

        await in_flight.commit()
        response = await asyncio.wait_for(logout, timeout=5)

    assert response.status_code == 204
    async with AsyncSession(committed_engine) as session:
        family = (
            await session.scalars(select(RefreshToken).where(RefreshToken.family_id == family_id))
        ).all()
    assert len(family) == 2
    assert all(token.revoked_at is not None for token in family)  # the replacement too
    after = await real_client.post("/auth/refresh", json={"refresh_token": replacement})
    assert after.status_code == 401


async def test_refresh_waits_while_the_user_lock_is_held(
    real_client, committed_engine, wait_for_lock_wait
):
    token = await login(real_client)
    user_id, _ = await owner_of(committed_engine, token)

    async with AsyncSession(committed_engine) as other_operation:
        await lock_user(other_operation, user_id)
        refresh = asyncio.create_task(
            real_client.post("/auth/refresh", json={"refresh_token": token})
        )
        await wait_for_lock_wait(committed_engine)
        assert not refresh.done()
    # The lock is released when that session closes; the refresh then goes through.
    assert (await asyncio.wait_for(refresh, timeout=5)).status_code == 200


async def test_the_user_lock_does_not_block_a_login(real_client, committed_engine):
    token = await login(real_client)
    user_id, _ = await owner_of(committed_engine, token)

    async with AsyncSession(committed_engine) as other_operation:
        await lock_user(other_operation, user_id)
        # A login inserts a row that references the user. FOR NO KEY UPDATE lets that through;
        # a plain FOR UPDATE would make this hang until the timeout.
        again = await asyncio.wait_for(login(real_client), timeout=5)

    assert again != token
