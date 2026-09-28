"""Expired-instrument tools — API-reference grade details.

Upstream (all require Upstox Plus):
- GET /v2/expired-instruments/expiries?instrument_key=
- GET /v2/expired-instruments/option/contract + future/contract
Expired contract keys carry a date suffix: NSE_FO|58422|03-10-2024.
Expired CANDLES are fetched through fetch_historical with the
date-suffixed key (stored + validated like any dataset).
"""

from __future__ import annotations

import json
import urllib.parse

from langchain_core.tools import tool

from ._client import api_get, compact_rows


@tool(
    "fetch_expiries",
    description="""List weekly/monthly expiry dates for an underlying key.

INPUT: instrument_key (required, e.g. "NSE_INDEX|Nifty 50").
Upstream requires Upstox Plus. Derive expiries/lots/strikes from this —
never hardcode expiry weekdays or lot sizes.
EXPECTED OUTPUT: {"data": ["2024-10-03", ...]} (oldest → newest).""",
)
def fetch_expiries(instrument_key: str) -> str:
    """Fetch expiry dates; returns the upstream expiry list."""
    return json.dumps(
        api_get(
            f"/instruments/expiries?instrument_key={urllib.parse.quote(instrument_key, safe='')}"
        )
    )


@tool(
    "fetch_expired_option_contracts",
    description="""List EXPIRED CE/PE contracts for an underlying + expiry.

INPUT: instrument_key (underlying, required), expiry_date "YYYY-MM-DD"
(required, must be an already-expired date from fetch_expiries).
Upstream requires Upstox Plus.
EXPECTED OUTPUT: {"total": N, "truncated": bool, "contracts":
[{instrument_key (date-suffixed, e.g. "NSE_FO|58422|03-10-2024"),
trading_symbol, strike_price, instrument_type, lot_size, ...}, ...]}
(capped at 100 rows). Feed these keys to fetch_historical for candles.""",
)
def fetch_expired_option_contracts(instrument_key: str, expiry_date: str) -> str:
    """Fetch expired option chain; returns contracts with dated keys."""
    params = urllib.parse.urlencode(
        {"instrument_key": instrument_key, "expiry_date": expiry_date}
    )
    body = api_get(f"/instruments/expired-option-contracts?{params}")
    if "error" in body:
        return json.dumps(body)
    return json.dumps(compact_rows(body.get("data", []), 100, "contracts"))


@tool(
    "fetch_expired_future_contracts",
    description="""List EXPIRED futures for an underlying + expiry.

INPUT: instrument_key (underlying, required), expiry_date "YYYY-MM-DD"
(required, already-expired). Upstream requires Upstox Plus.
EXPECTED OUTPUT: {"total": N, "truncated": bool, "contracts": [...]}
(empty list for dates with no futures expiry — not an error).""",
)
def fetch_expired_future_contracts(instrument_key: str, expiry_date: str) -> str:
    """Fetch expired futures; returns contracts (possibly empty)."""
    params = urllib.parse.urlencode(
        {"instrument_key": instrument_key, "expiry_date": expiry_date}
    )
    body = api_get(f"/instruments/expired-future-contracts?{params}")
    if "error" in body:
        return json.dumps(body)
    return json.dumps(compact_rows(body.get("data", []), 100, "contracts"))
