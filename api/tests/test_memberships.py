import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Membership, Tenant, User


async def make_user_and_tenant(session, slug="studio"):
    user = User(email=f"{slug}@example.com", name="Ada")
    tenant = Tenant(name=slug, slug=slug, timezone="UTC")
    session.add_all([user, tenant])
    await session.flush()
    return user, tenant


async def test_one_user_can_belong_to_two_tenants(db_session):
    user, tenant_a = await make_user_and_tenant(db_session, "studio-a")
    tenant_b = Tenant(name="B", slug="studio-b", timezone="UTC")
    db_session.add(tenant_b)
    await db_session.flush()
    db_session.add_all(
        [
            Membership(tenant_id=tenant_a.id, user_id=user.id, role="owner"),
            Membership(tenant_id=tenant_b.id, user_id=user.id, role="member"),
        ]
    )
    await db_session.flush()

    roles = await db_session.scalars(
        select(Membership.role).where(Membership.user_id == user.id).order_by(Membership.role)
    )

    assert list(roles) == ["member", "owner"]


async def test_duplicate_membership_is_rejected(db_session):
    user, tenant = await make_user_and_tenant(db_session)
    db_session.add_all(
        [
            Membership(tenant_id=tenant.id, user_id=user.id, role="coach"),
            Membership(tenant_id=tenant.id, user_id=user.id, role="member"),
        ]
    )

    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_invalid_role_is_rejected(db_session):
    user, tenant = await make_user_and_tenant(db_session)
    db_session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="wizard"))

    with pytest.raises(IntegrityError):
        await db_session.flush()


@pytest.mark.parametrize("missing", ["tenant_id", "user_id"])
async def test_membership_needs_an_existing_user_and_tenant(db_session, missing):
    user, tenant = await make_user_and_tenant(db_session)
    ids = {"tenant_id": tenant.id, "user_id": user.id, missing: uuid.uuid4()}
    db_session.add(Membership(**ids, role="member"))

    with pytest.raises(IntegrityError):
        await db_session.flush()
