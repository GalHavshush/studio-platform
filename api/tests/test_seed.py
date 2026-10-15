from sqlalchemy import func, select, update

from app.models import Membership, Tenant, User
from app.security import hash_password, verify_password
from app.seed import PILOT_PASSWORD, PILOT_PEOPLE, PILOT_TENANT, seed


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


async def test_seed_sets_verifiable_passwords_and_never_overwrites_them(db_session):
    await seed(db_session)
    hashes = dict((await db_session.execute(select(User.email, User.password_hash))).all())
    assert all(verify_password(PILOT_PASSWORD, h) for h in hashes.values())

    # A user who has since changed their password keeps it across re-seeding.
    changed = hash_password("my-own-password")
    await db_session.execute(
        update(User).where(User.email == "owner@example.com").values(password_hash=changed)
    )
    await seed(db_session)

    owner_hash = await db_session.scalar(
        select(User.password_hash).where(User.email == "owner@example.com")
    )
    assert owner_hash == changed
