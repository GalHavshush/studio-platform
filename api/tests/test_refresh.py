from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import select, update

from app.config import get_settings
from app.models import RefreshToken, User
from app.security import REFRESH_TOKEN_TTL, hash_refresh_token
from app.seed import PILOT_PASSWORD, seed


@pytest.fixture(autouse=True)
async def seeded(db_session):
    await seed(db_session)


async def login(client, email="owner@example.com") -> dict:
    response = await client.post("/auth/login", json={"email": email, "password": PILOT_PASSWORD})
    return response.json()


async def refresh(client, refresh_token):
    return await client.post("/auth/refresh", json={"refresh_token": refresh_token})


async def row_for(db_session, raw_token) -> RefreshToken:
    return await db_session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw_token))
    )


async def test_refresh_returns_a_new_working_pair(client):
    old = await login(client)

    response = await refresh(client, old["refresh_token"])

    assert response.status_code == 200
    new = response.json()
    assert new["refresh_token"] != old["refresh_token"]
    me = await client.get("/me", headers={"Authorization": f"Bearer {new['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "owner@example.com"


async def test_rotation_revokes_the_old_token_and_links_the_new_one(client, db_session):
    old = await login(client)

    new = (await refresh(client, old["refresh_token"])).json()

    old_row = await row_for(db_session, old["refresh_token"])
    new_row = await row_for(db_session, new["refresh_token"])
    assert old_row.revoked_at is not None
    assert old_row.replaced_by_id == new_row.id
    assert new_row.revoked_at is None
    assert new_row.replaced_by_id is None
    assert new_row.user_id == old_row.user_id
    assert abs(new_row.expires_at - (datetime.now(UTC) + REFRESH_TOKEN_TTL)) < timedelta(minutes=1)


async def test_rotation_can_be_repeated_and_forms_a_chain(client, db_session):
    a = await login(client)
    b = (await refresh(client, a["refresh_token"])).json()
    c = (await refresh(client, b["refresh_token"])).json()

    rows = [await row_for(db_session, t["refresh_token"]) for t in (a, b, c)]

    assert [r.replaced_by_id for r in rows] == [rows[1].id, rows[2].id, None]
    assert [r.revoked_at is not None for r in rows] == [True, True, False]


async def test_other_logins_are_untouched_by_a_refresh(client, db_session):
    this_device = await login(client)
    other_device = await login(client)

    await refresh(client, this_device["refresh_token"])

    assert (await row_for(db_session, other_device["refresh_token"])).revoked_at is None


async def test_unusable_tokens_all_get_the_same_401(client, db_session):
    used = await login(client)
    await refresh(client, used["refresh_token"])  # now used up
    logged_out = await login(client)
    await client.post("/auth/logout", json={"refresh_token": logged_out["refresh_token"]})
    expired = await login(client)
    await db_session.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(expired["refresh_token"]))
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )

    responses = [
        await refresh(client, used["refresh_token"]),  # reuse
        await refresh(client, logged_out["refresh_token"]),  # logout, then refresh
        await refresh(client, expired["refresh_token"]),
        await refresh(client, "not-a-token-we-ever-issued"),
    ]

    assert {r.status_code for r in responses} == {401}
    assert len({r.text for r in responses}) == 1  # identical bodies: nothing to tell them apart
    assert responses[0].json() == {"detail": "invalid_refresh_token"}


async def test_failed_refresh_stores_nothing(client, db_session):
    await login(client)  # one token exists

    await refresh(client, "nope")

    count = len((await db_session.scalars(select(RefreshToken))).all())
    assert count == 1


async def test_access_token_carries_identity_only(client, db_session):
    new = (await refresh(client, (await login(client))["refresh_token"])).json()

    claims = jwt.decode(new["access_token"], get_settings().jwt_secret, algorithms=["HS256"])

    owner_id = await db_session.scalar(select(User.id).where(User.email == "owner@example.com"))
    assert claims["sub"] == str(owner_id)
    # Permissions are looked up per request, never baked into a token: refreshing can't bring back
    # a studio role that was removed. Asserted by absence so claims like iss/aud can be added.
    forbidden = {"role", "roles", "tenant", "tenant_id", "tenants", "memberships", "permissions"}
    assert not forbidden & claims.keys()


async def test_malformed_body_is_a_validation_error(client):
    response = await client.post("/auth/refresh", json={})

    assert response.status_code == 422
