from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.models import RefreshToken
from app.security import hash_refresh_token
from app.seed import PILOT_PASSWORD, seed


@pytest.fixture(autouse=True)
async def seeded(db_session):
    await seed(db_session)


async def login(client, email="owner@example.com") -> str:
    response = await client.post("/auth/login", json={"email": email, "password": PILOT_PASSWORD})
    return response.json()["refresh_token"]


async def logout(client, refresh_token):
    return await client.post("/auth/logout", json={"refresh_token": refresh_token})


async def revoked_at(db_session, refresh_token):
    return await db_session.scalar(
        select(RefreshToken.revoked_at).where(
            RefreshToken.token_hash == hash_refresh_token(refresh_token)
        )
    )


async def test_logout_marks_the_token_revoked(client, db_session):
    token = await login(client)
    assert await revoked_at(db_session, token) is None

    response = await logout(client, token)

    assert response.status_code == 204
    assert response.content == b""
    assert abs(await revoked_at(db_session, token) - datetime.now(UTC)) < timedelta(minutes=1)


async def test_second_logout_keeps_the_first_revocation_time(client, db_session):
    token = await login(client)
    first = datetime(2020, 1, 1, tzinfo=UTC)  # a fixed time the test controls: no clock mocking
    await db_session.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(token))
        .values(revoked_at=first)
    )

    response = await logout(client, token)

    assert response.status_code == 204
    assert await revoked_at(db_session, token) == first  # an overwrite would show "now" here


async def test_unknown_token_gets_204_and_changes_nothing(client, db_session):
    token = await login(client)

    response = await logout(client, "not-a-token-we-ever-issued")

    assert response.status_code == 204
    assert await revoked_at(db_session, token) is None


async def test_logout_leaves_other_logins_untouched(client, db_session):
    this_device = await login(client)
    other_device = await login(client)  # same user, second login
    other_user = await login(client, "coach@example.com")

    await logout(client, this_device)

    assert await revoked_at(db_session, this_device) is not None
    assert await revoked_at(db_session, other_device) is None
    assert await revoked_at(db_session, other_user) is None


async def test_malformed_body_is_a_validation_error_not_a_success(client):
    response = await client.post("/auth/logout", json={})

    assert response.status_code == 422


async def test_logout_with_a_rotated_token_revokes_its_replacements(client, db_session):
    a = await login(client)
    b = (await client.post("/auth/refresh", json={"refresh_token": a})).json()["refresh_token"]
    other_device = await login(client)

    await logout(client, a)  # a is already used up, but it still identifies this login

    assert await revoked_at(db_session, b) is not None
    assert await revoked_at(db_session, other_device) is None
    refreshed = await client.post("/auth/refresh", json={"refresh_token": b})
    assert refreshed.status_code == 401
