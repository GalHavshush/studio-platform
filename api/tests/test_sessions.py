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


# --- reading: any member, one studio, a time window ---


async def add_session(db_session, studio, class_type_id, starts_at, coach_role="coach"):
    from datetime import datetime, timedelta

    start = datetime.fromisoformat(starts_at)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=class_type_id,
        coach_id=studio.users[coach_role],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def listing(client, two_tenants, studio, role, **params):
    return await client.get(
        "/sessions", params=params, headers=two_tenants.headers(studio.users[role], studio.id)
    )


@pytest.mark.parametrize("role", ["owner", "coach", "member"])
async def test_every_member_lists_only_their_studios_sessions_in_time_order(
    client, two_tenants, db_session, role
):
    a, b = two_tenants.a, two_tenants.b
    ct_a, ct_b = await add_class_type(db_session, a), await add_class_type(db_session, b)
    late = await add_session(db_session, a, ct_a, "2026-10-21T18:00:00+00:00")
    early = await add_session(db_session, a, ct_a, "2026-10-20T07:00:00+00:00")
    await add_session(db_session, b, ct_b, "2026-10-20T09:00:00+00:00")  # the other studio's

    response = await listing(
        client,
        two_tenants,
        a,
        role,
        **{"from": "2026-10-20T00:00:00+00:00", "to": "2026-10-22T00:00:00+00:00"},
    )

    assert response.status_code == 200
    assert [s["id"] for s in response.json()] == [str(early), str(late)]


async def test_the_range_includes_from_and_excludes_to(client, two_tenants, db_session):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)
    await add_session(db_session, a, ct, "2026-10-19T23:59:59+00:00")  # just before
    at_from = await add_session(db_session, a, ct, "2026-10-20T00:00:00+00:00")
    last = await add_session(db_session, a, ct, "2026-10-20T23:59:59+00:00")
    await add_session(db_session, a, ct, "2026-10-21T00:00:00+00:00")  # exactly `to`

    response = await listing(
        client,
        two_tenants,
        a,
        "member",
        **{"from": "2026-10-20T00:00:00+00:00", "to": "2026-10-21T00:00:00+00:00"},
    )

    assert [s["id"] for s in response.json()] == [str(at_from), str(last)]


async def test_the_range_is_compared_as_instants_not_wall_clock(client, two_tenants, db_session):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)
    inside = await add_session(db_session, a, ct, "2026-10-20T15:00:00+00:00")

    # The same instant as 18:00 in UTC+3, so a window ending at 18:30+03:00 contains it.
    response = await listing(
        client,
        two_tenants,
        a,
        "member",
        **{"from": "2026-10-20T17:00:00+03:00", "to": "2026-10-20T18:30:00+03:00"},
    )

    assert [s["id"] for s in response.json()] == [str(inside)]


@pytest.mark.parametrize(
    ("params", "code"),
    [
        ({"from": "2026-10-20T00:00:00+00:00"}, None),  # `to` missing
        ({"to": "2026-10-20T00:00:00+00:00"}, None),  # `from` missing
        ({"from": "2026-10-20T00:00:00", "to": "2026-10-21T00:00:00+00:00"}, None),  # naive
        ({"from": "2026-10-21T00:00:00+00:00", "to": "2026-10-20T00:00:00+00:00"}, "invalid_range"),
        ({"from": "2026-10-20T00:00:00+00:00", "to": "2026-10-20T00:00:00+00:00"}, "invalid_range"),
        (
            {"from": "2026-10-01T00:00:00+00:00", "to": "2026-12-05T00:00:00+00:00"},
            "range_too_long",
        ),
    ],
)
async def test_invalid_ranges_are_rejected(client, two_tenants, params, code):
    response = await listing(client, two_tenants, two_tenants.a, "member", **params)

    assert response.status_code == 422
    if code:
        assert response.json() == {"detail": code}


async def test_the_longest_allowed_range_works(client, two_tenants):
    response = await listing(
        client,
        two_tenants,
        two_tenants.a,
        "member",
        **{"from": "2026-10-01T00:00:00+00:00", "to": "2026-12-02T00:00:00+00:00"},  # 62 days
    )

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("role", ["owner", "coach", "member"])
async def test_every_member_gets_one_session_by_id(client, two_tenants, db_session, role):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)
    session_id = await add_session(db_session, a, ct, "2026-10-20T15:00:00+00:00")

    response = await client.get(
        f"/sessions/{session_id}", headers=two_tenants.headers(a.users[role], a.id)
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": str(session_id),
        "class_type_id": str(ct),
        "coach_id": str(a.users["coach"]),
        "starts_at": "2026-10-20T15:00:00Z",
        "ends_at": "2026-10-20T16:00:00Z",
        "status": "scheduled",
        "preview": None,
        "capacity": None,
    }


async def test_another_studios_session_is_not_found(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    theirs = await add_session(
        db_session, b, await add_class_type(db_session, b), "2026-10-20T15:00:00+00:00"
    )
    headers = two_tenants.headers(a.users["owner"], a.id)

    foreign = await client.get(f"/sessions/{theirs}", headers=headers)
    nonexistent = await client.get(f"/sessions/{uuid.uuid4()}", headers=headers)

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "session_not_found"}


# --- archived class types ---


async def test_a_session_cannot_use_an_archived_class_type(client, two_tenants, db_session):
    from datetime import UTC, datetime

    a = two_tenants.a
    ct = await add_class_type(db_session, a)
    await db_session.execute(
        text("UPDATE class_types SET archived_at = :now WHERE id = :id"),
        {"now": datetime.now(UTC), "id": ct},
    )

    response = await post(client, two_tenants, a, "owner", body(ct))

    assert response.status_code == 422
    assert response.json() == {"detail": "class_type_archived"}
    assert await count(db_session) == 0


async def test_archiving_leaves_existing_sessions_readable_and_unarchiving_allows_new_ones(
    client, two_tenants, db_session
):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)
    existing = await add_session(db_session, a, ct, "2026-10-20T15:00:00+00:00")
    owner = two_tenants.headers(a.users["owner"], a.id)

    await client.post(f"/class-types/{ct}/archive", headers=owner)
    still_there = await client.get(f"/sessions/{existing}", headers=owner)
    blocked = await post(client, two_tenants, a, "owner", body(ct))
    await client.post(f"/class-types/{ct}/unarchive", headers=owner)
    allowed = await post(client, two_tenants, a, "owner", body(ct))

    assert still_there.status_code == 200
    assert still_there.json()["class_type_id"] == str(ct)
    assert blocked.status_code == 422
    assert allowed.status_code == 201


# --- updating: owner any, coach own, members never ---


async def patch(client, two_tenants, studio, role, session_id, payload):
    return await client.patch(
        f"/sessions/{session_id}",
        json=payload,
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


async def cancel(client, two_tenants, studio, role, session_id):
    return await client.post(
        f"/sessions/{session_id}/cancel", headers=two_tenants.headers(studio.users[role], studio.id)
    )


async def a_session(db_session, studio, coach_role="coach"):
    ct = await add_class_type(db_session, studio)
    return await add_session(
        db_session, studio, ct, "2026-10-20T15:00:00+00:00", coach_role=coach_role
    )


@pytest.mark.parametrize("role", ["owner", "coach"])
async def test_the_owner_and_the_sessions_coach_can_edit_the_preview(
    client, two_tenants, db_session, role
):
    a = two_tenants.a
    sid = await a_session(db_session, a)  # taught by a's coach

    response = await patch(client, two_tenants, a, role, sid, {"preview": "  Guard passing  "})

    assert response.status_code == 200
    assert response.json()["preview"] == "Guard passing"  # trimmed


async def test_a_coach_cannot_edit_another_coachs_session(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, coach_role="owner")  # the owner teaches it

    response = await patch(client, two_tenants, a, "coach", sid, {"preview": "Mine now"})

    assert response.status_code == 403
    assert response.json() == {"detail": "not_your_session"}
    assert (
        await client.get(f"/sessions/{sid}", headers=two_tenants.headers(a.users["owner"], a.id))
    ).json()["preview"] is None


async def test_members_cannot_edit_or_cancel(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    edited = await patch(client, two_tenants, a, "member", sid, {"preview": "x"})
    cancelled = await cancel(client, two_tenants, a, "member", sid)

    for response in (edited, cancelled):
        assert response.status_code == 403
        assert response.json() == {"detail": "insufficient_role"}


async def test_only_the_sent_fields_change_and_null_clears_the_preview(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await patch(client, two_tenants, a, "owner", sid, {"preview": "Drills"})

    moved = await patch(
        client, two_tenants, a, "owner", sid, {"starts_at": "2026-10-20T18:30:00+03:00"}
    )
    cleared = await patch(client, two_tenants, a, "owner", sid, {"preview": None})
    untouched = await patch(client, two_tenants, a, "owner", sid, {})

    assert moved.json()["starts_at"] == "2026-10-20T15:30:00Z"  # stored in UTC
    assert moved.json()["ends_at"] == "2026-10-20T16:00:00Z"  # not sent, unchanged
    assert moved.json()["preview"] == "Drills"
    assert cleared.json()["preview"] is None
    assert untouched.status_code == 200
    assert untouched.json() == cleared.json()


@pytest.mark.parametrize(
    "payload",
    [
        {"ends_at": "2026-10-20T14:00:00+00:00"},  # before the stored start (15:00Z)
        {"starts_at": "2026-10-20T17:00:00+00:00"},  # after the stored end (16:00Z)
        {"starts_at": "2026-10-20T16:00:00+00:00"},  # equal to the stored end
    ],
)
async def test_the_resulting_times_must_still_be_in_order(client, two_tenants, db_session, payload):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await patch(client, two_tenants, a, "owner", sid, payload)

    assert response.status_code == 422
    assert response.json() == {"detail": "invalid_times"}


@pytest.mark.parametrize(
    "payload",
    [
        {"starts_at": "2026-10-20T18:00:00"},  # naive
        {"starts_at": None},
        {"ends_at": None},
        {"coach_id": None},
        {"preview": "x" * 2001},
    ],
)
async def test_invalid_fields_are_rejected(client, two_tenants, db_session, payload):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await patch(client, two_tenants, a, "owner", sid, payload)

    assert response.status_code == 422


async def test_only_the_owner_can_change_the_coach(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    by_coach = await patch(
        client, two_tenants, a, "coach", sid, {"coach_id": str(a.users["owner"])}
    )
    by_owner = await patch(
        client, two_tenants, a, "owner", sid, {"coach_id": str(a.users["owner"])}
    )

    assert by_coach.status_code == 403
    assert by_coach.json() == {"detail": "insufficient_role"}
    assert by_owner.status_code == 200
    assert by_owner.json()["coach_id"] == str(a.users["owner"])


@pytest.mark.parametrize("who", ["member", "other_studio", "nobody"])
async def test_the_new_coach_must_be_staff_of_this_studio(client, two_tenants, db_session, who):
    a, b = two_tenants.a, two_tenants.b
    sid = await a_session(db_session, a)
    new_coach = {
        "member": a.users["member"],
        "other_studio": b.users["coach"],
        "nobody": uuid.uuid4(),
    }[who]

    response = await patch(client, two_tenants, a, "owner", sid, {"coach_id": str(new_coach)})

    assert response.status_code == 422
    assert response.json() == {"detail": "invalid_coach"}


# --- cancelling ---


@pytest.mark.parametrize("role", ["owner", "coach"])
async def test_the_owner_and_the_sessions_coach_can_cancel_and_it_stays_listed(
    client, two_tenants, db_session, role
):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await cancel(client, two_tenants, a, role, sid)
    listed = await listing(
        client,
        two_tenants,
        a,
        "member",
        **{"from": "2026-10-20T00:00:00+00:00", "to": "2026-10-21T00:00:00+00:00"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert [(x["id"], x["status"]) for x in listed.json()] == [(str(sid), "cancelled")]


async def test_a_coach_cannot_cancel_another_coachs_session(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, coach_role="owner")

    response = await cancel(client, two_tenants, a, "coach", sid)

    assert response.status_code == 403
    assert response.json() == {"detail": "not_your_session"}
    still = await client.get(
        f"/sessions/{sid}", headers=two_tenants.headers(a.users["owner"], a.id)
    )
    assert still.json()["status"] == "scheduled"


async def test_cancelling_twice_is_fine(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    first = await cancel(client, two_tenants, a, "owner", sid)
    second = await cancel(client, two_tenants, a, "owner", sid)

    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()


async def test_a_cancelled_session_cannot_be_edited(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await cancel(client, two_tenants, a, "owner", sid)

    response = await patch(client, two_tenants, a, "owner", sid, {"preview": "Too late"})

    assert response.status_code == 409
    assert response.json() == {"detail": "session_cancelled"}


async def test_the_database_only_accepts_known_statuses(db_session, two_tenants):
    from sqlalchemy.exc import IntegrityError

    a = two_tenants.a
    sid = await a_session(db_session, a)

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text("UPDATE class_sessions SET status = 'postponed' WHERE id = :id"), {"id": sid}
        )


# --- other studios' sessions ---


async def test_another_studios_session_cannot_be_edited_or_cancelled(
    client, two_tenants, db_session
):
    a, b = two_tenants.a, two_tenants.b
    theirs = await a_session(db_session, b)

    edit = await patch(client, two_tenants, a, "owner", theirs, {"preview": "Hacked"})
    edit_missing = await patch(client, two_tenants, a, "owner", uuid.uuid4(), {"preview": "Hacked"})
    cancelled = await cancel(client, two_tenants, a, "owner", theirs)
    cancelled_missing = await cancel(client, two_tenants, a, "owner", uuid.uuid4())

    assert edit.status_code == edit_missing.status_code == 404
    assert cancelled.status_code == cancelled_missing.status_code == 404
    assert edit.text == edit_missing.text == cancelled.text == cancelled_missing.text
    assert edit.json() == {"detail": "session_not_found"}
    mine = await client.get(
        f"/sessions/{theirs}", headers=two_tenants.headers(b.users["owner"], b.id)
    )
    assert mine.json()["status"] == "scheduled"
    assert mine.json()["preview"] is None


# --- capacity: seats for booking-mode classes ---


async def test_capacity_can_be_set_on_create_and_defaults_to_unlimited(
    client, two_tenants, db_session
):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    limited = await post(client, two_tenants, a, "coach", body(ct, capacity=12))
    unlimited = await post(client, two_tenants, a, "coach", body(ct))

    assert limited.json()["capacity"] == 12
    assert unlimited.json()["capacity"] is None


@pytest.mark.parametrize("capacity", [0, -3, "many", 1.5])
async def test_an_invalid_capacity_is_rejected(client, two_tenants, db_session, capacity):
    a = two_tenants.a
    ct = await add_class_type(db_session, a)

    created = await post(client, two_tenants, a, "coach", body(ct, capacity=capacity))
    sid = await a_session(db_session, a)
    patched = await patch(client, two_tenants, a, "owner", sid, {"capacity": capacity})

    assert created.status_code == patched.status_code == 422
    assert await count(db_session) == 1  # only the helper's session


async def test_capacity_can_be_changed_and_cleared_with_patch(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)  # taught by the coach

    set_by_coach = await patch(client, two_tenants, a, "coach", sid, {"capacity": 8})
    untouched = await patch(client, two_tenants, a, "owner", sid, {"preview": "x"})
    cleared = await patch(client, two_tenants, a, "owner", sid, {"capacity": None})

    assert set_by_coach.json()["capacity"] == 8
    assert untouched.json()["capacity"] == 8  # a field that is not sent stays as it is
    assert cleared.json()["capacity"] is None


async def test_the_database_refuses_a_non_positive_capacity(db_session, two_tenants):
    from sqlalchemy.exc import IntegrityError

    a = two_tenants.a
    sid = await a_session(db_session, a)

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text("UPDATE class_sessions SET capacity = 0 WHERE id = :id"), {"id": sid}
        )
