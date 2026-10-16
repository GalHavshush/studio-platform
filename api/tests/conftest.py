import asyncio
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.db import get_engine, get_session
from app.main import app

TEST_DB_NAME = "studio_test"


@pytest.fixture(scope="session")
def test_db_url() -> URL:
    """Create the throwaway test database (once per run) next to the dev one."""
    admin_url = make_url(get_settings().database_url)

    async def create_if_missing() -> None:
        # CREATE DATABASE can't run inside a transaction, hence AUTOCOMMIT.
        # NullPool: no pooled connections, so nothing lingers on a closed event loop.
        engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
        async with engine.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
        await engine.dispose()

    asyncio.run(create_if_missing())
    return admin_url.set(database=TEST_DB_NAME)


# Plain `def`, not `async`: env.py calls asyncio.run(), which can't run inside the
# event loop pytest-asyncio keeps open for async tests.
@pytest.fixture
def alembic_cfg(monkeypatch, test_db_url: URL) -> Config:
    # env.py reads DATABASE_URL via get_settings(), so aim it at the test database.
    monkeypatch.setenv("DATABASE_URL", test_db_url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    yield Config(str(Path(__file__).parents[1] / "alembic.ini"))
    get_settings.cache_clear()  # the monkeypatched env is undone after this; drop the cached copy


@pytest.fixture
def migrated_db(alembic_cfg: Config) -> None:
    """Bring the test database to the latest schema, using the real migrations."""
    command.upgrade(alembic_cfg, "head")


@pytest.fixture
async def db_session(test_db_url: URL, migrated_db):
    engine = create_async_engine(test_db_url, poolclass=NullPool)
    async with engine.connect() as conn:
        outer = await conn.begin()
        # Endpoints call session.commit(). With create_savepoint that only releases a SAVEPOINT,
        # so the outer transaction is still open and rolling it back undoes everything.
        session = AsyncSession(bind=conn, join_transaction_mode="create_savepoint")
        yield session
        await session.close()
        await outer.rollback()
    await engine.dispose()


@pytest.fixture
async def client(db_session: AsyncSession):
    # Swap the app's real DB session for the test one; the endpoint code doesn't change.
    async def override_get_session():
        return db_session

    app.dependency_overrides[get_session] = override_get_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


# --- real commits, for the few tests that need them (rollback, concurrency) ---


async def _clear_tables(url: URL) -> None:
    engine = create_async_engine(url, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE users, tenants CASCADE"))
    await engine.dispose()


@pytest.fixture
async def committed_db(test_db_url: URL, migrated_db) -> URL:
    """The test database for tests that really commit; every other test rolls back instead.

    Clears whole tables before and after: acceptable only because this is the dedicated test
    database, hence the name check.
    ponytail: assumes tests run one at a time; parallel workers (pytest-xdist) would each need a
    database of their own.
    """
    assert test_db_url.database == TEST_DB_NAME
    await _clear_tables(test_db_url)
    yield test_db_url
    await _clear_tables(test_db_url)


@pytest.fixture
async def real_client(committed_db: URL, alembic_cfg: Config):
    """A client that runs the app with its real get_session: one session per request, committed
    only when the endpoint commits, rolled back when it fails. alembic_cfg has already pointed
    DATABASE_URL at the test database; the cached engine must not outlive that."""
    get_engine.cache_clear()
    # raise_app_exceptions=False: an unhandled error comes back as a 500 response, like a server.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    await get_engine().dispose()
    get_engine.cache_clear()
