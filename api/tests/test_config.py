import pytest
from pydantic import ValidationError

from app.config import Settings


# _env_file=None below: ignore any real .env so results don't depend on the machine.
def test_settings_load_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@host/db")
    monkeypatch.setenv("JWT_SECRET", "s3cret")

    settings = Settings(_env_file=None)

    assert settings.database_url == "postgresql+asyncpg://u:p@host/db"
    assert settings.jwt_secret == "s3cret"


def test_settings_fail_clearly_when_database_url_missing(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("JWT_SECRET", "s3cret")

    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None)


def test_settings_fail_clearly_when_jwt_secret_missing(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@host/db")
    monkeypatch.delenv("JWT_SECRET", raising=False)

    with pytest.raises(ValidationError, match="jwt_secret"):
        Settings(_env_file=None)
