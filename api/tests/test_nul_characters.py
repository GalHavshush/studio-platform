"""A NUL character cannot be stored in Postgres text. Without a check the driver raises and the
client gets a 500; every stored free-text field must answer 422 instead, and save nothing."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models import ClassReport, ClassSession, ClassType, Participant, ParticipantNote
from app.seed import PILOT_PASSWORD, seed

NUL = "bad\x00text"


async def session_and_member(db_session, studio):
    ct = ClassType(tenant_id=studio.id, name="Open mat")
    db_session.add(ct)
    await db_session.flush()
    start = datetime(2026, 10, 20, 15, tzinfo=UTC)
    row = ClassSession(
        tenant_id=studio.id,
        class_type_id=ct.id,
        coach_id=studio.users["coach"],
        starts_at=start,
        ends_at=start + timedelta(hours=1),
    )
    db_session.add(row)
    await db_session.flush()
    member = await db_session.scalar(
        select(Participant.id).where(
            Participant.tenant_id == studio.id, Participant.user_id == studio.users["member"]
        )
    )
    return row.id, member


@pytest.mark.parametrize(
    "field",
    ["class_type_name", "preview", "summary", "went_well", "needs_work", "observations", "note"],
)
async def test_a_nul_character_is_a_422_and_nothing_is_saved(
    client, two_tenants, db_session, field
):
    a = two_tenants.a
    session_id, member = await session_and_member(db_session, a)
    owner = two_tenants.headers(a.users["owner"], a.id)
    requests = {
        "class_type_name": lambda: client.post("/class-types", json={"name": NUL}, headers=owner),
        "preview": lambda: client.patch(
            f"/sessions/{session_id}", json={"preview": NUL}, headers=owner
        ),
        "note": lambda: client.put(
            f"/sessions/{session_id}/report",
            json={"notes": [{"participant_id": str(member), "body": NUL}]},
            headers=owner,
        ),
    }
    send = requests.get(field) or (
        lambda: client.put(f"/sessions/{session_id}/report", json={field: NUL}, headers=owner)
    )

    response = await send()

    assert response.status_code == 422
    assert "NUL" in response.text
    assert await db_session.scalar(select(func.count()).select_from(ClassReport)) == 0
    assert await db_session.scalar(select(func.count()).select_from(ParticipantNote)) == 0
    assert await db_session.scalar(select(ClassSession.preview)) is None
    assert [n for n in await db_session.scalars(select(ClassType.name)) if "\x00" in n] == []


async def test_a_nul_in_the_text_around_other_characters_is_also_rejected(client, two_tenants):
    a = two_tenants.a

    response = await client.post(
        "/class-types",
        json={"name": "\x00"},
        headers=two_tenants.headers(a.users["owner"], a.id),
    )

    assert response.status_code == 422


async def test_login_treats_a_nul_email_like_any_unknown_email(client, db_session):
    await seed(db_session)

    nul = await client.post(
        "/auth/login", json={"email": "owner\x00@example.com", "password": PILOT_PASSWORD}
    )
    unknown = await client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": PILOT_PASSWORD}
    )

    assert nul.status_code == 401
    assert nul.text == unknown.text  # nothing to tell them apart
