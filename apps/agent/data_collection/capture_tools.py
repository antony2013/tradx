"""Capture lifecycle tools — API-reference grade details (control plane).

The server never auto-starts capture: it stays STOPPED until start_capture.
Subscriptions are mutable at runtime through update_subscriptions.
"""

from __future__ import annotations

import json

from langchain_core.tools import tool

from ._client import api_get, api_post


@tool(
    "get_capture_status",
    description="""Capture state and queue depth.
INPUT: none.
EXPECTED OUTPUT: {"capture_enabled", "capture_state"
(STOPPED|CONNECTING|CONNECTED|CAPTURING|...), "source_connection_id",
"session_date", "queue_depth", ...}. Snapshot for context only.""",
)
def get_capture_status() -> str:
    """Fetch capture status; returns state + queue depth."""
    return json.dumps(api_get("/capture/status"))


@tool(
    "get_capture_stats",
    description="""Capture counters and write latency.
INPUT: none.
EXPECTED OUTPUT: {"batches_received/persisted", "instrument_rows_*",
"queue_overflow_count", "capture_error_count", latencies}. Snapshot for
context only.""",
)
def get_capture_stats() -> str:
    """Fetch capture stats; returns counters + latencies."""
    return json.dumps(api_get("/capture/stats"))


@tool(
    "get_subscriptions",
    description="""Currently subscribed instrument keys and feed mode.
INPUT: none.
EXPECTED OUTPUT: {"feed_mode", "instrument_keys": [...] }. Snapshot for
context only.""",
)
def get_subscriptions() -> str:
    """Fetch subscriptions; returns feed mode + keys."""
    return json.dumps(api_get("/capture/subscriptions"))


@tool(
    "update_subscriptions",
    description="""Subscribe or unsubscribe instrument keys at runtime.
INPUT: action ("sub"|"unsub", required), instrument_keys (required list of
canonical "SEGMENT|id" keys, e.g. ["NSE_FO|73985"]).
EXPECTED OUTPUT: {"action", "added"/"removed"/"missing"/"invalid",
"instrument_keys": [current set]}. Applies to the live socket immediately
and replays on reconnect.""",
)
def update_subscriptions(action: str, instrument_keys: list) -> str:
    """Change subscriptions; returns updated set."""
    return json.dumps(
        api_post(
            "/capture/subscriptions",
            {"action": action, "instrumentKeys": instrument_keys},
        )
    )


@tool(
    "start_capture",
    description="""Manually start the live capture feed.
INPUT: none. The server never auto-starts: call this ONLY on an explicit
user request to go live. Idempotent — a second call reports state instead
of double-connecting.
EXPECTED OUTPUT: the capture status after start.""",
)
def start_capture() -> str:
    """Start the live feed; returns status after start."""
    return json.dumps(api_post("/capture/start", {}))


@tool(
    "stop_capture",
    description="""Manually stop the live capture feed.
INPUT: none. Flushes pending batches before disconnecting. Safe no-op
when already stopped.
EXPECTED OUTPUT: the capture status after stop.""",
)
def stop_capture() -> str:
    """Stop the live feed; returns status after stop."""
    return json.dumps(api_post("/capture/stop", {}))
