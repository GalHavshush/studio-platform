import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.models import ClassSession, ClassType, Participant, Rsvp


async def a_session(db_session, studio, status="scheduled") -> uuid.UUID:
    ct = ClassType(tenant_id=studio.id, name="Open mat")
    db_session.add(ct)
    await db_session.flush()
    start = datetime(2026, 10, 20, 15, tzinfo=UTC)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=ct.id,
        coach_id=studio.users["coach"],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        status=status,
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


async def participant_of(db_session, studio, role) -> uuid.UUID:
    return await db_session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == studio.id, Participant.user_id == studio.users[role]
        )
    )


async def rows(db_session) -> dict[uuid.UUID, str]:
    return dict((await db_session.execute(select(Rsvp.participant_id, Rsvp.status))).all())


@pytest.mark.parametrize("role", ["owner", "coach", "member"])
async def test_every_member_rsvps_for_themselves(client, two_tenants, db_session, role):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await rsvp(client, two_tenants, a, role, sid, "going")

    assert response.status_code == 200
    assert response.json() == {"session_id": str(sid), "status": "going"}
    assert await rows(db_session) == {await participant_of(db_session, a, role): "going"}


async def test_changing_the_plan_updates_the_same_row(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    for status in ("going", "maybe", "not_going", "not_going"):  # the last one repeats
        response = await rsvp(client, two_tenants, a, "member", sid, status)
        assert response.status_code == 200
        assert response.json()["status"] == status

    assert await rows(db_session) == {await participant_of(db_session, a, "member"): "not_going"}


async def test_members_rsvps_are_independent(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    await rsvp(client, two_tenants, a, "member", sid, "going")
    await rsvp(client, two_tenants, a, "coach", sid, "maybe")
    await rsvp(client, two_tenants, a, "member", sid, "not_going")

    assert await rows(db_session) == {
        await participant_of(db_session, a, "member"): "not_going",
        await participant_of(db_session, a, "coach"): "maybe",
    }


async def test_the_client_cannot_rsvp_for_someone_else(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    other = await participant_of(db_session, a, "coach")

    await client.put(
        f"/sessions/{sid}/rsvp",
        json={"status": "going", "participant_id": str(other)},  # ignored: no such field
        headers=two_tenants.headers(a.users["member"], a.id),
    )

    assert await rows(db_session) == {await participant_of(db_session, a, "member"): "going"}


@pytest.mark.parametrize("status", ["waitlist", "attended", "", "GOING", None])
async def test_an_invalid_status_is_rejected(client, two_tenants, db_session, status):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await rsvp(client, two_tenants, a, "member", sid, status)

    assert response.status_code == 422
    assert await rows(db_session) == {}


async def test_the_database_only_accepts_known_statuses(db_session, two_tenants):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    db_session.add(
        Rsvp(
            tenant_id=a.id,
            session_id=sid,
            participant_id=await participant_of(db_session, a, "member"),
            status="x",
        )
    )

    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_a_cancelled_session_takes_no_rsvps(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, status="cancelled")

    response = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert response.status_code == 409
    assert response.json() == {"detail": "session_cancelled"}
    assert await rows(db_session) == {}


async def test_cancelling_keeps_existing_rsvps(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await rsvp(client, two_tenants, a, "member", sid, "going")

    await client.post(
        f"/sessions/{sid}/cancel", headers=two_tenants.headers(a.users["owner"], a.id)
    )

    assert list((await rows(db_session)).values()) == ["going"]


async def test_a_user_without_a_participant_gets_a_clear_error(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await db_session.execute(
        text("DELETE FROM participants WHERE tenant_id = :t AND user_id = :u"),
        {"t": a.id, "u": a.users["member"]},
    )

    response = await rsvp(client, two_tenants, a, "member", sid, "going")

    assert response.status_code == 409
    assert response.json() == {"detail": "no_participant"}


async def test_another_studios_session_is_not_found(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    theirs = await a_session(db_session, b)

    foreign = await rsvp(client, two_tenants, a, "member", theirs, "going")
    nonexistent = await rsvp(client, two_tenants, a, "member", uuid.uuid4(), "going")

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "session_not_found"}
    assert await db_session.scalar(select(func.count()).select_from(Rsvp)) == 0


async def test_the_same_person_rsvps_separately_in_two_studios(client, two_tenants, db_session):
    from app.models import Membership

    a, b = two_tenants.a, two_tenants.b
    user_id = a.users["member"]
    db_session.add_all(
        [
            Membership(tenant_id=b.id, user_id=user_id, role="member"),
            Participant(tenant_id=b.id, user_id=user_id, name="Same person"),
        ]
    )
    await db_session.flush()
    sid_a, sid_b = await a_session(db_session, a), await a_session(db_session, b)

    headers = {
        a.id: two_tenants.headers(user_id, a.id),
        b.id: two_tenants.headers(user_id, b.id),
    }
    await client.put(f"/sessions/{sid_a}/rsvp", json={"status": "going"}, headers=headers[a.id])
    await client.put(f"/sessions/{sid_b}/rsvp", json={"status": "maybe"}, headers=headers[b.id])
    # And studio A's session cannot be reached with studio B's header.
    crossed = await client.put(
        f"/sessions/{sid_a}/rsvp", json={"status": "going"}, headers=headers[b.id]
    )

    assert crossed.status_code == 404
    statuses = (await db_session.execute(select(Rsvp.session_id, Rsvp.status))).all()
    assert dict(statuses) == {sid_a: "going", sid_b: "maybe"}
