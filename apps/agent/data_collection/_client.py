"""Shared Tradex API HTTP layer for all data tools.

Single place for: base URL, timeouts, auth-header-free calls (the server
holds the Upstox token), error-as-result mapping, JSON safety, and output
caps that keep large upstream payloads out of model context.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from settings import load_settings

API_BASE = load_settings().tradx_api_url.rstrip("/")

LONG_TIMEOUT = 300


class ToolHttpError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _read_json(response: Any) -> Any:
    try:
        return json.load(response)
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError) as error:
        raise ToolHttpError(-1, f"non-JSON response: {error}") from error


def _error_payload(message: str, hint: str) -> dict:
    return {"error": message, "hint": hint}


def _request(
    method: str, path: str, payload: dict | None, timeout: int
) -> Any:
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{API_BASE}{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return _read_json(response)
    except urllib.error.HTTPError as http_error:
        try:
            detail = http_error.read().decode("utf-8", errors="replace")[:300]
        except Exception:  # noqa: BLE001
            detail = str(http_error.reason)
        raise ToolHttpError(http_error.code, detail) from http_error
    except OSError as network_error:
        raise ToolHttpError(-1, f"unreachable: {network_error}") from network_error


def api_get(path: str, timeout: int = 60) -> dict:
    """GET helper. Returns parsed JSON or an error dict (never raises)."""
    try:
        body = _request("GET", path, None, timeout)
    except ToolHttpError as error:
        return _error_payload(
            f"rejected: {error.detail}",
            "Fix parameters and retry once; do not hammer on 4xx.",
        )
    if not isinstance(body, dict):
        return _error_payload(
            "unexpected response shape",
            "Report this verbatim; do not retry blindly.",
        )
    return body


def api_post(path: str, payload: dict, timeout: int = LONG_TIMEOUT) -> dict:
    """POST helper. Long timeout: server jobs outlive single requests.

    If a call times out, the server usually keeps working — re-request the
    SAME parameters to resume/reuse instead of assuming failure.
    """
    try:
        body = _request("POST", path, payload, timeout)
    except ToolHttpError as error:
        hint = (
            "The server often keeps working past a client timeout: "
            "re-request the SAME parameters to resume/reuse. "
            if error.status == -1
            else "Fix parameters and retry once; do not hammer on 4xx. "
        )
        return _error_payload(f"failed: {error.detail}", hint + "Report it.")
    if not isinstance(body, dict):
        return _error_payload(
            "unexpected response shape",
            "Report this verbatim; do not retry blindly.",
        )
    return body


def compact_rows(
    rows: list, limit: int = 100, label: str = "rows"
) -> dict:
    """Cap list payloads for model context. Never silently truncate."""
    total = len(rows)
    if total <= limit:
        return {"total": total, "truncated": False, label: rows}
    return {
        "total": total,
        "truncated": True,
        label: rows[:limit],
        "note": f"showing first {limit} of {total}; narrow the request for the rest",
    }
