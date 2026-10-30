import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.models import ClassSeries, ClassSession
from tests.test_series_generation import create as create_series
from tests.test_series_generation import next_weekday, sessions_of
from tests.test_session_delete import record


async def delete(client, two_tenants, studio, role, series_id):
    return await client.delete(
        f"/series/{series_id}", headers=two_tenants.headers(studio.users[role], studio.id)
    )


async def counts(db_session, series_id) -> tuple[int, int]:
    series = await db_session.scalar(
        select(func.count()).select_from(ClassSeries).where(ClassSeries.id == series_id)
    )
    sessions = await db_session.scalar(
        select(func.count()).select_from(ClassSession).where(ClassSession.series_id == series_id)
    )
    return series, sessions


async def test_an_owner_deletes_a_series_and_all_its_sessions(client, two_tenants, db_session):
    series_id = await create_series(client, two_tenants, db_session)
    assert await counts(db_session, series_id) == (1, 4)

    response = await delete(client, two_tenants, two_tenants.a, "owner", series_id)

    assert (response.status_code, response.content) == (204, b"")
    assert await counts(db_session, series_id) == (0, 0)


async def test_a_series_that_has_run_but_left_nothing_behind_can_go(
    client, two_tenants, db_session
):
    series_id = await create_series(
        client, two_tenants, db_session, first_date=next_weekday(1) - timedelta(days=14)
    )

    response = await delete(client, two_tenants, two_tenants.a, "owner", series_id)

    assert response.status_code == 204


@pytest.mark.parametrize("kind", ["rsvp", "attendance", "report", "note"])
async def test_history_on_any_session_keeps_the_whole_series(client, two_tenants, db_session, kind):
    series_id = await create_series(client, two_tenants, db_session)
    last = (await sessions_of(db_session, series_id))[-1].id
    await record(db_session, two_tenants.a, last, kind)

    response = await delete(client, two_tenants, two_tenants.a, "owner", series_id)

    assert (response.status_code, response.json()) == (409, {"detail": "series_has_history"})
    assert await counts(db_session, series_id) == (1, 4)  # nothing deleted, not even the empty ones


async def test_other_series_are_not_touched(client, two_tenants, db_session):
    mine = await create_series(client, two_tenants, db_session)
    other = await create_series(client, two_tenants, db_session)

    await delete(client, two_tenants, two_tenants.a, "owner", mine)

    assert await counts(db_session, other) == (1, 4)


async def test_a_deleted_series_can_no_longer_be_extended_or_read(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create_series(client, two_tenants, db_session)
    await delete(client, two_tenants, a, "owner", series_id)
    headers = two_tenants.headers(a.users["owner"], a.id)

    extended = await client.post(f"/series/{series_id}/extend", headers=headers)
    read = await client.get(f"/series/{series_id}", headers=headers)

    assert (extended.status_code, read.status_code) == (404, 404)


@pytest.mark.parametrize("role", ["coach", "member"])
async def test_only_an_owner_can_delete_a_series(client, two_tenants, db_session, role):
    series_id = await create_series(client, two_tenants, db_session)

    response = await delete(client, two_tenants, two_tenants.a, role, series_id)

    assert (response.status_code, response.json()) == (403, {"detail": "insufficient_role"})
    assert await counts(db_session, series_id) == (1, 4)


async def test_another_studios_or_unknown_series_is_a_404(client, two_tenants, db_session):
    series_id = await create_series(client, two_tenants, db_session)

    for sid in (series_id, uuid.uuid4()):
        response = await delete(client, two_tenants, two_tenants.b, "owner", sid)
        assert (response.status_code, response.json()) == (404, {"detail": "series_not_found"})
    assert await counts(db_session, series_id) == (1, 4)
