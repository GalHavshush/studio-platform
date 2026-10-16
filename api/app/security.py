import uuid
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.config import get_settings

# recommended() = argon2id with library defaults. Each hash embeds its own random salt and
# parameters, so verify needs only the stored string.
_hasher = PasswordHash.recommended()

ACCESS_TOKEN_TTL = timedelta(minutes=15)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _hasher.verify(password, password_hash)


# Verified against when the email is unknown, so "no such user" costs as much time as
# "wrong password" and response timing doesn't reveal which emails exist.
DUMMY_HASH = hash_password("not-a-real-password")


def create_access_token(user_id: uuid.UUID) -> str:
    """Signed JWT: sub = who, iat = issued at, exp = expiry (PyJWT turns datetimes into epoch seconds)."""
    now = datetime.now(UTC)
    claims = {"sub": str(user_id), "iat": now, "exp": now + ACCESS_TOKEN_TTL}
    return jwt.encode(claims, get_settings().jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> uuid.UUID:
    """Return the user id in a valid token; raise jwt.ExpiredSignatureError / InvalidTokenError.

    algorithms is pinned: never let the token's own header choose how it is verified.
    The signature and exp are checked by PyJWT; "require" rejects tokens missing either claim.
    """
    claims = jwt.decode(
        token,
        get_settings().jwt_secret,
        algorithms=["HS256"],
        options={"require": ["exp", "sub"]},
    )
    try:
        return uuid.UUID(claims["sub"])
    except ValueError as e:
        raise jwt.InvalidTokenError("sub is not a user id") from e
