import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import get_session
from app.deps import KNOWN_MODULES, TenantContext, require_module
from app.models import Tenant
from app.seed import PILOT_TENANT, seed


async def set_modules(db_session, studio, modules):
    tenant = await db_session.get(Tenant, studio.id)
    tenant.modules = modules
    await db_session.flush()


# --- GET /tenant ---


@pytest.mark.parametrize("role", ["owner", "coach", "member"])
async def test_every_member_sees_their_own_studios_modules(client, two_tenants, db_session, role):
    a, b = two_tenants.a, two_tenants.b
    await set_modules(db_session, a, ["booking"])

    mine = await client.get("/tenant", headers=two_tenants.headers(a.users[role], a.id))
    other = await client.get("/tenant", headers=two_tenants.headers(b.users[role], b.id))

    assert mine.status_code == other.status_code == 200
    assert mine.json() == {
        "id": str(a.id),
        "name": "studio-a",
        "slug": "studio-a",
        "modules": ["booking"],
    }
    assert other.json()["modules"] == []  # A's flags do not leak into B


async def test_a_new_studio_has_no_modules(client, two_tenants):
    a = two_tenants.a

    response = await client.get("/tenant", headers=two_tenants.headers(a.users["member"], a.id))

    assert set(response.json()) == {"id", "name", "slug", "modules"}
    assert response.json()["modules"] == []


async def test_the_studio_comes_from_the_header(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    await set_modules(db_session, b, ["booking"])
    user_id = a.users["member"]
    from app.models import Membership

    db_session.add(Membership(tenant_id=b.id, user_id=user_id, role="member"))
    await db_session.flush()

    in_a = await client.get("/tenant", headers=two_tenants.headers(user_id, a.id))
    in_b = await client.get("/tenant", headers=two_tenants.headers(user_id, b.id))

    assert (in_a.json()["modules"], in_b.json()["modules"]) == ([], ["booking"])


# --- require_module ---


@pytest.fixture
async def gated_client(db_session):
    """A throwaway app with one route that needs the booking module (the first real one is step 23)."""
    gated = FastAPI()

    @gated.get("/gated")
    async def gated_route(ctx: TenantContext = Depends(require_module("booking"))):  # noqa: B008
        return {"role": ctx.role}

    gated.dependency_overrides[get_session] = lambda: db_session
    async with AsyncClient(transport=ASGITransport(app=gated), base_url="http://test") as c:
        yield c


@pytest.mark.parametrize("role", ["owner", "coach", "member"])
async def test_a_studio_with_the_module_gets_through(gated_client, two_tenants, db_session, role):
    a = two_tenants.a
    await set_modules(db_session, a, ["booking"])

    response = await gated_client.get("/gated", headers=two_tenants.headers(a.users[role], a.id))

    assert response.status_code == 200
    assert response.json() == {"role": role}


@pytest.mark.parametrize("modules", [[], ["something-else"]])
async def test_a_studio_without_the_module_is_refused(
    gated_client, two_tenants, db_session, modules
):
    a = two_tenants.a
    await set_modules(db_session, a, modules)

    response = await gated_client.get("/gated", headers=two_tenants.headers(a.users["owner"], a.id))

    assert response.status_code == 403
    assert response.json() == {"detail": "module_disabled"}


async def test_another_studios_module_does_not_count(gated_client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    await set_modules(db_session, a, ["booking"])  # only A has it

    own = await gated_client.get("/gated", headers=two_tenants.headers(b.users["owner"], b.id))
    # B's owner naming A is a stranger there: the membership check comes first.
    foreign = await gated_client.get("/gated", headers=two_tenants.headers(b.users["owner"], a.id))

    assert own.json() == {"detail": "module_disabled"}
    assert foreign.status_code == 403
    assert foreign.json() == {"detail": "not_a_member"}


def test_an_unknown_module_name_fails_when_the_dependency_is_built():
    with pytest.raises(ValueError, match="unknown module"):
        require_module("bookng")


def test_every_known_module_can_be_required():
    for name in KNOWN_MODULES:
        require_module(name)


# --- the seed ---


async def test_the_seed_enables_the_pilots_modules(db_session):
    await seed(db_session)

    modules = await db_session.scalar(
        select(Tenant.modules).where(Tenant.slug == PILOT_TENANT["slug"])
    )

    assert modules == ["booking"]


async def test_reseeding_resets_modules_but_leaves_the_rest_of_the_tenant_alone(db_session):
    await seed(db_session)
    tenant = await db_session.scalar(select(Tenant).where(Tenant.slug == PILOT_TENANT["slug"]))
    tenant.modules = []
    tenant.name = "Renamed by hand"
    await db_session.flush()

    await seed(db_session)

    await db_session.refresh(tenant)
    assert tenant.modules == ["booking"]
    assert tenant.name == "Renamed by hand"
