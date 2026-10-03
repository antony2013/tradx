"""Loader tests: synthetic sqlite fixtures + one guarded real-DB smoke."""

import sqlite3

import pandas as pd
import pytest

from research import config
from research.errors import InvalidDatasetError, MissingDataError
from research.loader import bar_ms, load_dataset, snapshot

VALID_ID = "abc123"


def _make_db(path, *, verdict="VALID", schema="upstox-v3-candles-1",
             candles="ok", unit="minutes", interval=1):
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE historical_datasets (dataset_id TEXT PRIMARY KEY,"
        " instrument_key TEXT, unit TEXT, interval INTEGER, source TEXT,"
        " schema_version TEXT,"
        " requested_from TEXT, requested_to TEXT, status TEXT, chunks_total INT,"
        " chunks_completed INT, chunks_failed INT, record_count INT,"
        " created_at INT, updated_at INT)"
    )
    con.execute(
        "CREATE TABLE historical_candles (dataset_id TEXT, timestamp INT,"
        " open REAL, high REAL, low REAL, close REAL, volume REAL,"
        " open_interest REAL, unit TEXT, interval INT)"
    )
    con.execute(
        "CREATE TABLE validation_reports (dataset_id TEXT PRIMARY KEY,"
        " verdict TEXT, candle_count INT, expected_count INT,"
        " completeness REAL, details TEXT, schema_version TEXT,"
        " created_at INT, updated_at INT)"
    )
    con.execute(
        "INSERT INTO historical_datasets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (VALID_ID, "NSE_INDEX|Nifty 50", unit, interval, "upstox", schema,
         "2026-09-28", "2026-09-28", "COMPLETE", 1, 1, 0, 3, 0, 0),
    )
    if verdict is not None:
        con.execute(
            "INSERT INTO validation_reports VALUES (?,?,?,?,?,?,?,?,?)",
            (VALID_ID, verdict, 3, 3, 1.0, "{}", "integrity-report-1", 0, 0),
        )
    base = 1790567100000  # 2026-09-28 09:15 IST
    step = 60_000
    rows = [
        (base, 100.0, 101.0, 99.0, 100.5, 1000.0, None),
        (base + step, 100.5, 102.0, 100.0, 101.5, 1200.0, None),
        (base + 2 * step, 101.5, 103.0, 101.0, 102.5, 1100.0, None),
    ]
    if candles == "gap":
        # Weekend-style skip is legal (multiples of the grid); an off-grid
        # stamp is not.
        rows = [rows[0], (rows[2][0] + 30_000,) + rows[2][1:]]
    elif candles == "dup":
        rows = [rows[0], rows[0], rows[2]]
    elif candles == "empty":
        rows = []
    for r in rows:
        con.execute(
            "INSERT INTO historical_candles VALUES (?,?,?,?,?,?,?,?,?,?)",
            (VALID_ID, *r, unit, interval),
        )
    con.commit()
    con.close()


def test_load_ok_converts_tz_and_decision_ts(tmp_path):
    db = tmp_path / "t.db"
    _make_db(str(db))
    frame = load_dataset(str(db), VALID_ID)
    assert len(frame) == 3
    assert str(frame["bar_start"].dt.tz) == "Asia/Kolkata"
    assert frame["bar_start"].iloc[0].strftime("%H:%M") == "09:15"
    assert (
        frame["decision_ts"].iloc[0] - frame["bar_start"].iloc[0]
    ) == pd.Timedelta(minutes=1)


def test_rejects_missing_dataset(tmp_path):
    db = tmp_path / "t.db"
    _make_db(str(db))
    with pytest.raises(MissingDataError):
        load_dataset(str(db), "nope")


def test_rejects_non_valid_and_missing_report(tmp_path):
    db = tmp_path / "t.db"
    _make_db(str(db), verdict="INCOMPLETE")
    with pytest.raises(InvalidDatasetError, match="verdict"):
        load_dataset(str(db), VALID_ID)
    db2 = tmp_path / "t2.db"
    _make_db(str(db2), verdict=None)
    with pytest.raises(InvalidDatasetError, match="no validation report"):
        load_dataset(str(db2), VALID_ID)


def test_rejects_schema_mismatch_and_empty(tmp_path):
    db = tmp_path / "t.db"
    _make_db(str(db), schema="other-1")
    with pytest.raises(InvalidDatasetError, match="schema_version"):
        load_dataset(str(db), VALID_ID)
    db2 = tmp_path / "t2.db"
    _make_db(str(db2), candles="empty")
    with pytest.raises(InvalidDatasetError, match="zero candles"):
        load_dataset(str(db2), VALID_ID)


def test_rejects_gap_and_duplicate(tmp_path):
    db = tmp_path / "t.db"
    _make_db(str(db), candles="gap")
    with pytest.raises(InvalidDatasetError, match="off-grid"):
        load_dataset(str(db), VALID_ID)
    db2 = tmp_path / "t2.db"
    _make_db(str(db2), candles="dup")
    with pytest.raises(InvalidDatasetError, match="non-monotonic"):
        load_dataset(str(db2), VALID_ID)


def test_accepts_multiday_skip_for_daily(tmp_path):
    # Tue 2026-09-15 then Fri 2026-09-18: 3-day spacing is grid-legal
    # (e.g. a mid-week holiday gap). Completeness belongs to the VALID
    # verdict, not the structural grid check.
    db = tmp_path / "t.db"
    con = sqlite3.connect(str(db))
    con.execute(
        "CREATE TABLE historical_datasets (dataset_id TEXT PRIMARY KEY,"
        " instrument_key TEXT, unit TEXT, interval INTEGER, source TEXT,"
        " schema_version TEXT,"
        " requested_from TEXT, requested_to TEXT, status TEXT, chunks_total INT,"
        " chunks_completed INT, chunks_failed INT, record_count INT,"
        " created_at INT, updated_at INT)"
    )
    con.execute(
        "CREATE TABLE historical_candles (dataset_id TEXT, timestamp INT,"
        " open REAL, high REAL, low REAL, close REAL, volume REAL,"
        " open_interest REAL, unit TEXT, interval INT)"
    )
    con.execute(
        "CREATE TABLE validation_reports (dataset_id TEXT PRIMARY KEY,"
        " verdict TEXT, candle_count INT, expected_count INT,"
        " completeness REAL, details TEXT, schema_version TEXT,"
        " created_at INT, updated_at INT)"
    )
    con.execute(
        "INSERT INTO historical_datasets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (VALID_ID, "NSE_INDEX|Nifty 50", "days", 1, "upstox",
         "upstox-v3-candles-1", "2026-09-15", "2026-09-18", "COMPLETE",
         1, 1, 0, 2, 0, 0),
    )
    con.execute(
        "INSERT INTO validation_reports VALUES (?,?,?,?,?,?,?,?,?)",
        (VALID_ID, "VALID", 2, 2, 1.0, "{}", "integrity-report-1", 0, 0),
    )
    tue = 1789410600000  # Tue 2026-09-15 00:00 UTC
    fri = tue + 3 * 86_400_000  # Fri 2026-09-18
    for ts in (tue, fri):
        con.execute(
            "INSERT INTO historical_candles VALUES (?,?,?,?,?,?,?,?,?,?)",
            (VALID_ID, ts, 100.0, 101.0, 99.0, 100.5, 1000.0, None,
             "days", 1),
        )
    con.commit()
    con.close()
    frame = load_dataset(str(db), VALID_ID)
    assert len(frame) == 2


def test_bar_ms_units():
    assert bar_ms("minutes", 5) == 300_000
    assert bar_ms("hours", 1) == 3_600_000
    assert bar_ms("days", 1) == 86_400_000
    with pytest.raises(InvalidDatasetError, match="weeks"):
        bar_ms("weeks", 1)


def test_snapshot_writes_once_and_refuses_overwrite(tmp_path):
    db = tmp_path / "t.db"
    _make_db(str(db))
    frame = load_dataset(str(db), VALID_ID)
    out = tmp_path / "snaps"
    path = snapshot(frame, VALID_ID, out_dir=out)
    assert path.exists()
    reread = pd.read_parquet(path)
    assert len(reread) == 3
    with pytest.raises(FileExistsError):
        snapshot(frame, VALID_ID, out_dir=out)


def test_real_db_smoke():
    """Guarded integration: real VALID 1-minute Nifty day."""
    from pathlib import Path

    if not Path(config.TRADX_DB_PATH).exists():
        pytest.skip("no tradx DB")
    try:
        frame = load_dataset(
            config.TRADX_DB_PATH,
            "ef6530935b28fe6d151fcf99c29eb3c144316b5e2d18aeb4ff1f51470199b805",
        )
    except (MissingDataError, InvalidDatasetError) as exc:
        pytest.skip(f"dataset unavailable: {exc}")
    assert len(frame) == 375
    assert frame["bar_start"].iloc[0].strftime("%H:%M") == "09:15"
    assert frame["bar_start"].iloc[-1].strftime("%H:%M") == "15:29"
