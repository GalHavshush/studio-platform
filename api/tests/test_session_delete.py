import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

import app.sessions
from app.models import ClassReport, ClassSession, Participant, ParticipantNote, Rsvp
from tests.test_series_generation import create as create_series
from tests.test_sessions import add_class_type


async def a_session(db_session, studio, starts_in=timedelta(days=3), status="scheduled"):
    type_id = await add_class_type(db_session, studio)
    start = datetime.now(UTC) + starts_in
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=type_id,
        coach_id=studio.users["coach"],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        status=status,
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def a_participant(db_session, studio, name="Gail") -> uuid.UUID:
    person = Participant(tenant_id=studio.id, name=name)
    db_session.add(person)
    await db_session.flush()
    return person.id


async def record(db_session, studio, session_id, kind):
    """Write one kind of history on a session."""
    person = await a_participant(db_session, studio)
    if kind == "rsvp":
        db_session.add(
            Rsvp(session_id=session_id, participant_id=person, tenant_id=studio.id, status="going")
        )
    elif kind == "attendance":  # no plan, only a mark that the person came
        db_session.add(
            Rsvp(
                session_id=session_id,
                participant_id=person,
                tenant_id=studio.id,
                status=None,
                attended=True,
            )
        )
    elif kind == "report":
        db_session.add(
            ClassReport(
                session_id=session_id,
                tenant_id=studio.id,
                author_id=studio.users["coach"],
                summary="Done",
                submitted_at=datetime.now(UTC),
            )
        )
    elif kind == "note":
        db_session.add(
            ParticipantNote(
                tenant_id=studio.id,
                participant_id=person,
                session_id=session_id,
                author_id=studio.users["coach"],
                body="Knee felt better",
            )
        )
    await db_session.flush()


async def delete(client, two_tenants, studio, role, session_id):
    return await client.delete(
        f"/sessions/{session_id}", headers=two_tenants.headers(studio.users[role], studio.id)
    )


async def exists(db_session, session_id) -> bool:
    return (
        await db_session.scalar(
            select(func.count()).select_from(ClassSession).where(ClassSession.id == session_id)
        )
    ) == 1


async def test_an_owner_deletes_a_session_nobody_touched(client, two_tenants, db_session):
    sid = await a_session(db_session, two_tenants.a)

    response = await delete(client, two_tenants, two_tenants.a, "owner", sid)

    assert (response.status_code, response.content) == (204, b"")
    assert not await exists(db_session, sid)


@pytest.mark.parametrize("kind", ["past", "cancelled"])
async def test_past_and_cancelled_sessions_with_nothing_on_them_can_go_too(
    client, two_tenants, db_session, kind
):
    sid = await a_session(
        db_session,
        two_tenants.a,
        starts_in=timedelta(days=-5) if kind == "past" else timedelta(days=3),
        status="cancelled" if kind == "cancelled" else "scheduled",
    )

    response = await delete(client, two_tenants, two_tenants.a, "owner", sid)

    assert response.status_code == 204
    assert not await exists(db_session, sid)


@pytest.mark.parametrize("kind", ["rsvp", "attendance", "report", "note"])
async def test_anything_recorded_on_a_session_keeps_it(client, two_tenants, db_session, kind):
    sid = await a_session(db_session, two_tenants.a, starts_in=timedelta(days=-1))
    await record(db_session, two_tenants.a, sid, kind)

    response = await delete(client, two_tenants, two_tenants.a, "owner", sid)

    assert (response.status_code, response.json()) == (409, {"detail": "session_has_history"})
    assert await exists(db_session, sid)


async def test_history_on_another_session_does_not_matter(client, two_tenants, db_session):
    mine = await a_session(db_session, two_tenants.a)
    other = await a_session(db_session, two_tenants.a)
    await record(db_session, two_tenants.a, other, "rsvp")

    response = await delete(client, two_tenants, two_tenants.a, "owner", mine)

    assert response.status_code == 204
    assert await exists(db_session, other)


async def test_a_session_of_a_series_cannot_be_deleted_alone(client, two_tenants, db_session):
    series_id = await create_series(client, two_tenants, db_session)
    sid = await db_session.scalar(
        select(ClassSession.id).where(ClassSession.series_id == series_id).limit(1)
    )

    response = await delete(client, two_tenants, two_tenants.a, "owner", sid)

    assert (response.status_code, response.json()) == (409, {"detail": "session_in_series"})
    assert await exists(db_session, sid)


async def test_a_record_that_appears_after_the_check_is_still_a_409(
    client, two_tenants, db_session, monkeypatch
):
    """The foreign keys are the backstop: if the history check missed something, the database
    refuses the delete and the answer is the same 409, not a 500."""
    sid = await a_session(db_session, two_tenants.a)
    await record(db_session, two_tenants.a, sid, "rsvp")

    async def saw_nothing(session, ids):
        return set()

    monkeypatch.setattr(app.sessions, "sessions_with_history", saw_nothing)

    response = await delete(client, two_tenants, two_tenants.a, "owner", sid)

    assert (response.status_code, response.json()) == (409, {"detail": "session_has_history"})


@pytest.mark.parametrize("role", ["coach", "member"])
async def test_only_an_owner_can_delete_a_session(client, two_tenants, db_session, role):
    sid = await a_session(db_session, two_tenants.a)

    response = await delete(client, two_tenants, two_tenants.a, role, sid)

    assert (response.status_code, response.json()) == (403, {"detail": "insufficient_role"})
    assert await exists(db_session, sid)


async def test_another_studios_or_unknown_session_is_a_404(client, two_tenants, db_session):
    theirs = await a_session(db_session, two_tenants.b)

    for sid in (theirs, uuid.uuid4()):
        response = await delete(client, two_tenants, two_tenants.a, "owner", sid)
        assert (response.status_code, response.json()) == (404, {"detail": "session_not_found"})
    assert await exists(db_session, theirs)


async def test_deleting_needs_a_login(client):
    assert (await client.delete(f"/sessions/{uuid.uuid4()}")).status_code == 401
