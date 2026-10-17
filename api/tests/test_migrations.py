import asyncio
import uuid

from alembic import command
from sqlalchemy import text
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
