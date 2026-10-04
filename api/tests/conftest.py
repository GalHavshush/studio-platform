import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.db import get_session
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


@pytest.fixture
async def db_session(test_db_url: URL):
    engine = create_async_engine(test_db_url, poolclass=NullPool)
    async with AsyncSession(engine) as session:
        yield session
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
