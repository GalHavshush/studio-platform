import uuid
from datetime import UTC, datetime

import pytest
from fastapi import Depends, FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.db import get_session
from app.deps import ROLE_RANK, TenantContext, require_role
from app.models import ClassType


async def add_class_type(db_session, studio, name) -> ClassType:
    row = ClassType(tenant_id=studio.id, name=name)
    db_session.add(row)
    await db_session.flush()
    return row


async def count(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(ClassType))


# --- creating and renaming: owner only ---


async def test_owner_creates_a_class_type_in_their_studio(client, two_tenants, db_session):
    a = two_tenants.a

    response = await client.post(
        "/class-types",
        json={"name": "  Pilates  "},
        headers=two_tenants.headers(a.users["owner"], a.id),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Pilates"  # whitespace trimmed
    row = await db_session.scalar(select(ClassType).where(ClassType.id == uuid.UUID(body["id"])))
    assert row.tenant_id == a.id


async def test_the_studio_comes_from_the_header_not_the_body(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b

    response = await client.post(
        "/class-types",
        json={"name": "BJJ", "tenant_id": str(b.id)},  # a client trying to write into B
        headers=two_tenants.headers(a.users["owner"], a.id),
    )

    row = await db_session.scalar(
        select(ClassType).where(ClassType.id == uuid.UUID(response.json()["id"]))
    )
    assert row.tenant_id == a.id


@pytest.mark.parametrize("role", ["coach", "member"])
async def test_only_owners_can_create_or_rename(client, two_tenants, db_session, role):
    a = two_tenants.a
    existing = await add_class_type(db_session, a, "BJJ")
    headers = two_tenants.headers(a.users[role], a.id)

    created = await client.post("/class-types", json={"name": "New"}, headers=headers)
    renamed = await client.put(
        f"/class-types/{existing.id}", json={"name": "Renamed"}, headers=headers
    )

    for response in (created, renamed):
        assert response.status_code == 403
        assert response.json() == {"detail": "insufficient_role"}
    assert await count(db_session) == 1
    await db_session.refresh(existing)
    assert existing.name == "BJJ"


async def test_owner_renames_a_class_type(client, two_tenants, db_session):
    a = two_tenants.a
    row_id = (await add_class_type(db_session, a, "BJJ")).id  # read now: the commit expires the row

    response = await client.put(
        f"/class-types/{row_id}",
        json={"name": "Brazilian Jiu-Jitsu"},
        headers=two_tenants.headers(a.users["owner"], a.id),
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": str(row_id),
        "name": "Brazilian Jiu-Jitsu",
        "attendance_mode": "rsvp",
        "archived_at": None,
    }


@pytest.mark.parametrize("body", [{"name": ""}, {"name": "   "}, {"name": "x" * 101}, {}])
async def test_invalid_names_are_rejected(client, two_tenants, db_session, body):
    a = two_tenants.a

    response = await client.post(
        "/class-types", json=body, headers=two_tenants.headers(a.users["owner"], a.id)
    )

    assert response.status_code == 422
    assert await count(db_session) == 0


# --- listing: every member, only their studio ---


@pytest.mark.parametrize("role", ["owner", "coach", "member"])
async def test_every_member_can_list_and_sees_only_their_own_studio(
    client, two_tenants, db_session, role
):
    a, b = two_tenants.a, two_tenants.b
    await add_class_type(db_session, a, "Yoga")
    await add_class_type(db_session, a, "BJJ")
    await add_class_type(db_session, b, "Pilates")

    response = await client.get("/class-types", headers=two_tenants.headers(a.users[role], a.id))

    assert response.status_code == 200
    assert [c["name"] for c in response.json()] == ["BJJ", "Yoga"]  # ordered by name, no Pilates


async def test_a_studio_with_no_class_types_gets_an_empty_list(client, two_tenants):
    a = two_tenants.a

    response = await client.get(
        "/class-types", headers=two_tenants.headers(a.users["member"], a.id)
    )

    assert response.json() == []


# --- other studios' data ---


async def test_an_owner_cannot_rename_another_studios_class_type(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    theirs = await add_class_type(db_session, b, "Pilates")
    headers = two_tenants.headers(a.users["owner"], a.id)

    foreign = await client.put(
        f"/class-types/{theirs.id}", json={"name": "Hacked"}, headers=headers
    )
    nonexistent = await client.put(
        f"/class-types/{uuid.uuid4()}", json={"name": "Hacked"}, headers=headers
    )

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "class_type_not_found"}
    await db_session.refresh(theirs)
    assert theirs.name == "Pilates"


# --- require_role: a higher role passes a lower requirement ---


@pytest.mark.parametrize("needed", ["member", "coach", "owner"])
@pytest.mark.parametrize("actual", ["member", "coach", "owner"])
async def test_require_role_lets_the_same_or_a_higher_role_through(
    two_tenants, db_session, needed, actual
):
    app = FastAPI()

    @app.get("/gate")
    async def gate(ctx: TenantContext = Depends(require_role(needed))):  # noqa: B008
        return {"role": ctx.role}

    app.dependency_overrides[get_session] = lambda: db_session
    studio = two_tenants.a
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.get(
            "/gate", headers=two_tenants.headers(studio.users[actual], studio.id)
        )

    expected = 200 if ROLE_RANK[actual] >= ROLE_RANK[needed] else 403
    assert response.status_code == expected


def test_a_typo_in_the_required_role_fails_when_the_dependency_is_built():
    with pytest.raises(KeyError):
        require_role("ownr")


async def test_a_role_the_ranking_does_not_know_is_refused_not_let_through():
    # The database only stores known roles, so this can only happen if a role is added (head_coach,
    # step 48) before ROLE_RANK is updated. It must fail closed.
    gate = require_role("member")  # the lowest requirement there is
    unknown = TenantContext(user=None, tenant_id=uuid.uuid4(), role="head_coach")

    with pytest.raises(HTTPException) as refused:
        await gate(unknown)

    assert refused.value.status_code == 403
    assert refused.value.detail == "insufficient_role"


# --- archiving: owner only, hidden by default, never deleted ---

PAST = datetime(2026, 1, 1, tzinfo=UTC)


async def archive(client, two_tenants, studio, role, class_type_id, action="archive"):
    return await client.post(
        f"/class-types/{class_type_id}/{action}",
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


async def names(client, two_tenants, studio, role="member", **params):
    response = await client.get(
        "/class-types", params=params, headers=two_tenants.headers(studio.users[role], studio.id)
    )
    return [c["name"] for c in response.json()]


@pytest.mark.parametrize("action", ["archive", "unarchive"])
@pytest.mark.parametrize("role", ["coach", "member"])
async def test_only_owners_can_archive_or_unarchive(client, two_tenants, db_session, role, action):
    a = two_tenants.a
    row = await add_class_type(db_session, a, "BJJ")
    row_id = row.id

    response = await archive(client, two_tenants, a, role, row_id, action)

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}
    await db_session.refresh(row)
    assert row.archived_at is None


async def test_archived_types_are_hidden_by_default_and_shown_on_request(
    client, two_tenants, db_session
):
    a = two_tenants.a
    await add_class_type(db_session, a, "Yoga")
    bjj = (await add_class_type(db_session, a, "BJJ")).id

    response = await archive(client, two_tenants, a, "owner", bjj)

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None
    assert await names(client, two_tenants, a) == ["Yoga"]
    assert await names(client, two_tenants, a, include_archived="true") == ["BJJ", "Yoga"]


async def test_unarchiving_brings_a_class_type_back(client, two_tenants, db_session):
    a = two_tenants.a
    bjj = (await add_class_type(db_session, a, "BJJ")).id
    await archive(client, two_tenants, a, "owner", bjj)

    response = await archive(client, two_tenants, a, "owner", bjj, "unarchive")

    assert response.status_code == 200
    assert response.json()["archived_at"] is None
    assert await names(client, two_tenants, a) == ["BJJ"]


async def test_archiving_twice_keeps_the_first_timestamp(client, two_tenants, db_session):
    a = two_tenants.a
    row = await add_class_type(db_session, a, "BJJ")
    row.archived_at = PAST  # a fixed past value, so no clock mocking is needed
    await db_session.flush()
    row_id = row.id

    response = await archive(client, two_tenants, a, "owner", row_id)

    assert response.status_code == 200
    assert response.json()["archived_at"] == "2026-01-01T00:00:00Z"


async def test_unarchiving_an_active_type_changes_nothing(client, two_tenants, db_session):
    a = two_tenants.a
    row_id = (await add_class_type(db_session, a, "BJJ")).id

    response = await archive(client, two_tenants, a, "owner", row_id, "unarchive")

    assert response.status_code == 200
    assert response.json()["archived_at"] is None


async def test_an_archived_type_can_still_be_renamed(client, two_tenants, db_session):
    a = two_tenants.a
    row = await add_class_type(db_session, a, "BJJ")
    row.archived_at = PAST
    await db_session.flush()
    row_id = row.id

    response = await client.put(
        f"/class-types/{row_id}",
        json={"name": "Brazilian Jiu-Jitsu"},
        headers=two_tenants.headers(a.users["owner"], a.id),
    )

    assert response.status_code == 200
    assert response.json()["archived_at"] == "2026-01-01T00:00:00Z"


@pytest.mark.parametrize("action", ["archive", "unarchive"])
async def test_another_studios_class_type_cannot_be_archived_or_unarchived(
    client, two_tenants, db_session, action
):
    a, b = two_tenants.a, two_tenants.b
    theirs = await add_class_type(db_session, b, "Pilates")
    if action == "unarchive":
        theirs.archived_at = PAST
        await db_session.flush()
    expected = theirs.archived_at
    theirs_id = theirs.id

    foreign = await archive(client, two_tenants, a, "owner", theirs_id, action)
    nonexistent = await archive(client, two_tenants, a, "owner", uuid.uuid4(), action)

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "class_type_not_found"}
    await db_session.refresh(theirs)
    assert theirs.archived_at == expected
    # And the other studio's list is not affected by what A's owner tried.
    assert await names(client, two_tenants, b, include_archived="true") == ["Pilates"]


# --- attendance mode: rsvp by default, booking only with the booking module ---


async def set_modules(db_session, studio, modules):
    from app.models import Tenant

    tenant = await db_session.get(Tenant, studio.id)
    tenant.modules = modules
    await db_session.flush()


async def create(client, two_tenants, studio, **body):
    return await client.post(
        "/class-types",
        json={"name": "Open mat"} | body,
        headers=two_tenants.headers(studio.users["owner"], studio.id),
    )


async def update(client, two_tenants, studio, class_type_id, **body):
    return await client.put(
        f"/class-types/{class_type_id}",
        json={"name": "Open mat"} | body,
        headers=two_tenants.headers(studio.users["owner"], studio.id),
    )


async def test_a_new_class_type_defaults_to_rsvp(client, two_tenants):
    response = await create(client, two_tenants, two_tenants.a)

    assert response.status_code == 201
    assert response.json()["attendance_mode"] == "rsvp"


async def test_booking_can_be_set_when_the_studio_has_the_module(client, two_tenants, db_session):
    a = two_tenants.a
    await set_modules(db_session, a, ["booking"])

    created = await create(client, two_tenants, a, attendance_mode="booking")
    other = (await create(client, two_tenants, a)).json()["id"]
    switched = await update(client, two_tenants, a, other, attendance_mode="booking")

    assert created.status_code == 201
    assert created.json()["attendance_mode"] == "booking"
    assert switched.status_code == 200
    assert switched.json()["attendance_mode"] == "booking"


async def test_booking_is_refused_without_the_module(client, two_tenants, db_session):
    a = two_tenants.a  # modules default to []
    existing = (await create(client, two_tenants, a, name="BJJ")).json()["id"]

    created = await create(client, two_tenants, a, name="Pilates", attendance_mode="booking")
    switched = await update(client, two_tenants, a, existing, attendance_mode="booking")

    for response in (created, switched):
        assert response.status_code == 403
        assert response.json() == {"detail": "module_disabled"}
    assert await names(client, two_tenants, a) == ["BJJ"]  # the refused create left nothing
    listed = await client.get("/class-types", headers=two_tenants.headers(a.users["owner"], a.id))
    assert [c["attendance_mode"] for c in listed.json()] == [
        "rsvp"
    ]  # and the update changed nothing


async def test_another_studios_module_does_not_count(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    await set_modules(db_session, a, ["booking"])  # only A has it

    response = await create(client, two_tenants, b, attendance_mode="booking")

    assert response.status_code == 403
    assert response.json() == {"detail": "module_disabled"}


async def test_an_omitted_mode_leaves_it_unchanged_on_update(client, two_tenants, db_session):
    a = two_tenants.a
    await set_modules(db_session, a, ["booking"])
    booking_id = (await create(client, two_tenants, a, attendance_mode="booking")).json()["id"]

    renamed = await update(client, two_tenants, a, booking_id, name="Booked class")

    assert renamed.status_code == 200
    assert renamed.json()["attendance_mode"] == "booking"
    assert renamed.json()["name"] == "Booked class"


async def test_a_booking_type_stays_editable_after_the_module_is_switched_off(
    client, two_tenants, db_session
):
    a = two_tenants.a
    await set_modules(db_session, a, ["booking"])
    class_type_id = (await create(client, two_tenants, a, attendance_mode="booking")).json()["id"]
    await set_modules(db_session, a, [])

    renamed = await update(client, two_tenants, a, class_type_id, name="New name")
    resent = await update(client, two_tenants, a, class_type_id, attendance_mode="booking")
    back = await update(client, two_tenants, a, class_type_id, attendance_mode="rsvp")
    again = await update(client, two_tenants, a, class_type_id, attendance_mode="booking")

    assert (renamed.status_code, resent.status_code, back.status_code) == (200, 200, 200)
    assert back.json()["attendance_mode"] == "rsvp"
    assert again.status_code == 403  # switching TO booking needs the module again


@pytest.mark.parametrize("mode", ["waitlist", "", "BOOKING"])
async def test_an_invalid_mode_is_rejected(client, two_tenants, mode):
    response = await create(client, two_tenants, two_tenants.a, attendance_mode=mode)

    assert response.status_code == 422


async def test_the_database_only_accepts_known_modes(db_session, two_tenants):
    from sqlalchemy.exc import IntegrityError

    db_session.add(ClassType(tenant_id=two_tenants.a.id, name="x", attendance_mode="waitlist"))

    with pytest.raises(IntegrityError):
        await db_session.flush()


@pytest.mark.parametrize("role", ["coach", "member"])
async def test_only_owners_can_set_the_mode(client, two_tenants, db_session, role):
    a = two_tenants.a
    await set_modules(db_session, a, ["booking"])

    response = await client.post(
        "/class-types",
        json={"name": "x", "attendance_mode": "booking"},
        headers=two_tenants.headers(a.users[role], a.id),
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}


async def test_every_member_sees_the_mode_in_the_list(client, two_tenants, db_session):
    a = two_tenants.a
    await set_modules(db_session, a, ["booking"])
    await create(client, two_tenants, a, name="BJJ", attendance_mode="booking")
    await create(client, two_tenants, a, name="Yoga")

    response = await client.get(
        "/class-types", headers=two_tenants.headers(a.users["member"], a.id)
    )

    assert [(c["name"], c["attendance_mode"]) for c in response.json()] == [
        ("BJJ", "booking"),
        ("Yoga", "rsvp"),
    ]


async def test_rsvp_never_needs_the_module_even_when_sent_explicitly(client, two_tenants):
    a = two_tenants.a  # no modules at all

    created = await create(client, two_tenants, a, attendance_mode="rsvp")
    updated = await update(
        client, two_tenants, a, created.json()["id"], name="Renamed", attendance_mode="rsvp"
    )

    assert created.status_code == 201
    assert updated.status_code == 200
    assert updated.json()["attendance_mode"] == "rsvp"
