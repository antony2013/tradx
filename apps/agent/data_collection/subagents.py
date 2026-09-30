"""Subagent specs: market snapshots + capture control (isolated)."""

from __future__ import annotations

from typing import Any, cast

from deepagents.middleware.filesystem import (
    FilesystemMiddleware,
    FilesystemPermission,
)
from deepagents.middleware.subagents import SubAgent

from .capture_tools import (
    get_capture_stats,
    get_capture_status,
    get_subscriptions,
    start_capture,
    stop_capture,
    update_subscriptions,
)
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
from .quote_tools import (
    get_full_quotes,
    get_ltp_quotes,
    get_ohlc_quotes,
    get_option_greeks,
)

MARKET_INFO_NAME = "market_information"
MARKET_STATUS_NAME = "market_status"
CAPTURE_CONTROLLER_NAME = "capture_controller"
MARKET_QUOTES_NAME = "market_quotes"

# Core rules every isolated subagent carries (they cannot see the parent
# prompt, so the essentials are duplicated here in compact form).
CORE_RULES = """\
Core rules (always apply): never invent or fabricate data — only report
tool-verified values; never trade, analyse, or recommend; on error, fix
parameters from the tool hint and retry once, then report honestly."""

# Filesystem is denied at build time (paths ["/"]). Lives here so both the
# main agent and every subagent share the identical rule object.
FILESYSTEM_DENY_ALL = FilesystemPermission(
    operations=["read", "write"],
    paths=["/"],
    mode="deny",
)


def filesystem_locked_middleware() -> FilesystemMiddleware:
    """FilesystemMiddleware exposing the smallest allowed schema.

    The framework requires read_file in any allowlist, so one fs tool
    remains VISIBLE but the deny rule above still blocks it at call time.
    Defense in depth: schema-hiding cuts per-call bytes; the permission
    blocks any attempt. Replaces the default middleware by name.
    (_permissions is private in 0.7.19; it mirrors what
    create_deep_agent(permissions=[...]) wires into the default instance.)
    """
    return FilesystemMiddleware(
        tools=["read_file"],
        _permissions=[FILESYSTEM_DENY_ALL],
    )  # type: ignore[call-arg]  # installed stubs lag 0.7.19 runtime kwargs


def market_info_spec(model: Any = None) -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    spec: dict = {
            "name": MARKET_INFO_NAME,
            "description": (
                "Reads market-information analytics: option/futures smartlists, "
                "open interest, change in OI, max pain, and put-call ratio. "
                "Delegate whenever positioning or sentiment context is needed."
            ),
            "system_prompt": """\
You read market-information analytics through the market tools.
Rules:
1. Smartlists need asset_type (INDEX|STOCK|COMMODITY) + category.
2. OI analytics need underlying key + expiry + date; max-pain and PCR
   REQUIRE bucket_interval (minutes) — upstream rejects without it.
3. Report the returned numbers verbatim with their timestamps. Never
   compute your own ratios from partial rows; use the reported pcr/max_pain.
4. These are point-in-time snapshots for context, not signals. Never
   present them as trade recommendations.
""" + CORE_RULES,
        "mode": "isolated",
        "middleware": [filesystem_locked_middleware()],
        "tools": [
            get_options_smartlist,
            get_futures_smartlist,
            get_oi,
            get_change_oi,
            get_max_pain,
            get_pcr,
        ],
    }
    # A distinct cheap/fast model for snapshot duty; absent key inherits
    # the main agent's model (framework default).
    if model is not None:
        spec["model"] = model
    return cast(SubAgent, spec)


def market_status_spec(model: Any = None) -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    spec: dict = {
        "name": MARKET_STATUS_NAME,
            "description": (
                "Reads market-status facts: live exchange status, session "
                "timings for a date, and the exchange holiday list. "
                "Delegate whenever open/closed state, session bounds, or "
                "holiday context is needed."
            ),
            "system_prompt": """\
You read market-status facts through the market-status tools.
Rules:
1. get_exchange_status needs one exchange (NSE, BSE, MCX).
2. get_market_timings needs a YYYY-MM-DD date; times are epoch ms.
3. get_market_holidays takes an optional date; omit it for the full
   list (capped at 100 with a truncation flag).
4. Report values verbatim with their timestamps. Holidays are context
   for gap analysis — never reclassify a validation verdict yourself.
5. Snapshots only, never persisted. Never present them as trade
   recommendations.
""" + CORE_RULES,
        "mode": "isolated",
        "middleware": [filesystem_locked_middleware()],
        "tools": [
            get_exchange_status,
            get_market_timings,
            get_market_holidays,
        ],
    }
    if model is not None:
        spec["model"] = model
    return cast(SubAgent, spec)


def market_quotes_spec(model: Any = None) -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    spec: dict = {
        "name": MARKET_QUOTES_NAME,
        "description": (
            "Reads V3 market quotes: full quotes, OHLC, LTP, and option "
            "Greeks for one or many instrument keys. Delegate whenever "
            "current prices or Greeks are needed."
        ),
        "system_prompt": """\
You read V3 market quotes through the quote tools.
Rules:
1. instrument_keys takes comma-separated canonical keys (up to 500;
   50 for Greeks).
2. get_ohlc_quotes interval is optional ("1d"|"I1"|"I30").
3. Report values verbatim with their timestamps. Greeks may come back
   empty outside Plus/session — report that as-is, never fabricate.
4. Snapshots only, never persisted. Never present them as trade
   recommendations.
""" + CORE_RULES,
        "mode": "isolated",
        "middleware": [filesystem_locked_middleware()],
        "tools": [
            get_full_quotes,
            get_ohlc_quotes,
            get_ltp_quotes,
            get_option_greeks,
        ],
    }
    if model is not None:
        spec["model"] = model
    return cast(SubAgent, spec)


def capture_controller_spec(model: Any = None) -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    spec: dict = {
        "name": CAPTURE_CONTROLLER_NAME,
        "description": (
            "Operates the live capture feed: state/stats inspection, "
            "runtime subscription changes, and manual start/stop. "
            "Delegate whenever live-feed state or control is needed."
        ),
        "system_prompt": """\
You operate the live capture feed through the capture tools.
Rules:
1. The server never auto-starts: start_capture ONLY on an explicit user
   request to go live. Never start speculatively.
2. Report capture_state verbatim (STOPPED/CONNECTING/CONNECTED/...).
3. update_subscriptions needs action ("sub"|"unsub") + canonical
   "SEGMENT|id" keys; report added/removed/missing/invalid honestly.
4. stop_capture flushes first and is safe when already stopped.
5. Snapshots only, never persisted. Never present feed state as trade
   recommendations.
""" + CORE_RULES,
        "mode": "isolated",
        "middleware": [filesystem_locked_middleware()],
        "tools": [
            get_capture_status,
            get_capture_stats,
            get_subscriptions,
            update_subscriptions,
            start_capture,
            stop_capture,
        ],
    }
    if model is not None:
        spec["model"] = model
    return cast(SubAgent, spec)
