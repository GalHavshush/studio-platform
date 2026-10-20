import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.bookings
from app.models import ClassSession, ClassType, Membership, Participant, Rsvp, Tenant, User
from app.security import create_access_token
from app.seed import PILOT_TENANT


async def booking_session(
    engine, capacity: int, extra_members: int = 0, starts_in: timedelta = timedelta(days=1)
):
    """A booking session in the committed pilot studio. Returns (session_id, tenant_id, people),
    where people maps "owner", "coach", "member" and "extra0".. to user ids."""
    async with AsyncSession(engine) as db:
        tenant_id = await db.scalar(select(Tenant.id).where(Tenant.slug == PILOT_TENANT["slug"]))
        rows = await db.execute(select(User.email, User.id).where(User.email.like("%@example.com")))
        people = {email.split("@")[0]: user_id for email, user_id in rows.all()}
        for i in range(extra_members):
            user = User(email=f"extra{i}@race.test", name=f"Extra {i}")
            db.add(user)
            await db.flush()
            db.add_all(
                [
                    Membership(tenant_id=tenant_id, user_id=user.id, role="member"),
                    Participant(tenant_id=tenant_id, user_id=user.id, name=user.name),
                ]
            )
            people[f"extra{i}"] = user.id
        class_type = ClassType(tenant_id=tenant_id, name="Booked class", attendance_mode="booking")
        db.add(class_type)
        await db.flush()
        start = datetime.now(UTC) + starts_in
        row = ClassSession(
            tenant_id=tenant_id,
            class_type_id=class_type.id,
            coach_id=people["coach"],
            starts_at=start,
            ends_at=start + timedelta(hours=1),
            capacity=capacity,
        )
        db.add(row)
        await db.flush()
        session_id = row.id  # read before the commit expires it
        await db.commit()
    return session_id, tenant_id, people


def auth(tenant_id, user_id) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_access_token(user_id)}",
        "X-Tenant-Id": str(tenant_id),
    }


def rsvp(client, tenant_id, user_id, session_id, status):
    return client.put(
        f"/sessions/{session_id}/rsvp", json={"status": status}, headers=auth(tenant_id, user_id)
    )


def hold_every_count_until_two_have_counted(monkeypatch) -> list[int]:
    """Make two simultaneous requests interleave the same way every run: each is held right after
    it counts the `going` rows, until both have counted. Returns the counts they saw.

    The rendezvous gives up after a second, so a fix that makes the second request wait for the
    first (a lock) lets the test finish instead of deadlocking: the first times out, writes and
    commits, and the second then counts the up-to-date number.
    """
    barrier = asyncio.Barrier(2)
    observed: list[int] = []
    real_count = app.bookings._count_going

    async def count_then_wait_for_the_other(session, sid):
        seen = await real_count(session, sid)
        observed.append(seen)
        try:
            await asyncio.wait_for(barrier.wait(), timeout=1)
        except (TimeoutError, asyncio.BrokenBarrierError):
            pass  # the other request is blocked (a fix is in place): carry on without it
        return seen

    monkeypatch.setattr(app.bookings, "_count_going", count_then_wait_for_the_other)
    return observed


async def count_status(engine, session_id, status) -> int:
    async with AsyncSession(engine) as db:
        return await db.scalar(
            select(func.count())
            .select_from(Rsvp)
            .where(Rsvp.session_id == session_id, Rsvp.status == status)
        )


async def test_two_simultaneous_bookings_never_overbook(real_client, committed_engine, monkeypatch):
    """A booking session with ONE seat, and two people ask for it at the same moment.

    Step 26 committed this as a strict xfail; the row lock added in step 27 makes it pass.

    What happens without a lock, step by step (READ COMMITTED, Postgres's default: a statement
    only sees data that was already committed when it started):

        request A: count going rows  -> 0   (a seat is free)
        request B: count going rows  -> 0   (A has not written yet, and B could not see it anyway)
        request A: insert 'going'; commit
        request B: insert 'going'; commit    <- both passed the check, so the seat is booked twice

    Each request is correct on its own. The bug is the gap between the check and the write, which
    no application-level `if` can close: whatever B checked is stale by the time B writes. The
    check and the write have to be made one atomic step (the fix: lock the session row first).
    """
    session_id, tenant_id, people = await booking_session(committed_engine, capacity=1)
    observed = hold_every_count_until_two_have_counted(monkeypatch)

    await asyncio.wait_for(
        asyncio.gather(
            rsvp(real_client, tenant_id, people["coach"], session_id, "going"),
            rsvp(real_client, tenant_id, people["member"], session_id, "going"),
        ),
        timeout=15,
    )

    going = await count_status(committed_engine, session_id, "going")
    assert going <= 1, (
        f"{going} people booked 1 seat: the two requests counted {observed} before either wrote"
    )


async def test_two_simultaneous_seat_releases_refill_both_seats(
    real_client, committed_engine, monkeypatch
):
    """Two seats, both held, two people waiting. Both holders give up at the same moment.

    The mirror image of overbooking: without a lock both releasing requests count one seat free,
    and both promote "the earliest waiting person", the same one. The second person waiting is
    never promoted, so a seat stays empty although someone is waiting for it. Serialized, the
    first release promotes the first in line and the second release promotes the next.
    """
    session_id, tenant_id, people = await booking_session(
        committed_engine, capacity=2, extra_members=1
    )
    for who in ("coach", "member"):  # take both seats
        await rsvp(real_client, tenant_id, people[who], session_id, "going")
    for who in ("owner", "extra0"):  # and queue up, in this order
        waiting = await rsvp(real_client, tenant_id, people[who], session_id, "going")
        assert waiting.json()["status"] == "waitlist"
    observed = hold_every_count_until_two_have_counted(monkeypatch)

    await asyncio.wait_for(
        asyncio.gather(
            rsvp(real_client, tenant_id, people["coach"], session_id, "not_going"),
            rsvp(real_client, tenant_id, people["member"], session_id, "not_going"),
        ),
        timeout=15,
    )

    going = await count_status(committed_engine, session_id, "going")
    waiting = await count_status(committed_engine, session_id, "waitlist")
    assert (going, waiting) == (2, 0), (
        f"{going} booked and {waiting} still waiting for 2 free seats: the two releases counted "
        f"{observed[-2:]} before either promoted anyone"
    )


# --- the lock itself: who waits, and who does not ---


async def hold_the_session_lock(holder: AsyncSession, session_id) -> None:
    """Take the same lock the endpoints take, from a connection of the test's own."""
    await holder.execute(
        select(ClassSession.id).where(ClassSession.id == session_id).with_for_update(key_share=True)
    )


@pytest.mark.parametrize("change", ["rsvp", "patch", "patch_no_change", "cancel"])
async def test_changing_a_session_waits_for_whoever_holds_its_lock(
    real_client, committed_engine, wait_for_lock_wait, change
):
    session_id, tenant_id, people = await booking_session(committed_engine, capacity=1)
    owner = auth(tenant_id, people["owner"])
    requests = {
        "rsvp": lambda: rsvp(real_client, tenant_id, people["member"], session_id, "going"),
        "patch": lambda: real_client.patch(
            f"/sessions/{session_id}", json={"capacity": 2}, headers=owner
        ),
        # Changes nothing, so it sends no UPDATE: only the lock on the SELECT can make it wait.
        "patch_no_change": lambda: real_client.patch(
            f"/sessions/{session_id}", json={"preview": None}, headers=owner
        ),
        "cancel": lambda: real_client.post(f"/sessions/{session_id}/cancel", headers=owner),
    }

    async with AsyncSession(committed_engine) as holder:
        await hold_the_session_lock(holder, session_id)
        request = asyncio.create_task(requests[change]())
        await wait_for_lock_wait(committed_engine)  # it is now blocked on the row lock
        assert not request.done()
    # leaving the block closes the session and releases the lock

    response = await asyncio.wait_for(request, timeout=10)
    assert response.status_code == 200


@pytest.mark.parametrize("changer", ["rsvp", "patch"])
async def test_attendance_is_not_blocked_while_a_change_holds_the_lock(
    real_client, committed_engine, monkeypatch, changer
):
    """The endpoints lock with FOR NO KEY UPDATE: that excludes other changers but not the plain
    inserts that only reference the row through a foreign key (an attendance record). With
    FOR UPDATE the attendance request would wait for the change and time out. Both ways of taking
    the lock are checked: the RSVP route, and PATCH (which shares `_own_session` with cancel)."""
    session_id, tenant_id, people = await booking_session(
        committed_engine,
        capacity=1,
        starts_in=timedelta(minutes=-5),  # check-in is open
    )
    holding, release = asyncio.Event(), asyncio.Event()
    real_count = app.bookings._count_going

    async def count_then_pause(session, sid):
        seen = await real_count(session, sid)
        holding.set()  # the booking has taken the session lock and now sits in its transaction
        await asyncio.wait_for(release.wait(), timeout=10)
        return seen

    monkeypatch.setattr(app.bookings, "_count_going", count_then_pause)
    changes = {
        "rsvp": lambda: rsvp(real_client, tenant_id, people["coach"], session_id, "going"),
        # a capacity change ends in the waitlist promotion, which counts the seats
        "patch": lambda: real_client.patch(
            f"/sessions/{session_id}",
            json={"capacity": 2},
            headers=auth(tenant_id, people["owner"]),
        ),
    }
    booking = asyncio.create_task(changes[changer]())
    try:
        await asyncio.wait_for(holding.wait(), timeout=10)
        attendance = await asyncio.wait_for(
            real_client.post(
                f"/sessions/{session_id}/attendance",
                json={"attended": True},
                headers=auth(tenant_id, people["member"]),
            ),
            timeout=5,
        )
    finally:
        release.set()
    booked = await asyncio.wait_for(booking, timeout=10)

    assert attendance.status_code == 200
    assert booked.status_code == 200
