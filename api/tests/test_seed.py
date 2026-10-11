from sqlalchemy import func, select

from app.models import Membership, Tenant, User
from app.seed import PILOT_PEOPLE, PILOT_TENANT, seed


async def test_seed_creates_pilot_studio_with_each_role(db_session):
    await seed(db_session)

    rows = await db_session.execute(
        select(User.email, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .join(Tenant, Tenant.id == Membership.tenant_id)
        .where(Tenant.slug == PILOT_TENANT["slug"])
    )

    assert dict(rows.all()) == {email: role for email, _, role in PILOT_PEOPLE}


async def test_seed_twice_creates_no_duplicates(db_session):
    await seed(db_session)
    await seed(db_session)

    async def count(model):
        return await db_session.scalar(select(func.count()).select_from(model))

    assert (await count(Tenant), await count(User), await count(Membership)) == (1, 3, 3)
