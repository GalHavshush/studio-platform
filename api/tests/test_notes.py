import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import app.reports
from app.models import (
    ClassReport,
    ClassSession,
    ClassType,
    Membership,
    Participant,
    ParticipantNote,
    Tenant,
    User,
)
from app.security import create_access_token
from app.seed import PILOT_TENANT


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


async def participant(db_session, studio, role) -> uuid.UUID:
    return await db_session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == studio.id, Participant.user_id == studio.users[role]
        )
    )


def note(participant_id, body="Good progress.", shared=None):
    payload = {"participant_id": str(participant_id), "body": body}
    if shared is not None:
        payload["shared_with_member"] = shared
    return payload


async def write(client, two_tenants, studio, role, session_id, **fields):
    return await client.put(
        f"/sessions/{session_id}/report",
        json=fields,
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


async def stored(db_session, session_id) -> dict[uuid.UUID, str]:
    rows = await db_session.execute(
        select(ParticipantNote.participant_id, ParticipantNote.body)
        .where(ParticipantNote.session_id == session_id)
        .execution_options(populate_existing=True)
    )
    return dict(rows.all())


async def read_notes(client, two_tenants, studio, role, participant_id, tenant_id=None):
    return await client.get(
        f"/participants/{participant_id}/notes",
        headers=two_tenants.headers(studio.users[role], tenant_id or studio.id),
    )


# --- writing notes inside the report ---


@pytest.mark.parametrize("role", ["owner", "coach"])
async def test_notes_are_saved_together_with_the_report(client, two_tenants, db_session, role):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya, olive = (
        await participant(db_session, a, "member"),
        await participant(db_session, a, "owner"),
    )

    response = await write(
        client,
        two_tenants,
        a,
        role,
        sid,
        summary="Guard work.",
        notes=[note(maya, "Ready for the next level."), note(olive, "Slow hips.")],
    )

    assert response.status_code == 200
    assert sorted((n["participant_id"], n["body"]) for n in response.json()["notes"]) == sorted(
        [(str(maya), "Ready for the next level."), (str(olive), "Slow hips.")]
    )
    assert await stored(db_session, sid) == {maya: "Ready for the next level.", olive: "Slow hips."}
    row = (
        await db_session.scalars(select(ParticipantNote).where(ParticipantNote.session_id == sid))
    ).first()
    assert (row.tenant_id, row.author_id) == (a.id, a.users[role])


async def test_omitting_notes_leaves_the_existing_ones_alone(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await write(client, two_tenants, a, "coach", sid, summary="First.", notes=[note(maya)])

    response = await write(client, two_tenants, a, "coach", sid, summary="Fixed a typo.")

    assert response.status_code == 200
    assert response.json()["notes"] == [
        {"participant_id": str(maya), "body": "Good progress.", "shared_with_member": False}
    ]
    assert await stored(db_session, sid) == {maya: "Good progress."}


async def test_a_list_of_notes_adds_changes_and_removes(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    cody = await participant(db_session, a, "coach")
    olive = await participant(db_session, a, "owner")
    await write(
        client,
        two_tenants,
        a,
        "coach",
        sid,
        summary="x",
        notes=[note(maya, "old"), note(cody, "going")],
    )

    await write(
        client,
        two_tenants,
        a,
        "coach",
        sid,
        summary="x",
        notes=[note(maya, "new"), note(olive, "added")],
    )

    assert await stored(db_session, sid) == {maya: "new", olive: "added"}  # cody's note is gone


async def test_an_empty_list_removes_every_note(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya)])

    response = await write(client, two_tenants, a, "coach", sid, summary="x", notes=[])

    assert response.json()["notes"] == []
    assert await stored(db_session, sid) == {}


async def test_a_changed_note_keeps_its_time_and_takes_the_latest_author(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya, "first")])
    first = await db_session.scalar(
        select(ParticipantNote)
        .where(ParticipantNote.session_id == sid)
        .execution_options(populate_existing=True)
    )
    created_at = first.created_at
    await db_session.execute(
        text("UPDATE participant_notes SET created_at = created_at - interval '1 day'")
    )

    await write(client, two_tenants, a, "owner", sid, summary="x", notes=[note(maya, "corrected")])

    row = await db_session.scalar(
        select(ParticipantNote)
        .where(ParticipantNote.session_id == sid)
        .execution_options(populate_existing=True)
    )
    assert (row.body, row.author_id) == ("corrected", a.users["owner"])
    assert row.created_at == created_at - timedelta(days=1)  # not reset by the update


async def test_a_report_may_consist_only_of_notes_but_not_of_nothing(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")

    only_notes = await write(client, two_tenants, a, "coach", sid, notes=[note(maya)])
    nothing = await write(client, two_tenants, a, "coach", sid, notes=[])

    assert only_notes.status_code == 200
    assert nothing.status_code == 422
    assert nothing.json() == {"detail": "empty_report"}


async def test_a_cancelled_session_takes_no_notes(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a, status="cancelled")
    maya = await participant(db_session, a, "member")

    response = await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya)])

    assert response.status_code == 409
    assert await stored(db_session, sid) == {}


# --- an invalid note means nothing is saved ---


def invalid_notes(maya, foreign):
    return {
        "a participant of another studio": (
            [note(maya), note(foreign)],
            422,
            "participant_not_found",
        ),
        "a participant that does not exist": (
            [note(maya), note(uuid.uuid4())],
            422,
            "participant_not_found",
        ),
        "a blank note": ([note(maya, "   ")], 422, None),
        "a note that is too long": ([note(maya, "x" * 5001)], 422, None),
        "the same person twice": ([note(maya, "a"), note(maya, "b")], 422, None),
    }


@pytest.mark.parametrize(
    "case",
    [
        "a participant of another studio",
        "a participant that does not exist",
        "a blank note",
        "a note that is too long",
        "the same person twice",
    ],
)
async def test_an_invalid_note_rejects_the_whole_request(client, two_tenants, db_session, case):
    a, b = two_tenants.a, two_tenants.b
    sid = await a_session(db_session, a)
    maya, cody = (
        await participant(db_session, a, "member"),
        await participant(db_session, a, "coach"),
    )
    foreign = await participant(db_session, b, "member")
    await write(
        client, two_tenants, a, "coach", sid, summary="Original.", notes=[note(cody, "kept")]
    )
    notes, status, code = invalid_notes(maya, foreign)[case]

    response = await write(
        client, two_tenants, a, "coach", sid, summary="Replacement.", notes=notes
    )

    assert response.status_code == status
    if code:
        assert response.json() == {"detail": code}
    report = await db_session.scalar(
        select(ClassReport)
        .where(ClassReport.session_id == sid)
        .execution_options(populate_existing=True)
    )
    assert report.summary == "Original."  # the report was not replaced
    assert await stored(db_session, sid) == {cody: "kept"}  # and the notes are as they were


async def test_a_failure_after_the_writes_rolls_everything_back(
    real_client, committed_engine, monkeypatch
):
    """The report and its notes are written inside one transaction that commits at the very end.
    Failing after both were written (building the response) leaves the database as it was."""
    async with AsyncSession(committed_engine) as db:
        tenant_id = await db.scalar(select(Tenant.id).where(Tenant.slug == PILOT_TENANT["slug"]))
        rows = await db.execute(select(User.email, User.id).where(User.email.like("%@example.com")))
        people = {email.split("@")[0]: user_id for email, user_id in rows.all()}
        maya = await db.scalar(
            select(Participant.id).where(Participant.user_id == people["member"])
        )
        ct = ClassType(tenant_id=tenant_id, name="c")
        db.add(ct)
        await db.flush()
        start = datetime.now(UTC) - timedelta(hours=2)
        session_row = ClassSession(
            tenant_id=tenant_id,
            class_type_id=ct.id,
            coach_id=people["coach"],
            starts_at=start,
            ends_at=start + timedelta(hours=1),
        )
        db.add(session_row)
        await db.flush()
        session_id = session_row.id
        await db.commit()
    headers = {
        "Authorization": f"Bearer {create_access_token(people['coach'])}",
        "X-Tenant-Id": str(tenant_id),
    }
    url = f"/sessions/{session_id}/report"
    first = await real_client.put(
        url, json={"summary": "Original.", "notes": [note(maya, "kept")]}, headers=headers
    )
    assert first.status_code == 200

    def explode(*args, **kwargs):
        raise RuntimeError("something went wrong after the writes")

    monkeypatch.setattr(app.reports, "NoteOut", explode)
    failed = await real_client.put(
        url, json={"summary": "Replacement.", "notes": [note(maya, "changed")]}, headers=headers
    )

    assert failed.status_code == 500
    async with AsyncSession(committed_engine) as db:  # a fresh connection sees only committed data
        summary = await db.scalar(
            select(ClassReport.summary).where(ClassReport.session_id == session_id)
        )
        body = await db.scalar(
            select(ParticipantNote.body).where(ParticipantNote.session_id == session_id)
        )
    assert (summary, body) == ("Original.", "kept")


# --- reading a participant's notes ---


async def test_staff_read_all_notes_about_a_participant_newest_first(
    client, two_tenants, db_session
):
    a = two_tenants.a
    first, second = await a_session(db_session, a), await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await write(client, two_tenants, a, "coach", first, summary="x", notes=[note(maya, "older")])
    await write(client, two_tenants, a, "owner", second, summary="x", notes=[note(maya, "newer")])

    by_owner = await read_notes(client, two_tenants, a, "owner", maya)
    by_coach = await read_notes(client, two_tenants, a, "coach", maya)  # not the author of "newer"

    for response in (by_owner, by_coach):
        assert response.status_code == 200
        assert [n["body"] for n in response.json()] == ["newer", "older"]
    newer = by_owner.json()[0]
    assert (newer["session_id"], newer["author_id"]) == (str(second), str(a.users["owner"]))
    assert set(newer) == {
        "id",
        "session_id",
        "author_id",
        "body",
        "shared_with_member",
        "created_at",
    }


async def test_a_participant_without_notes_has_an_empty_list(client, two_tenants, db_session):
    a = two_tenants.a

    response = await read_notes(
        client, two_tenants, a, "coach", await participant(db_session, a, "member")
    )

    assert response.status_code == 200
    assert response.json() == []


async def test_another_studios_participant_is_not_found(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    theirs = await participant(db_session, b, "member")

    foreign = await read_notes(client, two_tenants, a, "owner", theirs)
    nonexistent = await read_notes(client, two_tenants, a, "owner", uuid.uuid4())

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.text == nonexistent.text  # ids cannot be probed
    assert foreign.json() == {"detail": "participant_not_found"}


async def test_one_person_in_two_studios_has_separate_notes(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    user_id = a.users["member"]
    db_session.add(Membership(tenant_id=b.id, user_id=user_id, role="member"))
    db_session.add(Participant(tenant_id=b.id, user_id=user_id, name="Same person"))
    await db_session.flush()
    in_a, in_b = (
        await participant(db_session, a, "member"),
        await db_session.scalar(
            select(Participant.id).where(
                Participant.tenant_id == b.id, Participant.user_id == user_id
            )
        ),
    )
    sid_a, sid_b = await a_session(db_session, a), await a_session(db_session, b)
    await write(
        client, two_tenants, a, "coach", sid_a, summary="x", notes=[note(in_a, "studio A's view")]
    )
    await write(
        client, two_tenants, b, "coach", sid_b, summary="x", notes=[note(in_b, "studio B's view")]
    )

    seen_in_a = await read_notes(client, two_tenants, a, "owner", in_a)
    # Studio B's participant id, asked through studio A's header: not found, not leaked.
    crossed = await read_notes(client, two_tenants, a, "owner", in_b)

    assert [n["body"] for n in seen_in_a.json()] == ["studio A's view"]
    assert crossed.status_code == 404


# --- the database's own rules ---


@pytest.mark.parametrize(
    ("link", "constraint"),
    [
        ("participant", "fk_participant_notes_participant_same_tenant"),
        ("session", "fk_participant_notes_session_same_tenant"),
    ],
)
async def test_a_note_cannot_name_another_studios_participant_or_session(
    db_session, two_tenants, link, constraint
):
    a, b = two_tenants.a, two_tenants.b
    mine, sid_a = await participant(db_session, a, "member"), await a_session(db_session, a)
    theirs, sid_b = await participant(db_session, b, "member"), await a_session(db_session, b)
    participant_id, session_id = (theirs, sid_a) if link == "participant" else (mine, sid_b)

    db_session.add(a_note_row(a, participant_id, session_id))

    with pytest.raises(IntegrityError) as refused:
        await db_session.flush()
    assert constraint in str(refused.value)


def a_note_row(studio, participant_id, session_id) -> ParticipantNote:
    return ParticipantNote(
        tenant_id=studio.id,
        participant_id=participant_id,
        session_id=session_id,
        author_id=studio.users["coach"],
        body="x",
    )


async def test_notes_outside_a_class_may_repeat(db_session, two_tenants):
    a = two_tenants.a
    mine = await participant(db_session, a, "member")

    db_session.add_all([a_note_row(a, mine, None), a_note_row(a, mine, None)])

    await db_session.flush()  # no session: no one-per-session limit, and no session link to check


async def test_one_note_per_person_per_session(db_session, two_tenants):
    a = two_tenants.a
    sid, mine = await a_session(db_session, a), await participant(db_session, a, "member")
    db_session.add(a_note_row(a, mine, sid))
    await db_session.flush()

    db_session.add(a_note_row(a, mine, sid))  # a second note for the same person and session

    with pytest.raises(IntegrityError) as refused:
        await db_session.flush()
    assert "uq_participant_notes_session_participant" in str(refused.value)


# --- notes a coach shared with the member they are about ---


async def as_member(client, two_tenants, studio, participant_id, role="member"):
    return await read_notes(client, two_tenants, studio, role, participant_id)


async def test_a_note_is_staff_only_unless_it_is_shared(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")

    response = await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya)])

    assert response.json()["notes"][0]["shared_with_member"] is False
    row = await db_session.scalar(select(ParticipantNote).execution_options(populate_existing=True))
    assert row.shared_with_member is False


async def test_a_member_sees_only_the_notes_shared_with_them(client, two_tenants, db_session):
    a = two_tenants.a
    first, second, third = [await a_session(db_session, a) for _ in range(3)]
    maya = await participant(db_session, a, "member")
    await write(
        client, two_tenants, a, "coach", first, summary="x", notes=[note(maya, "private A", False)]
    )
    await write(
        client, two_tenants, a, "coach", second, summary="x", notes=[note(maya, "for Maya", True)]
    )
    await write(
        client, two_tenants, a, "coach", third, summary="x", notes=[note(maya, "private B")]
    )

    response = await as_member(client, two_tenants, a, maya)

    assert response.status_code == 200
    assert [n["body"] for n in response.json()] == [
        "for Maya"
    ]  # no private note, whatever the order
    assert "private" not in response.text


async def test_a_member_never_sees_the_author_or_the_flag(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya, "hi", True)])

    response = await as_member(client, two_tenants, a, maya)

    assert set(response.json()[0]) == {"id", "session_id", "body", "created_at"}
    assert str(a.users["coach"]) not in response.text


async def test_a_member_with_nothing_shared_gets_an_empty_list(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")

    no_notes_at_all = await as_member(client, two_tenants, a, maya)
    await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya, "secret")])
    private_only = await as_member(client, two_tenants, a, maya)

    # Both are 200 [], so a member cannot tell "no notes" from "notes that were not shared".
    assert (no_notes_at_all.status_code, no_notes_at_all.json()) == (200, [])
    assert (private_only.status_code, private_only.json()) == (200, [])
    assert private_only.text == no_notes_at_all.text


async def test_a_member_never_sees_notes_about_another_member(client, two_tenants, db_session):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    cody = await participant(db_session, a, "coach")
    olive = await participant(db_session, a, "owner")
    await write(
        client,
        two_tenants,
        a,
        "owner",
        sid,
        summary="x",
        notes=[
            note(cody, "shared with Cody", True),
            note(olive, "about Olive", True),
            note(maya, "mine", True),
        ],
    )

    about_cody = await as_member(client, two_tenants, a, cody)
    about_olive = await as_member(client, two_tenants, a, olive)
    nonexistent = await as_member(client, two_tenants, a, uuid.uuid4())
    mine = await as_member(client, two_tenants, a, maya)

    for response in (about_cody, about_olive):
        assert response.status_code == 404  # even though those notes ARE shared (with someone else)
        assert response.json() == {"detail": "participant_not_found"}
        assert response.text == nonexistent.text  # indistinguishable from "no such participant"
    assert [n["body"] for n in mine.json()] == ["mine"]


async def test_unsharing_hides_a_note_at_once_and_sharing_shows_it_again(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")

    async def member_sees():
        return [n["body"] for n in (await as_member(client, two_tenants, a, maya)).json()]

    await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya, "n", True)])
    shared = await member_sees()
    await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya, "n", False)])
    unshared = await member_sees()
    await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya, "n", True)])
    reshared = await member_sees()

    assert (shared, unshared, reshared) == (["n"], [], ["n"])


async def test_resending_a_shared_note_without_the_flag_makes_it_private(
    client, two_tenants, db_session
):
    a = two_tenants.a
    sid = await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await write(client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya, "n", True)])

    await write(
        client, two_tenants, a, "coach", sid, summary="x", notes=[note(maya, "n")]
    )  # no flag

    assert (await as_member(client, two_tenants, a, maya)).json() == []  # fails private


async def test_staff_see_every_note_with_its_flag(client, two_tenants, db_session):
    a = two_tenants.a
    first, second = await a_session(db_session, a), await a_session(db_session, a)
    maya = await participant(db_session, a, "member")
    await write(
        client, two_tenants, a, "coach", first, summary="x", notes=[note(maya, "private", False)]
    )
    await write(
        client, two_tenants, a, "coach", second, summary="x", notes=[note(maya, "shared", True)]
    )

    for role in ("owner", "coach"):
        response = await read_notes(client, two_tenants, a, role, maya)
        assert [(n["body"], n["shared_with_member"]) for n in response.json()] == [
            ("shared", True),
            ("private", False),
        ]


async def test_a_note_shared_in_one_studio_is_invisible_in_another(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    user_id = a.users["member"]  # one person, a member of both studios
    db_session.add(Membership(tenant_id=b.id, user_id=user_id, role="member"))
    db_session.add(Participant(tenant_id=b.id, user_id=user_id, name="Same person"))
    await db_session.flush()
    in_a = await participant(db_session, a, "member")
    in_b = await db_session.scalar(
        select(Participant.id).where(Participant.tenant_id == b.id, Participant.user_id == user_id)
    )
    sid_a, sid_b = await a_session(db_session, a), await a_session(db_session, b)
    await write(
        client, two_tenants, a, "coach", sid_a, summary="x", notes=[note(in_a, "A's note", True)]
    )
    await write(
        client, two_tenants, b, "coach", sid_b, summary="x", notes=[note(in_b, "B's note", False)]
    )

    seen_in_b = await client.get(
        f"/participants/{in_b}/notes", headers=two_tenants.headers(user_id, b.id)
    )
    crossed = await client.get(  # A's participant id through B's header
        f"/participants/{in_a}/notes", headers=two_tenants.headers(user_id, b.id)
    )

    assert seen_in_b.json() == []  # A's shared note does not leak, B's note is private
    assert crossed.status_code == 404


async def test_the_database_defaults_to_private_and_refuses_nothing_in_between(
    db_session, two_tenants
):
    a = two_tenants.a
    sid, maya = await a_session(db_session, a), await participant(db_session, a, "member")
    db_session.add(
        ParticipantNote(
            tenant_id=a.id,
            participant_id=maya,
            session_id=sid,
            author_id=a.users["coach"],
            body="x",
        )
    )
    await db_session.flush()

    flag = await db_session.scalar(select(ParticipantNote.shared_with_member))
    with pytest.raises(IntegrityError):
        await db_session.execute(text("UPDATE participant_notes SET shared_with_member = NULL"))

    assert flag is False


def test_an_unknown_role_gets_the_member_view_not_the_staff_one():
    from app.deps import TenantContext, is_staff

    # head_coach (step 48) must be added to ROLE_RANK before it can see staff-only notes.
    unknown = TenantContext(user=None, tenant_id=uuid.uuid4(), role="head_coach")
    coach = TenantContext(user=None, tenant_id=uuid.uuid4(), role="coach")

    assert is_staff(unknown) is False
    assert is_staff(coach) is True
