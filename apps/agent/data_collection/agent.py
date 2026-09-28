"""Data Collection Agent (deepagents, scope: collect + validate + store)."""

from __future__ import annotations

from typing import Any

from deepagents import create_deep_agent
from deepagents.middleware.filesystem import FilesystemPermission

from .prompt import SYSTEM_PROMPT
from .subagents import (
    expiry_fetcher_spec,
    history_fetcher_spec,
    instrument_finder_spec,
    market_info_spec,
)

AGENT_NAME = "data_collection"

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

# The framework adds built-in filesystem tools by default. This agent must
# never touch host files: deny all filesystem operations explicitly.
FILESYSTEM_DENY_ALL = FilesystemPermission(
    operations=["read", "write"],
    paths=["/"],
    mode="deny",
)


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
    return ChatOpenAI(
        model=spec,
        base_url=NVIDIA_BASE_URL,
        api_key=SecretStr(os.environ["NVIDIA_API_KEY"]),
        temperature=0.0,
    )


def build_data_collection_agent(model: Any | None = None):  # type: ignore[no-untyped-def]
    """Build the agent. Model required only to invoke, not to build."""
    return create_deep_agent(
        model=resolve_model(model),
        # No direct data tools: the main agent MUST delegate to subagents.
        # Giving it tools invites direct-call retry loops instead of routing.
        tools=[],
        system_prompt=SYSTEM_PROMPT,
        subagents=[
            instrument_finder_spec(),
            history_fetcher_spec(),
            expiry_fetcher_spec(),
            market_info_spec(),
        ],
        name=AGENT_NAME,
        permissions=[FILESYSTEM_DENY_ALL],
    )
