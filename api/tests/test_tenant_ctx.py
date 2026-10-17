import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.db import get_session
from app.deps import TenantCtx
from app.models import Membership, Tenant, User
from app.security import create_access_token
from app.seed import seed


# No real endpoint uses TenantCtx until class types (step 16), so the tests mount a throwaway
# route on their own app instead of shipping a dummy endpoint.
@pytest.fixture
async def protected(db_session):
    test_app = FastAPI()

    @test_app.get("/ctx")
    async def ctx_route(ctx: TenantCtx):
        return {"user": ctx.user.email, "tenant_id": str(ctx.tenant_id), "role": ctx.role}

    test_app.dependency_overrides[get_session] = lambda: db_session
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
async def seeded(db_session):
    await seed(db_session)


@pytest.fixture
async def pilot_id(db_session) -> uuid.UUID:
    return await db_session.scalar(select(Tenant.id).where(Tenant.slug == "pilot-studio"))


@pytest.fixture
def call(protected, db_session):
    """GET /ctx as a seeded user. `tenant` is sent as X-Tenant-Id unless it is None."""

    async def go(email, tenant):
        user_id = await db_session.scalar(select(User.id).where(User.email == email))
        headers = {"Authorization": f"Bearer {create_access_token(user_id)}"}
        if tenant is not None:
            headers["X-Tenant-Id"] = str(tenant)
        return await protected.get("/ctx", headers=headers)

    return go


@pytest.mark.parametrize(
    "email, role",
    [
        ("owner@example.com", "owner"),
        ("coach@example.com", "coach"),
        ("member@example.com", "member"),
    ],
)
async def test_members_get_their_role_in_the_studio(call, pilot_id, email, role):
    response = await call(email, pilot_id)

    assert response.status_code == 200
    assert response.json() == {"user": email, "tenant_id": str(pilot_id), "role": role}


async def test_no_token_is_401_before_the_header_is_looked_at(protected, pilot_id):
    response = await protected.get("/ctx", headers={"X-Tenant-Id": str(pilot_id)})

    assert response.status_code == 401
    assert response.json() == {"detail": "not_authenticated"}


async def test_missing_header_is_400(call):
    response = await call("owner@example.com", None)

    assert response.status_code == 400
    assert response.json() == {"detail": "missing_tenant_id"}


async def test_malformed_tenant_id_is_400(call):
    response = await call("owner@example.com", "not-a-uuid")

    assert response.status_code == 400
    assert response.json() == {"detail": "invalid_tenant_id"}


async def test_another_studio_and_a_nonexistent_one_get_the_same_403(call, db_session):
    other = Tenant(name="Other Studio", slug="other-studio", timezone="UTC")
    db_session.add(other)
    await db_session.flush()

    real_but_not_a_member = await call("owner@example.com", other.id)
    nonexistent = await call("owner@example.com", uuid.uuid4())

    assert real_but_not_a_member.status_code == nonexistent.status_code == 403
    assert real_but_not_a_member.text == nonexistent.text  # ids cannot be probed
    assert real_but_not_a_member.json() == {"detail": "not_a_member"}


async def test_a_user_in_two_studios_gets_the_role_of_the_studio_named(call, db_session, pilot_id):
    other = Tenant(name="Other Studio", slug="other-studio", timezone="UTC")
    db_session.add(other)
    await db_session.flush()
    coach_id = await db_session.scalar(select(User.id).where(User.email == "coach@example.com"))
    db_session.add(Membership(tenant_id=other.id, user_id=coach_id, role="owner"))
    await db_session.flush()

    in_pilot = await call("coach@example.com", pilot_id)
    in_other = await call("coach@example.com", other.id)

    assert in_pilot.json()["role"] == "coach"
    assert in_other.json()["role"] == "owner"


async def test_removing_a_membership_takes_effect_on_the_next_request(call, db_session, pilot_id):
    assert (await call("member@example.com", pilot_id)).status_code == 200

    user_id = await db_session.scalar(select(User.id).where(User.email == "member@example.com"))
    await db_session.execute(delete(Membership).where(Membership.user_id == user_id))

    # A fresh token is not needed to notice: the role is looked up, not carried in the token.
    assert (await call("member@example.com", pilot_id)).status_code == 403
