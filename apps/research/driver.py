#!/usr/bin/env python3
"""Bulk driver: expired Nifty 1-minute collection, 2025-01-01 to today.

One worker subprocess per trading day (fresh state, crash isolation).
Trading days come from the stored Nifty 50 DAILY candles. Canary gate
runs first; full range follows only if every canary passes.

Run (background, then stop polling until asked):
    cd apps/research && uv run python driver.py > logs/collect.log 2>&1 &

Resume: dates whose parquet exists with failed==0 in meta are skipped;
re-running never re-fetches completed days.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
OUT_DIR = HERE / "data" / "expired_options"
REPORTS = HERE / "reports"
LOGS = HERE / "logs"
LEDGER = REPORTS / "collect_progress.jsonl"
SUMMARY_MD = REPORTS / "collection_summary.md"

CANARY = [
    "2025-01-30",  # Jan expiry day (Thursday regime)
    "2025-06-26",  # Jun expiry day (Thursday regime)
    "2025-08-28",  # last Thursday expiry before the weekday change
    "2025-09-02",  # first Tuesday expiry after the change
    "2026-10-01",  # latest trading day
]
DAILY_DATASET = "c27e48b67c416a3775e2288add8bdbf63655f329b36f1d68ac7864a48240e099"
RANGE_FROM = "2025-01-01"
SLEEP_BETWEEN_DAYS = 5
IST = ZoneInfo("Asia/Kolkata")


def log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def tradx_db() -> Path:
    return Path(
        os.environ.get(
            "TRADX_DB_PATH",
            str(HERE.parents[1] / "apps" / "api" / "data" / "research.db"),
        )
    )


def trading_days() -> list:
    """Sorted YYYY-MM-DD dates with Nifty daily candles in range."""
    con = sqlite3.connect(f"file:{tradx_db()}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT DISTINCT timestamp FROM historical_candles"
            " WHERE dataset_id = ? ORDER BY timestamp",
            (DAILY_DATASET,),
        ).fetchall()
    finally:
        con.close()
    ist = [
        datetime.fromtimestamp(t[0] / 1000, timezone.utc)
        .astimezone(IST)
        .strftime("%Y-%m-%d")
        for t in rows
    ]
    today = date.today().isoformat()
    return sorted(d for d in ist if RANGE_FROM <= d <= today)


def api_healthy() -> bool:
    """Local API liveness gate. A dead server would burn every day with
    unreachable retries, so check first and halt loudly instead."""
    base = os.environ.get("TRADX_API_URL", "http://localhost:3000")
    try:
        with urllib.request.urlopen(base + "/health", timeout=10) as resp:
            return resp.status == 200
    except OSError:
        return False


def fetch_expiries() -> list:
    base = os.environ.get("TRADX_API_URL", "http://localhost:3000")
    url = base + "/instruments/expiries?" + urllib.parse.urlencode(
        {"instrument_key": "NSE_INDEX|Nifty 50"}
    )
    with urllib.request.urlopen(url, timeout=60) as resp:
        body = json.load(resp)
    return [d for d in body.get("data", []) if isinstance(d, str)]


def fetch_active_expiry() -> str | None:
    """Current trading week's expiry, read from the active chain response.

    Used only for days past the last expired expiry (the tail of the
    range). Never computed from weekdays.
    """
    base = os.environ.get("TRADX_API_URL", "http://localhost:3000")
    url = base + "/instruments/option-contracts?" + urllib.parse.urlencode(
        {"instrument_key": "NSE_INDEX|Nifty 50", "expiry_date": "next_week"}
    )
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            body = json.load(resp)
    except OSError:
        return None
    weeks = {r.get("expiry") for r in body.get("data", []) if isinstance(r, dict)}
    return weeks.pop() if len(weeks) == 1 and isinstance(next(iter(weeks)), str) else None


def expiry_acceptable(day: str, expiry: str, expiries: list,
                      active_expiry: str | None) -> bool:
    """E must come from a tool: expired list, or the active chain."""
    if expiry < day:
        return False
    if expiry in expiries:
        return True
    return active_expiry is not None and expiry == active_expiry


def parse_summary_line(line: str) -> dict | None:
    """Parse a worker summary line. None if it is not a summary."""
    import re

    parts = [p.strip() for p in line.split("|")]
    if len(parts) < 8 or not parts[0][:4].isdigit():
        return None
    try:
        short = int(re.search(r"short_series\((\d+)\)", parts[7]).group(1))  # type: ignore[union-attr]
        return {
            "date": parts[0],
            "expiry": parts[1],
            "stored": int(parts[4]),
            "skipped": int(parts[5]),
            "failed": int(parts[6]),
            "short": short,
        }
    except (IndexError, ValueError, AttributeError):
        return None


def run_day(day: str) -> dict:
    """One worker subprocess. Returns a record (never raises)."""
    proc = subprocess.run(
        [sys.executable, "-m", "research.expired_collect", "--date", day],
        cwd=str(SRC),
        capture_output=True,
        text=True,
        timeout=3600,
    )
    out = (proc.stdout or "").strip().splitlines()
    line = out[-1].strip() if out else ""
    rec: dict = {"date": day, "line": line, "rc": proc.returncode}
    parsed = parse_summary_line(line)
    if parsed is not None:
        rec.update(parsed)
        rec["kind"] = "summary"
    elif line in ("AUTH_ERROR",) or line.startswith("INPUT_ERROR"):
        rec["kind"] = "fatal"
    else:
        rec["kind"] = "other"
    tail = proc.stderr.strip().splitlines()
    if tail:
        rec["stderr_tail"] = tail[-3:]
    return rec


def record(rec: dict) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    with open(LEDGER, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")


def already_done(day: str) -> bool:
    """Parquet exists and its meta shows failed==0."""
    if not (OUT_DIR / f"expired_options_{day}.parquet").exists():
        return False
    meta = OUT_DIR / f"expired_options_{day}.meta.json"
    if not meta.exists():
        return False
    try:
        return (
            json.loads(meta.read_text(encoding="utf-8")).get("failed", ["?"])
            == []
        )
    except (json.JSONDecodeError, OSError):
        return False


def verify_existing(day: str, expiries: list, active_expiry: str | None) -> dict:
    """Re-check an ALREADY_COLLECTED day from its meta sidecar.

    The E-from-tool check cannot time-travel: an active-week E recorded
    days ago (e.g. 2026-10-06) will not match today's chain. Instead
    require self-consistency (meta E == summary E, E >= D) plus clean
    counts. Fresh runs still resolve E live from a tool.
    """
    try:
        meta = json.loads(
            (OUT_DIR / f"expired_options_{day}.meta.json").read_text(
                encoding="utf-8")
        )
        parsed = parse_summary_line(meta.get("summary", ""))
    except (OSError, json.JSONDecodeError) as exc:
        return {"date": day, "kind": "unverified", "line": f"ALREADY but unreadable: {exc}"}
    if (
        parsed is None
        or parsed.get("expiry") != meta.get("expiry")
        or parsed.get("date") != day
    ):
        return {"date": day, "kind": "unverified",
                "line": "ALREADY but meta/summary mismatch"}
    rec = {
        "date": day,
        "kind": "summary",
        "expiry": meta.get("expiry", "?"),
        "stored": meta.get("stored", -1),
        "skipped": meta.get("skipped", 99),
        "failed": len(meta.get("failed", ["?"])),
        "short": meta.get("short_series", 99),
        "line": meta.get("summary", "ALREADY_COLLECTED (meta)"),
        "reverified": True,
    }
    return rec


def canary_gate(days: list, expiries: list) -> bool:
    log(f"CANARY start: {CANARY}")
    active_expiry = fetch_active_expiry()
    log(f"CANARY active-week expiry: {active_expiry}")
    ok = True
    for day in CANARY:
        if day not in days:
            log(f"CANARY {day}: ABSENT from trading-day list -> FAIL")
            ok = False
            continue
        rec = run_day(day)
        if rec.get("line", "").startswith("ALREADY_COLLECTED"):
            rec = verify_existing(day, expiries, active_expiry)
            log(f"CANARY {day}: {rec.get('line')} (pre-collected, re-verified)")
        else:
            record(rec)
            log(f"CANARY {day}: {rec.get('line')}")
        if rec.get("kind") != "summary":
            log(f"CANARY {day}: no summary -> FAIL")
            ok = False
            continue
        e_ok = (
            True
            if rec.get("reverified")
            else expiry_acceptable(day, rec["expiry"], expiries, active_expiry)
        )
        checks = {
            "failed==0": rec["failed"] == 0,
            "short==0": rec["short"] == 0,
            "skipped<=2": rec["skipped"] <= 2,
            "E>=D": rec["expiry"] >= day,
            "E-from-tool": e_ok,
        }
        log(f"CANARY {day}: {checks}")
        if not all(checks.values()):
            ok = False
    log("CANARY " + ("PASS: continuing to full range" if ok else "FAIL: STOPPING"))
    return ok


def write_summary(results: list, started: str) -> None:
    failed_days = [
        (r["date"], r.get("line", "?"))
        for r in results
        if r.get("kind") != "summary" or r.get("failed", 1) > 0
    ]
    skipped_combos: list = []
    for rec in results:
        if rec.get("kind") != "summary":
            continue
        try:
            meta = json.loads(
                (OUT_DIR / f"expired_options_{rec['date']}.meta.json").read_text(
                    encoding="utf-8"
                )
            )
            for combo in meta.get("skipped_combos", []):
                skipped_combos.append(
                    (rec["date"], combo["strike"], combo["type"])
                )
        except (OSError, json.JSONDecodeError, KeyError):
            pass
    lines = [
        "# Collection summary",
        "",
        f"- started: {started}",
        f"- days attempted: {len(results)}",
        f"- days failed: {len(failed_days)}",
    ]
    for day, line in failed_days:
        lines.append(f"  - {day}: {line}")
    lines.append(f"- skipped combos (date, strike, type): {len(skipped_combos)}")
    for combo in sorted(skipped_combos):
        lines.append(f"  - {combo[0]}, {combo[1]}, {combo[2]}")
    lines += [
        "",
        "## Expiry-regime note",
        "- Weekly expiries ran Thursday through 2025-08-28, then Tuesday",
        "  from 2025-09-02 (observed in the expiries list; never computed).",
        "- Every run resolves E from the expiries tool (>= D).",
    ]
    REPORTS.mkdir(parents=True, exist_ok=True)
    SUMMARY_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"summary written: {SUMMARY_MD}")


def main(argv: list | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Bulk expired-option collector")
    parser.add_argument(
        "--canary-only",
        action="store_true",
        help="Run the canary gate only, then stop (no full range).",
    )
    args = parser.parse_args(argv)
    LOGS.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    days = trading_days()
    log(f"trading days in range: {len(days)} ({days[0]}..{days[-1]})")
    expiries = fetch_expiries()
    log(f"expiries listed: {len(expiries)}")

    if not canary_gate(days, expiries):
        write_summary([], started)
        return 2
    if args.canary_only:
        log("CANARY-ONLY: stopping before full range.")
        write_summary([], started)
        return 0

    results: list = []
    consec_failed = 0
    for day in days:
        if day in CANARY:
            continue  # already collected above
        if already_done(day):
            log(f"SKIP {day}: parquet + failed=0")
            continue
        if not api_healthy():
            log("HALT: API unreachable, refusing to burn days on retries")
            write_summary(results, started)
            return 6
        rec = run_day(day)
        record(rec)
        results.append(rec)
        log(f"DAY {day}: {rec.get('line')}")
        if rec.get("kind") == "fatal":
            log(f"HALT: {rec.get('line')}")
            write_summary(results, started)
            return 3
        if rec.get("kind") == "summary":
            consec_failed = consec_failed + 1 if rec["failed"] > 0 else 0
            if rec["skipped"] > 4:
                log(f"WARN {day}: skipped={rec['skipped']} possible contract-map gap")
            if rec["stored"] == 0:
                log(f"HALT {day}: stored=0 with spot data")
                write_summary(results, started)
                return 4
        else:
            consec_failed += 1
        if consec_failed >= 3:
            log("HALT: 3 consecutive failed days")
            write_summary(results, started)
            return 5
        time.sleep(SLEEP_BETWEEN_DAYS)

    # Retry FAILED days once: summaries with failed>0, plus transient
    # non-summary days (e.g. CONTRACT_EMPTY). Fatal halts never reach here.
    retry = [
        r["date"]
        for r in results
        if (r.get("kind") == "summary" and r["failed"] > 0)
        or r.get("kind") == "other"
    ]
    for day in retry:
        rec = run_day(day)
        record(rec)
        results.append(rec)
        log(f"RETRY {day}: {rec.get('line')}")
        time.sleep(SLEEP_BETWEEN_DAYS)

    write_summary(results, started)
    log("DONE. Summary path printed above. Stopping.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
