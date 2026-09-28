"""Instrument search + option-chain tools — API-reference grade details."""

from __future__ import annotations

import json
import urllib.parse

from langchain_core.tools import tool

from ._client import api_get, compact_rows


@tool(
    "search_instruments",
    description="""Search Upstox instruments and resolve names to canonical instrument_key values.

INPUT (all strings; query required):
- query: free text or ISIN, max 50 chars. E.g. "NIFTY", "RELIANCE", "INE002A01018".
- exchanges: ALL (default) | NSE | BSE | MCX.
- segments: ALL (default) | EQ | FO | CURR | COMM | INDEX | OPT | FUT.
- instrument_types: comma-separated, e.g. "CE", "PE", "CE,PE". Use with OPT/FO.
  NOTE: when set, segments must be concrete (FO or OPT) — segments=ALL with
  instrument_types is rejected upstream (HTTP 400).
- expiry: "current_week" | "next_month" | "YYYY-MM-DD".
- atm_offset: "0" = at-the-money; +/-N = strikes away from spot.
- page_number: 1-based (default "1"). records: 1..30 per page (default "10").
EXPECTED OUTPUT: {"count": N, "instruments": [{instrument_key (canonical,
SEGMENT|id — use verbatim, never invent), trading_symbol, exchange, segment,
instrument_type, expiry, strike_price, lot_size}, ...]}.
Upstream rate limits: standard APIs 50/sec, 500/min, 2000/30min.""",
)
def search_instruments(
    query: str,
    exchanges: str = "ALL",
    segments: str = "ALL",
    instrument_types: str = "",
    expiry: str = "",
    atm_offset: str = "",
    page_number: int = 1,
    records: int = 10,
) -> str:
    """Resolve names to canonical Upstox instrument_key values."""
    params: dict[str, str] = {
        "query": query,
        "exchanges": exchanges,
        "segments": segments,
        "page_number": str(page_number),
        "records": str(min(max(records, 1), 30)),
    }
    if instrument_types:
        params["instrument_types"] = instrument_types
    if expiry:
        params["expiry"] = expiry
    if atm_offset:
        params["atm_offset"] = atm_offset
    body = api_get(f"/instruments/search?{urllib.parse.urlencode(params)}")
    if "error" in body:
        return json.dumps(body)
    compact = [
        {
            "instrument_key": row.get("instrument_key"),
            "trading_symbol": row.get("trading_symbol"),
            "exchange": row.get("exchange"),
            "segment": row.get("segment"),
            "instrument_type": row.get("instrument_type"),
            "expiry": row.get("expiry"),
            "strike_price": row.get("strike_price"),
            "lot_size": row.get("lot_size"),
        }
        for row in body.get("data", [])
    ]
    return json.dumps({"count": len(compact), "instruments": compact})


@tool(
    "fetch_option_contracts",
    description="""List ACTIVE option contracts for an underlying and expiry.

INPUT: instrument_key (underlying, e.g. "NSE_INDEX|Nifty 50", required),
expiry_date (optional "YYYY-MM-DD"; omit for all expiries).
Upstream: GET /v2/option/contract. No Plus requirement.
EXPECTED OUTPUT: {"total": N, "truncated": bool, "contracts": [{instrument_key,
trading_symbol, expiry, strike_price, instrument_type, lot_size, tick_size,
...}, ...]} (capped at 100 rows; narrow by expiry_date for the rest).""",
)
def fetch_option_contracts(instrument_key: str, expiry_date: str = "") -> str:
    """List active CE/PE contracts; keys feed historical fetch or capture."""
    params = {"instrument_key": instrument_key}
    if expiry_date:
        params["expiry_date"] = expiry_date
    body = api_get(
        f"/instruments/option-contracts?{urllib.parse.urlencode(params)}"
    )
    if "error" in body:
        return json.dumps(body)
    return json.dumps(compact_rows(body.get("data", []), 100, "contracts"))
