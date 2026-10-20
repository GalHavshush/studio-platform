import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models import ClassSession, ClassType, Membership, Participant, Rsvp, Tenant, User


async def a_session(db_session, studio, capacity=1, mode="booking", modules=("booking",)):
    tenant = await db_session.get(Tenant, studio.id)
    tenant.modules = list(modules)
    ct = ClassType(tenant_id=studio.id, name=f"class {uuid.uuid4()}", attendance_mode=mode)
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
    """One more member of the studio, so a queue can be longer than the three seeded people."""
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
    """`user` is a role name of the seeded people, or a user id from extra_member."""
    user_id = studio.users.get(user, user)
    return await client.put(
        f"/sessions/{session_id}/rsvp",
        json={"status": status},
        headers=two_tenants.headers(user_id, studio.id),
    )


async def state(db_session, studio, user, session_id):
    """(status, waitlisted_at) of one person's RSVP, read fresh from the database."""
    user_id = studio.users.get(user, user)
    row = (
        await db_session.execute(
            select(Rsvp.status, Rsvp.waitlisted_at)
            .join(Participant, Participant.id == Rsvp.participant_id)
            .where(Rsvp.session_id == session_id, Participant.user_id == user_id)
            .execution_options(populate_existing=True)
        )
    ).first()
    return (row.status, row.waitlisted_at) if row else (None, None)


async def status_of(db_session, studio, user, session_id):
    return (await state(db_session, studio, user, session_id))[0]


# --- joining ---


async def test_going_on_a_full_session_joins_the_waitlist(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")

    response = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert response.status_code == 200
    assert response.json() == {"session_id": str(sid), "status": "waitlist"}
    status, waitlisted_at = await state(db_session, a, "member", sid)
    assert status == "waitlist" and waitlisted_at is not None
    assert await state(db_session, a, "coach", sid) == (
        "going",
        None,
    )  # a seat holder has no place in line


async def test_a_client_cannot_ask_for_the_waitlist_directly(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)

    response = await rsvp(client, two_tenants, a, "member", sid, "waitlist")

    assert response.status_code == 422
    assert await status_of(db_session, a, "member", sid) is None


# --- promotion order ---


async def test_a_freed_seat_goes_to_the_earliest_waiting_person(client, two_tenants, db_session):
    a = two_tenants.a
    third = await extra_member(db_session, a, "third")
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    for who in ("owner", "member", third):  # they queue in this order
        await rsvp(client, two_tenants, a, who, sid, "going")

    await rsvp(client, two_tenants, a, "coach", sid, "not_going")
    after_first = [await status_of(db_session, a, w, sid) for w in ("owner", "member", third)]
    await rsvp(client, two_tenants, a, "owner", sid, "not_going")
    after_second = [await status_of(db_session, a, w, sid) for w in ("member", third)]

    assert after_first == ["going", "waitlist", "waitlist"]
    assert after_second == ["going", "waitlist"]
    assert await state(db_session, a, "owner", sid) == ("not_going", None)


@pytest.mark.parametrize("leaving", ["not_going", "maybe"])
async def test_any_way_of_giving_up_a_seat_promotes(client, two_tenants, db_session, leaving):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "member", sid, "going")

    await rsvp(client, two_tenants, a, "coach", sid, leaving)

    assert await status_of(db_session, a, "member", sid) == "going"


async def test_only_as_many_people_are_promoted_as_seats_freed(client, two_tenants, db_session):
    a = two_tenants.a
    people = [await extra_member(db_session, a, f"p{i}") for i in range(3)]
    sid = await a_session(db_session, a, capacity=2)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "owner", sid, "going")
    for who in people:
        await rsvp(client, two_tenants, a, who, sid, "going")  # all three wait, in order

    await rsvp(client, two_tenants, a, "coach", sid, "not_going")  # one seat

    assert [await status_of(db_session, a, who, sid) for who in people] == [
        "going",
        "waitlist",
        "waitlist",
    ]


async def test_equal_timestamps_are_ordered_by_participant_id(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "owner", sid, "going")
    await rsvp(client, two_tenants, a, "member", sid, "going")
    await db_session.execute(
        text("UPDATE rsvps SET waitlisted_at = '2026-10-20T10:00:00Z' WHERE status = 'waitlist'")
    )
    first = await db_session.scalar(
        select(Rsvp.participant_id)
        .where(Rsvp.session_id == sid, Rsvp.status == "waitlist")
        .order_by(Rsvp.participant_id)
    )

    await rsvp(client, two_tenants, a, "coach", sid, "not_going")

    promoted = await db_session.scalar(
        select(Rsvp.participant_id)
        .where(Rsvp.session_id == sid, Rsvp.status == "going")
        .execution_options(populate_existing=True)
    )
    assert promoted == first


# --- staying and leaving the queue ---


async def test_repeating_going_keeps_your_place_in_line(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "owner", sid, "going")  # first in line
    await rsvp(client, two_tenants, a, "member", sid, "going")  # second
    _, place = await state(db_session, a, "owner", sid)

    again = await rsvp(client, two_tenants, a, "owner", sid, "going")
    await rsvp(client, two_tenants, a, "coach", sid, "not_going")

    assert again.json()["status"] == "waitlist"
    assert await state(db_session, a, "owner", sid) == ("going", None)  # still first, so promoted
    assert (await status_of(db_session, a, "member", sid)) == "waitlist"
    assert place is not None


@pytest.mark.parametrize("leaving", ["not_going", "maybe"])
async def test_leaving_the_queue_clears_the_place_and_is_skipped(
    client, two_tenants, db_session, leaving
):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "owner", sid, "going")
    await rsvp(client, two_tenants, a, "member", sid, "going")

    await rsvp(client, two_tenants, a, "owner", sid, leaving)  # gives up the wait
    assert await state(db_session, a, "owner", sid) == (leaving, None)
    await rsvp(client, two_tenants, a, "coach", sid, "not_going")

    assert await status_of(db_session, a, "member", sid) == "going"  # the next in line
    assert await status_of(db_session, a, "owner", sid) == leaving


async def test_a_waiting_person_takes_a_free_seat_if_there_is_one(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "member", sid, "going")
    # A seat frees up without the promotion having run (a direct change, not through the API).
    await db_session.execute(text("UPDATE rsvps SET status = 'not_going' WHERE status = 'going'"))

    again = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert again.json()["status"] == "going"
    assert await state(db_session, a, "member", sid) == ("going", None)


# --- capacity changes ---


async def patch_capacity(client, two_tenants, studio, session_id, capacity):
    return await client.patch(
        f"/sessions/{session_id}",
        json={"capacity": capacity},
        headers=two_tenants.headers(studio.users["owner"], studio.id),
    )


async def test_raising_capacity_promotes_exactly_the_new_seats(client, two_tenants, db_session):
    a = two_tenants.a
    people = [await extra_member(db_session, a, f"p{i}") for i in range(2)]
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    for who in ("owner", "member", *people):
        await rsvp(client, two_tenants, a, who, sid, "going")  # four wait, in this order

    await patch_capacity(client, two_tenants, a, sid, 3)  # two more seats

    waiting = ["owner", "member", *people]
    assert [await status_of(db_session, a, who, sid) for who in waiting] == [
        "going",
        "going",
        "waitlist",
        "waitlist",
    ]


async def test_making_a_session_unlimited_promotes_everyone_waiting(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "owner", sid, "going")
    await rsvp(client, two_tenants, a, "member", sid, "going")

    await patch_capacity(client, two_tenants, a, sid, None)

    assert [await status_of(db_session, a, w, sid) for w in ("owner", "member")] == [
        "going",
        "going",
    ]


async def test_lowering_capacity_promotes_and_removes_nobody(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=2)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "owner", sid, "going")
    await rsvp(client, two_tenants, a, "member", sid, "going")  # waits

    await patch_capacity(client, two_tenants, a, sid, 1)

    assert await status_of(db_session, a, "member", sid) == "waitlist"
    assert [await status_of(db_session, a, w, sid) for w in ("coach", "owner")] == [
        "going",
        "going",
    ]


async def test_no_promotion_when_booking_rules_no_longer_apply(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "member", sid, "going")
    (await db_session.get(Tenant, a.id)).modules = []  # the studio switches the module off
    await db_session.flush()

    await patch_capacity(client, two_tenants, a, sid, None)

    assert await status_of(db_session, a, "member", sid) == "waitlist"


# --- where it does not apply ---


async def test_rsvp_mode_has_no_waitlist(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, mode="rsvp")

    responses = [await rsvp(client, two_tenants, a, w, sid, "going") for w in ("coach", "member")]

    assert [r.json()["status"] for r in responses] == ["going", "going"]


async def test_studios_do_not_share_waitlists(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    sid_a = await a_session(db_session, a, capacity=1)
    sid_b = await a_session(db_session, b, capacity=1)
    for studio, sid in ((a, sid_a), (b, sid_b)):
        await rsvp(client, two_tenants, studio, "coach", sid, "going")
        await rsvp(client, two_tenants, studio, "member", sid, "going")

    await rsvp(client, two_tenants, a, "coach", sid_a, "not_going")  # frees a seat in A only

    assert await status_of(db_session, a, "member", sid_a) == "going"
    assert await status_of(db_session, b, "member", sid_b) == "waitlist"


# --- the database's own rules ---


@pytest.mark.parametrize(
    ("status", "waitlisted_at"),
    [
        ("waitlist", None),  # waiting without a place in line
        ("going", datetime(2026, 10, 20, tzinfo=UTC)),  # a place in line while holding a seat
        ("queued", None),  # not a status
    ],
)
async def test_the_database_keeps_status_and_queue_place_consistent(
    db_session, two_tenants, status, waitlisted_at
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    me = await db_session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == a.id, Participant.user_id == a.users["member"]
        )
    )
    db_session.add(
        Rsvp(
            tenant_id=a.id,
            session_id=sid,
            participant_id=me,
            status=status,
            waitlisted_at=waitlisted_at,
        )
    )

    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_each_session_has_its_own_waitlist(client, two_tenants, db_session):
    a = two_tenants.a
    first = await a_session(db_session, a, capacity=1)
    second = await a_session(db_session, a, capacity=1)
    for sid, waiting in ((first, "member"), (second, "owner")):
        await rsvp(client, two_tenants, a, "coach", sid, "going")
        await rsvp(
            client, two_tenants, a, waiting, sid, "going"
        )  # the first session's waiter is earlier

    await rsvp(client, two_tenants, a, "coach", second, "not_going")

    assert await status_of(db_session, a, "owner", second) == "going"
    assert await status_of(db_session, a, "member", first) == "waitlist"  # untouched
