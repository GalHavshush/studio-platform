from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    # Signs access tokens (HS256). Anyone holding it can mint tokens, so it never lives in git.
    jwt_secret: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
