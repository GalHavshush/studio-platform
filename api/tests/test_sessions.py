import uuid

import pytest
from sqlalchemy import func, select, text

from app.models import ClassSession, ClassType

START = "2026-10-20T18:00:00+03:00"  # 15:00 UTC
END = "2026-10-20T19:00:00+03:00"


async def add_class_type(db_session, studio, name="Open mat") -> uuid.UUID:
    row = ClassType(tenant_id=studio.id, name=name)
    db_session.add(row)
    await db_session.flush()
    return row.id


def body(class_type_id, **overrides):
    return {
        "class_type_id": str(class_type_id),
        "starts_at": START,
        "ends_at": END,
    } | overrides


async def count(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(ClassSession))


async def post(client, two_tenants, studio, role, payload):
    return await client.post(
        "/sessions", json=payload, headers=two_tenants.headers(studio.users[role], studio.id)
    )


# --- who can create ---


async def test_owner_creates_a_session_taught_by_a_coach(client, two_tenants, db_session):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "owner", body(ct, coach_id=str(a.users["coach"])))

    assert response.status_code == 201
    created = response.json()
    assert created["coach_id"] == str(a.users["coach"])
    assert created["class_type_id"] == str(ct)
    row = await db_session.scalar(
        select(ClassSession).where(ClassSession.id == uuid.UUID(created["id"]))
    )
    assert row.tenant_id == a.id


async def test_coach_defaults_to_the_caller(client, two_tenants, db_session):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "coach", body(ct))

    assert response.status_code == 201
    assert response.json()["coach_id"] == str(a.users["coach"])


async def test_owner_can_teach_a_session_themselves(client, two_tenants, db_session):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "owner", body(ct))

    assert response.status_code == 201
    assert response.json()["coach_id"] == str(a.users["owner"])


async def test_coach_cannot_create_a_session_for_another_coach(client, two_tenants, db_session):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "coach", body(ct, coach_id=str(a.users["owner"])))

    assert response.status_code == 403
    assert response.json() == {"detail": "not_your_session"}
    assert await count(db_session) == 0


async def test_member_cannot_create_sessions(client, two_tenants, db_session):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "member", body(ct))

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}
    assert await count(db_session) == 0


# --- the coach must be staff of this studio ---


@pytest.mark.parametrize("who", ["member", "other_studio", "nobody"])
async def test_the_coach_must_be_a_coach_or_owner_of_this_studio(
    client, two_tenants, db_session, who
):
    a, b = two_tenants.a, two_tenants.b
    ct = await add_class_type(db_session, a)
    coach_id = {
        "member": a.users["member"],
        "other_studio": b.users["coach"],
        "nobody": uuid.uuid4(),
    }[who]

    response = await post(client, two_tenants, a, "owner", body(ct, coach_id=str(coach_id)))

    assert response.status_code == 422
    assert response.json() == {"detail": "invalid_coach"}
    assert await count(db_session) == 0


# --- times ---


async def test_times_are_stored_in_utc(client, two_tenants, db_session):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "coach", body(ct))

    assert response.json()["starts_at"] == "2026-10-20T15:00:00Z"
    stored = await db_session.scalar(
        text("SELECT starts_at AT TIME ZONE 'UTC' FROM class_sessions")
    )
    assert stored.isoformat() == "2026-10-20T15:00:00"


@pytest.mark.parametrize(
    "times",
    [
        {"starts_at": "2026-10-20T18:00:00"},  # no offset: we won't guess the timezone
        {"ends_at": "2026-10-20T19:00:00"},
        {"ends_at": START},  # zero length
        {"ends_at": "2026-10-20T17:00:00+03:00"},  # ends before it starts
        {"starts_at": "tomorrow"},
    ],
)
async def test_invalid_times_are_rejected(client, two_tenants, db_session, times):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "coach", body(ct, **times))

    assert response.status_code == 422
    assert await count(db_session) == 0


async def test_the_database_also_refuses_a_session_that_ends_before_it_starts(
    two_tenants, db_session
):
    from datetime import UTC, datetime

    from sqlalchemy.exc import IntegrityError

    a = two_tenants.a
    ct = await add_class_type(db_session, a)
    now = datetime.now(UTC)
    db_session.add(
        ClassSession(
            tenant_id=a.id, class_type_id=ct, coach_id=a.users["coach"], starts_at=now, ends_at=now
        )
    )

    with pytest.raises(IntegrityError):
        await db_session.flush()


# --- other studios' data ---


async def test_a_class_type_of_another_studio_is_not_found(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    theirs = await add_class_type(db_session, b)

    foreign = await post(client, two_tenants, a, "owner", body(theirs))
    nonexistent = await post(client, two_tenants, a, "owner", body(uuid.uuid4()))

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "class_type_not_found"}
    assert await count(db_session) == 0


async def test_the_studio_comes_from_the_header_not_the_body(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    ct = await add_class_type(db_session, a)

    response = await post(client, two_tenants, a, "owner", body(ct, tenant_id=str(b.id)))

    row = await db_session.scalar(
        select(ClassSession).where(ClassSession.id == uuid.UUID(response.json()["id"]))
    )
    assert row.tenant_id == a.id
