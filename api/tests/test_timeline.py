import base64
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import (
    ClassReport,
    ClassSession,
    ClassType,
    Membership,
    Participant,
    ParticipantNote,
    Rsvp,
)

BASE = datetime(2026, 1, 1, 18, tzinfo=UTC)


async def a_class_type(db_session, studio, name="Open mat") -> uuid.UUID:
    row = ClassType(tenant_id=studio.id, name=name)
    db_session.add(row)
    await db_session.flush()
    return row.id


async def a_session(
    db_session, studio, day=0, class_type_id=None, status="scheduled", starts_at=None
):
    """A session `day` days after BASE (or at `starts_at`), taught by the studio's coach."""
    class_type_id = class_type_id or await a_class_type(db_session, studio)
    start = starts_at or BASE + timedelta(days=day)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=class_type_id,
        coach_id=studio.users["coach"],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        status=status,
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


async def rsvp(db_session, studio, session_id, participant_id, status="going", attended=None):
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


async def report(db_session, studio, session_id, summary="The summary."):
    db_session.add(
        ClassReport(
            session_id=session_id,
            tenant_id=studio.id,
            author_id=studio.users["coach"],
            summary=summary,
            went_well="WENT-WELL-SECRET",
            needs_work="NEEDS-WORK-SECRET",
            observations="OBSERVATIONS-SECRET",
            submitted_at=datetime.now(UTC),
        )
    )
    await db_session.flush()


async def note(db_session, studio, session_id, participant_id, body, shared=False):
    db_session.add(
        ParticipantNote(
            tenant_id=studio.id,
            participant_id=participant_id,
            session_id=session_id,
            author_id=studio.users["coach"],
            body=body,
            shared_with_member=shared,
        )
    )
    await db_session.flush()


async def get(client, two_tenants, studio, role, participant_id, user_id=None, **params):
    return await client.get(
        f"/participants/{participant_id}/timeline",
        params=params,
        headers=two_tenants.headers(user_id or studio.users[role], studio.id),
    )


def ids(response) -> list[str]:
    return [item["session_id"] for item in response.json()["items"]]


def forged_cursor(payload) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


# --- what a timeline entry holds, and which classes appear ---


async def test_staff_see_everything_about_a_class(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, class_type_id=await a_class_type(db_session, a, "BJJ"))
    maya = await participant(db_session, a, "member")
    await rsvp(db_session, a, sid, maya, status="going", attended=True)
    await report(db_session, a, sid, summary="We drilled guard passing.")
    await note(db_session, a, sid, maya, "Slow hips (private)", shared=False)

    response = await get(client, two_tenants, a, "coach", maya)

    assert response.status_code == 200
    assert response.json()["next_cursor"] is None
    [item] = response.json()["items"]
    assert (item["session_id"], item["class_type_name"], item["status"]) == (
        str(sid),
        "BJJ",
        "scheduled",
    )
    assert (item["booking"], item["attended"]) == ("going", True)
    assert item["summary"] == "We drilled guard passing."
    [shown] = item["notes"]
    assert (shown["body"], shown["shared_with_member"], shown["author_id"]) == (
        "Slow hips (private)",
        False,
        str(a.users["coach"]),
    )
    assert (
        "SECRET" not in response.text
    )  # the class-level coach fields are not part of the timeline


async def test_a_class_appears_through_an_rsvp_or_a_note_and_nothing_else(
    client, two_tenants, db_session
):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    cody = await participant(db_session, a, "coach")
    by_rsvp = await a_session(db_session, a, day=1)
    by_note = await a_session(db_session, a, day=2)
    only_attendance = await a_session(db_session, a, day=3)
    neither = await a_session(db_session, a, day=4)
    someone_elses = await a_session(db_session, a, day=5)
    await rsvp(db_session, a, by_rsvp, maya, status="maybe")
    await note(db_session, a, by_note, maya, "walk-in")  # no RSVP at all
    await rsvp(db_session, a, only_attendance, maya, status=None, attended=True)
    await rsvp(db_session, a, someone_elses, cody)
    await note(db_session, a, someone_elses, cody, "about Cody")

    response = await get(client, two_tenants, a, "owner", maya)

    assert ids(response) == [str(only_attendance), str(by_note), str(by_rsvp)]  # newest first
    assert str(neither) not in ids(response) and str(someone_elses) not in ids(response)


async def test_a_cancelled_class_stays_in_the_history(client, two_tenants, db_session):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    sid = await a_session(db_session, a, status="cancelled")
    await rsvp(db_session, a, sid, maya, status="going")

    [item] = (await get(client, two_tenants, a, "coach", maya)).json()["items"]

    assert (item["status"], item["booking"]) == ("cancelled", "going")


# --- a member sees only their own, and only what was shared ---


async def test_a_member_sees_their_own_history_without_staff_only_data(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await rsvp(db_session, a, sid, maya, status="going", attended=True)
    await report(db_session, a, sid, summary="We drilled guard passing.")
    await note(db_session, a, sid, maya, "PRIVATE-NOTE slow hips", shared=False)

    response = await get(client, two_tenants, a, "member", maya)

    [item] = response.json()["items"]
    assert (item["booking"], item["attended"]) == ("going", True)
    assert item["summary"] == "We drilled guard passing."
    assert item["notes"] == []  # the only note is private
    for secret in ("PRIVATE-NOTE", "SECRET", str(a.users["coach"])):
        assert secret not in response.text


async def test_a_member_sees_shared_notes_without_author_or_flag(client, two_tenants, db_session):
    a = two_tenants.a
    first, second = await a_session(db_session, a, day=1), await a_session(db_session, a, day=2)
    maya = await participant(db_session, a, "member")
    await rsvp(db_session, a, first, maya)
    await note(db_session, a, first, maya, "private", shared=False)
    await note(db_session, a, second, maya, "For Maya: great work!", shared=True)  # no RSVP

    response = await get(client, two_tenants, a, "member", maya)

    newer, older = response.json()["items"]
    assert (newer["session_id"], newer["booking"]) == (str(second), None)
    assert [set(n) for n in newer["notes"]] == [{"id", "body", "created_at"}]
    assert newer["notes"][0]["body"] == "For Maya: great work!"
    assert older["notes"] == []


async def test_a_class_with_only_a_private_note_never_shows_for_a_member(
    client, two_tenants, db_session
):
    a = two_tenants.a
    visible, hidden = await a_session(db_session, a, day=1), await a_session(db_session, a, day=2)
    maya = await participant(db_session, a, "member")
    await rsvp(db_session, a, visible, maya)
    await note(db_session, a, hidden, maya, "a staff-only note exists for this class")

    mine = await get(client, two_tenants, a, "member", maya)
    staff = await get(client, two_tenants, a, "coach", maya)

    assert ids(mine) == [str(visible)]  # even an empty entry would reveal the private note
    assert ids(staff) == [str(hidden), str(visible)]


async def test_a_member_gets_a_summary_only_for_classes_they_attended(
    client, two_tenants, db_session
):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    attended, absent, unrecorded, no_rsvp = [
        await a_session(db_session, a, day=d) for d in (1, 2, 3, 4)
    ]
    await rsvp(db_session, a, attended, maya, attended=True)
    await rsvp(db_session, a, absent, maya, attended=False)
    await rsvp(db_session, a, unrecorded, maya)
    await note(db_session, a, no_rsvp, maya, "shared", shared=True)
    for sid in (attended, absent, unrecorded, no_rsvp):
        await report(db_session, a, sid, summary=f"summary of {sid}")

    member = await get(client, two_tenants, a, "member", maya)
    staff = await get(client, two_tenants, a, "coach", maya)

    member_summaries = {i["session_id"]: i["summary"] for i in member.json()["items"]}
    assert member_summaries == {
        str(attended): f"summary of {attended}",
        str(absent): None,
        str(unrecorded): None,
        str(no_rsvp): None,
    }
    assert all(i["summary"] for i in staff.json()["items"])  # staff see every report


async def test_the_timeline_agrees_with_the_report_route_about_summaries(
    client, two_tenants, db_session
):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    sessions = [await a_session(db_session, a, day=d) for d in range(4)]
    for sid, attended in zip(sessions, (True, False, None, True), strict=True):
        await rsvp(db_session, a, sid, maya, attended=attended)
        await report(db_session, a, sid)

    timeline = (await get(client, two_tenants, a, "member", maya)).json()["items"]

    for item in timeline:  # the same rule, so the same answer as GET /sessions/{id}/report
        direct = await client.get(
            f"/sessions/{item['session_id']}/report",
            headers=two_tenants.headers(a.users["member"], a.id),
        )
        assert (item["summary"] is not None) == (direct.status_code == 200)


async def test_a_member_cannot_ask_for_anyone_elses_timeline(client, two_tenants, db_session):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    cody = await participant(db_session, a, "coach")
    sid = await a_session(db_session, a)
    await rsvp(db_session, a, sid, cody)

    other = await get(client, two_tenants, a, "member", cody)
    nonexistent = await get(client, two_tenants, a, "member", uuid.uuid4())
    mine = await get(client, two_tenants, a, "member", maya)

    assert other.status_code == nonexistent.status_code == 404
    assert other.text == nonexistent.text  # indistinguishable from "no such participant"
    assert other.json() == {"detail": "participant_not_found"}
    assert mine.json() == {"items": [], "next_cursor": None}


# --- ordering and pagination ---


async def many_sessions(db_session, studio, participant_id, count):
    out = []
    for day in range(count):
        sid = await a_session(db_session, studio, day=day)
        await rsvp(db_session, studio, sid, participant_id)
        out.append(sid)
    return out


async def test_newest_first_and_upcoming_classes_come_first(client, two_tenants, db_session):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    past = await a_session(db_session, a, starts_at=datetime.now(UTC) - timedelta(days=3))
    soon = await a_session(db_session, a, starts_at=datetime.now(UTC) + timedelta(days=2))
    older = await a_session(db_session, a, starts_at=datetime.now(UTC) - timedelta(days=9))
    for sid in (past, soon, older):
        await rsvp(db_session, a, sid, maya)

    response = await get(client, two_tenants, a, "coach", maya)

    assert ids(response) == [str(soon), str(past), str(older)]


@pytest.mark.parametrize("role", ["coach", "member"])
async def test_pages_follow_each_other_without_overlap_or_gaps(
    client, two_tenants, db_session, role
):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    created = await many_sessions(db_session, a, maya, 7)
    expected = [str(sid) for sid in reversed(created)]  # newest first

    pages, cursor = [], None
    for _ in range(10):  # a guard against an endless loop
        params = {"limit": 3} | ({"cursor": cursor} if cursor else {})
        response = await get(client, two_tenants, a, role, maya, **params)
        assert response.status_code == 200
        pages.append(ids(response))
        cursor = response.json()["next_cursor"]
        if cursor is None:
            break

    assert [len(p) for p in pages] == [3, 3, 1]
    assert [i for page in pages for i in page] == expected
    assert cursor is None  # the last page has no cursor


async def test_classes_with_the_same_start_time_are_not_skipped_or_repeated(
    client, two_tenants, db_session
):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    same_time = []
    for _ in range(5):
        sid = await a_session(
            db_session, a, starts_at=BASE
        )  # five classes at exactly the same moment
        await rsvp(db_session, a, sid, maya)
        same_time.append(str(sid))

    seen, cursor = [], None
    for _ in range(10):  # bounded, so a broken cursor fails the test instead of looping forever
        params = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        response = await get(client, two_tenants, a, "coach", maya, **params)
        seen += ids(response)
        cursor = response.json()["next_cursor"]
        if cursor is None:
            break

    assert cursor is None, "paging never reached the last page"
    assert sorted(seen) == sorted(same_time)  # all five, each exactly once


async def test_a_new_class_between_two_pages_does_not_disturb_paging(
    client, two_tenants, db_session
):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    created = await many_sessions(db_session, a, maya, 5)
    first = await get(client, two_tenants, a, "coach", maya, limit=2)

    newer = await a_session(db_session, a, day=50)  # appears at the top while the reader scrolls
    await rsvp(db_session, a, newer, maya)
    second = await get(
        client, two_tenants, a, "coach", maya, limit=2, cursor=first.json()["next_cursor"]
    )

    expected_rest = [str(s) for s in reversed(created)][2:4]
    assert ids(second) == expected_rest  # an OFFSET would have repeated the last item of page 1


async def test_the_default_page_is_20_and_the_limit_is_bounded(client, two_tenants, db_session):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    await many_sessions(db_session, a, maya, 22)

    default = await get(client, two_tenants, a, "coach", maya)
    too_small = await get(client, two_tenants, a, "coach", maya, limit=0)
    too_big = await get(client, two_tenants, a, "coach", maya, limit=51)

    assert len(default.json()["items"]) == 20
    assert default.json()["next_cursor"] is not None
    assert too_small.status_code == too_big.status_code == 422


@pytest.mark.parametrize(
    "cursor",
    [
        "not-a-cursor",
        base64.urlsafe_b64encode(b"not json").decode(),
        forged_cursor({"s": "2026-01-01T00:00:00+00:00"}),  # missing the id
        forged_cursor({"s": "yesterday", "i": str(uuid.uuid4())}),
        forged_cursor({"s": "2026-01-01T00:00:00", "i": str(uuid.uuid4())}),  # no timezone
        forged_cursor({"s": "2026-01-01T00:00:00+00:00", "i": "nope"}),
        forged_cursor([1, 2]),
    ],
)
async def test_a_malformed_cursor_is_rejected(client, two_tenants, db_session, cursor):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")

    response = await get(client, two_tenants, a, "coach", maya, cursor=cursor)

    assert response.status_code == 422
    assert response.json() == {"detail": "invalid_cursor"}


async def test_a_forged_cursor_cannot_widen_what_a_member_sees(client, two_tenants, db_session):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    cody = await participant(db_session, a, "coach")
    mine, hers = await a_session(db_session, a, day=1), await a_session(db_session, a, day=2)
    await rsvp(db_session, a, mine, maya)
    await note(db_session, a, hers, cody, "about Cody", shared=True)
    far_future = forged_cursor({"s": "9999-01-01T00:00:00+00:00", "i": str(uuid.uuid4())})

    response = await get(client, two_tenants, a, "member", maya, cursor=far_future)

    assert ids(response) == [str(mine)]  # a cursor is only a position; the filters still apply


# --- studios ---


async def test_another_studios_participant_is_not_found(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    theirs = await participant(db_session, b, "member")

    foreign = await get(client, two_tenants, a, "owner", theirs)
    nonexistent = await get(client, two_tenants, a, "owner", uuid.uuid4())

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text
    assert foreign.json() == {"detail": "participant_not_found"}


async def test_one_person_in_two_studios_has_two_timelines(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    user_id = a.users["member"]
    db_session.add(Membership(tenant_id=b.id, user_id=user_id, role="member"))
    db_session.add(Participant(tenant_id=b.id, user_id=user_id, name="Same person"))
    await db_session.flush()
    in_a = await participant(db_session, a, "member")
    in_b = await db_session.scalar(
        select(Participant.id).where(Participant.tenant_id == b.id, Participant.user_id == user_id)
    )
    class_a = await a_session(
        db_session, a, class_type_id=await a_class_type(db_session, a, "A's class")
    )
    class_b = await a_session(
        db_session, b, class_type_id=await a_class_type(db_session, b, "B's class")
    )
    await rsvp(db_session, a, class_a, in_a)
    await rsvp(db_session, b, class_b, in_b)

    seen_in_a = await get(client, two_tenants, a, "member", in_a, user_id=user_id)
    seen_in_b = await get(client, two_tenants, b, "member", in_b, user_id=user_id)
    crossed = await get(client, two_tenants, b, "member", in_a, user_id=user_id)

    assert [i["class_type_name"] for i in seen_in_a.json()["items"]] == ["A's class"]
    assert [i["class_type_name"] for i in seen_in_b.json()["items"]] == ["B's class"]
    assert crossed.status_code == 404


async def test_a_total_that_fills_the_last_page_exactly_has_no_next_page(
    client, two_tenants, db_session
):
    a = two_tenants.a
    maya = await participant(db_session, a, "member")
    await many_sessions(db_session, a, maya, 6)  # exactly two full pages of three

    first = await get(client, two_tenants, a, "coach", maya, limit=3)
    second = await get(
        client, two_tenants, a, "coach", maya, limit=3, cursor=first.json()["next_cursor"]
    )

    assert first.json()["next_cursor"] is not None
    assert len(second.json()["items"]) == 3
    assert second.json()["next_cursor"] is None  # not an announced-but-empty third page
