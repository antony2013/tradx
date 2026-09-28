"""Market-information tools — API-reference grade details (read-only)."""

from __future__ import annotations

import json
import urllib.parse

from langchain_core.tools import tool

from ._client import api_get, compact_rows


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
    "get_options_smartlist",
    description="""Ranked option contracts by category.
INPUT: asset_type (required: INDEX|STOCK|COMMODITY), category (required, e.g.
TOP_TRADED, MOST_ACTIVE, OI_GAINERS, OI_LOSERS), page_number/page_size
(optional, default 1/20).
EXPECTED OUTPUT: {"data": {smartlist rows, page info}}. Discovery only.""",
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
    return json.dumps(api_get(f"/market/smartlists/options?{params}"))


@tool(
    "get_futures_smartlist",
    description="""Ranked futures contracts by category.
INPUT: asset_type (required: INDEX|STOCK|COMMODITY), category (required),
page_number/page_size (optional, default 1/20).
EXPECTED OUTPUT: {"data": {smartlist rows, page info}}. Discovery only.""",
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
    return json.dumps(api_get(f"/market/smartlists/futures?{params}"))


@tool(
    "get_oi",
    description="""Strike-wise open interest for an underlying and expiry.
INPUT: instrument_key (underlying, required), expiry (date or keyword,
required), date "YYYY-MM-DD" (required).
EXPECTED OUTPUT: {"data": {total_puts, total_calls, spot, strike-wise
call/put OI}} (strike rows capped at 100 with truncation flag).""",
)
def get_oi(instrument_key: str, expiry: str, date: str) -> str:
    """Fetch OI snapshot; returns totals + strike rows."""
    body = api_get(f"/market/oi?{_oi_params(instrument_key, expiry, date)}")
    if "error" in body:
        return json.dumps(body)
    data = body.get("data", {})
    rows = data.get("call_put_oi_data_list", []) if isinstance(data, dict) else []
    return json.dumps({"meta": {k: v for k, v in (data.items() if isinstance(data, dict) else []) if k != "call_put_oi_data_list"}, **compact_rows(rows, 100, "strikes")})


@tool(
    "get_change_oi",
    description="""Total and strike-wise change in open interest.
INPUT: instrument_key, expiry, date (required), interval (optional days,
e.g. "7").
EXPECTED OUTPUT: {"data": {total + strike-wise OI changes}} (strike rows
capped at 100 with truncation flag).""",
)
def get_change_oi(
    instrument_key: str, expiry: str, date: str, interval: str = ""
) -> str:
    """Fetch OI change; returns totals + strike deltas."""
    extra = {"interval": interval} if interval else None
    body = api_get(
        f"/market/change-oi?{_oi_params(instrument_key, expiry, date, extra)}"
    )
    if "error" in body or not isinstance(body.get("data"), dict):
        return json.dumps(body)
    data = body["data"]
    rows = data.get("change_oi_data_list", data.get("data_list", []))
    return json.dumps({"meta": {k: v for k, v in data.items() if not isinstance(v, list)}, **compact_rows(rows if isinstance(rows, list) else [], 100, "strikes")})


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
        api_get(
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
        api_get(
            f"/market/pcr?{_oi_params(instrument_key, expiry, date, {'bucket_interval': bucket_interval})}"
        )
    )
