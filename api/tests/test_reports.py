import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.models import ClassReport, ClassSession, ClassType


async def a_session(db_session, studio, coach_role="coach", status="scheduled") -> uuid.UUID:
    ct = ClassType(tenant_id=studio.id, name=f"class {uuid.uuid4()}")
    db_session.add(ct)
    await db_session.flush()
    start = datetime(2026, 10, 20, 15, tzinfo=UTC)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=ct.id,
        coach_id=studio.users[coach_role],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        status=status,
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def write(client, two_tenants, studio, role, session_id, **fields):
    return await client.put(
        f"/sessions/{session_id}/report",
        json=fields,
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


async def report_of(db_session, session_id) -> ClassReport | None:
    return await db_session.scalar(
        select(ClassReport)
        .where(ClassReport.session_id == session_id)
        .execution_options(populate_existing=True)
    )


async def count(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(ClassReport))


FULL = {
    "summary": "Worked on guard passing.",
    "went_well": "Good energy, clean drilling.",
    "needs_work": "Hip escapes are still slow.",
    "observations": "Maya is ready for the next level.",
}


# --- who may write ---


@pytest.mark.parametrize("role", ["owner", "coach"])
async def test_the_owner_and_the_sessions_coach_write_the_report(
    client, two_tenants, db_session, role
):
    a = two_tenants.a
    sid = await a_session(db_session, a)  # taught by the coach

    response = await write(client, two_tenants, a, role, sid, **FULL)

    assert response.status_code == 200
    body = response.json()
    assert {k: body[k] for k in FULL} == FULL
    assert (body["session_id"], body["author_id"]) == (str(sid), str(a.users[role]))
    row = await report_of(db_session, sid)
    assert (row.tenant_id, row.author_id, row.summary) == (a.id, a.users[role], FULL["summary"])


async def test_a_coach_cannot_write_another_coachs_report(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, coach_role="owner")  # the owner teaches it

    response = await write(client, two_tenants, a, "coach", sid, **FULL)

    assert response.status_code == 403
    assert response.json() == {"detail": "not_your_session"}
    assert await count(db_session) == 0


async def test_members_cannot_write_reports(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await write(client, two_tenants, a, "member", sid, **FULL)

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}
    assert await count(db_session) == 0


# --- one report per session, and a PUT replaces it ---


async def test_a_second_save_replaces_the_report_and_clears_what_is_left_out(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await write(client, two_tenants, a, "coach", sid, **FULL)

    response = await write(client, two_tenants, a, "coach", sid, summary="Short version.")

    assert response.status_code == 200
    row = await report_of(db_session, sid)
    assert (row.summary, row.went_well, row.needs_work, row.observations) == (
        "Short version.",
        None,
        None,
        None,
    )
    assert await count(db_session) == 1  # replaced, not added


async def test_the_latest_writer_is_the_author_and_the_time_is_refreshed(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    await write(client, two_tenants, a, "coach", sid, **FULL)
    await db_session.execute(
        text("UPDATE class_reports SET submitted_at = now() - interval '1 day'")
    )

    await write(client, two_tenants, a, "owner", sid, **FULL)  # the owner corrects it

    row = await report_of(db_session, sid)
    assert row.author_id == a.users["owner"]
    assert row.submitted_at > datetime.now(UTC) - timedelta(minutes=1)


async def test_each_session_has_its_own_report(client, two_tenants, db_session):
    a = two_tenants.a
    first, second = await a_session(db_session, a), await a_session(db_session, a)

    await write(client, two_tenants, a, "coach", first, summary="one")
    await write(client, two_tenants, a, "coach", second, summary="two")

    assert (await report_of(db_session, first)).summary == "one"
    assert (await report_of(db_session, second)).summary == "two"


# --- what is accepted ---


@pytest.mark.parametrize(
    "fields", [{}, {"summary": None}, {"summary": "   ", "went_well": ""}, {"observations": "\n\t"}]
)
async def test_an_empty_report_is_rejected(client, two_tenants, db_session, fields):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await write(client, two_tenants, a, "coach", sid, **fields)

    assert response.status_code == 422
    assert response.json() == {"detail": "empty_report"}
    assert await count(db_session) == 0


async def test_text_is_trimmed_and_blank_fields_are_stored_as_nothing(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    response = await write(client, two_tenants, a, "coach", sid, summary="  hi  ", went_well="   ")

    assert response.json()["summary"] == "hi"
    assert response.json()["went_well"] is None
    assert (await report_of(db_session, sid)).went_well is None


async def test_a_field_can_hold_5000_characters_but_not_5001(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)

    longest = await write(client, two_tenants, a, "coach", sid, summary="x" * 5000)
    too_long = await write(client, two_tenants, a, "coach", sid, summary="x" * 5001)

    assert longest.status_code == 200
    assert too_long.status_code == 422
    assert (
        len((await report_of(db_session, sid)).summary) == 5000
    )  # the rejected one changed nothing


async def test_a_cancelled_session_takes_no_report(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, status="cancelled")

    response = await write(client, two_tenants, a, "coach", sid, **FULL)

    assert response.status_code == 409
    assert response.json() == {"detail": "session_cancelled"}
    assert await count(db_session) == 0


# --- other studios ---


async def test_another_studios_session_is_not_found(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    theirs = await a_session(db_session, b)

    foreign = await write(client, two_tenants, a, "owner", theirs, **FULL)
    nonexistent = await write(client, two_tenants, a, "owner", uuid.uuid4(), **FULL)

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "session_not_found"}
    assert await count(db_session) == 0


# --- the database's own rules ---


async def test_a_report_cannot_name_a_studio_other_than_its_sessions(db_session, two_tenants):
    a, b = two_tenants.a, two_tenants.b
    sid = await a_session(db_session, a)
    db_session.add(
        ClassReport(
            session_id=sid,
            tenant_id=b.id,  # not the session's studio
            author_id=a.users["coach"],
            summary="x",
            submitted_at=datetime.now(UTC),
        )
    )

    with pytest.raises(IntegrityError) as refused:
        await db_session.flush()
    assert "fk_class_reports_session_same_tenant" in str(refused.value)


async def test_the_primary_key_allows_one_report_per_session(db_session, two_tenants):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    for _ in range(2):
        db_session.add(
            ClassReport(
                session_id=sid,
                tenant_id=a.id,
                author_id=a.users["coach"],
                summary="x",
                submitted_at=datetime.now(UTC),
            )
        )

    with pytest.raises(IntegrityError):
        await db_session.flush()
