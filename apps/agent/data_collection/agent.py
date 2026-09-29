"""Data Collection Agent (deepagents, scope: collect + validate + store)."""

from __future__ import annotations

from typing import Any

from deepagents import create_deep_agent

from settings import load_settings

from .expiry_tools import (
    fetch_expired_future_contracts,
    fetch_expired_option_contracts,
    fetch_expiries,
)
from .history_tools import acquire_dataset
from .prompt import SYSTEM_PROMPT
from .search_tools import fetch_option_contracts, search_instruments
from .subagents import (
    FILESYSTEM_DENY_ALL,
    capture_controller_spec,
    filesystem_locked_middleware,
    market_info_spec,
    market_status_spec,
)

AGENT_NAME = "data_collection"


def resolve_model(spec: Any | None) -> Any | None:
    """Resolve a model spec to an invokable chat model.

    "nvidia/<model>" → ChatOpenAI via NVIDIA Integrate API (needs
    NVIDIA_API_KEY in env, never logged). Anything else passes through
    for the framework's own provider resolution.
    """
    if not isinstance(spec, str) or not spec.startswith("nvidia/"):
        return spec
    import os

    from langchain_openai import ChatOpenAI
    from pydantic import SecretStr

    if not os.environ.get("NVIDIA_API_KEY"):
        raise RuntimeError("NVIDIA_API_KEY is not set; cannot use nvidia/* model")
    settings = load_settings()
    return ChatOpenAI(
        model=spec,
        base_url=settings.nvidia_base_url,
        api_key=SecretStr(os.environ["NVIDIA_API_KEY"]),
        temperature=0.0,
        request_timeout=300,
        max_retries=2,
    )  # type: ignore[call-arg]  # installed stubs lag runtime kwargs


def build_data_collection_agent(model: Any):  # type: ignore[no-untyped-def]
    """Build the agent. An explicit model is required (no silent default)."""
    resolved = resolve_model(model)
    if resolved is None:
        raise RuntimeError(
            "No model configured: pass a model explicitly or set AGENT_MODEL."
        )
    settings = load_settings()
    subagent_model = (
        resolve_model(settings.subagent_model)
        if settings.subagent_model
        else None
    )
    return create_deep_agent(
        model=resolved,
        # Collection tools live on the main agent: one call per operation,
        # no delegation round-trips. Error-as-result + hint in every tool
        # is the retry-loop protection (see prompt: fix once, then report).
        # Only snapshot context (OI/smartlists, status) stays delegated.
        tools=[
            search_instruments,
            fetch_option_contracts,
            fetch_expiries,
            fetch_expired_option_contracts,
            fetch_expired_future_contracts,
            acquire_dataset,
        ],
        system_prompt=SYSTEM_PROMPT,
        # Locked fs middleware REPLACES the default by name: only read_file
        # stays in the model schema (framework minimum), still denied at
        # call time. permissions=[...] is kept so subagents inherit the
        # same deny rule when their specs omit permissions.
        middleware=[filesystem_locked_middleware()],  # type: ignore[list-item]  # stubs lag runtime generics
        subagents=[
            market_info_spec(subagent_model),
            market_status_spec(subagent_model),
            capture_controller_spec(subagent_model),
        ],
        name=AGENT_NAME,
        permissions=[FILESYSTEM_DENY_ALL],
    )
