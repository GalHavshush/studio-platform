import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Tenant


async def test_insert_and_read_tenant(db_session):
    db_session.add(Tenant(name="Pilates TLV", slug="pilates-tlv", timezone="Asia/Jerusalem"))
    await db_session.flush()

    tenant = await db_session.scalar(select(Tenant).where(Tenant.slug == "pilates-tlv"))

    assert tenant.name == "Pilates TLV"
    assert tenant.timezone == "Asia/Jerusalem"
    assert isinstance(tenant.id, uuid.UUID)
    assert tenant.default_locale == "en"  # server default


async def test_duplicate_slug_is_rejected(db_session):
    db_session.add_all(
        [
            Tenant(name="One", slug="same", timezone="UTC"),
            Tenant(name="Two", slug="same", timezone="UTC"),
        ]
    )

    with pytest.raises(IntegrityError):
        await db_session.flush()
