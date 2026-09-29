"""Base settings (pydantic-settings, .env supported, no secrets).

Non-secret runtime config in one place so tools and the agent do not
scatter raw os.environ reads. Secrets (UPSTOX_ACCESS_TOKEN, NVIDIA_API_KEY)
stay out — they are read directly from env where used and never logged.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = Field(default="tradex-agent")
    tradx_api_url: str = Field(default="http://localhost:3000")
    nvidia_base_url: str = Field(default="https://integrate.api.nvidia.com/v1")


def load_settings() -> Settings:
    return Settings()
