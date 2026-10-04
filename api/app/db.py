from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.config import get_settings


# Created on first use, not at import, so importing the app doesn't require DATABASE_URL.
@lru_cache
def get_engine() -> AsyncEngine:
    return create_async_engine(get_settings().database_url)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with AsyncSession(get_engine()) as session:
        yield session
