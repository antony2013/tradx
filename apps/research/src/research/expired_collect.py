"""Expired Nifty option 1-minute collector: ONE trading date per run.

Collection only. No analysis, strategy, or UI.

Procedure (role-faithful):
1. Nifty 50 spot DAILY candle of D -> open/high/low. Empty -> NO_DATA_SPOT.
2. Expiries list -> nearest expiry E >= D (never compute dates).
3. Arithmetic: atm/lo/hi/strikes (50-point grid, +/-100 buffer).
3b. Expired option contracts of E -> (strike, type) -> instrument key map.
    Strikes with no contract are skipped, never called.
4. Per (strike, type): skip if collected (reused COMPLETE); else fetch
   1-minute candles of D (max 3 attempts total); store non-empty series
   with strike/type/expiry/atm/offset columns; else FAILED.
5. Any 401/403 -> AUTH_ERROR immediately.
6. One summary line, then stop.

Candle rows are read from the tradx DB read-only (mode=ro); the API is
used for acquisition only. apps/api and apps/agent are not modified.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_BASE = os.environ.get("TRADX_API_URL", "http://localhost:3000").rstrip("/")
from .config import DATA_DIR as _DATA_DIR
from .config import TRADX_DB_PATH
from .errors import MissingDataError

OUT_DIR = Path(_DATA_DIR) / "expired_options"
UNDERLYING = "NSE_INDEX|Nifty 50"
MAX_ATTEMPTS = 3
SHORT_SERIES_BARS = 350


class AuthError(Exception):
    """Upstream 401/403: stop the whole run immediately."""


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


def _get(path: str) -> dict:
    return _request("GET", path)


def _post(path: str, payload: dict) -> dict:
    return _request("POST", path, payload)


def _read_candles(dataset_id: str) -> list:
    db = Path(TRADX_DB_PATH)
    if not db.exists():
        raise MissingDataError(f"tradx DB not found: {TRADX_DB_PATH}")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return con.execute(
            "SELECT timestamp, open, high, low, close, volume, open_interest"
            " FROM historical_candles WHERE dataset_id = ? ORDER BY timestamp",
            (dataset_id,),
        ).fetchall()
    finally:
        con.close()


def acquire(date: str, key: str, interval: str) -> dict:
    """POST a dataset acquisition. Returns (record, attempts_used=1).

    HTTP 429 (Upstox rate limit) backs off exponentially (2/4/8s, max 3
    tries) before giving up; anything else fails fast for the caller loop.
    """
    import time as _time

    delays = (2, 4, 8)
    attempts = 0
    while True:
        res = _post(
            "/historical/datasets",
            {"instrumentKey": key, "from": date, "to": date,
             "interval": interval, "source": "upstox"},
        )
        if res["status"] in (200, 201):
            return {"ok": True, "record": res["body"]}
        attempts += 1
        if res["status"] != 429 or attempts > len(delays):
            return {"ok": False, "error": res["body"]}
        _time.sleep(delays[attempts - 1])


def pick_expiry(dates: list, day: str) -> str:
    """Nearest expiry E >= D. Never compute dates; pick from the list."""
    candidates = sorted(d for d in dates if isinstance(d, str) and d >= day)
    if not candidates:
        raise ValueError(f"no expiry >= {day} in {dates}")
    return candidates[0]


def strike_grid(day_open: float, day_low: float, day_high: float) -> tuple:
    """(atm, strikes) per role arithmetic, 50-point grid."""
    atm = round(day_open / 50) * 50
    lo = math.floor(day_low / 50) * 50 - 100
    hi = math.ceil(day_high / 50) * 50 + 100
    return atm, list(range(lo, hi + 1, 50))


def run(date: str, resume: bool = False) -> str:
    """Execute one collection run. Returns the final reply line."""
    out_path = OUT_DIR / f"expired_options_{date}.parquet"
    if out_path.exists() and not resume:
        return f"ALREADY_COLLECTED {date} (use --resume)"

    # 1. Spot daily.
    spot = acquire(date, UNDERLYING, "1day")
    if not spot["ok"]:
        return f"SPOT_ERROR {date} {spot['error']}"
    spot_rows = _read_candles(spot["record"]["dataset_id"])
    if not spot_rows:
        return f"NO_DATA_SPOT {date}"
    _, day_open, day_high, day_low, _, _, _ = spot_rows[0]

    # 2. Nearest expiry >= D.
    exp = _get(f"/instruments/expiries?{urllib.parse.urlencode({'instrument_key': UNDERLYING})}")
    if exp["status"] != 200 or not isinstance(exp["body"].get("data"), list):
        return f"EXPIRY_ERROR {date} {exp['body']}"
    expiry = pick_expiry(exp["body"]["data"], date)

    # 3. Strike grid.
    atm, strikes = strike_grid(day_open, day_low, day_high)

    # 3b. Contract map (strike, type) -> key.
    con = _get(
        "/instruments/expired-option-contracts?"
        + urllib.parse.urlencode(
            {"instrument_key": UNDERLYING, "expiry_date": expiry}
        )
    )
    if con["status"] != 200 or not isinstance(con["body"].get("data"), list):
        return f"CONTRACT_ERROR {date} {con['body']}"
    key_of: dict = {}
    for row in con["body"]["data"]:
        try:
            key_of[(int(row["strike_price"]), str(row["instrument_type"]))] = str(
                row["instrument_key"]
            )
        except (KeyError, TypeError, ValueError):
            continue

    # 4. Per (strike, type).
    stored: list = []
    skipped = 0
    skipped_combos: list = []
    failed: list = []
    for strike in strikes:
        for opt_type in ("CE", "PE"):
            key = key_of.get((strike, opt_type))
            if key is None:
                skipped += 1
                skipped_combos.append({"strike": strike, "type": opt_type})
                continue
            attempts = 0
            done = False
            while attempts < MAX_ATTEMPTS and not done:
                attempts += 1
                got = acquire(date, key, "1minute")
                if not got["ok"]:
                    continue
                rec = got["record"]
                if rec.get("reused") and rec.get("status") == "COMPLETE":
                    skipped += 1
                    done = True
                    continue
                rows = _read_candles(rec["dataset_id"])
                if rows:
                    for r in rows:
                        stored.append(
                            {
                                "timestamp": r[0], "open": r[1], "high": r[2],
                                "low": r[3], "close": r[4], "volume": r[5],
                                "oi": r[6], "strike": strike, "type": opt_type,
                                "expiry": expiry, "atm_strike": atm,
                                "offset": (strike - atm) // 50,
                                "dataset_id": rec["dataset_id"],
                            }
                        )
                    done = True
            if not done:
                failed.append(f"{strike}{opt_type}")

    # 5/6. Store + summary.
    short = 0
    if stored:
        import pandas as pd  # local import: heavy dep only on write path

        frame = pd.DataFrame(stored)
        counts = frame.groupby(["strike", "type"]).size()
        short = int((counts < SHORT_SERIES_BARS).sum())
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        if resume and out_path.exists():
            old = pd.read_parquet(out_path)
            keep = old[
                ~old.set_index(["strike", "type"]).index.isin(
                    frame.set_index(["strike", "type"]).index
                )
            ]
            frame = pd.concat([keep, frame], ignore_index=True)
        frame.to_parquet(out_path, engine="pyarrow", index=False)

    stored_n = len({(s["strike"], s["type"]) for s in stored})
    line = (
        f"{date} | {expiry} | {atm} | {len(strikes)}"
        f" | {stored_n} | {skipped} | {len(failed)}"
        f" | short_series({short})"
        + (f" FAILED={','.join(failed)}" if failed else "")
    )
    # Sidecar for the driver (resume + reporting). Overwritten per run;
    # the summary line above stays the parsed contract.
    meta = {
        "date": date, "expiry": expiry, "atm": atm,
        "strikes_tried": len(strikes), "stored": stored_n,
        "skipped": skipped, "failed": failed,
        "short_series": short, "skipped_combos": skipped_combos,
        "summary": line,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / f"expired_options_{date}.meta.json", "w",
              encoding="utf-8") as fh:
        json.dump(meta, fh)
    return line


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD, one day only")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        print(run(args.date, resume=args.resume))
    except AuthError:
        print("AUTH_ERROR")
    except (ValueError, MissingDataError) as exc:
        print(f"INPUT_ERROR {exc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
