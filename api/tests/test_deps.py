import base64
import json
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.config import get_settings
from app.db import get_session
from app.deps import CurrentUser
from app.models import User
from app.security import create_access_token
from app.seed import seed


# No real endpoint uses current_user until GET /me (step 12), so the tests mount a throwaway
# route on their own app instead of shipping a dummy endpoint.
@pytest.fixture
async def protected(db_session):
    test_app = FastAPI()

    @test_app.get("/protected")
    async def protected_route(user: CurrentUser):
        return {"id": str(user.id)}

    test_app.dependency_overrides[get_session] = lambda: db_session
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def owner(db_session) -> User:
    await seed(db_session)
    return await db_session.scalar(select(User).where(User.email == "owner@example.com"))


def make_token(sub, *, expires_in=timedelta(minutes=5), secret=None, algorithm="HS256"):
    now = datetime.now(UTC)
    claims = {"sub": str(sub), "iat": now, "exp": now + expires_in}
    return jwt.encode(claims, secret or get_settings().jwt_secret, algorithm=algorithm)


def get(client, token):
    return client.get("/protected", headers={"Authorization": f"Bearer {token}"})


async def test_valid_token_returns_the_user(protected, owner):
    response = await get(protected, create_access_token(owner.id))

    assert response.status_code == 200
    assert response.json() == {"id": str(owner.id)}


async def test_missing_or_non_bearer_header_is_not_authenticated(protected):
    for headers in ({}, {"Authorization": "Basic dXNlcjpwYXNz"}):
        response = await protected.get("/protected", headers=headers)

        assert response.status_code == 401
        assert response.json() == {"detail": "not_authenticated"}


async def test_expired_token_says_so(protected, owner):
    response = await get(protected, make_token(owner.id, expires_in=timedelta(minutes=-1)))

    assert response.status_code == 401
    assert response.json() == {"detail": "token_expired"}


async def test_tampered_payload_is_rejected(protected, owner):
    # Swap in a different user id but keep the original signature: it no longer matches.
    header, _, signature = create_access_token(owner.id).split(".")
    forged = {
        "sub": str(uuid.uuid4()),
        "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
    }
    payload = base64.urlsafe_b64encode(json.dumps(forged).encode()).rstrip(b"=").decode()

    response = await get(protected, f"{header}.{payload}.{signature}")

    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_token"}


@pytest.mark.filterwarnings("ignore::jwt.warnings.InsecureKeyLengthWarning")  # HS512 case
@pytest.mark.parametrize(
    "token_for",
    [
        lambda uid: make_token(uid, secret="x" * 40),  # signed with some other secret
        lambda uid: make_token(uid, algorithm="HS512"),  # right secret, algorithm not allowed
        lambda uid: jwt.encode({"sub": str(uid)}, "", algorithm="none"),  # unsigned "none" token
        lambda uid: "not-a-jwt",
        lambda uid: make_token("not-a-uuid"),  # validly signed but sub isn't a user id
        lambda uid: make_token(uuid.uuid4()),  # validly signed for a user that doesn't exist
    ],
)
async def test_other_bad_tokens_are_invalid(protected, owner, token_for):
    response = await get(protected, token_for(owner.id))

    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_token"}
