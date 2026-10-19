import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import Membership, Participant, Tenant, User
from app.seed import PILOT_PEOPLE, PILOT_TENANT, seed


async def test_seed_makes_a_participant_for_every_membership(db_session):
    await seed(db_session)
    await seed(db_session)  # twice: still one each

    rows = await db_session.execute(
        select(Participant.name, Tenant.slug)
        .join(Tenant, Tenant.id == Participant.tenant_id)
        .join(User, User.id == Participant.user_id)
    )

    assert sorted(rows.all()) == sorted((name, PILOT_TENANT["slug"]) for _, name, _ in PILOT_PEOPLE)


async def test_a_participant_is_unique_per_studio_and_user(db_session):
    await seed(db_session)
    person = (await db_session.scalars(select(Participant))).first()
    db_session.add(Participant(tenant_id=person.tenant_id, user_id=person.user_id, name="Again"))

    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_participants_without_an_account_can_repeat(db_session, two_tenants):
    # user_id NULL is for kids without a login (step 47); NULLs never collide in a unique index.
    db_session.add_all(Participant(tenant_id=two_tenants.a.id, name=n) for n in ("Kid 1", "Kid 2"))
    await db_session.flush()


async def test_participant_needs_an_existing_studio(db_session):
    db_session.add(Participant(tenant_id=uuid.uuid4(), name="Ghost"))

    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_the_same_user_in_two_studios_has_two_participants(db_session, two_tenants):
    user_id = two_tenants.a.users["member"]
    db_session.add(Membership(tenant_id=two_tenants.b.id, user_id=user_id, role="member"))
    db_session.add_all(
        Participant(tenant_id=studio.id, user_id=user_id, name="Same person")
        for studio in (two_tenants.a, two_tenants.b)
    )
    await db_session.flush()

    studios = await db_session.scalars(
        select(Participant.tenant_id).where(Participant.user_id == user_id)
    )

    assert set(studios) == {two_tenants.a.id, two_tenants.b.id}


async def test_a_studio_only_finds_its_own_participants(db_session, two_tenants):
    for studio in (two_tenants.a, two_tenants.b):
        db_session.add(Participant(tenant_id=studio.id, name=f"kid of {studio.id}"))
    await db_session.flush()

    names = await db_session.scalars(
        select(Participant.name).where(Participant.tenant_id == two_tenants.a.id)
    )

    assert list(names) == [f"kid of {two_tenants.a.id}"]


async def test_every_membership_has_a_participant_after_seeding(db_session):
    await seed(db_session)

    missing = await db_session.scalar(
        select(func.count())
        .select_from(Membership)
        .outerjoin(
            Participant,
            (Participant.tenant_id == Membership.tenant_id)
            & (Participant.user_id == Membership.user_id),
        )
        .where(Participant.id.is_(None))
    )

    assert missing == 0
