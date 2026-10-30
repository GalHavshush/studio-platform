import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
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
from app.models import Membership, Participant, Tenant, User
from app.security import create_access_token
from app.seed import seed

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
def alembic_cfg(monkeypatch, test_db_url: URL) -> Iterator[Config]:
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
async def committed_db(test_db_url: URL, migrated_db) -> AsyncIterator[URL]:
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


@pytest.fixture
async def committed_engine(committed_db: URL):
    """An engine on the test database with the pilot studio really committed (see committed_db)."""
    engine = create_async_engine(committed_db, poolclass=NullPool)
    async with AsyncSession(engine) as session:
        await seed(session)
        await session.commit()
    yield engine
    await engine.dispose()


@pytest.fixture
def wait_for_lock_wait():
    """Returns an async function that polls Postgres until some connection is blocked on a lock,
    so tests prove "it is waiting" without sleeping and hoping. It returns the moment a wait shows
    up, so the generous timeout only costs time when the test is about to fail; a slow CI runner
    needed more than 5 seconds for the request to even reach the lock."""

    async def wait(engine, timeout: float = 20.0) -> None:
        deadline = asyncio.get_running_loop().time() + timeout
        async with engine.connect() as conn:
            while asyncio.get_running_loop().time() < deadline:
                waiting = await conn.scalar(
                    text("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'")
                )
                if waiting:
                    return
                await asyncio.sleep(0.02)
        raise AssertionError("nothing ever started waiting on a lock")

    return wait


# --- tenant isolation harness: see tests/test_tenant_isolation.py ---


@dataclass
class Studio:
    id: uuid.UUID
    # role -> id of a user who holds exactly that role in this studio. Ids, not User objects:
    # an endpoint's commit expires ORM objects, and reading one afterwards fails in async code.
    users: dict[str, uuid.UUID]


@dataclass
class TwoTenants:
    a: Studio
    b: Studio

    def headers(self, user_id: uuid.UUID, tenant_id: uuid.UUID) -> dict[str, str]:
        """Request headers for a user acting in `tenant_id` (their own studio or someone else's)."""
        return {
            "Authorization": f"Bearer {create_access_token(user_id)}",
            "X-Tenant-Id": str(tenant_id),
        }


@pytest.fixture
async def two_tenants(db_session: AsyncSession) -> TwoTenants:
    """Two studios, each with its own owner, coach and member. Later steps add data to both and
    assert that one studio never sees the other's."""
    studios = []
    for slug in ("studio-a", "studio-b"):
        tenant = Tenant(name=slug, slug=slug, timezone="UTC")
        users = {
            role: User(email=f"{role}@{slug}.example.com", name=f"{role} of {slug}")
            for role in ("owner", "coach", "member")
        }
        db_session.add(tenant)
        db_session.add_all(users.values())
        await db_session.flush()
        db_session.add_all(
            Membership(tenant_id=tenant.id, user_id=user.id, role=role)
            for role, user in users.items()
        )
        # Every membership has a participant, as the seed and the migration guarantee.
        db_session.add_all(
            Participant(tenant_id=tenant.id, user_id=user.id, name=user.name)
            for user in users.values()
        )
        studios.append(Studio(id=tenant.id, users={role: user.id for role, user in users.items()}))
    await db_session.flush()
    return TwoTenants(a=studios[0], b=studios[1])


def treated_as_stranger(response) -> bool:
    """401, or the 403 `not_a_member` that TenantCtx gives to someone outside the studio."""
    if response.status_code == 401:
        return True
    return response.status_code == 403 and response.json() == {"detail": "not_a_member"}


@pytest.fixture
def assert_tenant_isolation(two_tenants: TwoTenants):
    """Returns `check(send)`; `send(headers)` performs one request against the endpoint under test.

    Every user of each studio, owners included, must get 403 `not_a_member` when naming the other
    studio. Each user must also be accepted as a member of their own studio (a role too low for the
    endpoint is fine): without that control the check would pass for an endpoint that simply
    refuses everybody.
    """

    async def check(send) -> None:
        for mine, theirs in ((two_tenants.a, two_tenants.b), (two_tenants.b, two_tenants.a)):
            for role, user_id in mine.users.items():
                own = await send(two_tenants.headers(user_id, mine.id))
                # A role too low for the endpoint (403 insufficient_role) is fine: this user is
                # still a member. Being treated as a stranger in their own studio is not.
                assert not treated_as_stranger(own), (
                    f"a {role} was treated as a stranger in their own studio ({own.status_code}): "
                    "the endpoint is broken, so the isolation result would mean nothing"
                )
                foreign = await send(two_tenants.headers(user_id, theirs.id))
                assert foreign.status_code == 403 and foreign.json() == {
                    "detail": "not_a_member"
                }, f"a {role} of one studio got {foreign.status_code} when naming another studio"

    return check
