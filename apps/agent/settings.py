"""Base settings (pydantic-settings, .env supported, no secrets)."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = Field(default="tradex-agent")


def load_settings() -> Settings:
    return Settings()
