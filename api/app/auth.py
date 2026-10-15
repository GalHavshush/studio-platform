from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import User
from app.security import DUMMY_HASH, create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login")
async def login(
    body: LoginRequest, session: Annotated[AsyncSession, Depends(get_session)]
) -> TokenResponse:
    user = await session.scalar(select(User).where(User.email == body.email.strip().lower()))
    # Always run one argon2 verify, in a thread: it is deliberately slow and would otherwise
    # block the event loop (every other request) while it runs.
    stored = user.password_hash if user and user.password_hash else DUMMY_HASH
    password_ok = await run_in_threadpool(verify_password, body.password, stored)

    # One identical error for unknown email, wrong password and no-password users: no enumeration.
    if not (user and user.password_hash and password_ok):
        raise HTTPException(
            status_code=401,
            detail="invalid_credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return TokenResponse(access_token=create_access_token(user.id))
