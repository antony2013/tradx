"""Data Collection Agent package (collect + validate + store only)."""

from __future__ import annotations

from .agent import (
    AGENT_NAME,
    FILESYSTEM_DENY_ALL,
    build_data_collection_agent,
    resolve_model,
)
from .capture_tools import (
    get_capture_stats,
    get_capture_status,
    get_subscriptions,
    start_capture,
    stop_capture,
    update_subscriptions,
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
from .quote_tools import (
    get_full_quotes,
    get_ltp_quotes,
    get_ohlc_quotes,
    get_option_greeks,
)
from .search_tools import fetch_option_contracts, search_instruments
from .subagents import (
    CAPTURE_CONTROLLER_NAME,
    MARKET_INFO_NAME,
    MARKET_QUOTES_NAME,
    MARKET_STATUS_NAME,
    capture_controller_spec,
    filesystem_locked_middleware,
    market_info_spec,
    market_quotes_spec,
    market_status_spec,
)

__all__ = [
    "AGENT_NAME",
    "CAPTURE_CONTROLLER_NAME",
    "FILESYSTEM_DENY_ALL",
    "MARKET_INFO_NAME",
    "MARKET_QUOTES_NAME",
    "MARKET_STATUS_NAME",
    "SYSTEM_PROMPT",
    "acquire_dataset",
    "build_data_collection_agent",
    "capture_controller_spec",
    "fetch_expired_future_contracts",
    "fetch_expired_option_contracts",
    "fetch_expiries",
    "fetch_historical",
    "fetch_option_contracts",
    "filesystem_locked_middleware",
    "get_capture_stats",
    "get_capture_status",
    "get_change_oi",
    "get_exchange_status",
    "get_full_quotes",
    "get_futures_smartlist",
    "get_ltp_quotes",
    "get_market_holidays",
    "get_market_timings",
    "get_max_pain",
    "get_ohlc_quotes",
    "get_oi",
    "get_option_greeks",
    "get_options_smartlist",
    "get_pcr",
    "get_subscriptions",
    "market_info_spec",
    "market_quotes_spec",
    "market_status_spec",
    "resolve_model",
    "search_instruments",
    "start_capture",
    "stop_capture",
    "update_subscriptions",
    "validate_dataset",
]
