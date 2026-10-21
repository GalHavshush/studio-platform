import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import lock_user
from app.models import (
    ClassReport,
    ClassSession,
    ClassType,
    Membership,
    Participant,
    ParticipantNote,
    RefreshToken,
    Rsvp,
    Tenant,
    User,
)
from app.security import hash_password
from app.seed import PILOT_PASSWORD

PASSWORD = "correct horse battery"


async def user_row(db_session, user_id) -> User:
    return await db_session.scalar(
        select(User).where(User.id == user_id).execution_options(populate_existing=True)
    )


async def with_password(db_session, studio, role) -> tuple[uuid.UUID, str]:
    """Give a fixture user a password, so they can log in. Returns (user id, email)."""
    user_id = studio.users[role]
    user = await user_row(db_session, user_id)
    user.password_hash = hash_password(PASSWORD)
    await db_session.flush()
    return user_id, user.email


async def login(client, email, password=PASSWORD):
    response = await client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"], response.json()["refresh_token"]


async def delete_me(client, access_token, password=PASSWORD):
    return await client.request(
        "DELETE",
        "/me",
        json={"password": password},
        headers={"Authorization": f"Bearer {access_token}"},
    )


async def participants_of(db_session, user_id) -> list[uuid.UUID]:
    return list(
        await db_session.scalars(select(Participant.id).where(Participant.user_id == user_id))
    )


async def a_session(
    db_session, studio, starts_in=timedelta(days=-5), mode="rsvp", capacity=None, coach=None
):
    ct = ClassType(tenant_id=studio.id, name=f"class {uuid.uuid4()}", attendance_mode=mode)
    db_session.add(ct)
    await db_session.flush()
    start = datetime.now(UTC) + starts_in
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=ct.id,
        coach_id=coach or studio.users["coach"],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
        capacity=capacity,
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def rsvp(
    db_session,
    studio,
    session_id,
    participant_id,
    status="going",
    attended=None,
    waitlisted_at=None,
):
    db_session.add(
        Rsvp(
            tenant_id=studio.id,
            session_id=session_id,
            participant_id=participant_id,
            status=status,
            attended=attended,
            waitlisted_at=waitlisted_at,
        )
    )
    await db_session.flush()


async def note(db_session, studio, session_id, about, body="a note", author_role="coach"):
    db_session.add(
        ParticipantNote(
            tenant_id=studio.id,
            participant_id=about,
            session_id=session_id,
            author_id=studio.users[author_role],
            body=body,
        )
    )
    await db_session.flush()


# --- confirming ---


async def test_a_wrong_password_deletes_nothing(client, two_tenants, db_session):
    a = two_tenants.a
    user_id, email = await with_password(db_session, a, "member")
    access, _ = await login(client, email)

    response = await delete_me(client, access, password="not my password")

    assert response.status_code == 403
    assert response.json() == {"detail": "invalid_password"}
    user = await user_row(db_session, user_id)
    assert (user.email, user.deleted_at) == (email, None)
    still_works = await client.get("/me", headers={"Authorization": f"Bearer {access}"})
    assert still_works.status_code == 200


async def test_a_missing_password_is_rejected(client, two_tenants, db_session):
    a = two_tenants.a
    _, email = await with_password(db_session, a, "member")
    access, _ = await login(client, email)

    response = await client.request("DELETE", "/me", headers={"Authorization": f"Bearer {access}"})

    assert response.status_code == 422


async def test_an_account_without_a_password_cannot_be_confirmed_yet(client, two_tenants):
    a = two_tenants.a  # fixture users have no password: like a Google or Apple account
    response = await client.request(
        "DELETE",
        "/me",
        json={"password": "anything"},
        headers=two_tenants.headers(a.users["member"], a.id),
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "reauthentication_unavailable"}


async def test_deleting_needs_a_login(client):
    response = await client.request("DELETE", "/me", json={"password": "x"})

    assert response.status_code == 401


# --- what the account becomes ---


async def test_the_account_is_anonymized_in_place(client, two_tenants, db_session):
    a = two_tenants.a
    user_id, email = await with_password(db_session, a, "member")
    access, _ = await login(client, email)

    response = await delete_me(client, access)

    assert response.status_code == 204
    user = await user_row(db_session, user_id)
    assert user.email == f"deleted-{user_id}@deleted.invalid"
    assert (user.name, user.password_hash) == ("Deleted user", None)
    assert user.deleted_at is not None
    assert (
        await db_session.scalar(
            select(func.count()).select_from(Membership).where(Membership.user_id == user_id)
        )
        == 0
    )


async def test_every_login_stops_working_at_once(client, two_tenants, db_session):
    a = two_tenants.a
    user_id, email = await with_password(db_session, a, "member")
    logins = [await login(client, email) for _ in range(3)]  # three devices, three families

    await delete_me(client, logins[0][0])

    for access, refresh in logins:
        me = await client.get("/me", headers={"Authorization": f"Bearer {access}"})
        refreshed = await client.post("/auth/refresh", json={"refresh_token": refresh})
        assert me.status_code == 401 and me.json() == {
            "detail": "invalid_token"
        }  # not in 15 minutes: now
        assert refreshed.status_code == 401
    open_tokens = await db_session.scalar(
        select(func.count())
        .select_from(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
    )
    assert open_tokens == 0


async def test_the_old_and_the_new_address_cannot_log_in(client, two_tenants, db_session):
    a = two_tenants.a
    user_id, email = await with_password(db_session, a, "member")
    access, _ = await login(client, email)
    await delete_me(client, access)

    by_old = await client.post("/auth/login", json={"email": email, "password": PASSWORD})
    by_new = await client.post(
        "/auth/login", json={"email": f"deleted-{user_id}@deleted.invalid", "password": PASSWORD}
    )
    unknown = await client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
    )

    assert by_old.status_code == by_new.status_code == unknown.status_code == 401
    assert by_old.text == by_new.text == unknown.text  # nothing tells them apart


async def test_the_email_can_be_registered_again(client, two_tenants, db_session):
    a = two_tenants.a
    _, email = await with_password(db_session, a, "member")
    access, _ = await login(client, email)
    await delete_me(client, access)

    db_session.add(User(email=email, name="A new person"))

    await db_session.flush()  # no unique violation: the address is free again


async def test_deleting_twice_is_refused_by_the_login_check(client, two_tenants, db_session):
    a = two_tenants.a
    _, email = await with_password(db_session, a, "member")
    access, _ = await login(client, email)
    await delete_me(client, access)

    again = await delete_me(client, access)

    assert again.status_code == 401


# --- what is erased, what is kept ---


async def test_notes_about_the_person_are_erased_and_other_notes_stay(
    client, two_tenants, db_session
):
    a, b = two_tenants.a, two_tenants.b
    user_id, email = await with_password(db_session, a, "member")
    maya = await participants_of(db_session, user_id)
    cody = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == a.users["coach"])
    )
    theirs_b = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == b.users["member"])
    )
    first, second = await a_session(db_session, a), await a_session(db_session, a)
    for sid in (first, second):
        await note(db_session, a, sid, maya[0], "about Maya")
    await note(db_session, a, first, cody, "about Cody")
    await note(db_session, b, await a_session(db_session, b), theirs_b, "in another studio")
    access, _ = await login(client, email)

    await delete_me(client, access)

    bodies = set(await db_session.scalars(select(ParticipantNote.body)))
    assert bodies == {"about Cody", "in another studio"}


async def test_what_they_wrote_as_a_coach_stays_with_an_anonymous_author(
    client, two_tenants, db_session
):
    a = two_tenants.a
    user_id, email = await with_password(db_session, a, "coach")
    cody_taught = await a_session(db_session, a)  # the coach teaches it
    maya = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == a.users["member"])
    )
    await note(db_session, a, cody_taught, maya, "written by the coach")
    db_session.add(
        ClassReport(
            session_id=cody_taught,
            tenant_id=a.id,
            author_id=user_id,
            summary="the coach's report",
            submitted_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    access, _ = await login(client, email)

    await delete_me(client, access)

    note_row = await db_session.scalar(
        select(ParticipantNote).execution_options(populate_existing=True)
    )
    report = await db_session.scalar(select(ClassReport).execution_options(populate_existing=True))
    author = await user_row(db_session, note_row.author_id)
    assert (note_row.body, report.summary) == ("written by the coach", "the coach's report")
    assert author.id == report.author_id == user_id
    assert (author.name, author.email.endswith("@deleted.invalid")) == ("Deleted user", True)
    session_row = await db_session.get(ClassSession, cody_taught)
    assert session_row.coach_id == user_id  # the class they taught is still there


async def test_their_participants_are_renamed_and_everyone_elses_are_not(
    client, two_tenants, db_session
):
    a, b = two_tenants.a, two_tenants.b
    user_id, email = await with_password(db_session, a, "member")
    other_member = await db_session.scalar(
        select(Participant)
        .where(Participant.user_id == b.users["member"])
        .execution_options(populate_existing=True)
    )
    name_before = other_member.name
    access, _ = await login(client, email)

    await delete_me(client, access)

    mine = await db_session.scalars(
        select(Participant)
        .where(Participant.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    assert [p.name for p in mine] == ["Deleted user"]
    await db_session.refresh(other_member)
    assert other_member.name == name_before


async def test_past_history_stays_and_upcoming_bookings_go(client, two_tenants, db_session):
    a = two_tenants.a
    user_id, email = await with_password(db_session, a, "member")
    [maya] = await participants_of(db_session, user_id)
    past = await a_session(db_session, a, starts_in=timedelta(days=-3))
    started = await a_session(db_session, a, starts_in=timedelta(minutes=-10))  # under way
    soon = await a_session(db_session, a, starts_in=timedelta(days=2))
    later = await a_session(db_session, a, starts_in=timedelta(days=9))
    await rsvp(db_session, a, past, maya, attended=True)
    await rsvp(db_session, a, started, maya)
    await rsvp(db_session, a, soon, maya, status="maybe")
    await rsvp(db_session, a, later, maya, status="going")
    access, _ = await login(client, email)

    await delete_me(client, access)

    left = set(await db_session.scalars(select(Rsvp.session_id).where(Rsvp.participant_id == maya)))
    assert left == {past, started}  # the history of classes that happened stays, anonymously


async def test_a_seat_they_held_goes_to_the_next_person_on_the_waitlist(
    client, two_tenants, db_session
):
    a = two_tenants.a
    (await db_session.get(Tenant, a.id)).modules = ["booking"]
    user_id, email = await with_password(db_session, a, "member")
    [maya] = await participants_of(db_session, user_id)
    cody = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == a.users["coach"])
    )
    olive = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == a.users["owner"])
    )
    sid = await a_session(db_session, a, starts_in=timedelta(days=3), mode="booking", capacity=1)
    await rsvp(db_session, a, sid, maya, status="going")  # the only seat
    await rsvp(db_session, a, sid, cody, status="waitlist", waitlisted_at=datetime.now(UTC))
    await rsvp(
        db_session,
        a,
        sid,
        olive,
        status="waitlist",
        waitlisted_at=datetime.now(UTC) + timedelta(seconds=1),
    )
    access, _ = await login(client, email)

    await delete_me(client, access)

    states = dict(
        (
            await db_session.execute(
                select(Rsvp.participant_id, Rsvp.status)
                .where(Rsvp.session_id == sid)
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    assert states == {cody: "going", olive: "waitlist"}  # the earliest in line got the seat


async def test_leaving_the_waitlist_does_not_promote_anyone(client, two_tenants, db_session):
    a = two_tenants.a
    (await db_session.get(Tenant, a.id)).modules = ["booking"]
    user_id, email = await with_password(db_session, a, "member")
    [maya] = await participants_of(db_session, user_id)
    cody = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == a.users["coach"])
    )
    olive = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == a.users["owner"])
    )
    sid = await a_session(db_session, a, starts_in=timedelta(days=3), mode="booking", capacity=1)
    await rsvp(db_session, a, sid, cody, status="going")
    await rsvp(db_session, a, sid, maya, status="waitlist", waitlisted_at=datetime.now(UTC))
    await rsvp(
        db_session,
        a,
        sid,
        olive,
        status="waitlist",
        waitlisted_at=datetime.now(UTC) + timedelta(seconds=1),
    )
    access, _ = await login(client, email)

    await delete_me(client, access)

    states = dict(
        (
            await db_session.execute(
                select(Rsvp.participant_id, Rsvp.status)
                .where(Rsvp.session_id == sid)
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    assert states == {cody: "going", olive: "waitlist"}  # the seat is still taken


async def test_nothing_in_another_studio_changes(client, two_tenants, db_session):
    a, b = two_tenants.a, two_tenants.b
    _, email = await with_password(db_session, a, "member")
    theirs = await participants_of(db_session, b.users["member"])
    await note(db_session, b, await a_session(db_session, b), theirs[0], "B's note")

    async def snapshot():
        rows = {}
        for model in (Membership, Participant, ParticipantNote, Rsvp, ClassSession):
            rows[model.__tablename__] = await db_session.scalar(
                select(func.count()).select_from(model).where(model.tenant_id == b.id)
            )
        rows["names"] = sorted(
            (
                await db_session.scalars(
                    select(Participant.name).where(Participant.tenant_id == b.id)
                )
            ).all()
        )
        return rows

    before = await snapshot()
    access, _ = await login(client, email)

    await delete_me(client, access)

    assert await snapshot() == before


# --- the last owner ---


async def test_the_only_owner_of_a_studio_with_members_must_hand_over_first(
    client, two_tenants, db_session
):
    a = two_tenants.a
    user_id, email = await with_password(db_session, a, "owner")
    access, refresh = await login(client, email)

    response = await delete_me(client, access)

    assert response.status_code == 409
    assert response.json() == {"detail": "transfer_ownership_first"}
    user = await user_row(db_session, user_id)
    assert (user.email, user.deleted_at) == (email, None)  # nothing happened at all
    assert (
        await client.get("/me", headers={"Authorization": f"Bearer {access}"})
    ).status_code == 200
    assert (await client.post("/auth/refresh", json={"refresh_token": refresh})).status_code == 200


async def test_an_owner_can_delete_when_another_owner_remains(client, two_tenants, db_session):
    a = two_tenants.a
    _, email = await with_password(db_session, a, "owner")
    await db_session.execute(
        update(Membership)
        .where(Membership.tenant_id == a.id, Membership.user_id == a.users["coach"])
        .values(role="owner")
    )
    access, _ = await login(client, email)

    response = await delete_me(client, access)

    assert response.status_code == 204


async def test_an_owner_alone_in_a_studio_can_delete(client, two_tenants, db_session):
    a = two_tenants.a
    _, email = await with_password(db_session, a, "owner")
    await db_session.execute(
        Membership.__table__.delete().where(
            Membership.tenant_id == a.id, Membership.user_id != a.users["owner"]
        )
    )
    access, _ = await login(client, email)

    response = await delete_me(client, access)

    assert response.status_code == 204


async def test_an_owner_of_another_studio_does_not_block_a_member_elsewhere(
    client, two_tenants, db_session
):
    a, b = two_tenants.a, two_tenants.b
    user_id, email = await with_password(db_session, a, "member")
    db_session.add(Membership(tenant_id=b.id, user_id=user_id, role="member"))  # a member of both
    await db_session.flush()
    access, _ = await login(client, email)

    response = await delete_me(client, access)

    assert response.status_code == 204


# --- a refresh in flight cannot outlive the deletion ---


async def test_a_refresh_racing_the_deletion_leaves_no_usable_token(
    real_client, committed_engine, wait_for_lock_wait
):
    async with AsyncSession(committed_engine) as db:
        user_id = await db.scalar(select(User.id).where(User.email == "member@example.com"))
    login_response = await real_client.post(
        "/auth/login", json={"email": "member@example.com", "password": PILOT_PASSWORD}
    )
    access, refresh = login_response.json()["access_token"], login_response.json()["refresh_token"]

    async with AsyncSession(committed_engine) as holder:
        await lock_user(holder, user_id)  # both requests queue up behind this lock
        refreshing = asyncio.create_task(
            real_client.post("/auth/refresh", json={"refresh_token": refresh})
        )
        deleting = asyncio.create_task(delete_me(real_client, access, PILOT_PASSWORD))
        await wait_for_lock_wait(committed_engine)
        await asyncio.sleep(0.5)  # far longer than a deletion takes when nothing blocks it
        assert not deleting.done(), "the deletion did not wait for the user lock"
        assert not refreshing.done(), "the refresh did not wait for the user lock"
    refreshed, deleted = await asyncio.wait_for(asyncio.gather(refreshing, deleting), timeout=15)

    assert deleted.status_code == 204
    assert refreshed.status_code in (200, 401)  # it depends who the lock went to first...
    async with AsyncSession(committed_engine) as db:  # ...but either way nothing survives
        usable = await db.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        )
        deleted_at = await db.scalar(select(User.deleted_at).where(User.id == user_id))
    assert usable == 0
    assert deleted_at is not None
