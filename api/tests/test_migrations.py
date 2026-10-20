import asyncio
import uuid

import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool


def test_migrations_upgrade_and_downgrade_cleanly(alembic_cfg):
    command.upgrade(alembic_cfg, "head")
    command.downgrade(alembic_cfg, "base")
    # Upgrading again only works if the downgrade really undid everything.
    command.upgrade(alembic_cfg, "head")


def test_family_backfill_keeps_a_rotation_chain_together(alembic_cfg, test_db_url):
    ids = {name: uuid.uuid4() for name in "ABCD"}  # A -> B -> C is one chain, D another login
    user_id = uuid.uuid4()

    async def run(work):
        engine = create_async_engine(test_db_url, poolclass=NullPool)
        async with engine.begin() as conn:
            result = await work(conn)
        await engine.dispose()
        return result

    async def insert_chain(conn):
        await conn.execute(
            text("INSERT INTO users (id, email, name) VALUES (:id, 'u@example.com', 'U')"),
            {"id": user_id},
        )
        for name, token_id in ids.items():
            await conn.execute(
                text(
                    "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)"
                    " VALUES (:id, :user, :hash, now() + interval '1 day')"
                ),
                {"id": token_id, "user": user_id, "hash": name},
            )
        for old, new in (("A", "B"), ("B", "C")):
            await conn.execute(
                text("UPDATE refresh_tokens SET replaced_by_id = :new WHERE id = :old"),
                {"old": ids[old], "new": ids[new]},
            )

    async def read_families(conn):
        rows = await conn.execute(text("SELECT id, family_id FROM refresh_tokens"))
        return dict(rows.all())

    try:
        command.downgrade(alembic_cfg, "base")
        command.upgrade(alembic_cfg, "a4b00fe1d59a")  # the revision just before family_id
        asyncio.run(run(insert_chain))
        command.upgrade(alembic_cfg, "head")
        families = asyncio.run(run(read_families))
    finally:
        command.downgrade(alembic_cfg, "base")  # drops this test's rows; fixtures re-upgrade

    assert families[ids["A"]] == families[ids["B"]] == families[ids["C"]]
    assert families[ids["D"]] != families[ids["A"]]


def test_participants_backfill_covers_existing_memberships(alembic_cfg, test_db_url):
    async def run(work):
        engine = create_async_engine(test_db_url, poolclass=NullPool)
        async with engine.begin() as conn:
            result = await work(conn)
        await engine.dispose()
        return result

    async def insert_member(conn):
        await conn.execute(text("INSERT INTO users (email, name) VALUES ('m@example.com', 'Mia')"))
        await conn.execute(
            text("INSERT INTO tenants (name, slug, timezone) VALUES ('S', 's', 'UTC')")
        )
        await conn.execute(
            text(
                "INSERT INTO memberships (tenant_id, user_id, role)"
                " SELECT t.id, u.id, 'member' FROM tenants t, users u"
            )
        )

    async def read_participants(conn):
        return (await conn.execute(text("SELECT name FROM participants"))).scalars().all()

    try:
        command.downgrade(alembic_cfg, "base")
        command.upgrade(alembic_cfg, "d04a2ab4f83a")  # the revision just before participants
        asyncio.run(run(insert_member))
        command.upgrade(alembic_cfg, "head")
        names = asyncio.run(run(read_participants))
    finally:
        command.downgrade(alembic_cfg, "base")

    assert names == ["Mia"]


# --- step 27b: same-studio foreign keys ---

BEFORE_SAME_STUDIO_KEYS = "c0f26fe1c347"  # the revision just before


async def _run(test_db_url, work):
    engine = create_async_engine(test_db_url, poolclass=NullPool)
    async with engine.begin() as conn:
        result = await work(conn)
    await engine.dispose()
    return result


async def _insert_old_schema_rows(conn, session_in_studio: str, class_type_in_studio: str):
    """Rows as the schema looked before 27b (rsvps has no tenant_id yet). The class type and the
    session can be put in different studios ("a" or "b") to build bad data."""
    studios = {}
    for name in ("a", "b"):
        studios[name] = (
            await conn.execute(
                text(
                    "INSERT INTO tenants (name, slug, timezone) VALUES (:n, :n, 'UTC') RETURNING id"
                ),
                {"n": name},
            )
        ).scalar_one()
    user_id = (
        await conn.execute(
            text("INSERT INTO users (email, name) VALUES ('u@example.com', 'U') RETURNING id")
        )
    ).scalar_one()
    class_type_id = (
        await conn.execute(
            text("INSERT INTO class_types (tenant_id, name) VALUES (:t, 'c') RETURNING id"),
            {"t": studios[class_type_in_studio]},
        )
    ).scalar_one()
    session_id = (
        await conn.execute(
            text(
                "INSERT INTO class_sessions (tenant_id, class_type_id, coach_id, starts_at, ends_at)"
                " VALUES (:t, :c, :u, now(), now() + interval '1 hour') RETURNING id"
            ),
            {"t": studios[session_in_studio], "c": class_type_id, "u": user_id},
        )
    ).scalar_one()
    participant_id = (
        await conn.execute(
            text(
                "INSERT INTO participants (tenant_id, user_id, name)"
                " VALUES (:t, :u, 'U') RETURNING id"
            ),
            {"t": studios[session_in_studio], "u": user_id},
        )
    ).scalar_one()
    await conn.execute(
        text("INSERT INTO rsvps (session_id, participant_id, status) VALUES (:s, :p, 'going')"),
        {"s": session_id, "p": participant_id},
    )
    return studios[session_in_studio]


def test_same_studio_keys_backfill_the_rsvps_studio(alembic_cfg, test_db_url):
    async def read(conn):
        return (await conn.execute(text("SELECT tenant_id FROM rsvps"))).scalars().all()

    try:
        command.downgrade(alembic_cfg, "base")
        command.upgrade(alembic_cfg, BEFORE_SAME_STUDIO_KEYS)
        studio = asyncio.run(
            _run(test_db_url, lambda conn: _insert_old_schema_rows(conn, "a", "a"))
        )
        command.upgrade(alembic_cfg, "head")
        backfilled = asyncio.run(_run(test_db_url, read))
    finally:
        command.downgrade(alembic_cfg, "base")  # drops this test's rows; fixtures re-upgrade

    assert backfilled == [studio]


def test_the_migration_refuses_existing_rows_that_cross_studios(alembic_cfg, test_db_url):
    async def current_revision(conn):
        return (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()

    try:
        command.downgrade(alembic_cfg, "base")
        command.upgrade(alembic_cfg, BEFORE_SAME_STUDIO_KEYS)
        # A session in studio a that uses a class type of studio b: possible before 27b.
        asyncio.run(_run(test_db_url, lambda conn: _insert_old_schema_rows(conn, "a", "b")))
        with pytest.raises(DBAPIError):
            command.upgrade(alembic_cfg, "head")
        revision = asyncio.run(_run(test_db_url, current_revision))
    finally:
        command.downgrade(alembic_cfg, "base")

    # The failed migration rolled back completely (DDL is transactional in Postgres).
    assert revision == BEFORE_SAME_STUDIO_KEYS
