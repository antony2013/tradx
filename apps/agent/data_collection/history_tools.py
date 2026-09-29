"""Historical fetch + validation tools — API-reference grade details."""

from __future__ import annotations

import json

from langchain_core.tools import tool

from ._client import api_post


@tool(
    "fetch_historical",
    description="""Acquire (or reuse) an OHLCV candle dataset for one instrument.

INPUT (all strings unless noted):
- instrumentKey (required): canonical key, e.g. "NSE_FO|73985". Resolve it
  via search first — never invent one. Expired date-suffixed keys
  ("NSE_FO|58422|03-10-2024") route to expired storage automatically.
- from_date / to_date (required): "YYYY-MM-DD", from <= to, to not in future.
- interval (required): "1minute".."300minute" | "1hour".."5hours" |
  "1day" | "1week" | "1month". (Hours unsupported for expired keys.)
- source: "upstox" (default, only supported source).
Server behavior: chunks long ranges per Upstox windows, fetches with bounded
parallelism, retries transient failures max 3, dedups by (dataset_id,
timestamp).
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
        api_post(
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

INPUT: dataset_id (required, from fetch_historical / acquire_dataset).
Server checks: schema/OHLC integrity, timestamp ordering, duplicate/conflict
scan, IST expected-session gaps (holiday-aware via the server's exchange
calendar), completeness score. Intraday grid assumes NSE cash 09:15–15:29.
EXPECTED OUTPUT: {"verdict" VALID|INVALID|INCOMPLETE, "completeness" 0..1,
"gaps" [...], issue counts}. Interpret the verdict — never re-validate by
eyeballing data; manual "looks fine" is the silent-corruption risk.""",
)
def validate_dataset(dataset_id: str) -> str:
    """Validate; returns the integrity report (verdict, completeness, gaps)."""
    return json.dumps(api_post(f"/historical/datasets/{dataset_id}/validation", {}))


@tool(
    "acquire_dataset",
    description="""Acquire AND validate an OHLCV dataset in one call.
Same INPUT as fetch_historical (instrumentKey, from_date, to_date,
interval, source). Prefer this over fetch_historical + validate_dataset:
it POSTs /historical/datasets, then POSTs the validation, and returns one
compact merged result.
EXPECTED OUTPUT: {"dataset_id", "status" COMPLETE/PARTIAL/FAILED,
"record_count", "reused" bool, "verdict" VALID|INVALID|INCOMPLETE,
"completeness" 0..1, "gap_count", "first_gaps" (at most 20), "notes"}.
On PARTIAL/FAILED: report it, re-request later to resume — do not hammer.""",
)
def acquire_dataset(
    instrumentKey: str,
    from_date: str,
    to_date: str,
    interval: str,
    source: str = "upstox",
) -> str:
    """Acquire + validate; returns one merged compact result."""
    body = api_post(
        "/historical/datasets",
        {
            "instrumentKey": instrumentKey,
            "from": from_date,
            "to": to_date,
            "interval": interval,
            "source": source,
        },
    )
    if "error" in body or not body.get("dataset_id"):
        return json.dumps(body)
    validation = api_post(
        f"/historical/datasets/{body['dataset_id']}/validation", {}
    )
    if "error" in validation:
        return json.dumps({**{k: body.get(k) for k in ("dataset_id", "status", "record_count", "reused")}, "validation_error": validation})
    gaps = validation.get("gaps", [])
    return json.dumps(
        {
            "dataset_id": body.get("dataset_id"),
            "status": body.get("status"),
            "record_count": body.get("record_count"),
            "reused": body.get("reused"),
            "verdict": validation.get("verdict"),
            "completeness": validation.get("completeness"),
            "gap_count": validation.get("gap_count"),
            "first_gaps": gaps[:20] if isinstance(gaps, list) else gaps,
            "notes": validation.get("notes", []),
        }
    )
