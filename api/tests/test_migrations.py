from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from app.config import get_settings


# Plain `def`, not `async`: env.py calls asyncio.run(), which can't run inside the
# event loop pytest-asyncio keeps open for async tests.
@pytest.fixture
def alembic_cfg(monkeypatch, test_db_url) -> Config:
    # env.py reads DATABASE_URL via get_settings(), so aim it at the test database.
    monkeypatch.setenv("DATABASE_URL", test_db_url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    yield Config(str(Path(__file__).parents[1] / "alembic.ini"))
    get_settings.cache_clear()  # the monkeypatched env is undone after this; drop the cached copy


def test_migrations_upgrade_and_downgrade_cleanly(alembic_cfg):
    command.upgrade(alembic_cfg, "head")
    command.downgrade(alembic_cfg, "base")
