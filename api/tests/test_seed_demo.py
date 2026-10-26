# Tests for the DEV DEMO block in app/seed.py. Delete this file together with that block.
from sqlalchemy import func, select

from app.models import Membership, Participant, Tenant, User
from app.seed import DEMO_TENANT, seed, seed_demo


async def test_demo_studio_gives_the_coach_a_second_studio_with_another_role(db_session):
    await seed(db_session)
    await seed_demo(db_session)

    rows = await db_session.execute(
        select(Tenant.slug, Membership.role)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .join(User, User.id == Membership.user_id)
        .where(User.email == "coach@example.com")
    )

    assert dict(rows.all()) == {"pilot-studio": "coach", DEMO_TENANT["slug"]: "member"}


async def test_demo_twice_creates_no_duplicates(db_session):
    for _ in range(2):
        await seed(db_session)
        await seed_demo(db_session)

    async def count(model):
        return await db_session.scalar(select(func.count()).select_from(model))

    # 2 studios; 5 people (the coach is one login in both); 6 memberships, one participant each.
    assert (await count(Tenant), await count(User), await count(Membership)) == (2, 5, 6)
    assert await count(Participant) == 6
