import uuid
from datetime import UTC, datetime, timedelta

from app.models import ClassSession, ClassType, Membership, Participant, Rsvp, User


async def a_session(db_session, studio, status="scheduled"):
    ct = ClassType(tenant_id=studio.id, name=f"class {uuid.uuid4()}")
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


async def person(db_session, studio, name) -> uuid.UUID:
    """A member of the studio with this display name; returns their participant id."""
    user = User(email=f"{name.lower()}@{studio.id}.example.com", name=name)
    db_session.add(user)
    await db_session.flush()
    participant = Participant(tenant_id=studio.id, user_id=user.id, name=name)
    db_session.add_all(
        [Membership(tenant_id=studio.id, user_id=user.id, role="member"), participant]
    )
    await db_session.flush()
    return participant.id


async def mark(db_session, studio, session_id, participant_id, attended, status=None):
    """Write the attendance straight into the row: the route has a time window these fixed dates
    are long past."""
    db_session.add(
        Rsvp(
            session_id=session_id,
            participant_id=participant_id,
            tenant_id=studio.id,
            status=status,
            attended=attended,
        )
    )
    await db_session.flush()


async def attendees(client, two_tenants, studio, role, session_id):
    return await client.get(
        f"/sessions/{session_id}/attendees",
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


def names(response):
    return [a["name"] for a in response.json()]


async def test_a_member_gets_403(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await attendees(client, two_tenants, a, "member", sid)

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}


async def test_coaches_and_owners_get_the_list_in_name_order(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    for name in ("Zed", "Amy", "Moe"):
        await mark(db_session, a, sid, await person(db_session, a, name), True, status="going")

    for role in ("coach", "owner"):
        response = await attendees(client, two_tenants, a, role, sid)
        assert response.status_code == 200
        assert names(response) == ["Amy", "Moe", "Zed"]


async def test_an_entry_has_the_id_and_the_name_and_nothing_else(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    pid = await person(db_session, a, "Amy")
    await mark(db_session, a, sid, pid, True)

    response = await attendees(client, two_tenants, a, "coach", sid)

    assert response.json() == [{"participant_id": str(pid), "name": "Amy"}]  # no email, no plan


async def test_a_walk_in_with_no_plan_is_included(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await mark(db_session, a, sid, await person(db_session, a, "Walker"), True, status=None)

    assert names(await attendees(client, two_tenants, a, "coach", sid)) == ["Walker"]


async def test_only_people_marked_present_are_listed(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await mark(db_session, a, sid, await person(db_session, a, "Came"), True, status="going")
    await mark(db_session, a, sid, await person(db_session, a, "Absent"), False, status="going")
    await mark(db_session, a, sid, await person(db_session, a, "Unrecorded"), None, status="going")

    assert names(await attendees(client, two_tenants, a, "coach", sid)) == ["Came"]


async def test_an_empty_session_gives_an_empty_list(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await attendees(client, two_tenants, a, "coach", sid)

    assert (response.status_code, response.json()) == (200, [])


async def test_only_this_sessions_attendees_are_listed(client, two_tenants, db_session):
    a = two_tenants.a
    mine, other = await a_session(db_session, a), await a_session(db_session, a)
    await mark(db_session, a, mine, await person(db_session, a, "Here"), True)
    await mark(db_session, a, other, await person(db_session, a, "Elsewhere"), True)

    assert names(await attendees(client, two_tenants, a, "coach", mine)) == ["Here"]


async def test_a_cancelled_session_can_still_be_read(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, status="cancelled")
    await mark(db_session, a, sid, await person(db_session, a, "Amy"), True)

    assert names(await attendees(client, two_tenants, a, "coach", sid)) == ["Amy"]


async def test_another_studios_session_is_the_same_404_as_a_missing_one(
    client, two_tenants, db_session
):
    a, b = two_tenants.a, two_tenants.b
    theirs = await a_session(db_session, b)
    await mark(db_session, b, theirs, await person(db_session, b, "Secret"), True)

    foreign = await attendees(client, two_tenants, a, "coach", theirs)
    missing = await attendees(client, two_tenants, a, "coach", uuid.uuid4())

    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json() == {"detail": "session_not_found"}
