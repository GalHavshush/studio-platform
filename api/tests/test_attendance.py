import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text

from app.models import ClassSession, ClassType, Participant, Rsvp


async def a_session(db_session, studio, starts_in, coach_role="coach", status="scheduled"):
    """A one-hour session starting `starts_in` from now (negative = already started)."""
    ct = ClassType(tenant_id=studio.id, name="Open mat")
    db_session.add(ct)
    await db_session.flush()
    start = datetime.now(UTC) + starts_in
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


async def participant_of(db_session, studio, role) -> uuid.UUID:
    return await db_session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == studio.id, Participant.user_id == studio.users[role]
        )
    )


async def attend(client, two_tenants, studio, role, session_id, attended=True, **extra):
    return await client.post(
        f"/sessions/{session_id}/attendance",
        json={"attended": attended} | extra,
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


async def row_of(db_session, session_id, participant_id) -> Rsvp | None:
    return await db_session.scalar(
        select(Rsvp)
        .where(Rsvp.session_id == session_id, Rsvp.participant_id == participant_id)
        .execution_options(populate_existing=True)
    )


# --- the check-in window: opens 15 minutes before the start; closes for members 24h after the end ---


@pytest.mark.parametrize(
    ("starts_in", "allowed"),
    [
        (timedelta(hours=2), False),
        (timedelta(minutes=16), False),
        (timedelta(minutes=14), True),  # inside the 15-minute window
        (timedelta(0), True),  # just started
        (timedelta(hours=-3), True),  # over, but a member can still record it
    ],
)
async def test_check_in_opens_fifteen_minutes_before_the_start(
    client, two_tenants, db_session, starts_in, allowed
):
    a = two_tenants.a
    sid = await a_session(db_session, a, starts_in)

    response = await attend(client, two_tenants, a, "member", sid)

    if allowed:
        assert response.status_code == 200
    else:
        assert response.status_code == 409
        assert response.json() == {"detail": "checkin_not_open"}
        assert await db_session.scalar(select(func.count()).select_from(Rsvp)) == 0


# --- a member records their own attendance ---


@pytest.mark.parametrize("role", ["owner", "coach", "member"])
async def test_everyone_records_their_own_attendance_without_an_rsvp(
    client, two_tenants, db_session, role
):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))
    me = await participant_of(db_session, a, role)

    response = await attend(client, two_tenants, a, role, sid, attended=True)

    assert response.status_code == 200
    body = response.json()
    assert (body["session_id"], body["participant_id"], body["attended"]) == (
        str(sid),
        str(me),
        True,
    )
    row = await row_of(db_session, sid, me)
    assert (row.attended, row.status) == (True, None)  # no RSVP was given
    assert row.confirmed_at is not None


async def test_attendance_and_rsvp_do_not_overwrite_each_other(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))
    me = await participant_of(db_session, a, "member")
    headers = two_tenants.headers(a.users["member"], a.id)

    await client.put(f"/sessions/{sid}/rsvp", json={"status": "going"}, headers=headers)
    await attend(client, two_tenants, a, "member", sid, attended=False)  # said going, did not come
    row = await row_of(db_session, sid, me)
    assert (row.status, row.attended) == ("going", False)

    await client.put(f"/sessions/{sid}/rsvp", json={"status": "maybe"}, headers=headers)
    row = await row_of(db_session, sid, me)
    assert (row.status, row.attended) == ("maybe", False)


async def test_the_answer_can_be_changed_and_confirmed_at_is_refreshed(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))
    me = await participant_of(db_session, a, "member")
    await attend(client, two_tenants, a, "member", sid, attended=False)
    await db_session.execute(
        text("UPDATE rsvps SET confirmed_at = now() - interval '1 day'")  # an old answer
    )

    response = await attend(client, two_tenants, a, "member", sid, attended=True)

    assert response.status_code == 200
    row = await row_of(db_session, sid, me)
    assert row.attended is True
    assert row.confirmed_at > datetime.now(UTC) - timedelta(minutes=1)
    assert await db_session.scalar(select(func.count()).select_from(Rsvp)) == 1


# --- who may record whose ---


async def test_a_member_cannot_record_someone_elses_attendance(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))
    other = await participant_of(db_session, a, "coach")

    response = await attend(client, two_tenants, a, "member", sid, participant_id=str(other))

    assert response.status_code == 403
    assert response.json() == {"detail": "insufficient_role"}
    assert await db_session.scalar(select(func.count()).select_from(Rsvp)) == 0


async def test_a_member_may_name_themselves(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))
    me = await participant_of(db_session, a, "member")

    response = await attend(client, two_tenants, a, "member", sid, participant_id=str(me))

    assert response.status_code == 200


async def test_a_coach_records_anyone_on_a_session_they_teach(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))  # taught by a's coach
    member = await participant_of(db_session, a, "member")

    response = await attend(
        client, two_tenants, a, "coach", sid, attended=False, participant_id=str(member)
    )

    assert response.status_code == 200
    assert response.json()["participant_id"] == str(member)
    assert (await row_of(db_session, sid, member)).attended is False


async def test_a_coach_cannot_record_on_another_coachs_session(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5), coach_role="owner")
    member = await participant_of(db_session, a, "member")

    response = await attend(client, two_tenants, a, "coach", sid, participant_id=str(member))

    assert response.status_code == 403
    assert response.json() == {"detail": "not_your_session"}
    assert await db_session.scalar(select(func.count()).select_from(Rsvp)) == 0


async def test_the_owner_records_anyone_on_any_session(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))  # taught by the coach
    member = await participant_of(db_session, a, "member")

    response = await attend(client, two_tenants, a, "owner", sid, participant_id=str(member))

    assert response.status_code == 200
    assert (await row_of(db_session, sid, member)).attended is True


async def test_the_named_participant_must_belong_to_this_studio(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    sid = await a_session(db_session, a, timedelta(minutes=-5))
    theirs = await participant_of(db_session, b, "member")

    foreign = await attend(client, two_tenants, a, "owner", sid, participant_id=str(theirs))
    nonexistent = await attend(
        client, two_tenants, a, "owner", sid, participant_id=str(uuid.uuid4())
    )

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "participant_not_found"}
    assert await db_session.scalar(select(func.count()).select_from(Rsvp)) == 0


# --- the session itself ---


async def test_a_cancelled_session_takes_no_attendance(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5), status="cancelled")

    response = await attend(client, two_tenants, a, "member", sid)

    assert response.status_code == 409
    assert response.json() == {"detail": "session_cancelled"}


async def test_another_studios_session_is_not_found(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    theirs = await a_session(db_session, b, timedelta(minutes=-5))

    foreign = await attend(client, two_tenants, a, "owner", theirs)
    nonexistent = await attend(client, two_tenants, a, "owner", uuid.uuid4())

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text
    assert foreign.json() == {"detail": "session_not_found"}
    assert await db_session.scalar(select(func.count()).select_from(Rsvp)) == 0


@pytest.mark.parametrize(
    "payload",
    [{}, {"attended": None}, {"attended": "maybe"}, {"attended": "yes"}, {"attended": "true"}]
    + [{"attended": 1}, {"attended": 0}],  # only real booleans: no "yes", no 1
)
async def test_attended_must_be_a_boolean(client, two_tenants, db_session, payload):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))

    response = await client.post(
        f"/sessions/{sid}/attendance",
        json=payload,
        headers=two_tenants.headers(a.users["member"], a.id),
    )

    assert response.status_code == 422


# --- the cap: a member can change their own attendance until 24 hours after the session ends ---

ONE_HOUR = timedelta(hours=1)  # the length of the helper's sessions


@pytest.mark.parametrize(
    ("ended_ago", "allowed"),
    [
        (timedelta(hours=23, minutes=59), True),
        (timedelta(hours=24, minutes=1), False),
    ],
)
async def test_a_member_can_record_attendance_until_a_day_after_the_end(
    client, two_tenants, db_session, ended_ago, allowed
):
    a = two_tenants.a
    sid = await a_session(db_session, a, -(ended_ago + ONE_HOUR))

    response = await attend(client, two_tenants, a, "member", sid)

    assert response.status_code == (200 if allowed else 409)
    if not allowed:
        assert response.json() == {"detail": "checkin_closed"}
    me = await participant_of(db_session, a, "member")
    assert (await row_of(db_session, sid, me) is not None) is allowed


async def test_after_the_cap_a_members_earlier_answer_cannot_be_changed(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(minutes=-5))
    await attend(client, two_tenants, a, "member", sid, attended=True)
    await db_session.execute(  # time passes: the session ended two days ago
        text(
            "UPDATE class_sessions SET starts_at = now() - interval '49 hours', "
            "ends_at = now() - interval '48 hours' WHERE id = :id"
        ),
        {"id": sid},
    )

    changed = await attend(client, two_tenants, a, "member", sid, attended=False)

    assert changed.status_code == 409
    me = await participant_of(db_session, a, "member")
    assert (await row_of(db_session, sid, me)).attended is True


@pytest.mark.parametrize("role", ["coach", "owner"])
async def test_staff_can_record_attendance_long_after_the_cap(
    client, two_tenants, db_session, role
):
    a = two_tenants.a
    sid = await a_session(db_session, a, timedelta(days=-30))
    member = await participant_of(db_session, a, "member")
    mine = await participant_of(db_session, a, role)

    for_member = await attend(client, two_tenants, a, role, sid, participant_id=str(member))
    for_self = await attend(client, two_tenants, a, role, sid)

    assert (for_member.status_code, for_self.status_code) == (200, 200)
    assert (await row_of(db_session, sid, member)).attended is True
    assert (await row_of(db_session, sid, mine)).attended is True


@pytest.mark.parametrize(
    ("ended_ago", "sees_summary"),
    [
        (timedelta(hours=23, minutes=59), True),  # the control: inside the cap it does unlock it
        (timedelta(hours=24, minutes=1), False),
    ],
)
async def test_the_cap_keeps_the_summary_hidden_from_a_late_member(
    client, two_tenants, db_session, ended_ago, sees_summary
):
    a = two_tenants.a
    sid = await a_session(db_session, a, -(ended_ago + ONE_HOUR))
    await client.put(
        f"/sessions/{sid}/report",
        json={"summary": "Worked on guard passing."},
        headers=two_tenants.headers(a.users["coach"], a.id),
    )
    me = await participant_of(db_session, a, "member")
    member = two_tenants.headers(a.users["member"], a.id)

    await attend(client, two_tenants, a, "member", sid)
    report = await client.get(f"/sessions/{sid}/report", headers=member)
    timeline = await client.get(f"/participants/{me}/timeline", headers=member)

    if sees_summary:
        assert report.json() == {"session_id": str(sid), "summary": "Worked on guard passing."}
        assert [i["summary"] for i in timeline.json()["items"]] == ["Worked on guard passing."]
    else:
        assert (report.status_code, report.json()) == (404, {"detail": "report_not_found"})
        assert timeline.json()["items"] == []  # no RSVP, no attendance: not even an entry
