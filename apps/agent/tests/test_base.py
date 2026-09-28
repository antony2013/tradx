"""Base checks (no external services)."""


def test_settings() -> None:
    from settings import load_settings

    assert load_settings().app_name == "tradex-agent"


def test_dotenv_available() -> None:
    import dotenv

    assert dotenv is not None
