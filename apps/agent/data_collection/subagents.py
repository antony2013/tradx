"""Subagent specs: market info + status snapshots (isolated)."""

from __future__ import annotations

from typing import cast

from deepagents.middleware.subagents import SubAgent

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

MARKET_INFO_NAME = "market_information"
MARKET_STATUS_NAME = "market_status"

# Core rules every isolated subagent carries (they cannot see the parent
# prompt, so the essentials are duplicated here in compact form).
CORE_RULES = """\
Core rules (always apply): never invent or fabricate data — only report
tool-verified values; never trade, analyse, or recommend; on error, fix
parameters from the tool hint and retry once, then report honestly."""


def market_info_spec() -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    return cast(
        SubAgent,
        {
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
            "tools": [
                get_options_smartlist,
                get_futures_smartlist,
                get_oi,
                get_change_oi,
                get_max_pain,
                get_pcr,
            ],
        },
    )


def market_status_spec() -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    return cast(
        SubAgent,
        {
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
            "tools": [
                get_exchange_status,
                get_market_timings,
                get_market_holidays,
            ],
        },
    )
