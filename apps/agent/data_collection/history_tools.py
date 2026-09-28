"""Historical fetch + validation tools — API-reference grade details.

Upstream: POST {TRADX_API}/historical/datasets
  → GET https://api.upstox.com/v3/historical-candle/{key}/{unit}/{interval}/{to}[/{from}]
Validation: POST {TRADX_API}/historical/datasets/{id}/validation
  (deterministic server checks: schema/OHLC, ordering, dedup, IST gaps,
  completeness → VALID / INVALID / INCOMPLETE).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from langchain_core.tools import tool

API_BASE = os.environ.get("TRADX_API_URL", "http://localhost:3000").rstrip("/")


def _post(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
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
    "fetch_historical",
    description="""Acquire (or reuse) an OHLCV candle dataset for one instrument.

INPUT (all strings unless noted):
- instrumentKey (required): canonical key, e.g. "NSE_FO|73985". Resolve it
  via search first — never invent one.
- from / to (required): "YYYY-MM-DD", from <= to, to not in the future.
- interval (required): "1minute".."300minute" | "1hour".."5hours" |
  "1day" | "1week" | "1month".
- source: "upstox" (default, only supported source).
Server behavior: chunks long ranges per Upstox windows (minutes 1-15: 1 month;
minutes >15 / hours: 1 quarter; days: 1 decade; weeks/months: single),
fetches sequentially, retries transient failures max 3 (500ms→8000ms backoff,
15s timeout). Never retries auth/validation errors.
EXPECTED OUTPUT: {"dataset_id" (SHA-256, deterministic — same request reuses
stored data), "status" COMPLETE/PARTIAL/FAILED, "record_count",
"chunks_total/failed", "reused" bool}.
On PARTIAL/FAILED: report it, re-request later to resume — do not hammer.""",
)
def fetch_historical(
    instrumentKey: str,
    from_date: str,
    to_date: str,
    interval: str,
    source: str = "upstox",
) -> str:
    """Fetch candles; returns the dataset record (id, status, counts)."""
    return json.dumps(
        _post(
            "/historical/datasets",
            {
                "instrumentKey": instrumentKey,
                "from": from_date,
                "to": to_date,
                "interval": interval,
                "source": source,
            },
        )
    )


@tool(
    "validate_dataset",
    description="""Run deterministic server-side validation on a dataset_id.

INPUT: dataset_id (required, from fetch_historical).
Server checks: schema/OHLC integrity, timestamp ordering, duplicate/conflict
scan, IST expected-session gaps, completeness score. No holiday calendar
(holidays appear as gaps); intraday grid assumes NSE cash 09:15–15:30.
EXPECTED OUTPUT: {"verdict" VALID|INVALID|INCOMPLETE, "completeness" 0..1,
"gaps" [...], issue counts}. Interpret the verdict — never re-validate by
eyeballing data; manual "looks fine" is the silent-corruption risk.""",
)
def validate_dataset(dataset_id: str) -> str:
    """Validate; returns the integrity report (verdict, completeness, gaps)."""
    return json.dumps(_post(f"/historical/datasets/{dataset_id}/validation", {}))
