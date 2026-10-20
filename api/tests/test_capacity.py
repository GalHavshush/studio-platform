import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import ClassSession, ClassType, Participant, Rsvp, Tenant


async def a_session(
    db_session, studio, capacity=1, mode="booking", modules=("booking",), class_type_id=None
) -> uuid.UUID:
    """A session of a class type in `mode`, in a studio with `modules` switched on."""
    tenant = await db_session.get(Tenant, studio.id)
    tenant.modules = list(modules)
    if class_type_id is None:
        ct = ClassType(tenant_id=studio.id, name=f"class {uuid.uuid4()}", attendance_mode=mode)
        db_session.add(ct)
        await db_session.flush()
        class_type_id = ct.id
    start = datetime(2026, 10, 20, 15, tzinfo=UTC)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=class_type_id,
        coach_id=studio.users["coach"],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=capacity,
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def rsvp(client, two_tenants, studio, role, session_id, status):
    return await client.put(
        f"/sessions/{session_id}/rsvp",
        json={"status": status},
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


async def statuses(db_session, session_id) -> list[str]:
    rows = await db_session.scalars(
        select(Rsvp.status).where(Rsvp.session_id == session_id).order_by(Rsvp.status)
    )
    return list(rows)


async def test_a_full_session_rejects_the_next_going(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=2)

    first = await rsvp(client, two_tenants, a, "owner", sid, "going")
    second = await rsvp(client, two_tenants, a, "coach", sid, "going")
    third = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert (first.status_code, second.status_code) == (200, 200)
    assert third.status_code == 409
    assert third.json() == {"detail": "session_full"}
    assert await statuses(db_session, sid) == ["going", "going"]  # the refused one left no row


async def test_maybe_and_not_going_never_take_a_seat(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")  # the only seat

    maybe = await rsvp(client, two_tenants, a, "member", sid, "maybe")
    not_going = await rsvp(client, two_tenants, a, "owner", sid, "not_going")

    assert (maybe.status_code, not_going.status_code) == (200, 200)


async def test_giving_up_a_seat_frees_it_for_someone_else(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    refused = await rsvp(client, two_tenants, a, "member", sid, "going")

    await rsvp(client, two_tenants, a, "coach", sid, "not_going")
    accepted = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert refused.status_code == 409
    assert accepted.status_code == 200


async def test_repeating_going_when_full_is_a_no_op(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)

    first = await rsvp(client, two_tenants, a, "coach", sid, "going")
    again = await rsvp(client, two_tenants, a, "coach", sid, "going")

    assert (first.status_code, again.status_code) == (200, 200)
    assert await statuses(db_session, sid) == ["going"]  # one row, one seat


async def test_going_after_maybe_needs_a_free_seat(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "member", sid, "maybe")

    response = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert response.status_code == 409
    assert await statuses(db_session, sid) == ["going", "maybe"]  # still maybe


async def test_seats_are_counted_per_session(client, two_tenants, db_session):
    a = two_tenants.a
    first = await a_session(db_session, a, capacity=1)
    ct = await db_session.scalar(select(ClassSession.class_type_id).where(ClassSession.id == first))
    second = await a_session(db_session, a, capacity=1, class_type_id=ct)
    await rsvp(client, two_tenants, a, "coach", first, "going")  # fills the first session only

    response = await rsvp(client, two_tenants, a, "member", second, "going")

    assert response.status_code == 200


async def test_no_capacity_means_unlimited(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=None)

    responses = [
        await rsvp(client, two_tenants, a, role, sid, "going")
        for role in ("owner", "coach", "member")
    ]

    assert [r.status_code for r in responses] == [200, 200, 200]


async def test_rsvp_mode_ignores_capacity(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, mode="rsvp")

    responses = [
        await rsvp(client, two_tenants, a, role, sid, "going") for role in ("coach", "member")
    ]

    assert [r.status_code for r in responses] == [200, 200]


async def test_booking_rules_need_the_module_to_be_on(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1, mode="booking", modules=())

    responses = [
        await rsvp(client, two_tenants, a, role, sid, "going") for role in ("coach", "member")
    ]

    assert [r.status_code for r in responses] == [200, 200]


async def test_another_studios_module_does_not_switch_booking_on(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    await a_session(db_session, a, modules=("booking",))  # only A has the module
    sid = await a_session(db_session, b, capacity=1, mode="booking", modules=())

    responses = [
        await rsvp(client, two_tenants, b, role, sid, "going") for role in ("coach", "member")
    ]

    assert [r.status_code for r in responses] == [200, 200]


async def test_a_cancelled_session_is_still_refused_first(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=5)
    await client.post(
        f"/sessions/{sid}/cancel", headers=two_tenants.headers(a.users["owner"], a.id)
    )

    response = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert response.json() == {"detail": "session_cancelled"}


async def test_lowering_capacity_keeps_existing_bookings(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=2)
    await rsvp(client, two_tenants, a, "coach", sid, "going")
    await rsvp(client, two_tenants, a, "owner", sid, "going")

    lowered = await client.patch(
        f"/sessions/{sid}",
        json={"capacity": 1},
        headers=two_tenants.headers(a.users["owner"], a.id),
    )
    newcomer = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert lowered.status_code == 200  # nobody is removed
    assert await statuses(db_session, sid) == ["going", "going"]
    assert newcomer.status_code == 409


async def test_the_primary_key_rejects_a_duplicate_row(db_session, two_tenants):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    me = await db_session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == a.id, Participant.user_id == a.users["member"]
        )
    )
    db_session.add(Rsvp(session_id=sid, participant_id=me, status="going"))
    await db_session.flush()
    db_session.add(Rsvp(session_id=sid, participant_id=me, status="going"))

    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_seat_counting_ignores_the_other_studios_bookings(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    sid_a = await a_session(db_session, a, capacity=1)
    sid_b = await a_session(db_session, b, capacity=1)
    await rsvp(client, two_tenants, b, "coach", sid_b, "going")  # B's session is full

    response = await rsvp(client, two_tenants, a, "member", sid_a, "going")

    assert response.status_code == 200
    assert await db_session.scalar(select(func.count()).select_from(Rsvp)) == 2


async def test_earlier_maybe_and_not_going_do_not_block_a_going(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, capacity=1)
    await rsvp(client, two_tenants, a, "member", sid, "maybe")  # these come first this time
    await rsvp(client, two_tenants, a, "owner", sid, "not_going")

    response = await rsvp(client, two_tenants, a, "coach", sid, "going")

    assert response.status_code == 200
    assert await statuses(db_session, sid) == ["going", "maybe", "not_going"]
