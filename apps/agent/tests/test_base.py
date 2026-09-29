"""Base checks (no external services)."""

from _pytest.monkeypatch import MonkeyPatch


def test_settings() -> None:
    from settings import load_settings

    assert load_settings().app_name == "tradex-agent"


def test_settings_defaults() -> None:
    import os

    from settings import load_settings

    os.environ.pop("TRADX_API_URL", None)
    assert load_settings().tradx_api_url == "http://localhost:3000"
    assert (
        load_settings().nvidia_base_url == "https://integrate.api.nvidia.com/v1"
    )
    assert load_settings().agent_model == ""
    assert load_settings().subagent_model == ""


def test_settings_env_override(monkeypatch: MonkeyPatch) -> None:
    from settings import load_settings

    monkeypatch.setenv("TRADX_API_URL", "http://example:4000")
    assert load_settings().tradx_api_url == "http://example:4000"


def test_dotenv_available() -> None:
    import dotenv

    assert dotenv is not None
