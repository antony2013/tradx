"""Subagent specs: key finder, history fetcher, expiry fetcher (isolated)."""

from __future__ import annotations

from typing import cast

from deepagents.middleware.subagents import SubAgent

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
from .search_tools import fetch_option_contracts, search_instruments

INSTRUMENT_FINDER_NAME = "instrument_key_finder"
HISTORY_FETCHER_NAME = "history_data_fetcher"
EXPIRY_FETCHER_NAME = "expiry_data_fetcher"
MARKET_INFO_NAME = "market_information"

# Core rules every isolated subagent carries (they cannot see the parent
# prompt, so the essentials are duplicated here in compact form).
CORE_RULES = """\
Core rules (always apply): never invent or fabricate data — only report
tool-verified values; never trade, analyse, or recommend; on error, fix
parameters from the tool hint and retry once, then report honestly."""


def instrument_finder_spec() -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    return cast(
        SubAgent,
        {
        "name": INSTRUMENT_FINDER_NAME,
        "description": (
            "Resolves stocks, indices, futures and option contracts to verified "
            "canonical Upstox instrument_key values via instrument search. "
            "Delegate whenever an instrument_key is needed and not already verified."
        ),
        "system_prompt": """\
You resolve human instrument descriptions to canonical Upstox instrument_key values.
Rules:
1. ALWAYS call search_instruments (and fetch_option_contracts for expiry
   chains) first — never invent, guess, or complete an instrument_key.
2. For single-strike / ATM lookups pass records="5" (ATM ± 2 is enough).
3. If vague (no expiry/strike/type), return what is missing; do not pick
   a random contract.
4. Return ONLY verified rows: instrument_key, trading_symbol, expiry,
   strike_price, lot_size. Empty result is a valid answer.
5. Keep segments straight (NSE_INDEX vs NSE_EQ vs NSE_FO).
6. When instrument_types is set, segments must be concrete (FO or OPT).
""" + CORE_RULES,
        "mode": "isolated",
        "tools": [search_instruments, fetch_option_contracts],
        },
    )


def history_fetcher_spec() -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    return cast(
        SubAgent,
        {
        "name": HISTORY_FETCHER_NAME,
        "description": (
            "Acquires (or reuses) historical OHLCV candle datasets for a verified "
            "instrument key over a date range and interval, then validates them. "
            "Delegate whenever candles are needed."
        ),
        "system_prompt": """\
You acquire historical candle datasets through fetch_historical, then validate
them through validate_dataset.
Rules:
1. The instrumentKey MUST already be verified — never invent one.
2. Call fetch_historical with exact from/to dates and a supported interval.
   On error, fix parameters from its hint and retry once.
3. Always follow with validate_dataset and report its verdict (VALID /
   INVALID / INCOMPLETE), completeness, and gaps.
4. Report ONLY the dataset record + verdict. Never fabricate candle values.
5. PARTIAL/FAILED means re-request later to resume — say so explicitly.
""" + CORE_RULES,
        "mode": "isolated",
        "tools": [fetch_historical, validate_dataset],
        },
    )


def expiry_fetcher_spec() -> SubAgent:
    # cast: installed stubs lag the runtime TypedDict (which has "mode").
    return cast(
        SubAgent,
        {
            "name": EXPIRY_FETCHER_NAME,
            "description": (
                "Collects expired-instrument data: expiries, expired option/future "
                "contracts, and expired-candle datasets. Delegate for any "
                "expiry-driven history work."
            ),
            "system_prompt": """\
You collect expired-instrument data.
Rules:
1. Start from fetch_expiries for the underlying; derive everything from it.
2. Use fetch_expired_option_contracts / fetch_expired_future_contracts with
   an already-expired expiry_date to get date-suffixed contract keys.
3. For candles of an expired key, call fetch_historical with the
   date-suffixed key, then validate_dataset — expired rows are stored and
   validated like any dataset, never pasted into context.
4. Report keys, dataset_ids, verdicts, and empty results honestly
   (empty = no contracts, not an error). Never fabricate candles or keys.
""" + CORE_RULES,
        "mode": "isolated",
        "tools": [
            fetch_expiries,
            fetch_expired_option_contracts,
            fetch_expired_future_contracts,
            fetch_historical,
            validate_dataset,
        ],
        },
    )


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
