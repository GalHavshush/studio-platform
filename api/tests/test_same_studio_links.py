import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import ClassSession, ClassType, Participant, Rsvp


async def a_class_type(db_session, studio) -> uuid.UUID:
    row = ClassType(tenant_id=studio.id, name=f"class {uuid.uuid4()}")
    db_session.add(row)
    await db_session.flush()
    return row.id


def a_session_row(studio, class_type_id) -> ClassSession:
    start = datetime(2026, 10, 20, 15, tzinfo=UTC)
    return ClassSession(
        tenant_id=studio.id,
        class_type_id=class_type_id,
        coach_id=studio.users["coach"],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
    )


async def a_session(db_session, studio) -> uuid.UUID:
    row = a_session_row(studio, await a_class_type(db_session, studio))
    db_session.add(row)
    await db_session.flush()
    return row.id


async def a_participant(db_session, studio) -> uuid.UUID:
    return await db_session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == studio.id, Participant.user_id == studio.users["member"]
        )
    )


async def assert_refused_by(db_session, constraint: str) -> None:
    """The flush must fail, and for the named constraint (not for some other reason)."""
    with pytest.raises(IntegrityError) as refused:
        await db_session.flush()
    assert constraint in str(refused.value)


# --- the positive control: links inside one studio are fine ---


async def test_links_inside_one_studio_are_accepted(db_session, two_tenants):
    a = two_tenants.a
    sid, me = await a_session(db_session, a), await a_participant(db_session, a)

    db_session.add(Rsvp(tenant_id=a.id, session_id=sid, participant_id=me, status="going"))

    await db_session.flush()  # no error: without this the refusals below could mean "refuses all"


# --- links across studios are refused by the database itself ---


async def test_a_session_cannot_use_another_studios_class_type(db_session, two_tenants):
    a, b = two_tenants.a, two_tenants.b
    theirs = await a_class_type(db_session, b)

    db_session.add(a_session_row(a, theirs))

    await assert_refused_by(db_session, "fk_class_sessions_class_type_same_tenant")


async def test_an_rsvp_cannot_name_another_studios_participant(db_session, two_tenants):
    a, b = two_tenants.a, two_tenants.b
    sid, theirs = await a_session(db_session, a), await a_participant(db_session, b)

    db_session.add(Rsvp(tenant_id=a.id, session_id=sid, participant_id=theirs, status="going"))

    await assert_refused_by(db_session, "fk_rsvps_participant_same_tenant")


async def test_an_rsvp_cannot_name_another_studios_session(db_session, two_tenants):
    a, b = two_tenants.a, two_tenants.b
    theirs, me = await a_session(db_session, b), await a_participant(db_session, a)

    db_session.add(Rsvp(tenant_id=a.id, session_id=theirs, participant_id=me, status="going"))

    await assert_refused_by(db_session, "fk_rsvps_session_same_tenant")


async def test_an_rsvp_cannot_claim_a_studio_that_is_neither_parents(db_session, two_tenants):
    a, b = two_tenants.a, two_tenants.b
    sid, me = await a_session(db_session, a), await a_participant(db_session, a)

    db_session.add(Rsvp(tenant_id=b.id, session_id=sid, participant_id=me, status="going"))

    await assert_refused_by(db_session, "fk_rsvps_session_same_tenant")


async def test_a_link_to_nothing_is_still_refused(db_session, two_tenants):
    a = two_tenants.a
    db_session.add(a_session_row(a, uuid.uuid4()))  # no such class type

    await assert_refused_by(db_session, "fk_class_sessions_class_type_same_tenant")


# --- the endpoints fill in the studio themselves ---


async def test_the_endpoints_store_the_callers_studio_on_the_rsvp(client, two_tenants, db_session):
    a = two_tenants.a
    started = a_session_row(a, await a_class_type(db_session, a))
    started.starts_at = datetime.now(UTC) - timedelta(minutes=5)  # check-in is open
    started.ends_at = started.starts_at + timedelta(hours=1)
    db_session.add(started)
    await db_session.flush()
    sid = started.id
    member = two_tenants.headers(a.users["member"], a.id)
    owner = two_tenants.headers(a.users["owner"], a.id)

    rsvp = await client.put(f"/sessions/{sid}/rsvp", json={"status": "going"}, headers=member)
    attendance = await client.post(
        f"/sessions/{sid}/attendance", json={"attended": True}, headers=owner
    )  # the owner's own attendance: a second row, created by the other upsert

    assert (rsvp.status_code, attendance.status_code) == (200, 200)
    rows = (await db_session.execute(select(Rsvp.tenant_id))).scalars().all()
    assert rows == [a.id, a.id]
