import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import RefreshToken, User
from app.security import REFRESH_TOKEN_TTL, hash_refresh_token
from app.seed import PILOT_PASSWORD, seed

FUTURE = datetime.now(UTC) + timedelta(days=1)


async def login(client, email="owner@example.com", password=PILOT_PASSWORD):
    return await client.post("/auth/login", json={"email": email, "password": password})


async def count_tokens(session):
    return await session.scalar(select(func.count()).select_from(RefreshToken))


# --- the table ---


async def test_duplicate_token_hash_is_rejected(db_session):
    user = User(email="a@example.com", name="A")
    db_session.add(user)
    await db_session.flush()
    db_session.add_all(
        [
            RefreshToken(
                user_id=user.id, family_id=uuid.uuid4(), token_hash="same", expires_at=FUTURE
            ),
            RefreshToken(
                user_id=user.id, family_id=uuid.uuid4(), token_hash="same", expires_at=FUTURE
            ),
        ]
    )

    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_token_for_a_missing_user_is_rejected(db_session):
    db_session.add(
        RefreshToken(
            user_id=uuid.uuid4(), family_id=uuid.uuid4(), token_hash="h", expires_at=FUTURE
        )
    )

    with pytest.raises(IntegrityError):
        await db_session.flush()


# --- login issues one ---


@pytest.fixture
async def seeded(db_session):
    await seed(db_session)


async def test_login_returns_a_refresh_token_stored_only_as_a_hash(client, db_session, seeded):
    response = await login(client)

    raw = response.json()["refresh_token"]
    row = await db_session.scalar(select(RefreshToken))
    owner_id = await db_session.scalar(select(User.id).where(User.email == "owner@example.com"))
    assert row.token_hash == hash_refresh_token(raw)
    assert row.token_hash != raw  # the raw token is never stored
    assert row.user_id == owner_id
    expected_expiry = datetime.now(UTC) + REFRESH_TOKEN_TTL
    assert abs(row.expires_at - expected_expiry) < timedelta(minutes=1)


async def test_each_login_issues_a_different_refresh_token(client, db_session, seeded):
    first = (await login(client)).json()["refresh_token"]
    second = (await login(client)).json()["refresh_token"]

    assert first != second
    assert await count_tokens(db_session) == 2


async def test_failed_login_stores_no_refresh_token(client, db_session, seeded):
    await login(client, password="wrong-password")
    await login(client, email="nobody@example.com")

    assert await count_tokens(db_session) == 0
