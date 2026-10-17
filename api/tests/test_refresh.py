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


async def test_rotation_uses_up_the_old_token_and_issues_one_in_the_same_family(client, db_session):
    old = await login(client)

    new = (await refresh(client, old["refresh_token"])).json()

    old_row = await row_for(db_session, old["refresh_token"])
    new_row = await row_for(db_session, new["refresh_token"])
    assert old_row.revoked_at is not None
    assert new_row.revoked_at is None
    assert new_row.user_id == old_row.user_id
    assert new_row.family_id == old_row.family_id
    assert abs(new_row.expires_at - (datetime.now(UTC) + REFRESH_TOKEN_TTL)) < timedelta(minutes=1)


async def test_rotation_can_be_repeated_and_only_the_newest_token_stays_usable(client, db_session):
    a = await login(client)
    b = (await refresh(client, a["refresh_token"])).json()
    c = (await refresh(client, b["refresh_token"])).json()

    rows = [await row_for(db_session, t["refresh_token"]) for t in (a, b, c)]

    assert len({r.family_id for r in rows}) == 1  # one login, one family
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


async def test_refresh_keeps_the_family_and_each_login_gets_its_own(client, db_session):
    first_login = await login(client)
    second_login = await login(client)
    rotated = (await refresh(client, first_login["refresh_token"])).json()

    rows = [
        await row_for(db_session, t["refresh_token"]) for t in (first_login, rotated, second_login)
    ]

    assert rows[0].family_id == rows[1].family_id  # rotation inherits the family
    assert rows[0].family_id != rows[2].family_id  # a different login is a different family


# --- reuse detection ---


async def expire(db_session, raw_token):
    await db_session.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(raw_token))
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )


async def test_reusing_a_used_up_token_revokes_the_whole_family(client, db_session):
    a = await login(client)
    b = (await refresh(client, a["refresh_token"])).json()
    c = (await refresh(client, b["refresh_token"])).json()  # the newest token, held by the "thief"

    reuse = await refresh(client, a["refresh_token"])  # the old one comes back

    assert reuse.status_code == 401
    assert reuse.json() == {"detail": "invalid_refresh_token"}  # nothing that hints at theft
    for token in (a, b, c):
        assert (await row_for(db_session, token["refresh_token"])).revoked_at is not None
    assert (await refresh(client, c["refresh_token"])).status_code == 401  # even the newest is dead


async def test_reuse_is_detected_even_if_the_used_up_token_has_expired(client, db_session):
    a = await login(client)
    b = (await refresh(client, a["refresh_token"])).json()
    await expire(db_session, a["refresh_token"])

    await refresh(client, a["refresh_token"])

    assert (await refresh(client, b["refresh_token"])).status_code == 401


async def test_reuse_leaves_other_devices_untouched(client, db_session):
    a = await login(client)
    await refresh(client, a["refresh_token"])
    other_device = await login(client)

    await refresh(client, a["refresh_token"])  # reuse

    assert (await row_for(db_session, other_device["refresh_token"])).revoked_at is None


async def test_only_real_reuse_is_logged(client, db_session, caplog):
    caplog.set_level("WARNING", logger="app.auth")
    logged_out = await login(client)
    await client.post("/auth/logout", json={"refresh_token": logged_out["refresh_token"]})
    await refresh(client, logged_out["refresh_token"])  # revoked by logout: nothing to detect
    expired = await login(client)
    await expire(db_session, expired["refresh_token"])
    await refresh(client, expired["refresh_token"])  # merely expired
    assert "reuse" not in caplog.text

    used = await login(client)
    await refresh(client, used["refresh_token"])
    await refresh(client, used["refresh_token"])  # real reuse

    assert caplog.text.count("refresh token reuse") == 1
    assert used["refresh_token"] not in caplog.text  # ids only, never the token


async def test_an_expired_token_is_a_plain_401_and_revokes_nothing(client, db_session):
    expired = await login(client)
    await expire(db_session, expired["refresh_token"])

    response = await refresh(client, expired["refresh_token"])

    assert response.status_code == 401
    assert (await row_for(db_session, expired["refresh_token"])).revoked_at is None
