"""Data Collection Agent package (collect + validate + store only)."""

from __future__ import annotations

from .agent import (
    AGENT_NAME,
    FILESYSTEM_DENY_ALL,
    build_data_collection_agent,
    resolve_model,
)
from .expiry_tools import (
    fetch_expired_future_contracts,
    fetch_expired_option_contracts,
    fetch_expiries,
)
from .history_tools import acquire_dataset, fetch_historical, validate_dataset
from .market_tools import (
    get_change_oi,
    get_exchange_status,
    get_futures_smartlist,
    get_market_holidays,
    get_market_timings,
    get_max_pain,
    get_oi,
    get_options_smartlist,
    get_pcr,
)
from .prompt import SYSTEM_PROMPT
from .search_tools import fetch_option_contracts, search_instruments
from .subagents import (
    MARKET_INFO_NAME,
    MARKET_STATUS_NAME,
    market_info_spec,
    market_status_spec,
)

__all__ = [
    "AGENT_NAME",
    "FILESYSTEM_DENY_ALL",
    "MARKET_INFO_NAME",
    "MARKET_STATUS_NAME",
    "SYSTEM_PROMPT",
    "acquire_dataset",
    "build_data_collection_agent",
    "fetch_expired_future_contracts",
    "fetch_expired_option_contracts",
    "fetch_expiries",
    "fetch_historical",
    "fetch_option_contracts",
    "get_change_oi",
    "get_exchange_status",
    "get_futures_smartlist",
    "get_market_holidays",
    "get_market_timings",
    "get_max_pain",
    "get_oi",
    "get_options_smartlist",
    "get_pcr",
    "market_info_spec",
    "market_status_spec",
    "resolve_model",
    "search_instruments",
    "validate_dataset",
]
