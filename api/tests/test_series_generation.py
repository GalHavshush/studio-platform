from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.models import ClassSeries, ClassSession
from app.series import occurrences
from tests.test_series import body, post
from tests.test_sessions import add_class_type

JERUSALEM = ZoneInfo("Asia/Jerusalem")
NEW_YORK = ZoneInfo("America/New_York")


def rule(weekday, start, first, last=None, minutes=60) -> ClassSeries:
    """An unsaved series: `occurrences` only reads its fields."""
    return ClassSeries(
        weekday=weekday,
        start_time=time.fromisoformat(start),
        duration_minutes=minutes,
        first_date=first,
        last_date=last,
    )


def starts(series, tz, today):
    return [s for s, _ in occurrences(series, tz, today)]


# --- the dates and instants (no database) ---


def test_four_weeks_from_today_and_never_the_past():
    series = rule(1, "18:00", date(2026, 10, 20))  # Tuesdays, started two weeks ago

    result = starts(series, JERUSALEM, date(2026, 10, 30))  # a Friday

    assert [s.date() for s in result] == [date(2026, 11, d) for d in (3, 10, 17, 24)]
    assert {s.hour for s in result} == {16}  # 18:00 in Jerusalem in November is 16:00 UTC


def test_a_series_that_starts_later_gets_its_own_four_weeks():
    series = rule(1, "18:00", date(2026, 12, 1))

    result = starts(series, JERUSALEM, date(2026, 10, 30))

    assert [s.date() for s in result] == [date(2026, 12, d) for d in (1, 8, 15, 22)]


def test_today_counts_when_it_is_the_weekday():
    series = rule(4, "18:00", date(2026, 10, 2))  # Fridays

    assert starts(series, JERUSALEM, date(2026, 10, 30))[0].date() == date(2026, 10, 30)


def test_last_date_is_included_and_stops_the_series():
    series = rule(1, "18:00", date(2026, 10, 20), last=date(2026, 11, 10))

    result = starts(series, JERUSALEM, date(2026, 10, 30))

    assert [s.date() for s in result] == [date(2026, 11, 3), date(2026, 11, 10)]


def test_nothing_is_left_after_last_date():
    series = rule(1, "18:00", date(2026, 10, 20), last=date(2026, 10, 27))

    assert occurrences(series, JERUSALEM, date(2026, 10, 30)) == []


def test_the_end_is_the_start_plus_the_length():
    series = rule(1, "18:00", date(2026, 11, 3), minutes=90)

    first = occurrences(series, JERUSALEM, date(2026, 10, 30))[0]

    assert first[1] - first[0] == timedelta(minutes=90)


def test_the_wall_clock_time_survives_the_clocks_going_forward():
    series = rule(6, "18:00", date(2026, 3, 1))  # Sundays; New York changes on 8 March

    result = starts(series, NEW_YORK, date(2026, 3, 1))

    assert [s.hour for s in result] == [23, 22, 22, 22]  # 18:00 is 23:00 UTC in winter, 22:00 after
    assert {s.astimezone(NEW_YORK).hour for s in result} == {18}


def test_a_time_the_clocks_skip_lands_an_hour_later():
    series = rule(6, "02:30", date(2026, 3, 1))  # 02:30 does not exist on 8 March

    result = starts(series, NEW_YORK, date(2026, 3, 1))

    skipped = result[1].astimezone(NEW_YORK)
    assert (skipped.date(), skipped.hour, skipped.minute) == (date(2026, 3, 8), 3, 30)
    assert len({s for s in result}) == 4  # no day lost or doubled


def test_a_time_that_happens_twice_takes_the_first_one():
    series = rule(6, "01:30", date(2026, 10, 25))  # 01:30 happens twice on 1 November

    result = starts(series, NEW_YORK, date(2026, 10, 25))

    assert result[1] == datetime(2026, 11, 1, 5, 30, tzinfo=UTC)  # the first, still summer time


# --- creating and extending through the API ---


def next_weekday(day: int) -> date:
    """The first date today or later on this weekday. The test studios use UTC."""
    today = datetime.now(UTC).date()
    return today + timedelta(days=(day - today.weekday()) % 7)


async def create(client, two_tenants, db_session, **overrides):
    a = two_tenants.a
    type_id = await add_class_type(db_session, a)
    first = overrides.pop("first_date", next_weekday(1))
    payload = body(type_id, first_date=first.isoformat(), weekday=first.weekday(), **overrides)
    response = await post(client, two_tenants, a, "owner", payload)
    assert response.status_code == 201
    return response.json()["id"]


async def sessions_of(db_session, series_id) -> list[ClassSession]:
    rows = await db_session.scalars(
        select(ClassSession)
        .where(ClassSession.series_id == series_id)
        .order_by(ClassSession.starts_at)
    )
    return list(rows)


async def extend(client, two_tenants, studio, role, series_id):
    return await client.post(
        f"/series/{series_id}/extend",
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


async def test_creating_a_series_creates_its_first_four_weeks(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create(
        client,
        two_tenants,
        db_session,
        capacity=8,
        coach_id=str(a.users["coach"]),
        duration_minutes=75,
    )

    rows = await sessions_of(db_session, series_id)

    assert len(rows) == 4
    assert all(r.tenant_id == a.id and r.coach_id == a.users["coach"] for r in rows)
    assert {r.capacity for r in rows} == {8}
    assert {r.status for r in rows} == {"scheduled"}
    assert {(r.starts_at.hour, r.starts_at.minute) for r in rows} == {(18, 0)}  # the studio is UTC
    assert {r.ends_at - r.starts_at for r in rows} == {timedelta(minutes=75)}
    assert rows[1].starts_at - rows[0].starts_at == timedelta(days=7)


async def test_a_series_that_began_in_the_past_does_not_create_past_sessions(
    client, two_tenants, db_session
):
    series_id = await create(
        client, two_tenants, db_session, first_date=next_weekday(1) - timedelta(weeks=3)
    )

    rows = await sessions_of(db_session, series_id)

    assert len(rows) == 4
    assert rows[0].starts_at.date() >= datetime.now(UTC).date()


async def test_last_date_limits_the_first_window(client, two_tenants, db_session):
    first = next_weekday(1)
    series_id = await create(
        client,
        two_tenants,
        db_session,
        first_date=first,
        last_date=(first + timedelta(days=7)).isoformat(),
    )

    assert len(await sessions_of(db_session, series_id)) == 2


async def test_extending_right_away_creates_nothing(client, two_tenants, db_session):
    series_id = await create(client, two_tenants, db_session)

    response = await extend(client, two_tenants, two_tenants.a, "owner", series_id)

    assert (response.status_code, response.json()) == (200, {"created": 0})
    assert len(await sessions_of(db_session, series_id)) == 4


async def test_extending_fills_in_what_is_missing_and_leaves_the_rest_alone(
    client, two_tenants, db_session
):
    series_id = await create(client, two_tenants, db_session)
    rows = await sessions_of(db_session, series_id)
    kept, cancelled, dropped = rows[0], rows[1], rows[3]
    await db_session.execute(
        update(ClassSession)
        .where(ClassSession.id == cancelled.id)
        .values(status="cancelled", preview="edited by hand")
    )
    await db_session.execute(delete(ClassSession).where(ClassSession.id == dropped.id))
    dropped_start = dropped.starts_at
    db_session.expire_all()

    response = await extend(client, two_tenants, two_tenants.a, "owner", series_id)

    assert response.json() == {"created": 1}
    after = await sessions_of(db_session, series_id)
    assert [r.starts_at for r in after][-1] == dropped_start  # only the missing one came back
    assert (after[1].status, after[1].preview) == ("cancelled", "edited by hand")  # not redone
    assert after[0].id == kept.id


async def test_only_an_owner_can_extend(client, two_tenants, db_session):
    series_id = await create(client, two_tenants, db_session)

    for role in ("coach", "member"):
        response = await extend(client, two_tenants, two_tenants.a, role, series_id)
        assert (response.status_code, response.json()) == (403, {"detail": "insufficient_role"})


async def test_another_studios_series_cannot_be_extended(client, two_tenants, db_session):
    series_id = await create(client, two_tenants, db_session)

    response = await extend(client, two_tenants, two_tenants.b, "owner", series_id)

    assert (response.status_code, response.json()) == (404, {"detail": "series_not_found"})


async def test_the_database_refuses_a_second_session_at_the_same_instant(
    client, two_tenants, db_session
):
    series_id = await create(client, two_tenants, db_session)
    first = (await sessions_of(db_session, series_id))[0]

    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(
                ClassSession(
                    tenant_id=first.tenant_id,
                    class_type_id=first.class_type_id,
                    coach_id=first.coach_id,
                    series_id=series_id,
                    starts_at=first.starts_at,
                    ends_at=first.ends_at,
                )
            )
            await db_session.flush()


# --- every session says which series it came from ---


async def test_a_session_says_which_series_made_it_and_a_single_class_says_none(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session)
    sid = await db_session.scalar(
        select(ClassSession.id).where(ClassSession.series_id == series_id).limit(1)
    )
    type_id = await add_class_type(db_session, a, name="Open mat")
    single = ClassSession(
        tenant_id=a.id,
        class_type_id=type_id,
        coach_id=a.users["coach"],
        starts_at=datetime.now(UTC) + timedelta(days=2),
        ends_at=datetime.now(UTC) + timedelta(days=2, hours=1),
    )
    db_session.add(single)
    await db_session.flush()
    headers = two_tenants.headers(a.users["member"], a.id)  # a member sees it too: it is only an id

    detail = await client.get(f"/sessions/{sid}", headers=headers)
    alone = await client.get(f"/sessions/{single.id}", headers=headers)
    listed = await client.get(
        "/sessions",
        params={
            "from": datetime.now(UTC).isoformat(),
            "to": (datetime.now(UTC) + timedelta(days=60)).isoformat(),
        },
        headers=headers,
    )

    assert detail.json()["series_id"] == series_id
    assert alone.json()["series_id"] is None
    by_id = {row["id"]: row["series_id"] for row in listed.json()}
    assert by_id[str(sid)] == series_id
    assert by_id[str(single.id)] is None
