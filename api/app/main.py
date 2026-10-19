from typing import Annotated

from fastapi import Depends, FastAPI
from scalar_fastapi import get_scalar_api_reference
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import router as auth_router
from app.class_types import router as class_types_router
from app.db import get_session
from app.me import router as me_router
from app.sessions import router as sessions_router

app = FastAPI(title="Studio API")
app.include_router(auth_router)  # getting a token: login
app.include_router(me_router)  # the logged-in user's own data
app.include_router(class_types_router)  # what a studio offers (BJJ, Pilates...)
app.include_router(sessions_router)  # one occurrence of a class: when, and who teaches


@app.get("/health")
async def health(session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, str]:
    await session.execute(text("SELECT 1"))
    return {"status": "ok"}


# An alternative docs page with a dark mode, next to Swagger (/docs) and ReDoc (/redoc).
# To remove: delete this route and `uv remove scalar-fastapi`.
@app.get("/scalar", include_in_schema=False)
async def scalar_docs():
    return get_scalar_api_reference(openapi_url=app.openapi_url, title=app.title, telemetry=False)
