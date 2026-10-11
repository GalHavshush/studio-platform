from alembic import command


def test_migrations_upgrade_and_downgrade_cleanly(alembic_cfg):
    command.upgrade(alembic_cfg, "head")
    command.downgrade(alembic_cfg, "base")
    # Upgrading again only works if the downgrade really undid everything.
    command.upgrade(alembic_cfg, "head")
