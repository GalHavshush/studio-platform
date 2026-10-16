from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import router as auth_router
from app.db import get_session
from app.me import router as me_router

app = FastAPI(title="Studio API")
app.include_router(auth_router)  # getting a token: login
app.include_router(me_router)  # the logged-in user's own data


@app.get("/health")
async def health(session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, str]:
    await session.execute(text("SELECT 1"))
    return {"status": "ok"}
