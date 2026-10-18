"""The permanent guard rail for tenant isolation.

All studios share one database, so one endpoint that forgets to scope by studio leaks data.
Two things keep that from happening:

1. `assert_tenant_isolation` (conftest) proves the access rule: nobody can act in a studio they
   do not belong to, whatever their role elsewhere.
2. `TENANT_SCOPED_ENDPOINTS` below is a registry, and a test fails when a route that uses
   `TenantCtx` is missing from it. A new tenant-scoped endpoint cannot ship without an isolation
   case. (Data isolation, "a list never contains another studio's rows", is added per endpoint,
   using the `two_tenants` fixture, starting with class types in step 16.)

To register an endpoint: add `("METHOD", "/path"): sender` below, where
`async def sender(client, headers)` sends one request to it with those headers.
"""

from typing import Annotated

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from app.deps import CurrentUser, TenantCtx, tenant_ctx
from app.main import app

TENANT_SCOPED_ENDPOINTS: dict[tuple[str, str], object] = {}


def uses_tenant_ctx(dependant) -> bool:
    return any(d.call is tenant_ctx or uses_tenant_ctx(d) for d in dependant.dependencies)


def tenant_scoped_routes(application: FastAPI) -> set[tuple[str, str]]:
    """Every (METHOD, path) whose handler depends on TenantCtx, directly or through another
    dependency."""
    return {
        (method, route.path)
        for route in application.routes
        if isinstance(route, APIRoute) and uses_tenant_ctx(route.dependant)
        for method in route.methods
    }


async def test_every_registered_endpoint_is_isolated(client, assert_tenant_isolation):
    for sender in TENANT_SCOPED_ENDPOINTS.values():
        # sender=sender binds this iteration's sender (a bare closure would see the last one).
        await assert_tenant_isolation(lambda headers, sender=sender: sender(client, headers))


def test_every_tenant_scoped_route_has_an_isolation_case():
    found, registered = tenant_scoped_routes(app), set(TENANT_SCOPED_ENDPOINTS)

    assert found == registered, (
        f"tenant-scoped routes missing from TENANT_SCOPED_ENDPOINTS: {sorted(found - registered)}; "
        f"registered but no longer tenant-scoped: {sorted(registered - found)}. "
        "Register every route that uses TenantCtx in tests/test_tenant_isolation.py."
    )


# --- the harness itself, shown working on TenantCtx ---


@pytest.fixture
async def tenant_ctx_client(db_session):
    """A throwaway app with one TenantCtx route, since no real tenant-scoped endpoint exists yet."""
    from app.db import get_session

    test_app = FastAPI()

    @test_app.get("/ctx")
    async def ctx_route(ctx: TenantCtx):
        return {"role": ctx.role}

    test_app.dependency_overrides[get_session] = lambda: db_session
    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test") as c:
        yield c


async def test_tenant_ctx_keeps_studios_apart(tenant_ctx_client, assert_tenant_isolation):
    await assert_tenant_isolation(lambda headers: tenant_ctx_client.get("/ctx", headers=headers))


async def test_the_harness_fails_for_an_endpoint_that_ignores_the_studio(
    two_tenants, assert_tenant_isolation, db_session
):
    from app.db import get_session

    leaky = FastAPI()

    @leaky.get("/leaky")
    async def leaky_route(user: CurrentUser):  # authenticates but never checks the studio
        return {"ok": True}

    leaky.dependency_overrides[get_session] = lambda: db_session
    async with AsyncClient(transport=ASGITransport(app=leaky), base_url="http://test") as c:
        with pytest.raises(AssertionError, match="named another studio|got 200"):
            await assert_tenant_isolation(lambda headers: c.get("/leaky", headers=headers))


# --- the route scanner must not be vacuous ---


def test_the_scanner_finds_direct_and_indirect_tenant_ctx_routes_and_ignores_others():
    from fastapi import Depends

    scanned = FastAPI()

    @scanned.get("/direct")
    async def direct(ctx: TenantCtx): ...

    async def wraps_ctx(ctx: TenantCtx):
        return ctx

    @scanned.get("/indirect")
    async def indirect(wrapped: Annotated[object, Depends(wraps_ctx)]): ...

    @scanned.get("/user-only")
    async def user_only(user: CurrentUser): ...

    @scanned.get("/open")
    async def open_route(): ...

    assert tenant_scoped_routes(scanned) == {("GET", "/direct"), ("GET", "/indirect")}
