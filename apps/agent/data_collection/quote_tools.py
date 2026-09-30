"""Market-quote tools — API-reference grade details (read-only).

Upstox V3 quotes: full, OHLC, LTP, option Greeks. Snapshots for context,
never persisted. instrument_key accepts comma-separated keys (up to 500;
50 for Greeks).
"""

from __future__ import annotations

import json
import urllib.parse

from langchain_core.tools import tool

from ._client import api_get


def _keys_param(instrument_keys: str) -> str:
    return urllib.parse.urlencode({"instrument_key": instrument_keys})


@tool(
    "get_full_quotes",
    description="""Full market quotes V3: OHLC, depth, OI, circuits, year
high/low, CAS fields, last price.
INPUT: instrument_keys (required, comma-separated canonical keys, up to 500).
EXPECTED OUTPUT: {"data": {<key>: {quote fields}}}. Snapshot for context
only — never persisted.""",
)
def get_full_quotes(instrument_keys: str) -> str:
    """Fetch full quotes; returns per-key quote payloads."""
    return json.dumps(api_get(f"/market/quotes?{_keys_param(instrument_keys)}"))


@tool(
    "get_ohlc_quotes",
    description="""OHLC quotes V3: previous + live OHLC with volume.
INPUT: instrument_keys (required, comma-separated, up to 500), interval
(optional "1d"|"I1"|"I30").
EXPECTED OUTPUT: {"data": {<key>: {last_price, prev_ohlc, live_ohlc}}}.
Snapshot for context only — never persisted.""",
)
def get_ohlc_quotes(instrument_keys: str, interval: str = "") -> str:
    """Fetch OHLC quotes; returns prev + live OHLC per key."""
    params = _keys_param(instrument_keys)
    if interval:
        params += "&" + urllib.parse.urlencode({"interval": interval})
    return json.dumps(api_get(f"/market/quotes/ohlc?{params}"))


@tool(
    "get_ltp_quotes",
    description="""LTP quotes V3: last price, quantity, volume, close.
INPUT: instrument_keys (required, comma-separated, up to 500).
EXPECTED OUTPUT: {"data": {<key>: {last_price, ltq, volume, cp}}}.
Snapshot for context only — never persisted.""",
)
def get_ltp_quotes(instrument_keys: str) -> str:
    """Fetch LTP quotes; returns last price per key."""
    return json.dumps(api_get(f"/market/quotes/ltp?{_keys_param(instrument_keys)}"))


@tool(
    "get_option_greeks",
    description="""Option Greeks: IV, delta, theta, gamma, vega, OI, last price.
INPUT: instrument_keys (required, comma-separated option keys, up to 50).
Upstream may return an empty object outside Plus/session — report it
as-is, never fabricate Greeks.
EXPECTED OUTPUT: {"data": {<key>: {greeks}}}. Snapshot for context
only — never persisted.""",
)
def get_option_greeks(instrument_keys: str) -> str:
    """Fetch option Greeks; returns per-key Greeks (may be empty)."""
    return json.dumps(
        api_get(f"/market/quotes/greeks?{_keys_param(instrument_keys)}")
    )
