import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import ClassSession, ClassType, Membership, Participant, Rsvp, Tenant, User


async def a_session(db_session, studio, *, capacity=None, booking=False, status="scheduled"):
    if booking:
        (await db_session.get(Tenant, studio.id)).modules = ["booking"]
    ct = ClassType(
        tenant_id=studio.id,
        name=f"class {uuid.uuid4()}",
        attendance_mode="booking" if booking else "rsvp",
    )
    db_session.add(ct)
    await db_session.flush()
    start = datetime(2026, 10, 20, 15, tzinfo=UTC)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=ct.id,
        coach_id=studio.users["coach"],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=capacity,
        status=status,
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def person(db_session, studio, name) -> uuid.UUID:
    """A member of the studio with this display name; returns their user id."""
    user = User(email=f"{name.lower()}@{studio.id}.example.com", name=name)
    db_session.add(user)
    await db_session.flush()
    db_session.add_all(
        [
            Membership(tenant_id=studio.id, user_id=user.id, role="member"),
            Participant(tenant_id=studio.id, user_id=user.id, name=name),
        ]
    )
    await db_session.flush()
    return user.id


async def rsvp(client, two_tenants, studio, user, session_id, status):
    user_id = studio.users.get(user, user)
    response = await client.put(
        f"/sessions/{session_id}/rsvp",
        json={"status": status},
        headers=two_tenants.headers(user_id, studio.id),
    )
    assert response.status_code == 200


async def listing(client, two_tenants, studio, role, session_id):
    return await client.get(
        f"/sessions/{session_id}/rsvps", headers=two_tenants.headers(studio.users[role], studio.id)
    )


def summary(response):
    return [(e["name"], e["status"], e["waitlist_position"]) for e in response.json()]


# --- who may ask ---


async def test_a_member_gets_403(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await listing(client, two_tenants, a, "member", sid)

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}


@pytest.mark.parametrize("role", ["owner", "coach"])
async def test_coaches_and_owners_get_the_list(client, two_tenants, db_session, role):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await rsvp(client, two_tenants, a, "member", sid, "maybe")

    response = await listing(client, two_tenants, a, role, sid)

    assert response.status_code == 200
    assert summary(response) == [("member of studio-a", "maybe", None)]


# --- what each entry holds ---


async def test_an_entry_has_the_participant_name_and_never_an_email(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await rsvp(client, two_tenants, a, "member", sid, "going")

    body = (await listing(client, two_tenants, a, "coach", sid)).json()

    assert set(body[0]) == {"participant_id", "name", "status", "waitlist_position"}
    assert "example.com" not in str(body)  # no email anywhere in the response


# --- the order ---


async def test_going_then_the_waiting_list_then_maybe_then_not_going(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, booking=True)
    ann, bob, cat, dan, eve = [
        await person(db_session, a, n) for n in ("Ann", "Bob", "Cat", "Dan", "Eve")
    ]
    await rsvp(client, two_tenants, a, eve, sid, "not_going")
    await rsvp(client, two_tenants, a, dan, sid, "maybe")
    await rsvp(client, two_tenants, a, cat, sid, "going")  # takes the only seat
    await rsvp(client, two_tenants, a, bob, sid, "going")  # waits first
    await rsvp(client, two_tenants, a, ann, sid, "going")  # waits second

    response = await listing(client, two_tenants, a, "owner", sid)

    assert summary(response) == [
        ("Cat", "going", None),
        ("Bob", "waitlist", 1),  # queue order, not alphabetical: Ann asked later
        ("Ann", "waitlist", 2),
        ("Dan", "maybe", None),
        ("Eve", "not_going", None),
    ]


async def test_inside_a_group_people_are_sorted_by_name(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    for name in ("Zed", "Amy", "Mia"):
        await rsvp(client, two_tenants, a, await person(db_session, a, name), sid, "going")

    response = await listing(client, two_tenants, a, "coach", sid)

    assert [e["name"] for e in response.json()] == ["Amy", "Mia", "Zed"]


async def test_the_waiting_list_counts_positions_from_one(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, booking=True)
    holder = await person(db_session, a, "Holder")
    await rsvp(client, two_tenants, a, holder, sid, "going")
    for name in ("W1", "W2", "W3"):
        await rsvp(client, two_tenants, a, await person(db_session, a, name), sid, "going")

    response = await listing(client, two_tenants, a, "coach", sid)

    assert [e["waitlist_position"] for e in response.json()] == [None, 1, 2, 3]


async def test_people_who_joined_the_waiting_list_at_the_same_moment_go_by_participant_id(
    client, two_tenants, db_session
):
    # The same tie-break promote_waitlist uses, so the list shows who gets the next seat.
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, booking=True)
    moment = datetime(2026, 10, 19, 9, tzinfo=UTC)
    ids = []
    for name in ("P1", "P2", "P3"):
        user_id = await person(db_session, a, name)
        participant = await db_session.scalar(
            select(Participant.id).where(
                Participant.user_id == user_id, Participant.tenant_id == a.id
            )
        )
        ids.append((participant, name))
        db_session.add(
            Rsvp(
                tenant_id=a.id,
                session_id=sid,
                participant_id=participant,
                status="waitlist",
                waitlisted_at=moment,
            )
        )
    await db_session.flush()

    response = await listing(client, two_tenants, a, "coach", sid)

    assert [e["participant_id"] for e in response.json()] == [str(i) for i, _ in sorted(ids)]


# --- who is left out ---


async def test_someone_with_no_plan_is_left_out(client, two_tenants, db_session):
    # An RSVP row can exist without a plan (attendance recorded for someone who never RSVPed).
    a = two_tenants.a
    sid = await a_session(db_session, a)
    quiet = await person(db_session, a, "Quiet")
    participant = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == quiet)
    )
    db_session.add(Rsvp(tenant_id=a.id, session_id=sid, participant_id=participant, status=None))
    await rsvp(client, two_tenants, a, "member", sid, "going")
    await db_session.flush()

    response = await listing(client, two_tenants, a, "coach", sid)

    assert [e["name"] for e in response.json()] == ["member of studio-a"]


async def test_an_empty_session_gives_an_empty_list(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await listing(client, two_tenants, a, "coach", sid)

    assert response.status_code == 200
    assert response.json() == []


async def test_only_this_sessions_plans_are_listed(client, two_tenants, db_session):
    a = two_tenants.a
    this_one = await a_session(db_session, a)
    other_one = await a_session(db_session, a)  # same studio, a different class
    await rsvp(client, two_tenants, a, "member", other_one, "going")
    await rsvp(client, two_tenants, a, "coach", this_one, "maybe")

    response = await listing(client, two_tenants, a, "owner", this_one)

    assert summary(response) == [("coach of studio-a", "maybe", None)]


# --- cancelled sessions, other studios ---


async def test_a_cancelled_session_can_still_be_read(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await rsvp(client, two_tenants, a, "member", sid, "going")
    session_row = await db_session.get(ClassSession, sid)
    session_row.status = "cancelled"
    await db_session.flush()

    response = await listing(client, two_tenants, a, "coach", sid)

    assert response.status_code == 200
    assert summary(response) == [("member of studio-a", "going", None)]


async def test_another_studios_session_is_a_404_like_a_missing_one(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    sid_b = await a_session(db_session, b)
    await rsvp(client, two_tenants, b, "member", sid_b, "going")

    other = await listing(client, two_tenants, a, "owner", sid_b)
    missing = await listing(client, two_tenants, a, "owner", uuid.uuid4())

    assert other.status_code == 404
    assert other.json() == missing.json() == {"detail": "session_not_found"}


async def test_the_other_studios_plans_never_appear(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    sid_a = await a_session(db_session, a)
    sid_b = await a_session(db_session, b)
    await rsvp(client, two_tenants, b, "member", sid_b, "going")
    await rsvp(client, two_tenants, a, "member", sid_a, "maybe")

    response = await listing(client, two_tenants, a, "owner", sid_a)

    assert summary(response) == [("member of studio-a", "maybe", None)]
