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

import uuid
from typing import Annotated

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.deps import CurrentUser, TenantCtx
from app.main import app


async def _get_tenant(client, headers):
    return await client.get("/tenant", headers=headers)


async def _list_class_types(client, headers):
    return await client.get("/class-types", headers=headers)


async def _create_class_type(client, headers):
    return await client.post("/class-types", json={"name": "BJJ"}, headers=headers)


async def _rename_class_type(client, headers):
    # A random id is enough here: this checks who is let in, not what the route does.
    return await client.put(f"/class-types/{uuid.uuid4()}", json={"name": "BJJ"}, headers=headers)


async def _archive_class_type(client, headers):
    return await client.post(f"/class-types/{uuid.uuid4()}/archive", headers=headers)


async def _unarchive_class_type(client, headers):
    return await client.post(f"/class-types/{uuid.uuid4()}/unarchive", headers=headers)


async def _update_session(client, headers):
    return await client.patch(f"/sessions/{uuid.uuid4()}", json={"preview": "x"}, headers=headers)


async def _cancel_session(client, headers):
    return await client.post(f"/sessions/{uuid.uuid4()}/cancel", headers=headers)


async def _rsvp(client, headers):
    return await client.put(
        f"/sessions/{uuid.uuid4()}/rsvp", json={"status": "going"}, headers=headers
    )


async def _attendance(client, headers):
    return await client.post(
        f"/sessions/{uuid.uuid4()}/attendance", json={"attended": True}, headers=headers
    )


async def _write_report(client, headers):
    return await client.put(
        f"/sessions/{uuid.uuid4()}/report", json={"summary": "x"}, headers=headers
    )


async def _list_notes(client, headers):
    return await client.get(f"/participants/{uuid.uuid4()}/notes", headers=headers)


async def _read_report(client, headers):
    return await client.get(f"/sessions/{uuid.uuid4()}/report", headers=headers)


async def _timeline(client, headers):
    return await client.get(f"/participants/{uuid.uuid4()}/timeline", headers=headers)


async def _create_session(client, headers):
    # Random ids: this checks who is let in, not what the route does with the body.
    body = {
        "class_type_id": str(uuid.uuid4()),
        "starts_at": "2026-10-20T18:00:00+03:00",
        "ends_at": "2026-10-20T19:00:00+03:00",
    }
    return await client.post("/sessions", json=body, headers=headers)


async def _list_sessions(client, headers):
    params = {"from": "2026-10-01T00:00:00+00:00", "to": "2026-10-08T00:00:00+00:00"}
    return await client.get("/sessions", params=params, headers=headers)


async def _get_session(client, headers):
    return await client.get(f"/sessions/{uuid.uuid4()}", headers=headers)


TENANT_SCOPED_ENDPOINTS: dict[tuple[str, str], object] = {
    ("GET", "/tenant"): _get_tenant,
    ("GET", "/class-types"): _list_class_types,
    ("POST", "/class-types"): _create_class_type,
    ("PUT", "/class-types/{class_type_id}"): _rename_class_type,
    ("POST", "/class-types/{class_type_id}/archive"): _archive_class_type,
    ("POST", "/class-types/{class_type_id}/unarchive"): _unarchive_class_type,
    ("POST", "/sessions"): _create_session,
    ("GET", "/sessions"): _list_sessions,
    ("GET", "/sessions/{session_id}"): _get_session,
    ("PATCH", "/sessions/{session_id}"): _update_session,
    ("POST", "/sessions/{session_id}/cancel"): _cancel_session,
    ("PUT", "/sessions/{session_id}/rsvp"): _rsvp,
    ("POST", "/sessions/{session_id}/attendance"): _attendance,
    ("PUT", "/sessions/{session_id}/report"): _write_report,
    ("GET", "/sessions/{session_id}/report"): _read_report,
    ("GET", "/participants/{participant_id}/notes"): _list_notes,
    ("GET", "/participants/{participant_id}/timeline"): _timeline,
}


def tenant_scoped_routes(application: FastAPI) -> set[tuple[str, str]]:
    """Every (METHOD, path) that takes the `X-Tenant-Id` header, which is exactly the routes that
    depend on TenantCtx, however deeply nested or included from a router.

    Read from the OpenAPI schema, a public and stable view, rather than from FastAPI's route
    objects: this FastAPI wraps included routers in private objects, and an earlier version of
    this scan that walked the routes silently found nothing.
    ponytail: a route with include_in_schema=False is invisible to this scan.
    """
    found = set()
    for path, operations in application.openapi()["paths"].items():
        for method, operation in operations.items():
            if any(
                p["in"] == "header" and p["name"].lower() == "x-tenant-id"
                for p in operation.get("parameters", [])
            ):
                found.add((method.upper(), path))
    return found


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


def test_the_scanner_sees_routes_added_through_an_included_router():
    from fastapi import APIRouter

    router = APIRouter(prefix="/things")

    @router.get("/{thing_id}")
    async def thing(thing_id: int, ctx: TenantCtx): ...

    scanned = FastAPI()
    scanned.include_router(router)

    assert tenant_scoped_routes(scanned) == {("GET", "/things/{thing_id}")}
