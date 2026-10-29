"""GET /report-queue: the classes whose report a coach or owner can write, and whether it exists."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models import ClassSession, ClassType, Participant

NOW = datetime.now(UTC)


async def a_class(
    db_session, studio, *, coach_role="coach", hours_ago=24, status="scheduled", name=None
) -> uuid.UUID:
    """A class that started `hours_ago` hours ago (negative: it is still to come)."""
    class_type = ClassType(tenant_id=studio.id, name=name or f"class {uuid.uuid4()}")
    db_session.add(class_type)
    await db_session.flush()
    start = NOW - timedelta(hours=hours_ago)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=class_type.id,
        coach_id=studio.users[coach_role],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        status=status,
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def ask(client, two_tenants, studio, role, **params):
    params = {
        "from": (NOW - timedelta(days=30)).isoformat(),
        "to": (NOW + timedelta(days=30)).isoformat(),
        **params,
    }
    return await client.get(
        "/report-queue", params=params, headers=two_tenants.headers(studio.users[role], studio.id)
    )


async def ids_for(client, two_tenants, studio, role, **params) -> list[str]:
    response = await ask(client, two_tenants, studio, role, **params)
    assert response.status_code == 200
    return [item["session_id"] for item in response.json()]


async def write(client, two_tenants, studio, role, session_id, **fields):
    return await client.put(
        f"/sessions/{session_id}/report",
        json=fields,
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


# --- who may ask ---


async def test_a_member_cannot_list_the_queue(client, two_tenants):
    response = await ask(client, two_tenants, two_tenants.a, "member")

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}


async def test_the_queue_needs_a_login(client):
    response = await client.get("/report-queue", params={"from": "x", "to": "y"})

    assert response.status_code == 401


# --- whose classes ---


async def test_a_coach_sees_only_their_own_classes_and_an_owner_sees_all(
    client, two_tenants, db_session
):
    a = two_tenants.a
    mine = await a_class(db_session, a, coach_role="coach", hours_ago=30)
    owners = await a_class(db_session, a, coach_role="owner", hours_ago=20)

    assert await ids_for(client, two_tenants, a, "coach") == [str(mine)]
    assert await ids_for(client, two_tenants, a, "owner") == [str(owners), str(mine)]


async def test_another_studios_classes_never_appear(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    await a_class(db_session, b, coach_role="coach")  # taught by b's coach, in b
    ours = await a_class(db_session, a, coach_role="coach")

    assert await ids_for(client, two_tenants, a, "owner") == [str(ours)]
    assert await ids_for(client, two_tenants, b, "owner") != [str(ours)]


# --- which classes ---


async def test_classes_still_to_come_and_cancelled_ones_are_left_out(
    client, two_tenants, db_session
):
    a = two_tenants.a
    took_place = await a_class(db_session, a, hours_ago=5)
    await a_class(db_session, a, hours_ago=-5)  # tomorrow
    await a_class(db_session, a, hours_ago=10, status="cancelled")

    assert await ids_for(client, two_tenants, a, "coach") == [str(took_place)]


async def test_a_class_in_progress_is_listed(client, two_tenants, db_session):
    a = two_tenants.a
    started = await a_class(db_session, a, hours_ago=0.1)  # started six minutes ago

    assert await ids_for(client, two_tenants, a, "coach") == [str(started)]


async def test_the_newest_class_comes_first(client, two_tenants, db_session):
    a = two_tenants.a
    old = await a_class(db_session, a, hours_ago=72)
    recent = await a_class(db_session, a, hours_ago=2)
    middle = await a_class(db_session, a, hours_ago=30)

    assert await ids_for(client, two_tenants, a, "coach") == [str(recent), str(middle), str(old)]


async def test_each_item_names_the_class_and_its_times(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_class(db_session, a, hours_ago=3, name="Pilates")

    (item,) = (await ask(client, two_tenants, a, "coach")).json()

    assert item["session_id"] == str(sid)
    assert item["class_type_name"] == "Pilates"
    assert item["has_report"] is False
    assert set(item) == {"session_id", "class_type_name", "starts_at", "ends_at", "has_report"}


# --- has the report been written ---


async def test_has_report_turns_true_once_the_report_is_written(client, two_tenants, db_session):
    a = two_tenants.a
    written = await a_class(db_session, a, hours_ago=3)
    waiting = await a_class(db_session, a, hours_ago=6)

    assert (
        await write(client, two_tenants, a, "coach", written, summary="Good class.")
    ).status_code == 200

    flags = {
        i["session_id"]: i["has_report"]
        for i in (await ask(client, two_tenants, a, "coach")).json()
    }
    assert flags == {str(written): True, str(waiting): False}


async def test_a_report_with_only_a_note_counts_as_written(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_class(db_session, a, hours_ago=3)
    person = await db_session.scalar(select(Participant.id).where(Participant.tenant_id == a.id))

    response = await write(
        client,
        two_tenants,
        a,
        "coach",
        sid,
        notes=[{"participant_id": str(person), "body": "Strong."}],
    )

    assert response.status_code == 200
    (item,) = (await ask(client, two_tenants, a, "coach")).json()
    assert item["has_report"] is True


# --- it agrees with the report route ---


async def test_every_listed_class_accepts_a_report_and_the_others_do_not(
    client, two_tenants, db_session
):
    """The queue and `PUT /report` are one rule, so what one lists the other must accept."""
    a = two_tenants.a
    listed = await a_class(db_session, a, coach_role="coach", hours_ago=4)
    not_theirs = await a_class(db_session, a, coach_role="owner", hours_ago=4)
    future = await a_class(db_session, a, coach_role="coach", hours_ago=-4)
    cancelled = await a_class(db_session, a, coach_role="coach", hours_ago=4, status="cancelled")

    queue = await ids_for(client, two_tenants, a, "coach")
    attempts = {
        sid: (await write(client, two_tenants, a, "coach", sid, summary="Notes.")).status_code
        for sid in (listed, not_theirs, future, cancelled)
    }

    assert queue == [str(listed)]
    assert attempts == {listed: 200, not_theirs: 403, future: 409, cancelled: 409}


# --- the range ---


async def test_only_classes_starting_in_the_range_are_listed(client, two_tenants, db_session):
    a = two_tenants.a
    inside = await a_class(db_session, a, hours_ago=24)
    await a_class(db_session, a, hours_ago=24 * 10)

    window = {
        "from": (NOW - timedelta(days=2)).isoformat(),
        "to": (NOW + timedelta(days=1)).isoformat(),
    }

    assert await ids_for(client, two_tenants, a, "coach", **window) == [str(inside)]


async def test_to_is_excluded_so_back_to_back_ranges_neither_overlap_nor_miss(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_class(db_session, a, hours_ago=24)
    start = await db_session.scalar(select(ClassSession.starts_at).where(ClassSession.id == sid))

    first = {"from": (start - timedelta(days=1)).isoformat(), "to": start.isoformat()}
    second = {"from": start.isoformat(), "to": (start + timedelta(days=1)).isoformat()}

    assert await ids_for(client, two_tenants, a, "coach", **first) == []
    assert await ids_for(client, two_tenants, a, "coach", **second) == [str(sid)]


async def test_a_range_that_is_not_forwards_is_refused(client, two_tenants):
    response = await ask(
        client,
        two_tenants,
        two_tenants.a,
        "coach",
        **{"from": NOW.isoformat(), "to": NOW.isoformat()},
    )

    assert (response.status_code, response.json()) == (422, {"detail": "invalid_range"})


async def test_a_range_over_62_days_is_refused(client, two_tenants):
    response = await ask(
        client,
        two_tenants,
        two_tenants.a,
        "coach",
        **{"from": NOW.isoformat(), "to": (NOW + timedelta(days=63)).isoformat()},
    )

    assert (response.status_code, response.json()) == (422, {"detail": "range_too_long"})
