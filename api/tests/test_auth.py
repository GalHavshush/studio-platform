import jwt
import pytest
from sqlalchemy import select, update

from app.config import get_settings
from app.models import User
from app.security import ACCESS_TOKEN_TTL
from app.seed import PILOT_PASSWORD, seed


@pytest.fixture(autouse=True)
async def seeded(db_session):
    await seed(db_session)


async def login(client, email, password):
    return await client.post("/auth/login", json={"email": email, "password": password})


async def test_login_returns_a_signed_token_for_the_user(client, db_session):
    response = await login(client, "owner@example.com", PILOT_PASSWORD)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    claims = jwt.decode(body["access_token"], get_settings().jwt_secret, algorithms=["HS256"])
    user_id = await db_session.scalar(select(User.id).where(User.email == "owner@example.com"))
    assert claims["sub"] == str(user_id)
    assert claims["exp"] - claims["iat"] == ACCESS_TOKEN_TTL.total_seconds()


async def test_login_email_is_case_insensitive(client):
    response = await login(client, "  Owner@Example.com ", PILOT_PASSWORD)

    assert response.status_code == 200


async def test_wrong_password_unknown_email_and_no_password_get_the_same_401(client, db_session):
    await db_session.execute(
        update(User).where(User.email == "coach@example.com").values(password_hash=None)
    )

    responses = [
        await login(client, "owner@example.com", "wrong-password"),
        await login(client, "nobody@example.com", PILOT_PASSWORD),
        await login(client, "coach@example.com", PILOT_PASSWORD),
    ]

    assert {r.status_code for r in responses} == {401}
    assert len({r.text for r in responses}) == 1  # identical bodies: nothing to enumerate with
    assert responses[0].json() == {"detail": "invalid_credentials"}
