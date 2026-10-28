import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import ClassSession, ClassType, Membership, Participant, Rsvp, Tenant, User

COUNTS_OF_NOBODY = {"going": 0, "maybe": 0, "not_going": 0, "waitlist": 0}


async def a_session(db_session, studio, *, capacity=None, booking=False):
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
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def extra_member(db_session, studio, name) -> uuid.UUID:
    user = User(email=f"{name}@{studio.id}.example.com", name=name)
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
    return response.json()["status"]


async def detail(client, two_tenants, studio, user, session_id):
    user_id = studio.users.get(user, user)
    response = await client.get(
        f"/sessions/{session_id}", headers=two_tenants.headers(user_id, studio.id)
    )
    assert response.status_code == 200
    return response.json()


# --- my_rsvp: the caller's own plan ---


@pytest.mark.parametrize("status", ["going", "maybe", "not_going"])
async def test_my_rsvp_is_the_callers_own_plan(client, two_tenants, db_session, status):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    assert (await detail(client, two_tenants, a, "member", sid))["my_rsvp"] is None

    await rsvp(client, two_tenants, a, "member", sid, status)

    assert (await detail(client, two_tenants, a, "member", sid))["my_rsvp"] == status


async def test_my_rsvp_shows_waitlist_when_the_class_is_full(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, booking=True)
    assert await rsvp(client, two_tenants, a, "coach", sid, "going") == "going"

    assert await rsvp(client, two_tenants, a, "member", sid, "going") == "waitlist"

    assert (await detail(client, two_tenants, a, "member", sid))["my_rsvp"] == "waitlist"


async def test_someone_elses_plan_is_never_my_rsvp(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await rsvp(client, two_tenants, a, "coach", sid, "going")

    assert (await detail(client, two_tenants, a, "member", sid))["my_rsvp"] is None


# --- rsvp_counts: for coaches and owners only ---


async def test_staff_get_how_many_chose_each_plan(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, booking=True)
    second = await extra_member(db_session, a, "second")
    third = await extra_member(db_session, a, "third")
    fourth = await extra_member(db_session, a, "fourth")
    await rsvp(client, two_tenants, a, "member", sid, "going")  # takes the only seat
    await rsvp(client, two_tenants, a, second, sid, "going")  # waitlist
    await rsvp(client, two_tenants, a, third, sid, "maybe")
    await rsvp(client, two_tenants, a, fourth, sid, "not_going")

    for role in ("owner", "coach"):
        counts = (await detail(client, two_tenants, a, role, sid))["rsvp_counts"]
        assert counts == {"going": 1, "maybe": 1, "not_going": 1, "waitlist": 1}


async def test_staff_get_zeros_when_nobody_has_chosen(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    body = await detail(client, two_tenants, a, "coach", sid)

    assert body["rsvp_counts"] == COUNTS_OF_NOBODY


async def test_a_member_never_sees_counts_whatever_others_chose(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await rsvp(client, two_tenants, a, "coach", sid, "going")

    body = await detail(client, two_tenants, a, "member", sid)

    assert body["rsvp_counts"] is None


async def test_counts_are_per_session(client, two_tenants, db_session):
    a = two_tenants.a
    this_one = await a_session(db_session, a)
    other_one = await a_session(db_session, a)  # same studio, a different class
    await rsvp(client, two_tenants, a, "member", other_one, "going")
    await rsvp(client, two_tenants, a, "coach", this_one, "maybe")

    counts = (await detail(client, two_tenants, a, "owner", this_one))["rsvp_counts"]

    assert counts == COUNTS_OF_NOBODY | {"maybe": 1}


async def test_counts_leave_out_the_other_studio(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    sid_a = await a_session(db_session, a)
    sid_b = await a_session(db_session, b)
    await rsvp(client, two_tenants, b, "member", sid_b, "going")
    await rsvp(client, two_tenants, a, "member", sid_a, "maybe")

    counts = (await detail(client, two_tenants, a, "owner", sid_a))["rsvp_counts"]

    assert counts == COUNTS_OF_NOBODY | {"maybe": 1}


# --- names, and what stays private ---


async def test_the_coach_name_is_shown_but_never_their_email(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    body = await detail(client, two_tenants, a, "member", sid)

    assert body["coach_name"] == "coach of studio-a"
    assert "example.com" not in str(body)  # no email anywhere in the response


# --- seats_left: the one number every member gets ---


async def seats_left(client, two_tenants, studio, user, session_id):
    return (await detail(client, two_tenants, studio, user, session_id))["seats_left"]


async def test_seats_left_counts_down_as_people_say_going(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=2, booking=True)
    assert await seats_left(client, two_tenants, a, "member", sid) == 2

    await rsvp(client, two_tenants, a, "member", sid, "going")
    assert await seats_left(client, two_tenants, a, "member", sid) == 1

    await rsvp(client, two_tenants, a, "coach", sid, "going")
    assert await seats_left(client, two_tenants, a, "member", sid) == 0


@pytest.mark.parametrize("role", ["owner", "coach", "member"])
async def test_every_member_gets_seats_left(client, two_tenants, db_session, role):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=3, booking=True)

    assert await seats_left(client, two_tenants, a, role, sid) == 3


async def test_a_waitlisted_person_does_not_take_a_seat(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, booking=True)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    assert await rsvp(client, two_tenants, a, "member", sid, "going") == "waitlist"

    assert await seats_left(client, two_tenants, a, "member", sid) == 0  # not -1


async def test_maybe_and_not_going_do_not_take_a_seat(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=2, booking=True)
    await rsvp(client, two_tenants, a, "member", sid, "maybe")
    await rsvp(client, two_tenants, a, "coach", sid, "not_going")

    assert await seats_left(client, two_tenants, a, "member", sid) == 2


async def test_seats_left_is_never_negative(client, two_tenants, db_session):
    # Capacity cannot be lowered under the going count through the API, but the column allows it.
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, booking=True)
    for role in ("member", "coach"):
        participant = await db_session.scalar(
            select(Participant.id).where(Participant.user_id == a.users[role])
        )
        db_session.add(
            Rsvp(session_id=sid, participant_id=participant, tenant_id=a.id, status="going")
        )
    await db_session.flush()

    assert await seats_left(client, two_tenants, a, "member", sid) == 0


async def test_seats_left_only_counts_this_session(client, two_tenants, db_session):
    a = two_tenants.a
    this_one = await a_session(db_session, a, capacity=2, booking=True)
    other_one = await a_session(db_session, a, capacity=2, booking=True)
    await rsvp(client, two_tenants, a, "member", other_one, "going")

    assert await seats_left(client, two_tenants, a, "member", this_one) == 2


async def enable_booking_module(db_session, studio):
    (await db_session.get(Tenant, studio.id)).modules = ["booking"]
    await db_session.flush()


async def test_no_seats_left_for_an_rsvp_mode_class(client, two_tenants, db_session):
    a = two_tenants.a
    await enable_booking_module(db_session, a)  # the module is on; the class is still RSVP mode
    sid = await a_session(db_session, a, capacity=5)

    assert await seats_left(client, two_tenants, a, "member", sid) is None


async def test_no_seats_left_for_an_unlimited_class(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=None, booking=True)  # booking mode, module on

    assert await seats_left(client, two_tenants, a, "member", sid) is None


async def test_no_seats_left_when_the_booking_module_is_off(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=5, booking=True)
    (await db_session.get(Tenant, a.id)).modules = []  # booking mode and a limit, but module off
    await db_session.flush()

    assert await seats_left(client, two_tenants, a, "member", sid) is None
