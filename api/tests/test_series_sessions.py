import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from app.models import ClassSession
from tests.test_series_end import rsvp_row, started
from tests.test_series_generation import create as create_now
from tests.test_series_generation import sessions_of


async def read(client, two_tenants, studio, role, series_id):
    return await client.get(
        f"/series/{series_id}/sessions", headers=two_tenants.headers(studio.users[role], studio.id)
    )


async def test_the_coming_classes_come_earliest_first_with_their_going_counts(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id, _, future = await started(client, two_tenants, db_session, capacity=20)
    await rsvp_row(db_session, a, future[0], "Gail")
    await rsvp_row(db_session, a, future[0], "Hal")
    await rsvp_row(db_session, a, future[2], "Ivy")

    response = await read(client, two_tenants, a, "owner", series_id)

    assert response.status_code == 200
    rows = response.json()
    assert [r["id"] for r in rows] == [str(i) for i in future]  # the past one is not "coming up"
    assert [r["going"] for r in rows] == [2, 0, 1]
    assert {r["capacity"] for r in rows} == {20}
    assert {r["status"] for r in rows} == {"scheduled"}


async def test_only_going_counts_and_a_cancelled_class_stays_in_the_list(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id, _, future = await started(client, two_tenants, db_session)
    await rsvp_row(db_session, a, future[0], "Gail", status="maybe")
    await rsvp_row(db_session, a, future[0], "Hal", status="going")
    await db_session.execute(
        update(ClassSession).where(ClassSession.id == future[1]).values(status="cancelled")
    )

    rows = (await read(client, two_tenants, a, "owner", series_id)).json()

    assert rows[0]["going"] == 1  # the "maybe" is not going
    assert [r["status"] for r in rows] == ["scheduled", "cancelled", "scheduled"]


async def test_a_class_edited_by_hand_says_so(client, two_tenants, db_session):
    series_id, _, future = await started(client, two_tenants, db_session)
    await client.patch(
        f"/sessions/{future[1]}",
        json={"capacity": 5},
        headers=two_tenants.headers(two_tenants.a.users["owner"], two_tenants.a.id),
    )

    rows = (await read(client, two_tenants, two_tenants.a, "owner", series_id)).json()

    assert [r["changed_by_hand"] for r in rows] == [False, True, False]


async def test_a_class_that_has_started_is_not_coming_up(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create_now(client, two_tenants, db_session)
    first, *rest = await sessions_of(db_session, series_id)
    earlier = datetime.now(UTC) - timedelta(minutes=5)
    await db_session.execute(
        update(ClassSession)
        .where(ClassSession.id == first.id)
        .values(starts_at=earlier, ends_at=earlier + timedelta(hours=1))
    )

    rows = (await read(client, two_tenants, a, "owner", series_id)).json()

    assert [r["id"] for r in rows] == [str(s.id) for s in rest]


async def test_a_series_without_sessions_gives_an_empty_list(client, two_tenants, db_session):
    a = two_tenants.a
    series_id, _, future = await started(client, two_tenants, db_session)
    for days, session_id in enumerate(
        future, start=1
    ):  # each on its own day: a series cannot repeat a start
        before = datetime.now(UTC) - timedelta(days=days)
        await db_session.execute(
            update(ClassSession)
            .where(ClassSession.id == session_id)
            .values(starts_at=before, ends_at=before + timedelta(hours=1))
        )

    response = await read(client, two_tenants, a, "owner", series_id)

    assert response.status_code == 200
    assert response.json() == []


async def test_a_coach_reads_their_own_series_but_not_anothers(client, two_tenants, db_session):
    a = two_tenants.a
    mine = await create_now(client, two_tenants, db_session, coach_id=str(a.users["coach"]))
    theirs = await create_now(client, two_tenants, db_session)  # taught by the owner

    assert (await read(client, two_tenants, a, "coach", mine)).status_code == 200
    other = await read(client, two_tenants, a, "coach", theirs)
    assert (other.status_code, other.json()["detail"]) == (403, "not_your_series")


async def test_a_member_cannot_read_it(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create_now(client, two_tenants, db_session)

    assert (await read(client, two_tenants, a, "member", series_id)).status_code == 403


async def test_another_studios_series_is_not_found(client, two_tenants, db_session):
    series_id = await create_now(client, two_tenants, db_session)  # in studio A

    response = await read(client, two_tenants, two_tenants.b, "owner", series_id)

    assert (response.status_code, response.json()["detail"]) == (404, "series_not_found")


async def test_an_unknown_series_is_not_found(client, two_tenants):
    response = await read(client, two_tenants, two_tenants.a, "owner", uuid.uuid4())

    assert (response.status_code, response.json()["detail"]) == (404, "series_not_found")
