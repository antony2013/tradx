#!/usr/bin/env python3
"""Migrate collected parquet days into ONE SQLCipher-encrypted database.

Reads apps/research/data/expired_options/expired_options_*.parquet (+ meta
sidecars) and writes data/expired_options_encrypted.sqlite. Rerunnable:
days already present are skipped (PRIMARY KEY match).

Password comes ONLY from the RESEARCH_DB_KEY env var (never logged,
never stored). Refuses to run without it.

Usage:
    cd apps/research
    $env:RESEARCH_DB_KEY = "<password>"
    uv run python encrypt_store.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
IN_DIR = HERE / "data" / "expired_options"
OUT_DB = HERE / "data" / "expired_options_encrypted.sqlite"

sys.path.insert(0, str(SRC))

CANDLE_COLS = [
    "dataset_id", "timestamp", "open", "high", "low", "close", "volume",
    "oi", "strike", "type", "expiry", "atm_strike", "offset",
]


def open_encrypted(path: Path, key: str):
    import sqlcipher3

    db = sqlcipher3.connect(str(path))
    # PRAGMA key takes no bound parameters; escape quotes instead.
    db.execute(f"PRAGMA key='{key.replace(chr(39), chr(39) * 2)}'")
    # Fail fast on wrong password: read test (empty DB has no tables yet,
    # so validation happens after schema creation by the caller).
    return db


def ensure_schema(db) -> None:
    db.execute(
        "CREATE TABLE IF NOT EXISTS candles ("
        " dataset_id TEXT NOT NULL, timestamp INTEGER NOT NULL,"
        " \"open\" REAL, high REAL, low REAL, close REAL, volume REAL,"
        " oi REAL, strike INTEGER, type TEXT, expiry TEXT,"
        " atm_strike INTEGER, \"offset\" INTEGER,"
        " PRIMARY KEY (dataset_id, timestamp))"
    )
    db.execute(
        "CREATE TABLE IF NOT EXISTS day_meta ("
        " date TEXT PRIMARY KEY, summary TEXT NOT NULL,"
        " meta_json TEXT NOT NULL)"
    )
    db.commit()


def day_present(db, day: str) -> bool:
    row = db.execute(
        "SELECT 1 FROM day_meta WHERE date = ?", (day,)
    ).fetchone()
    return row is not None


def migrate_day(db, parquet_path: Path, day: str) -> tuple:
    """Returns (series, rows). Raises on schema mismatch (fail loudly)."""
    import pandas as pd

    frame = pd.read_parquet(parquet_path)
    missing = [c for c in CANDLE_COLS if c not in frame.columns]
    if missing:
        raise ValueError(f"{parquet_path.name}: missing columns {missing}")
    rows = [
        tuple(None if pd.isna(v) else v for v in rec)
        for rec in frame[CANDLE_COLS].itertuples(index=False, name=None)
    ]
    db.executemany(
        "INSERT OR IGNORE INTO candles"
        " (dataset_id, timestamp, open, high, low, close, volume, oi,"
        " strike, type, expiry, atm_strike, offset)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    meta_path = parquet_path.parent / (
        parquet_path.name.replace(".parquet", ".meta.json")
    )
    meta_json = (
        meta_path.read_text(encoding="utf-8") if meta_path.exists() else "{}"
    )
    summary = ""
    try:
        summary = json.loads(meta_json).get("summary", "")
    except json.JSONDecodeError:
        summary = ""
    db.execute(
        "INSERT OR REPLACE INTO day_meta (date, summary, meta_json)"
        " VALUES (?,?,?)",
        (day, summary, meta_json),
    )
    db.commit()
    n_series = frame[["strike", "type"]].drop_duplicates().shape[0]
    return n_series, len(frame)


def main() -> int:
    key = os.environ.get("RESEARCH_DB_KEY", "")
    if not key:
        print("INPUT_ERROR RESEARCH_DB_KEY is not set", flush=True)
        return 2
    files = sorted(IN_DIR.glob("expired_options_*.parquet"))
    if not files:
        print("INPUT_ERROR no parquet files found", flush=True)
        return 2
    OUT_DIR = OUT_DB.parent
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    db = open_encrypted(OUT_DB, key)
    try:
        try:
            ensure_schema(db)
            # Wrong password on an EXISTING db fails here loudly
            # (sqlcipher raises, variously, DatabaseError/MemoryError).
            db.execute("SELECT count(*) FROM day_meta").fetchone()
        except Exception as exc:  # noqa: BLE001
            print(f"INPUT_ERROR wrong password or corrupt db: {exc}", flush=True)
            return 2
        done = skipped = 0
        total_rows = 0
        for path in files:
            day = path.stem.replace("expired_options_", "")
            if day_present(db, day):
                skipped += 1
                continue
            n_series, n_rows = migrate_day(db, path, day)
            total_rows += n_rows
            done += 1
            print(f"DAY {day}: series={n_series} rows={n_rows}", flush=True)
        print(
            f"DONE days={done} skipped={skipped} rows_added={total_rows}",
            flush=True,
        )
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
