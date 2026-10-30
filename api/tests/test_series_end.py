from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.models import ClassReport, ClassSession, Participant, Rsvp
from tests.test_series_generation import create as create_now
from tests.test_series_generation import next_weekday, sessions_of


async def started(client, two_tenants, db_session, **overrides):
    """A Tuesday series that began two weeks ago, with its first of four sessions moved into the
    past, so it has a past session (with history) and three still to come, a week or more away."""
    series_id = await create_now(
        client,
        two_tenants,
        db_session,
        first_date=next_weekday(1) - timedelta(days=14),
        **overrides,
    )
    past, *future = [s.id for s in await sessions_of(db_session, series_id)]
    before = datetime.now(UTC) - timedelta(days=2)
    await db_session.execute(
        update(ClassSession)
        .where(ClassSession.id == past)
        .values(starts_at=before, ends_at=before + timedelta(hours=1))
    )
    db_session.expire_all()
    return series_id, past, future


async def end(client, two_tenants, studio, role, series_id):
    return await client.post(
        f"/series/{series_id}/end", headers=two_tenants.headers(studio.users[role], studio.id)
    )


async def rsvp_row(db_session, studio, session_id, name="Gail"):
    person = Participant(tenant_id=studio.id, name=name)
    db_session.add(person)
    await db_session.flush()
    db_session.add(
        Rsvp(session_id=session_id, participant_id=person.id, tenant_id=studio.id, status="going")
    )
    await db_session.flush()


async def ids_of(db_session, series_id):
    return {s.id: s for s in await sessions_of(db_session, series_id)}


async def test_ending_deletes_the_empty_future_and_keeps_the_past(client, two_tenants, db_session):
    a = two_tenants.a
    series_id, past_id, _ = await started(client, two_tenants, db_session)
    await rsvp_row(db_session, a, past_id)  # history

    response = await end(client, two_tenants, a, "owner", series_id)

    assert response.status_code == 200
    out = response.json()
    assert (out["sessions_deleted"], out["sessions_cancelled"]) == (3, 0)
    assert out["last_date"] == datetime.now(UTC).date().isoformat()  # the test studio is UTC
    db_session.expire_all()
    left = await ids_of(db_session, series_id)
    assert list(left) == [past_id]
    assert left[past_id].status == "scheduled"
    assert await db_session.scalar(select(Rsvp.session_id).where(Rsvp.session_id == past_id))


async def test_a_future_session_with_an_rsvp_is_cancelled_not_deleted(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id, _, future = await started(client, two_tenants, db_session)
    await rsvp_row(db_session, a, future[1])

    out = (await end(client, two_tenants, a, "owner", series_id)).json()

    assert (out["sessions_deleted"], out["sessions_cancelled"]) == (2, 1)
    db_session.expire_all()
    left = await ids_of(db_session, series_id)
    assert future[1] in left and left[future[1]].status == "cancelled"
    assert await db_session.scalar(select(Rsvp.session_id).where(Rsvp.session_id == future[1]))


async def test_past_history_survives_including_a_report(client, two_tenants, db_session):
    a = two_tenants.a
    series_id, past_id, _ = await started(client, two_tenants, db_session)
    db_session.add(
        ClassReport(
            session_id=past_id,
            tenant_id=a.id,
            author_id=a.users["coach"],
            summary="Good class",
            submitted_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    await end(client, two_tenants, a, "owner", series_id)

    db_session.expire_all()
    assert await db_session.get(ClassReport, past_id) is not None


async def test_todays_class_stays(client, two_tenants, db_session):
    a = two_tenants.a
    series_id, _, future = await started(client, two_tenants, db_session)
    # Late tonight, so it is still ahead of the clock whenever the test runs: the rule is about the
    # date, not about being in the future.
    noon = datetime.now(UTC).replace(hour=23, minute=58, second=0, microsecond=0)
    await db_session.execute(
        update(ClassSession)
        .where(ClassSession.id == future[0])
        .values(starts_at=noon, ends_at=noon + timedelta(hours=1))
    )
    db_session.expire_all()

    out = (await end(client, two_tenants, a, "owner", series_id)).json()

    assert out["sessions_deleted"] == 2
    db_session.expire_all()
    assert future[0] in await ids_of(db_session, series_id)


async def test_an_already_cancelled_future_session_is_left_as_it_is(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id, _, future = await started(client, two_tenants, db_session)
    await db_session.execute(
        update(ClassSession).where(ClassSession.id == future[0]).values(status="cancelled")
    )
    db_session.expire_all()

    out = (await end(client, two_tenants, a, "owner", series_id)).json()

    assert out["sessions_deleted"] == 2
    db_session.expire_all()
    left = await ids_of(db_session, series_id)
    assert future[0] in left and left[future[0]].status == "cancelled"


async def test_a_hand_edited_future_session_goes_too(client, two_tenants, db_session):
    a = two_tenants.a
    series_id, _, future = await started(client, two_tenants, db_session)
    await db_session.execute(
        update(ClassSession).where(ClassSession.id == future[2]).values(is_overridden=True)
    )
    db_session.expire_all()

    out = (await end(client, two_tenants, a, "owner", series_id)).json()

    assert out["sessions_deleted"] == 3


async def test_repeating_it_changes_nothing(client, two_tenants, db_session):
    a = two_tenants.a
    series_id, _, _ = await started(client, two_tenants, db_session)
    await end(client, two_tenants, a, "owner", series_id)

    again = await end(client, two_tenants, a, "owner", series_id)

    assert again.status_code == 200
    assert (again.json()["sessions_deleted"], again.json()["sessions_cancelled"]) == (0, 0)


async def test_nothing_more_is_generated_after_ending(client, two_tenants, db_session):
    a = two_tenants.a
    series_id, _, _ = await started(client, two_tenants, db_session)
    await end(client, two_tenants, a, "owner", series_id)

    extended = await client.post(
        f"/series/{series_id}/extend", headers=two_tenants.headers(a.users["owner"], a.id)
    )

    assert extended.json() == {"created": 0}


async def test_an_earlier_last_date_is_never_pushed_later(client, two_tenants, db_session):
    a = two_tenants.a
    first = next_weekday(1) - timedelta(days=21)
    series_id = await create_now(
        client,
        two_tenants,
        db_session,
        first_date=first,
        last_date=(first + timedelta(days=7)).isoformat(),
    )

    out = (await end(client, two_tenants, a, "owner", series_id)).json()

    assert out["last_date"] == (first + timedelta(days=7)).isoformat()


async def test_a_series_that_has_not_started_cannot_be_ended(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create_now(
        client, two_tenants, db_session, first_date=next_weekday(1) + timedelta(days=7)
    )

    response = await end(client, two_tenants, a, "owner", series_id)

    assert (response.status_code, response.json()) == (409, {"detail": "series_not_started"})
    assert len(await sessions_of(db_session, series_id)) == 4


@pytest.mark.parametrize("role", ["coach", "member"])
async def test_only_an_owner_can_end_a_series(client, two_tenants, db_session, role):
    series_id, _, _ = await started(client, two_tenants, db_session)

    response = await end(client, two_tenants, two_tenants.a, role, series_id)

    assert (response.status_code, response.json()) == (403, {"detail": "insufficient_role"})


async def test_another_studios_series_cannot_be_ended(client, two_tenants, db_session):
    series_id, _, _ = await started(client, two_tenants, db_session)

    response = await end(client, two_tenants, two_tenants.b, "owner", series_id)

    assert (response.status_code, response.json()) == (404, {"detail": "series_not_found"})
