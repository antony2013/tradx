#!/usr/bin/env python3
"""Spot Nifty 50 1-minute collector: ONE trading day per worker call.

Collection only. Mirrors expired_collect conventions (never overwrites,
loud errors, meta sidecars) but has no expiry/grid/contract steps:
acquire -> read DB -> validate -> store parquet + meta.

Writes: data/spot_1m/spot_1m_YYYY-MM-DD.parquet (+ .meta.json).
DB reads are read-only (mode=ro). apps/api and apps/agent untouched.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

API_BASE = os.environ.get("TRADX_API_URL", "http://localhost:3000").rstrip("/")

from .config import TRADX_DB_PATH
from .errors import MissingDataError

OUT_DIR = Path(__file__).resolve().parents[2] / "data" / "spot_1m"
UNDERLYING = "NSE_INDEX|Nifty 50"

SHORT_SERIES_BARS = 350


class AuthError(Exception):
    """Upstream 401/403: stop everything immediately."""


def _request(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{API_BASE}{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return {"status": resp.status, "body": json.load(resp)}
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise AuthError(f"HTTP {exc.code} on {path}") from exc
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            body: dict = {"error": detail}
        except Exception:  # noqa: BLE001
            body = {"error": str(exc)}
        return {"status": exc.code, "body": body}
    except OSError as exc:
        return {"status": -1, "body": {"error": f"unreachable: {exc}"}}


def acquire(date_: str) -> dict:
    """POST the spot 1-minute dataset. 429s back off exponentially."""
    delays = (2, 4, 8)
    attempts = 0
    while True:
        res = _request(
            "POST",
            "/historical/datasets",
            {"instrumentKey": UNDERLYING, "from": date_, "to": date_,
             "interval": "1minute", "source": "upstox"},
        )
        if res["status"] in (200, 201):
            return {"ok": True, "record": res["body"]}
        attempts += 1
        if res["status"] != 429 or attempts > len(delays):
            return {"ok": False, "error": res["body"]}
        time.sleep(delays[attempts - 1])


def read_candles(dataset_id: str) -> list:
    db = Path(TRADX_DB_PATH)
    if not db.exists():
        raise MissingDataError(f"tradx DB not found: {TRADX_DB_PATH}")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return con.execute(
            "SELECT timestamp, open, high, low, close, volume"
            " FROM historical_candles WHERE dataset_id = ? ORDER BY timestamp",
            (dataset_id,),
        ).fetchall()
    finally:
        con.close()


def validate(dataset_id: str) -> dict:
    res = _request("POST", f"/historical/datasets/{dataset_id}/validation", {})
    if res["status"] != 200:
        return {"verdict": "UNKNOWN", "error": res["body"]}
    return res["body"]


def run(date_: str) -> str:
    """Collect one day. Returns the summary line."""
    out_path = OUT_DIR / f"spot_1m_{date_}.parquet"
    if out_path.exists():
        return f"ALREADY_COLLECTED {date_} (use --resume)"
    got = acquire(date_)
    if not got["ok"]:
        return f"SPOT_ERROR {date_} {got['error']}"
    rec = got["record"]
    rows = read_candles(rec["dataset_id"])
    if not rows:
        return f"NO_DATA_SPOT {date_}"
    report = validate(rec["dataset_id"])
    verdict = report.get("verdict", "UNKNOWN")

    import pandas as pd  # local import: heavy dep only on write path

    frame = pd.DataFrame(
        rows, columns=["timestamp", "open", "high", "low", "close", "volume"]
    )
    frame.insert(0, "dataset_id", rec["dataset_id"])
    short = " SHORT" if len(frame) < SHORT_SERIES_BARS else ""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(out_path, engine="pyarrow", index=False)
    line = f"{date_} | rows={len(frame)} | {verdict}{short}"
    meta = {
        "date": date_, "dataset_id": rec["dataset_id"], "rows": len(frame),
        "verdict": verdict, "reused": bool(rec.get("reused")), "summary": line,
    }
    (OUT_DIR / f"spot_1m_{date_}.meta.json").write_text(
        json.dumps(meta), encoding="utf-8"
    )
    return line


def trading_days(from_: str = "2025-01-01") -> list:
    """Trading days from the stored Nifty DAILY candles (holidays absent)."""
    con = sqlite3.connect(f"file:{TRADX_DB_PATH}?mode=ro", uri=True)
    try:
        daily = con.execute(
            "SELECT dataset_id FROM historical_datasets"
            " WHERE instrument_key=? AND unit='days' AND interval=1"
            " ORDER BY requested_to DESC LIMIT 1",
            (UNDERLYING,),
        ).fetchone()
        if daily is None:
            raise MissingDataError("no Nifty daily dataset found")
        stamps = con.execute(
            "SELECT DISTINCT timestamp FROM historical_candles"
            " WHERE dataset_id=? ORDER BY timestamp",
            (daily[0],),
        ).fetchall()
    finally:
        con.close()
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo

    days = sorted(
        datetime.fromtimestamp(t[0] / 1000, timezone.utc)
        .astimezone(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
        for t in stamps
    )
    today = date.today().isoformat()
    return [d for d in days if from_ <= d <= today]


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", help="single YYYY-MM-DD to collect")
    parser.add_argument("--all", action="store_true",
                        help="collect every trading day in range")
    parser.add_argument("--sleep", type=float, default=5.0)
    args = parser.parse_args(argv)
    try:
        if args.date:
            print(run(args.date))
            return 0
        if not args.all:
            parser.print_help()
            return 2
        days = trading_days()
        print(f"days in range: {len(days)}", flush=True)
        failed = 0
        for day in days:
            pq = OUT_DIR / f"spot_1m_{day}.parquet"
            if pq.exists():
                print(f"SKIP {day}", flush=True)
                continue
            line = run(day)
            print(line, flush=True)
            if line == "AUTH_ERROR" or line.startswith("INPUT_ERROR"):
                return 3
            if "rows=0" in line or "FAILED" in line or line.startswith(
                ("NO_DATA_SPOT", "SPOT_ERROR")
            ):
                failed += 1
                if failed >= 3:
                    print("HALT: 3 consecutive failed days", flush=True)
                    return 5
            else:
                failed = 0
            time.sleep(args.sleep)
        print("DONE", flush=True)
        return 0
    except AuthError:
        print("AUTH_ERROR")
        return 3
    except MissingDataError as exc:
        print(f"INPUT_ERROR {exc}")
        return 3


if __name__ == "__main__":
    sys.exit(main())
