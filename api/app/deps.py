from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import User
from app.security import decode_access_token

# auto_error=False: we raise our own 401 so every auth failure has the same shape. Declaring the
# scheme here is also what puts the Authorize button in /docs.
bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(code: str) -> HTTPException:
    return HTTPException(status_code=401, detail=code, headers={"WWW-Authenticate": "Bearer"})


async def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Resolve the Bearer token in the request to a User, or raise 401.

    Token checks (signature, expiry) need no DB; the lookup afterwards only loads the account.
    Codes: not_authenticated = no usable header, token_expired = refresh, invalid_token = log in again.
    """
    if credentials is None:
        raise _unauthorized("not_authenticated")
    try:
        user_id = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("token_expired")  # the app can refresh (step 13) instead of logging out
    except jwt.InvalidTokenError:
        raise _unauthorized("invalid_token")

    # A valid signature only proves we issued the token; the user may have been deleted since.
    user = await session.get(User, user_id)
    if user is None:
        raise _unauthorized("invalid_token")
    return user


# Endpoints write `user: CurrentUser` to require a logged-in user.
CurrentUser = Annotated[User, Depends(current_user)]
