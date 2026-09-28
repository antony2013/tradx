"""Expired-instrument tools — API-reference grade details.

Upstream (all require Upstox Plus):
- GET /v2/expired-instruments/expiries?instrument_key= (weekly/monthly dates)
- GET /v2/expired-instruments/option/contract?instrument_key=&expiry_date=
- GET /v2/expired-instruments/future/contract?instrument_key=&expiry_date=
- GET /v2/expired-instruments/historical-candle/{key}/{interval}/{to}/{from}
Expired contract keys carry a date suffix: NSE_FO|58422|03-10-2024.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from langchain_core.tools import tool

API_BASE = os.environ.get("TRADX_API_URL", "http://localhost:3000").rstrip("/")


def _get(path: str) -> dict:
    request = urllib.request.Request(
        f"{API_BASE}{path}", headers={"Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as http_error:
        try:
            detail = http_error.read().decode("utf-8", errors="replace")[:300]
        except Exception:  # noqa: BLE001
            detail = http_error.reason
        return {
            "error": f"rejected (HTTP {http_error.code}): {detail}",
            "hint": "Fix parameters and retry once; do not hammer on 4xx.",
        }
    except OSError as network_error:
        return {
            "error": f"unreachable: {network_error}",
            "hint": "Is the Tradex API running? Retry once before giving up.",
        }


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
        _get(f"/instruments/expiries?instrument_key={urllib.parse.quote(instrument_key, safe='')}")
    )


@tool(
    "fetch_expired_option_contracts",
    description="""List EXPIRED CE/PE contracts for an underlying + expiry.

INPUT: instrument_key (underlying, required), expiry_date "YYYY-MM-DD"
(required, must be an already-expired date from fetch_expiries).
Upstream requires Upstox Plus.
EXPECTED OUTPUT: {"data": [{instrument_key (date-suffixed, e.g.
"NSE_FO|58422|03-10-2024"), trading_symbol, strike_price, instrument_type,
lot_size, ...}, ...]}. Feed these keys to fetch_expired_candles.""",
)
def fetch_expired_option_contracts(instrument_key: str, expiry_date: str) -> str:
    """Fetch expired option chain; returns contracts with dated keys."""
    params = urllib.parse.urlencode(
        {"instrument_key": instrument_key, "expiry_date": expiry_date}
    )
    return json.dumps(_get(f"/instruments/expired-option-contracts?{params}"))


@tool(
    "fetch_expired_future_contracts",
    description="""List EXPIRED futures for an underlying + expiry.

INPUT: instrument_key (underlying, required), expiry_date "YYYY-MM-DD"
(required, already-expired). Upstream requires Upstox Plus.
EXPECTED OUTPUT: {"data": [{instrument_key, trading_symbol, ...}, ...]}
(empty list for dates with no futures expiry — not an error).""",
)
def fetch_expired_future_contracts(instrument_key: str, expiry_date: str) -> str:
    """Fetch expired futures; returns contracts (possibly empty)."""
    params = urllib.parse.urlencode(
        {"instrument_key": instrument_key, "expiry_date": expiry_date}
    )
    return json.dumps(_get(f"/instruments/expired-future-contracts?{params}"))


@tool(
    "fetch_expired_candles",
    description="""OHLC history for one EXPIRED contract key.

INPUT: instrument_key (required, date-suffixed expired key, e.g.
"NSE_FO|58422|03-10-2024"), interval (required: <N>minute | day | week |
month — Upstox accepts minute multiples, verified live), to_date / from_date
(required "YYYY-MM-DD"). Upstream requires Upstox Plus.
EXPECTED OUTPUT: {"data": {"candles": [[timestamp, open, high, low, close,
volume, open_interest], ...]}} in chronological order.""",
)
def fetch_expired_candles(
    instrument_key: str, interval: str, to_date: str, from_date: str
) -> str:
    """Fetch expired candles; returns chronological OHLC arrays."""
    params = urllib.parse.urlencode(
        {
            "instrument_key": instrument_key,
            "interval": interval,
            "to_date": to_date,
            "from_date": from_date,
        }
    )
    return json.dumps(_get(f"/instruments/expired-candles?{params}"))
