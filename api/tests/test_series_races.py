"""Series changes against requests that are in flight at the same moment, with real commits."""

import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClassSeries, ClassSession, ClassType, Participant, Rsvp, Tenant
from app.seed import PILOT_TENANT
from tests.test_booking_race import auth, booking_session


async def running_series(engine, real_client):
    """A weekly series in the committed pilot studio that started two weeks ago, so it has four
    sessions to come. Returns (series_id, session_ids, tenant_id, people)."""
    _, tenant_id, people = await booking_session(engine, capacity=1)  # only for the people
    async with AsyncSession(engine) as db:
        tenant = await db.scalar(select(Tenant).where(Tenant.slug == PILOT_TENANT["slug"]))
        tz = ZoneInfo(tenant.timezone)
        class_type = ClassType(tenant_id=tenant_id, name="Series class")
        db.add(class_type)
        await db.flush()
        class_type_id = str(class_type.id)
        await db.commit()
    today = datetime.now(tz).date()
    first = today + timedelta(days=(1 - today.weekday()) % 7) - timedelta(days=14)
    response = await real_client.post(
        "/series",
        json={
            "class_type_id": class_type_id,
            "weekday": 1,
            "start_time": "18:00",
            "duration_minutes": 60,
            "capacity": 8,
            "first_date": first.isoformat(),
        },
        headers=auth(tenant_id, people["owner"]),
    )
    assert response.status_code == 201
    series_id = response.json()["id"]
    async with AsyncSession(engine) as db:
        ids = list(
            await db.scalars(
                select(ClassSession.id)
                .where(ClassSession.series_id == series_id)
                .order_by(ClassSession.starts_at)
            )
        )
    return series_id, ids, tenant_id, people


async def test_extend_waits_for_whoever_holds_the_series_row(
    real_client, committed_engine, wait_for_lock_wait
):
    """An edit holds the series row while it rewrites the sessions; an `extend` that did not wait
    for it could add sessions with the old capacity right after."""
    series_id, _, tenant_id, people = await running_series(committed_engine, real_client)

    async with AsyncSession(committed_engine) as holder:
        await holder.execute(
            select(ClassSeries.id).where(ClassSeries.id == series_id).with_for_update()
        )
        request = asyncio.create_task(
            real_client.post(
                f"/series/{series_id}/extend", headers=auth(tenant_id, people["owner"])
            )
        )
        await wait_for_lock_wait(committed_engine, timeout=3)
        assert not request.done()

    assert (await asyncio.wait_for(request, timeout=10)).status_code == 200


async def test_editing_waits_for_whoever_holds_the_series_row(
    real_client, committed_engine, wait_for_lock_wait
):
    series_id, _, tenant_id, people = await running_series(committed_engine, real_client)

    async with AsyncSession(committed_engine) as holder:
        await holder.execute(
            select(ClassSeries.id).where(ClassSeries.id == series_id).with_for_update()
        )
        request = asyncio.create_task(
            real_client.patch(
                f"/series/{series_id}",
                json={"capacity": 3},
                headers=auth(tenant_id, people["owner"]),
            )
        )
        await wait_for_lock_wait(committed_engine, timeout=3)
        assert not request.done()

    assert (await asyncio.wait_for(request, timeout=10)).status_code == 200


async def test_an_edit_and_an_extend_at_once_leave_no_session_with_the_old_capacity(
    real_client, committed_engine
):
    series_id, ids, tenant_id, people = await running_series(committed_engine, real_client)
    async with AsyncSession(committed_engine) as db:  # make `extend` have something to create
        await db.delete(await db.get(ClassSession, ids[-1]))
        await db.commit()
    owner = auth(tenant_id, people["owner"])

    edit, extend = await asyncio.gather(
        real_client.patch(f"/series/{series_id}", json={"capacity": 3}, headers=owner),
        real_client.post(f"/series/{series_id}/extend", headers=owner),
    )

    assert (edit.status_code, extend.status_code) == (200, 200)
    async with AsyncSession(committed_engine) as db:
        capacity = set(
            await db.scalars(
                select(ClassSession.capacity).where(ClassSession.series_id == series_id)
            )
        )
    assert capacity == {3}


async def test_ending_a_series_waits_for_a_booking_in_flight_and_then_keeps_it(
    real_client, committed_engine, wait_for_lock_wait
):
    """A booking holds the session's row lock while it writes its RSVP. Ending the series must wait
    for it, see the RSVP once it commits, and cancel that session instead of deleting it."""
    series_id, ids, tenant_id, people = await running_series(committed_engine, real_client)
    booked = ids[1]

    async with AsyncSession(committed_engine) as booking:
        await booking.execute(  # the lock every booking takes first
            select(ClassSession.id).where(ClassSession.id == booked).with_for_update(key_share=True)
        )
        participant = await booking.scalar(
            select(Participant.id).where(Participant.user_id == people["member"])
        )
        booking.add(
            Rsvp(session_id=booked, participant_id=participant, tenant_id=tenant_id, status="going")
        )
        await booking.flush()  # written, not committed
        request = asyncio.create_task(
            real_client.post(f"/series/{series_id}/end", headers=auth(tenant_id, people["owner"]))
        )
        await wait_for_lock_wait(committed_engine, timeout=5)
        assert not request.done()
        await booking.commit()

    response = await asyncio.wait_for(request, timeout=10)
    assert response.status_code == 200
    assert (response.json()["sessions_deleted"], response.json()["sessions_cancelled"]) == (3, 1)
    async with AsyncSession(committed_engine) as db:
        left = (
            await db.execute(
                select(ClassSession.id, ClassSession.status).where(
                    ClassSession.series_id == series_id
                )
            )
        ).all()
        rsvps = list(await db.scalars(select(Rsvp.session_id).where(Rsvp.session_id == booked)))
    assert left == [(booked, "cancelled")]
    assert rsvps == [booked]
