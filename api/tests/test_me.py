import pytest
from sqlalchemy import select

from app.models import Membership, Participant, Tenant, User
from app.security import create_access_token
from app.seed import seed


@pytest.fixture(autouse=True)
async def seeded(db_session):
    await seed(db_session)


@pytest.fixture
def get_me(client, db_session):
    """Call GET /me as the given seeded user, with a real token for them."""

    async def call(email):
        user_id = await db_session.scalar(select(User.id).where(User.email == email))
        token = create_access_token(user_id)
        return await client.get("/me", headers={"Authorization": f"Bearer {token}"})

    return call


async def test_me_returns_profile_and_membership(get_me):
    response = await get_me("owner@example.com")

    assert response.status_code == 200
    body = response.json()
    assert (body["email"], body["name"], body["locale"]) == (
        "owner@example.com",
        "Olivia Owner",
        "en",
    )
    assert len(body["memberships"]) == 1
    membership = body["memberships"][0]
    assert membership["role"] == "owner"
    assert membership["tenant"]["slug"] == "pilot-studio"
    assert set(membership["tenant"]) == {"id", "name", "slug"}


async def test_a_membership_carries_the_callers_own_participant_in_that_studio(get_me, db_session):
    body = (await get_me("member@example.com")).json()

    expected = await db_session.scalar(
        select(Participant.id).where(Participant.user_id == body["id"])
    )
    assert body["memberships"][0]["participant_id"] == str(expected)


async def test_each_studio_gives_its_own_participant(get_me, db_session):
    other = Tenant(name="Another Studio", slug="another-studio", timezone="UTC")
    db_session.add(other)
    await db_session.flush()
    coach_id = await db_session.scalar(select(User.id).where(User.email == "coach@example.com"))
    db_session.add_all(
        [
            Membership(tenant_id=other.id, user_id=coach_id, role="member"),
            Participant(tenant_id=other.id, user_id=coach_id, name="Cody elsewhere"),
        ]
    )
    await db_session.flush()

    memberships = (await get_me("coach@example.com")).json()["memberships"]

    by_slug = {m["tenant"]["slug"]: m["participant_id"] for m in memberships}
    assert len(set(by_slug.values())) == 2  # one person, two studios, two participants
    for slug, participant_id in by_slug.items():
        row = await db_session.get(Participant, participant_id)
        assert (row.user_id, row.tenant_id) == (
            coach_id,
            await db_session.scalar(select(Tenant.id).where(Tenant.slug == slug)),
        )


async def test_nobody_elses_participant_ever_appears(get_me, db_session):
    mine = (await get_me("member@example.com")).json()["memberships"][0]["participant_id"]
    others = set(
        map(
            str,
            await db_session.scalars(select(Participant.id).where(Participant.id != mine)),
        )
    )

    response = await get_me("member@example.com")

    assert others and not any(other in response.text for other in others)


async def test_a_membership_without_a_participant_is_null_not_an_error(get_me, db_session):
    other = Tenant(name="Another Studio", slug="another-studio", timezone="UTC")
    db_session.add(other)
    await db_session.flush()
    coach_id = await db_session.scalar(select(User.id).where(User.email == "coach@example.com"))
    db_session.add(Membership(tenant_id=other.id, user_id=coach_id, role="member"))
    await db_session.flush()

    response = await get_me("coach@example.com")

    assert response.status_code == 200
    ids = {m["tenant"]["slug"]: m["participant_id"] for m in response.json()["memberships"]}
    assert ids["another-studio"] is None
    assert ids["pilot-studio"] is not None


async def test_me_never_exposes_the_password_hash(get_me):
    response = await get_me("owner@example.com")

    assert set(response.json()) == {"id", "email", "name", "locale", "memberships"}
    assert "argon2" not in response.text


async def test_me_lists_every_studio_with_the_role_held_in_each(get_me, db_session):
    other = Tenant(name="Another Studio", slug="another-studio", timezone="UTC")
    db_session.add(other)
    await db_session.flush()
    coach_id = await db_session.scalar(select(User.id).where(User.email == "coach@example.com"))
    db_session.add(Membership(tenant_id=other.id, user_id=coach_id, role="owner"))
    await db_session.flush()

    response = await get_me("coach@example.com")

    roles = {m["tenant"]["slug"]: m["role"] for m in response.json()["memberships"]}
    assert roles == {"pilot-studio": "coach", "another-studio": "owner"}
    # Ordered by studio name, so the list is stable.
    assert [m["tenant"]["name"] for m in response.json()["memberships"]] == [
        "Another Studio",
        "Pilot Studio",
    ]


async def test_me_for_a_user_with_no_studios_is_an_empty_list(get_me, db_session):
    db_session.add(User(email="loner@example.com", name="Lone"))
    await db_session.flush()

    response = await get_me("loner@example.com")

    assert response.status_code == 200
    assert response.json()["memberships"] == []


async def test_me_without_a_token_is_401(client):
    response = await client.get("/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "not_authenticated"}
