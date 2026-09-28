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
from .history_tools import fetch_historical, validate_dataset
from .market_tools import (
    get_change_oi,
    get_futures_smartlist,
    get_max_pain,
    get_oi,
    get_options_smartlist,
    get_pcr,
)
from .prompt import SYSTEM_PROMPT
from .search_tools import fetch_option_contracts, search_instruments
from .subagents import (
    EXPIRY_FETCHER_NAME,
    HISTORY_FETCHER_NAME,
    INSTRUMENT_FINDER_NAME,
    MARKET_INFO_NAME,
    expiry_fetcher_spec,
    history_fetcher_spec,
    instrument_finder_spec,
    market_info_spec,
)

__all__ = [
    "AGENT_NAME",
    "EXPIRY_FETCHER_NAME",
    "FILESYSTEM_DENY_ALL",
    "HISTORY_FETCHER_NAME",
    "INSTRUMENT_FINDER_NAME",
    "MARKET_INFO_NAME",
    "SYSTEM_PROMPT",
    "build_data_collection_agent",
    "expiry_fetcher_spec",
    "fetch_expired_future_contracts",
    "fetch_expired_option_contracts",
    "fetch_expiries",
    "fetch_historical",
    "fetch_option_contracts",
    "get_change_oi",
    "get_futures_smartlist",
    "get_max_pain",
    "get_oi",
    "get_options_smartlist",
    "get_pcr",
    "history_fetcher_spec",
    "instrument_finder_spec",
    "market_info_spec",
    "resolve_model",
    "search_instruments",
    "validate_dataset",
]
