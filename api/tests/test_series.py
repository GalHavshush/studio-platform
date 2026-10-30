import uuid

import pytest
from sqlalchemy import func, select

from app.models import ClassSeries, ClassType
from tests.test_sessions import add_class_type


def body(class_type_id, **overrides):
    return {
        "class_type_id": str(class_type_id),
        "weekday": 1,  # 2026-10-20 is a Tuesday
        "start_time": "18:00",
        "duration_minutes": 60,
        "first_date": "2026-10-20",
    } | overrides


async def post(client, two_tenants, studio, role, payload):
    return await client.post(
        "/series", json=payload, headers=two_tenants.headers(studio.users[role], studio.id)
    )


async def get(client, two_tenants, studio, role, path=""):
    return await client.get(
        f"/series{path}", headers=two_tenants.headers(studio.users[role], studio.id)
    )


async def count(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(ClassSeries))


# --- create ---


async def test_an_owner_creates_a_series_taught_by_themselves(client, two_tenants, db_session):
    a = two_tenants.a
    type_id = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "owner", body(type_id, capacity=12))

    assert response.status_code == 201
    assert response.json() | {"id": None} == {
        "id": None,
        "class_type_id": str(type_id),
        "coach_id": str(a.users["owner"]),
        "weekday": 1,
        "start_time": "18:00:00",
        "duration_minutes": 60,
        "capacity": 12,
        "first_date": "2026-10-20",
        "last_date": None,
    }
    assert await count(db_session) == 1


@pytest.mark.parametrize("role", ["coach", "member"])
async def test_only_an_owner_can_create_a_series(client, two_tenants, db_session, role):
    type_id = await add_class_type(db_session, two_tenants.a)

    response = await post(client, two_tenants, two_tenants.a, role, body(type_id))

    assert (response.status_code, response.json()) == (403, {"detail": "insufficient_role"})
    assert await count(db_session) == 0


async def test_an_owner_names_the_coach(client, two_tenants, db_session):
    a = two_tenants.a
    type_id = await add_class_type(db_session, a)

    response = await post(
        client, two_tenants, a, "owner", body(type_id, coach_id=str(a.users["coach"]))
    )

    assert response.status_code == 201
    assert response.json()["coach_id"] == str(a.users["coach"])


@pytest.mark.parametrize("who", ["member", "other_studio_coach"])
async def test_the_coach_must_be_staff_of_this_studio(client, two_tenants, db_session, who):
    a, b = two_tenants.a, two_tenants.b
    type_id = await add_class_type(db_session, a)
    coach = a.users["member"] if who == "member" else b.users["coach"]

    response = await post(client, two_tenants, a, "owner", body(type_id, coach_id=str(coach)))

    assert (response.status_code, response.json()) == (422, {"detail": "invalid_coach"})


async def test_the_class_type_must_exist_here_and_be_active(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    other = await add_class_type(db_session, b)
    archived = ClassType(tenant_id=a.id, name="Old", archived_at=func.now())
    db_session.add(archived)
    await db_session.flush()

    foreign = await post(client, two_tenants, a, "owner", body(other))
    gone = await post(client, two_tenants, a, "owner", body(archived.id))
    unknown = await post(client, two_tenants, a, "owner", body(uuid.uuid4()))

    assert (foreign.status_code, foreign.json()) == (404, {"detail": "class_type_not_found"})
    assert (unknown.status_code, unknown.json()) == (404, {"detail": "class_type_not_found"})
    assert (gone.status_code, gone.json()) == (422, {"detail": "class_type_archived"})
    assert await count(db_session) == 0


# --- validation ---


@pytest.mark.parametrize(
    "overrides",
    [
        {"weekday": 7},
        {"weekday": -1},
        {"duration_minutes": 0},
        {"capacity": 0},
        {"start_time": "18:00+03:00"},  # a studio's wall clock has no offset
        {"last_date": "2026-10-13"},  # before first_date
    ],
)
async def test_bad_values_are_refused(client, two_tenants, db_session, overrides):
    type_id = await add_class_type(db_session, two_tenants.a)

    response = await post(client, two_tenants, two_tenants.a, "owner", body(type_id, **overrides))

    assert response.status_code == 422
    assert await count(db_session) == 0


async def test_first_date_must_fall_on_the_weekday(client, two_tenants, db_session):
    type_id = await add_class_type(db_session, two_tenants.a)

    response = await post(
        client, two_tenants, two_tenants.a, "owner", body(type_id, first_date="2026-10-21")
    )

    assert (response.status_code, response.json()) == (
        422,
        {"detail": "first_date_not_on_weekday"},
    )
    assert await count(db_session) == 0


async def test_a_series_may_end_on_its_first_day(client, two_tenants, db_session):
    type_id = await add_class_type(db_session, two_tenants.a)

    response = await post(
        client, two_tenants, two_tenants.a, "owner", body(type_id, last_date="2026-10-20")
    )

    assert response.status_code == 201


# --- read ---


async def seeded(client, two_tenants, db_session):
    """Studio A: a series taught by the owner and one by the coach; studio B: one. Owners create them."""
    a, b = two_tenants.a, two_tenants.b
    type_a = await add_class_type(db_session, a)
    type_b = await add_class_type(db_session, b)
    ids = {}
    for key, studio, coach, type_id in (
        ("owner", a, "owner", type_a),
        ("coach", a, "coach", type_a),
        ("b", b, "owner", type_b),
    ):
        payload = body(type_id, coach_id=str(studio.users[coach]))
        ids[key] = (await post(client, two_tenants, studio, "owner", payload)).json()["id"]
    return ids


async def test_an_owner_lists_every_series_of_the_studio_only(client, two_tenants, db_session):
    ids = await seeded(client, two_tenants, db_session)

    response = await get(client, two_tenants, two_tenants.a, "owner")

    assert {s["id"] for s in response.json()} == {ids["owner"], ids["coach"]}


async def test_a_coach_lists_only_their_own(client, two_tenants, db_session):
    ids = await seeded(client, two_tenants, db_session)

    response = await get(client, two_tenants, two_tenants.a, "coach")

    assert [s["id"] for s in response.json()] == [ids["coach"]]


async def test_a_member_cannot_read_series(client, two_tenants, db_session):
    ids = await seeded(client, two_tenants, db_session)

    for path in ("", f"/{ids['coach']}"):
        response = await get(client, two_tenants, two_tenants.a, "member", path)
        assert (response.status_code, response.json()) == (403, {"detail": "insufficient_role"})


async def test_reading_one_series(client, two_tenants, db_session):
    ids = await seeded(client, two_tenants, db_session)
    a = two_tenants.a

    mine = await get(client, two_tenants, a, "coach", f"/{ids['coach']}")
    owners = await get(client, two_tenants, a, "coach", f"/{ids['owner']}")
    as_owner = await get(client, two_tenants, a, "owner", f"/{ids['coach']}")
    other_studio = await get(client, two_tenants, a, "owner", f"/{ids['b']}")
    unknown = await get(client, two_tenants, a, "owner", f"/{uuid.uuid4()}")

    assert (mine.status_code, mine.json()["id"]) == (200, ids["coach"])
    assert (owners.status_code, owners.json()) == (403, {"detail": "not_your_series"})
    assert as_owner.status_code == 200
    assert (other_studio.status_code, other_studio.json()) == (404, {"detail": "series_not_found"})
    assert unknown.status_code == 404


async def test_series_need_a_login(client):
    assert (await client.get("/series")).status_code == 401
    assert (await client.post("/series", json={})).status_code == 401
