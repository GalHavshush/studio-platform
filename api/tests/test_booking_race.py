import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.sessions
from app.models import ClassSession, ClassType, Rsvp, Tenant, User
from app.security import create_access_token
from app.seed import PILOT_TENANT


@pytest.mark.xfail(
    strict=True,
    reason="Known race (step 26): the seat check is check-then-insert. Step 27 fixes it, then this"
    " test passes and the xfail marker must be removed.",
)
async def test_two_simultaneous_bookings_never_overbook(real_client, committed_engine, monkeypatch):
    """A booking session with ONE seat, and two people ask for it at the same moment.

    What happens today, step by step (READ COMMITTED, Postgres's default: a statement only sees
    data that was already committed when it started):

        request A: count going rows  -> 0   (a seat is free)
        request B: count going rows  -> 0   (A has not written yet, and B could not see it anyway)
        request A: insert 'going'; commit
        request B: insert 'going'; commit    <- both passed the check, so the seat is booked twice

    Each request is correct on its own. The bug is the gap between the check and the write, which
    no application-level `if` can close: whatever B checked is stale by the time B writes. The
    check and the write have to be made one atomic step (step 27: lock the session row first).

    To make this happen every run instead of occasionally, both requests are held right after
    their count, until both have counted. The rendezvous gives up after a second, so a fix that
    makes B wait for A (a lock) lets the test finish instead of deadlocking: A times out, writes,
    commits, and B then counts 1 and joins the waitlist.

    The test asserts the correct rule (never more going than seats), so it fails today and is
    committed as a strict xfail.
    """
    async with AsyncSession(committed_engine) as db:
        tenant_id = await db.scalar(select(Tenant.id).where(Tenant.slug == PILOT_TENANT["slug"]))
        rows = await db.execute(select(User.email, User.id).where(User.email.like("%@example.com")))
        users = dict(rows.all())
        class_type = ClassType(tenant_id=tenant_id, name="Booked class", attendance_mode="booking")
        db.add(class_type)
        await db.flush()
        start = datetime.now(UTC) + timedelta(days=1)
        booked_session = ClassSession(
            tenant_id=tenant_id,
            class_type_id=class_type.id,
            coach_id=users["coach@example.com"],
            starts_at=start,
            ends_at=start + timedelta(hours=1),
            capacity=1,
        )
        db.add(booked_session)
        await db.flush()
        session_id, capacity = (
            booked_session.id,
            booked_session.capacity,
        )  # before the commit expires them
        await db.commit()

    barrier = asyncio.Barrier(2)
    observed: list[int] = []
    real_count = app.sessions._count_going

    async def count_then_wait_for_the_other(session, sid):
        seen = await real_count(session, sid)
        observed.append(seen)
        try:
            await asyncio.wait_for(barrier.wait(), timeout=1)
        except (TimeoutError, asyncio.BrokenBarrierError):
            pass  # the other request is blocked (a fix is in place): carry on without it
        return seen

    monkeypatch.setattr(app.sessions, "_count_going", count_then_wait_for_the_other)

    def book(email: str):
        return real_client.put(
            f"/sessions/{session_id}/rsvp",
            json={"status": "going"},
            headers={
                "Authorization": f"Bearer {create_access_token(users[email])}",
                "X-Tenant-Id": str(tenant_id),
            },
        )

    await asyncio.wait_for(
        asyncio.gather(book("coach@example.com"), book("member@example.com")), timeout=15
    )

    async with AsyncSession(committed_engine) as db:
        going = await db.scalar(
            select(func.count())
            .select_from(Rsvp)
            .where(Rsvp.session_id == session_id, Rsvp.status == "going")
        )
    assert going <= capacity, (
        f"{going} people booked {capacity} seat(s): the two requests counted {observed} "
        "before either one wrote"
    )
