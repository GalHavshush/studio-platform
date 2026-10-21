import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import ClassSession, ClassType, Membership, Participant, Rsvp, User

SUMMARY = "SUMMARY-TEXT We drilled guard passing."
SECRETS = ("WENT-WELL-TEXT", "NEEDS-WORK-TEXT", "OBSERVATIONS-TEXT", "NOTE-TEXT", "PRIVATE-NOTE")


async def a_session(db_session, studio, coach_role="coach", started_minutes_ago=60) -> uuid.UUID:
    ct = ClassType(tenant_id=studio.id, name=f"class {uuid.uuid4()}")
    db_session.add(ct)
    await db_session.flush()
    start = datetime.now(UTC) - timedelta(minutes=started_minutes_ago)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=ct.id,
        coach_id=studio.users[coach_role],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def participant(db_session, studio, role) -> uuid.UUID:
    return await db_session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == studio.id, Participant.user_id == studio.users[role]
        )
    )


async def another_member(db_session, studio) -> uuid.UUID:
    """A second plain member of the studio. Returns their user id."""
    user = User(email=f"other-{uuid.uuid4()}@example.com", name="Other Member")
    db_session.add(user)
    await db_session.flush()
    db_session.add_all(
        [
            Membership(tenant_id=studio.id, user_id=user.id, role="member"),
            Participant(tenant_id=studio.id, user_id=user.id, name=user.name),
        ]
    )
    await db_session.flush()
    return user.id


async def put_rsvp_row(db_session, studio, session_id, participant_id, status=None, attended=None):
    db_session.add(
        Rsvp(
            tenant_id=studio.id,
            session_id=session_id,
            participant_id=participant_id,
            status=status,
            attended=attended,
            confirmed_at=datetime.now(UTC) if attended is not None else None,
        )
    )
    await db_session.flush()


def full_report(maya_id, **overrides):
    return {
        "summary": SUMMARY,
        "went_well": "WENT-WELL-TEXT good energy",
        "needs_work": "NEEDS-WORK-TEXT hip escapes",
        "observations": "OBSERVATIONS-TEXT ready for the next level",
        "notes": [
            {"participant_id": str(maya_id), "body": "PRIVATE-NOTE slow hips"},
        ],
    } | overrides


async def save(client, two_tenants, studio, session_id, payload, role="coach"):
    response = await client.put(
        f"/sessions/{session_id}/report",
        json=payload,
        headers=two_tenants.headers(studio.users[role], studio.id),
    )
    assert response.status_code == 200, response.text
    return response


async def read(client, two_tenants, studio, role, session_id, user_id=None):
    return await client.get(
        f"/sessions/{session_id}/report",
        headers=two_tenants.headers(user_id or studio.users[role], studio.id),
    )


async def report_for_attendance_tests(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await save(client, two_tenants, a, sid, full_report(maya))
    return a, sid, maya


# --- a member: only the summary, only if they attended ---


async def test_a_member_who_attended_sees_only_the_summary(client, two_tenants, db_session):
    a, sid, maya = await report_for_attendance_tests(client, two_tenants, db_session)
    await put_rsvp_row(db_session, a, sid, maya, status="going", attended=True)

    response = await read(client, two_tenants, a, "member", sid)

    assert response.status_code == 200
    assert response.json() == {"session_id": str(sid), "summary": SUMMARY}
    for secret in SECRETS:
        assert secret not in response.text  # nothing staff-only leaks, in any field
    assert str(a.users["coach"]) not in response.text  # not even who wrote it


@pytest.mark.parametrize(
    "state",
    [
        "no RSVP at all",
        "RSVP going, attendance not recorded",
        "RSVP going, recorded as NOT attended",
        "RSVP not_going",
    ],
)
async def test_a_member_who_did_not_attend_sees_nothing(client, two_tenants, db_session, state):
    a, sid, maya = await report_for_attendance_tests(client, two_tenants, db_session)
    if state != "no RSVP at all":
        status = "not_going" if state == "RSVP not_going" else "going"
        attended = False if "NOT attended" in state else None
        await put_rsvp_row(db_session, a, sid, maya, status=status, attended=attended)

    response = await read(client, two_tenants, a, "member", sid)

    assert response.status_code == 404
    assert response.json() == {"detail": "report_not_found"}
    assert SUMMARY not in response.text


async def test_someone_elses_attendance_does_not_open_the_report(client, two_tenants, db_session):
    a, sid, _maya = await report_for_attendance_tests(client, two_tenants, db_session)
    other_user = await another_member(db_session, a)
    other = await db_session.scalar(select(Participant.id).where(Participant.user_id == other_user))
    await put_rsvp_row(db_session, a, sid, other, status="going", attended=True)  # only they came

    theirs = await read(client, two_tenants, a, "member", sid, user_id=other_user)
    mine = await read(client, two_tenants, a, "member", sid)  # Maya did not

    assert theirs.status_code == 200
    assert mine.status_code == 404


async def test_a_report_without_a_summary_shows_a_member_nothing(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await save(client, two_tenants, a, sid, full_report(maya, summary=None))
    await put_rsvp_row(db_session, a, sid, maya, status="going", attended=True)

    without = await read(client, two_tenants, a, "member", sid)
    await save(client, two_tenants, a, sid, full_report(maya, summary="Now there is one."))
    with_summary = await read(client, two_tenants, a, "member", sid)

    assert without.status_code == 404
    assert with_summary.json()["summary"] == "Now there is one."  # an edit shows up at once


async def test_all_the_reasons_for_nothing_look_the_same_to_a_member(
    client, two_tenants, db_session
):
    a, b = two_tenants.a, two_tenants.b
    no_report = await a_session(db_session, a)
    attended_nothing = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await put_rsvp_row(db_session, a, no_report, maya, status="going", attended=True)
    await save(client, two_tenants, a, attended_nothing, full_report(maya))  # a report, Maya absent
    theirs = await a_session(db_session, b)

    responses = [
        await read(client, two_tenants, a, "member", sid)
        for sid in (no_report, attended_nothing, theirs, uuid.uuid4())
    ]

    assert {r.status_code for r in responses} == {404}
    assert len({r.text for r in responses}) == 1  # no report, not attended, foreign, nonexistent


async def test_recording_attendance_through_the_api_opens_and_closes_the_report(
    client, two_tenants, db_session
):
    a, sid, maya = await report_for_attendance_tests(client, two_tenants, db_session)
    coach = two_tenants.headers(a.users["coach"], a.id)

    async def member_status():
        return (await read(client, two_tenants, a, "member", sid)).status_code

    before = await member_status()
    await client.post(
        f"/sessions/{sid}/attendance",
        json={"attended": True, "participant_id": str(maya)},
        headers=coach,
    )
    attended = await member_status()
    await client.post(
        f"/sessions/{sid}/attendance",
        json={"attended": False, "participant_id": str(maya)},
        headers=coach,
    )
    corrected = await member_status()

    assert (before, attended, corrected) == (404, 200, 404)


# --- staff: the whole report ---


@pytest.mark.parametrize("role", ["owner", "coach"])
async def test_staff_read_the_whole_report_with_its_notes(client, two_tenants, db_session, role):
    a = two_tenants.a
    sid = await a_session(db_session, a, coach_role="coach")
    maya = await participant(db_session, a, "member")
    written = await save(
        client, two_tenants, a, sid, full_report(maya), role="owner"
    )  # not the coach

    response = await read(client, two_tenants, a, role, sid)  # any coach reads all reports

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "session_id",
        "summary",
        "went_well",
        "needs_work",
        "observations",
        "author_id",
        "submitted_at",
        "notes",
    }
    assert body["went_well"] == "WENT-WELL-TEXT good energy"
    assert body["notes"] == [
        {"participant_id": str(maya), "body": "PRIVATE-NOTE slow hips", "shared_with_member": False}
    ]
    assert body == written.json()  # the same shape the PUT returns


async def test_staff_get_a_clear_404_for_a_missing_report_or_session(
    client, two_tenants, db_session
):
    a, b = two_tenants.a, two_tenants.b
    no_report = await a_session(db_session, a)
    theirs = await a_session(db_session, b)

    missing_report = await read(client, two_tenants, a, "coach", no_report)
    foreign = await read(client, two_tenants, a, "owner", theirs)
    nonexistent = await read(client, two_tenants, a, "owner", uuid.uuid4())

    assert missing_report.json() == {"detail": "report_not_found"}
    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "session_not_found"}
