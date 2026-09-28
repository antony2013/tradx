"""Market-information tools — API-reference grade details.

Upstream (v2, discovery only, never stored):
- GET /market/smartlist/options|futures?asset_type=&category=&page_number=&page_size=
- GET /market/oi?instrument_key=&expiry=&date=
- GET /market/change-oi?...&interval= (days)
- GET /market/max-pain /market/pcr?...&bucket_interval= (minutes, REQUIRED)
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
    "get_options_smartlist",
    description="""Ranked option contracts by category.
INPUT: asset_type (required: INDEX|STOCK|COMMODITY), category (required, e.g.
TOP_TRADED, MOST_ACTIVE, OI_GAINERS, OI_LOSERS, price gainers/losers),
page_number/page_size (optional, default 1/20).
EXPECTED OUTPUT: {"data": {smartlist rows, page info}}.""",
)
def get_options_smartlist(
    asset_type: str, category: str, page_number: int = 1, page_size: int = 20
) -> str:
    """Fetch ranked options; returns the smartlist payload."""
    params = urllib.parse.urlencode(
        {
            "asset_type": asset_type,
            "category": category,
            "page_number": str(page_number),
            "page_size": str(min(max(page_size, 1), 100)),
        }
    )
    return json.dumps(_get(f"/market/smartlists/options?{params}"))


@tool(
    "get_futures_smartlist",
    description="""Ranked futures contracts by category.
INPUT: asset_type (required: INDEX|STOCK|COMMODITY), category (required),
page_number/page_size (optional, default 1/20).
EXPECTED OUTPUT: {"data": {smartlist rows, page info}}.""",
)
def get_futures_smartlist(
    asset_type: str, category: str, page_number: int = 1, page_size: int = 20
) -> str:
    """Fetch ranked futures; returns the smartlist payload."""
    params = urllib.parse.urlencode(
        {
            "asset_type": asset_type,
            "category": category,
            "page_number": str(page_number),
            "page_size": str(min(max(page_size, 1), 100)),
        }
    )
    return json.dumps(_get(f"/market/smartlists/futures?{params}"))


def _oi_params(
    instrument_key: str, expiry: str, date: str, extra: dict | None = None
) -> str:
    params: dict[str, str] = {
        "instrument_key": instrument_key,
        "expiry": expiry,
        "date": date,
    }
    if extra:
        params.update(extra)
    return urllib.parse.urlencode(params)


@tool(
    "get_oi",
    description="""Strike-wise open interest for an underlying and expiry.
INPUT: instrument_key (underlying, required), expiry (date or keyword,
required), date "YYYY-MM-DD" (required).
EXPECTED OUTPUT: {"data": {total_puts, total_calls, spot, strike-wise
call/put OI}}.""",
)
def get_oi(instrument_key: str, expiry: str, date: str) -> str:
    """Fetch OI snapshot; returns totals + strike rows."""
    return json.dumps(
        _get(f"/market/oi?{_oi_params(instrument_key, expiry, date)}")
    )


@tool(
    "get_change_oi",
    description="""Total and strike-wise change in open interest.
INPUT: instrument_key, expiry, date (required), interval (optional days,
e.g. "7").
EXPECTED OUTPUT: {"data": {total + strike-wise OI changes}}.""",
)
def get_change_oi(
    instrument_key: str, expiry: str, date: str, interval: str = ""
) -> str:
    """Fetch OI change; returns totals + strike deltas."""
    extra = {"interval": interval} if interval else None
    return json.dumps(
        _get(f"/market/change-oi?{_oi_params(instrument_key, expiry, date, extra)}")
    )


@tool(
    "get_max_pain",
    description="""Max pain, spot price and intraday insights.
INPUT: instrument_key, expiry, date (required), bucket_interval
(REQUIRED minutes, e.g. "30" — upstream rejects without it).
EXPECTED OUTPUT: {"data": {max_pain, spot_closing_price, insights[]}}.""",
)
def get_max_pain(
    instrument_key: str, expiry: str, date: str, bucket_interval: str
) -> str:
    """Fetch max pain; returns value + intraday insights."""
    return json.dumps(
        _get(
            f"/market/max-pain?{_oi_params(instrument_key, expiry, date, {'bucket_interval': bucket_interval})}"
        )
    )


@tool(
    "get_pcr",
    description="""Put-call ratio, spot price and intraday insights.
INPUT: instrument_key, expiry, date (required), bucket_interval
(REQUIRED minutes, e.g. "30" — upstream rejects without it).
EXPECTED OUTPUT: {"data": {pcr, spot_closing_price, insights[]}}.""",
)
def get_pcr(
    instrument_key: str, expiry: str, date: str, bucket_interval: str
) -> str:
    """Fetch PCR; returns ratio + intraday insights."""
    return json.dumps(
        _get(
            f"/market/pcr?{_oi_params(instrument_key, expiry, date, {'bucket_interval': bucket_interval})}"
        )
    )
