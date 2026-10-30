from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy import select, update

from app.models import ClassSession, ClassType, Participant, Rsvp, Tenant
from tests.test_series import body, post
from tests.test_series_generation import create as create_now
from tests.test_series_generation import next_weekday, sessions_of
from tests.test_sessions import add_class_type


async def create(client, two_tenants, db_session, **overrides):
    """A Tuesday series whose four sessions all start at least a week from now."""
    first = next_weekday(1) + timedelta(days=7)
    return await create_now(client, two_tenants, db_session, first_date=first, **overrides)


async def patch(client, two_tenants, studio, role, series_id, payload):
    return await client.patch(
        f"/series/{series_id}",
        json=payload,
        headers=two_tenants.headers(studio.users[role], studio.id),
    )


async def patch_session(client, two_tenants, session_id, payload):
    a = two_tenants.a
    return await client.patch(
        f"/sessions/{session_id}", json=payload, headers=two_tenants.headers(a.users["owner"], a.id)
    )


# --- the rule and its future sessions ---


async def test_a_new_coach_teaches_the_series_and_its_future_sessions(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session)

    response = await patch(
        client, two_tenants, a, "owner", series_id, {"coach_id": str(a.users["coach"])}
    )

    assert response.status_code == 200
    assert response.json()["coach_id"] == str(a.users["coach"])
    assert (response.json()["sessions_updated"], response.json()["sessions_kept"]) == (4, 0)
    rows = await sessions_of(db_session, series_id)
    assert {r.coach_id for r in rows} == {a.users["coach"]}


async def test_capacity_follows_and_null_means_unlimited(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session, capacity=8)

    await patch(client, two_tenants, a, "owner", series_id, {"capacity": 5})
    five = {r.capacity for r in await sessions_of(db_session, series_id)}
    db_session.expire_all()
    await patch(client, two_tenants, a, "owner", series_id, {"capacity": None})
    unlimited = {r.capacity for r in await sessions_of(db_session, series_id)}

    assert (five, unlimited) == ({5}, {None})


async def test_a_new_start_time_and_length_keep_every_session_on_its_own_date(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session)
    dates = [r.starts_at.date() for r in await sessions_of(db_session, series_id)]

    response = await patch(
        client,
        two_tenants,
        a,
        "owner",
        series_id,
        {"start_time": "07:30", "duration_minutes": 90},
    )

    assert (response.json()["start_time"], response.json()["duration_minutes"]) == ("07:30:00", 90)
    db_session.expire_all()
    rows = await sessions_of(db_session, series_id)
    assert [r.starts_at.date() for r in rows] == dates
    assert {(r.starts_at.hour, r.starts_at.minute) for r in rows} == {(7, 30)}
    assert {r.ends_at - r.starts_at for r in rows} == {timedelta(minutes=90)}


async def test_a_new_start_time_means_the_same_wall_clock_across_a_clock_change(
    client, two_tenants, db_session
):
    """Sundays in New York around 14 March 2030, when the clocks go forward."""
    a = two_tenants.a
    (await db_session.get(Tenant, a.id)).timezone = "America/New_York"
    series_id = await create(client, two_tenants, db_session)
    first = (await sessions_of(db_session, series_id))[0]
    await db_session.execute(
        ClassSession.__table__.delete().where(ClassSession.series_id == series_id)
    )
    for day in (
        date(2030, 3, 3),
        date(2030, 3, 10),
    ):  # 22:00 local: 03:00 UTC the next day, then 02:00
        zone_start = datetime.combine(
            day, time(22), tzinfo=__import__("zoneinfo").ZoneInfo("America/New_York")
        )
        db_session.add(
            ClassSession(
                tenant_id=a.id,
                class_type_id=first.class_type_id,
                coach_id=first.coach_id,
                series_id=series_id,
                starts_at=zone_start.astimezone(UTC),
                ends_at=zone_start.astimezone(UTC) + timedelta(hours=1),
            )
        )
    await db_session.flush()

    response = await patch(client, two_tenants, a, "owner", series_id, {"start_time": "23:00"})

    assert response.json()["sessions_updated"] == 2
    db_session.expire_all()
    rows = await sessions_of(db_session, series_id)
    assert [r.starts_at for r in rows] == [
        datetime(2030, 3, 4, 4, 0, tzinfo=UTC),  # 23:00 EST on the 3rd
        datetime(2030, 3, 11, 3, 0, tzinfo=UTC),  # 23:00 EDT on the 10th
    ]


async def test_repeating_an_edit_changes_nothing_more(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session)
    await patch(client, two_tenants, a, "owner", series_id, {"start_time": "07:30"})
    db_session.expire_all()
    before = [r.starts_at for r in await sessions_of(db_session, series_id)]

    await patch(client, two_tenants, a, "owner", series_id, {"start_time": "07:30"})
    db_session.expire_all()

    assert [r.starts_at for r in await sessions_of(db_session, series_id)] == before


async def test_extend_uses_the_changed_rule(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session, capacity=8)
    await patch(client, two_tenants, a, "owner", series_id, {"capacity": 3})
    last = (await sessions_of(db_session, series_id))[-1]
    await db_session.execute(
        update(ClassSession).where(ClassSession.id == last.id).values(series_id=None)
    )  # one session gone from the series, as if it had been deleted
    db_session.expire_all()

    response = await client.post(
        f"/series/{series_id}/extend", headers=two_tenants.headers(a.users["owner"], a.id)
    )

    assert response.json() == {"created": 1}
    assert (await sessions_of(db_session, series_id))[-1].capacity == 3


# --- what is left alone ---


async def test_past_cancelled_and_hand_edited_sessions_keep_what_they_have(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session, capacity=8)
    past, cancelled, edited, followed = await sessions_of(db_session, series_id)
    long_ago = datetime.now(UTC) - timedelta(days=2)
    await db_session.execute(
        update(ClassSession)
        .where(ClassSession.id == past.id)
        .values(starts_at=long_ago, ends_at=long_ago + timedelta(hours=1))
    )
    await db_session.execute(
        update(ClassSession).where(ClassSession.id == cancelled.id).values(status="cancelled")
    )
    edited_id, followed_id = edited.id, followed.id
    await patch_session(client, two_tenants, edited_id, {"capacity": 20})
    db_session.expire_all()

    response = await patch(client, two_tenants, a, "owner", series_id, {"capacity": 2})

    assert (response.json()["sessions_updated"], response.json()["sessions_kept"]) == (1, 1)
    db_session.expire_all()
    capacity = {r.id: r.capacity for r in await sessions_of(db_session, series_id)}
    assert capacity[past.id] == capacity[cancelled.id] == 8
    assert capacity[edited_id] == 20
    assert capacity[followed_id] == 2


@pytest.mark.parametrize(
    ("change", "marks"),
    [
        ({"capacity": 9}, True),
        ({"coach_id": "coach"}, True),
        ({"starts_at": "+1h"}, True),
        ({"preview": "bring a towel"}, False),  # a preview is not something the series writes
        ({"capacity": 8}, False),  # the value it already has
    ],
)
async def test_what_counts_as_a_hand_edit(client, two_tenants, db_session, change, marks):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session, capacity=8)
    row = (await sessions_of(db_session, series_id))[0]
    row_id = row.id
    if change.get("coach_id") == "coach":
        change = {"coach_id": str(a.users["coach"])}
    if change.get("starts_at") == "+1h":
        change = {
            "starts_at": (row.starts_at + timedelta(hours=1)).isoformat(),
            "ends_at": (row.ends_at + timedelta(hours=1)).isoformat(),
        }

    response = await patch_session(client, two_tenants, row_id, change)

    assert response.status_code == 200
    db_session.expire_all()
    assert (await db_session.get(ClassSession, row_id)).is_overridden is marks


async def test_a_session_made_by_hand_is_never_marked(client, two_tenants, db_session):
    a = two_tenants.a
    type_id = await add_class_type(db_session, a)
    start = datetime.now(UTC) + timedelta(days=3)
    created = await client.post(
        "/sessions",
        json={
            "class_type_id": str(type_id),
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(hours=1)).isoformat(),
        },
        headers=two_tenants.headers(a.users["owner"], a.id),
    )

    await patch_session(client, two_tenants, created.json()["id"], {"capacity": 4})

    db_session.expire_all()
    row = await db_session.get(ClassSession, created.json()["id"])
    assert (row.series_id, row.is_overridden) == (None, False)


# --- clashes and refusals ---


async def test_a_start_time_that_lands_on_another_sessions_instant_changes_nothing(
    client, two_tenants, db_session
):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session)
    first, *_, last = await sessions_of(db_session, series_id)
    target = first.starts_at.replace(hour=7, minute=30)  # where the new 07:30 puts the first one
    last_id = last.id
    moved = await patch_session(
        client,
        two_tenants,
        last_id,
        {"starts_at": target.isoformat(), "ends_at": (target + timedelta(hours=1)).isoformat()},
    )
    assert moved.status_code == 200

    response = await patch(client, two_tenants, a, "owner", series_id, {"start_time": "07:30"})

    assert (response.status_code, response.json()) == (409, {"detail": "session_time_clash"})
    db_session.expire_all()
    read = await client.get(
        f"/series/{series_id}", headers=two_tenants.headers(a.users["owner"], a.id)
    )
    assert read.json()["start_time"] == "18:00:00"
    assert {r.starts_at.hour for r in await sessions_of(db_session, series_id)} == {18, 7}


async def test_the_new_coach_must_be_staff(client, two_tenants, db_session):
    a = two_tenants.a
    series_id = await create(client, two_tenants, db_session)

    response = await patch(
        client, two_tenants, a, "owner", series_id, {"coach_id": str(a.users["member"])}
    )

    assert (response.status_code, response.json()) == (422, {"detail": "invalid_coach"})


@pytest.mark.parametrize(
    "payload",
    [
        {"weekday": 2},
        {"first_date": "2030-01-01"},
        {"last_date": "2030-01-01"},
        {"class_type_id": "00000000-0000-0000-0000-000000000000"},
        {"coach_id": None},
        {"start_time": None},
        {"duration_minutes": 0},
        {"capacity": 0},
        {"start_time": "18:00+03:00"},
    ],
)
async def test_what_cannot_be_changed_or_is_invalid_is_refused(
    client, two_tenants, db_session, payload
):
    series_id = await create(client, two_tenants, db_session)

    response = await patch(client, two_tenants, two_tenants.a, "owner", series_id, payload)

    assert response.status_code == 422


@pytest.mark.parametrize("role", ["coach", "member"])
async def test_only_an_owner_can_edit_a_series(client, two_tenants, db_session, role):
    series_id = await create(client, two_tenants, db_session)

    response = await patch(client, two_tenants, two_tenants.a, role, series_id, {"capacity": 3})

    assert (response.status_code, response.json()) == (403, {"detail": "insufficient_role"})


async def test_another_studios_series_cannot_be_edited(client, two_tenants, db_session):
    series_id = await create(client, two_tenants, db_session)

    response = await patch(client, two_tenants, two_tenants.b, "owner", series_id, {"capacity": 3})

    assert (response.status_code, response.json()) == (404, {"detail": "series_not_found"})


# --- booking ---


async def test_more_seats_let_the_waiting_list_in(client, two_tenants, db_session):
    a = two_tenants.a
    (await db_session.get(Tenant, a.id)).modules = ["booking"]
    type_row = ClassType(tenant_id=a.id, name="Spin", attendance_mode="booking")
    db_session.add(type_row)
    await db_session.flush()
    payload = body(
        type_row.id,
        first_date=(next_weekday(1) + timedelta(days=7)).isoformat(),
        capacity=1,
    )
    series_id = (await post(client, two_tenants, a, "owner", payload)).json()["id"]
    session_id = (await sessions_of(db_session, series_id))[0].id
    going, waiting = (Participant(tenant_id=a.id, name=n) for n in ("Gail", "Wally"))
    db_session.add_all([going, waiting])
    await db_session.flush()
    db_session.add_all(
        [
            Rsvp(session_id=session_id, participant_id=going.id, tenant_id=a.id, status="going"),
            Rsvp(
                session_id=session_id,
                participant_id=waiting.id,
                tenant_id=a.id,
                status="waitlist",
                waitlisted_at=datetime.now(UTC),
            ),
        ]
    )
    await db_session.flush()

    await patch(client, two_tenants, a, "owner", series_id, {"capacity": 2})

    db_session.expire_all()
    statuses = await db_session.scalars(select(Rsvp.status).where(Rsvp.session_id == session_id))
    assert sorted(statuses) == ["going", "going"]
