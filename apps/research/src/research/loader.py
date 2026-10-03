"""Load validated candle datasets from the tradx SQLite DB (read-only).

Conventions (verified against real data 2026-10-03):
- candle timestamp = epoch MILLISECONDS UTC of the BAR START
  (1-minute Nifty bars run 09:15, 09:16, ... IST with uniform 60s spacing).
- decision_ts = bar_start + one bar length: a candle's close is only
  known then. Every downstream feature may only use bars ending
  at or before decision_ts.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pandas as pd

from . import config
from .errors import InvalidDatasetError, MissingDataError

def bar_ms(unit: str, interval: int) -> int:
    """Bar length in ms. Only fixed-length units have a decision_ts."""
    if unit == "minutes":
        return interval * 60_000
    if unit == "hours":
        return interval * 3_600_000
    if unit == "days":
        return interval * 86_400_000
    raise InvalidDatasetError(
        f"decision_ts is undefined for unit={unit!r}: "
        "weeks/months have no fixed bar length"
    )


def _connect_ro(db_path: str) -> sqlite3.Connection:
    path = Path(db_path)
    if not path.exists():
        raise MissingDataError(f"tradx DB not found: {db_path}")
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def load_dataset(db_path: str, dataset_id: str) -> pd.DataFrame:
    """Load one VALIDATED dataset. Raises on anything unusable.

    - dataset row missing -> MissingDataError
    - no validation report, or verdict != VALID -> InvalidDatasetError
    - schema_version mismatch -> InvalidDatasetError
    - zero candles -> InvalidDatasetError
    - non-monotonic or non-uniform bar timestamps -> InvalidDatasetError
    """
    con = _connect_ro(db_path)
    try:
        meta = con.execute(
            "SELECT instrument_key, unit, interval, schema_version,"
            " requested_from, requested_to FROM historical_datasets"
            " WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchone()
        if meta is None:
            raise MissingDataError(f"dataset not found: {dataset_id}")
        instrument_key, unit, interval, schema_version, _, _ = meta
        if schema_version != config.EXPECTED_DATASET_SCHEMA_VERSION:
            raise InvalidDatasetError(
                f"{dataset_id}: schema_version={schema_version!r},"
                f" expected {config.EXPECTED_DATASET_SCHEMA_VERSION!r}"
            )
        report = con.execute(
            "SELECT verdict, schema_version FROM validation_reports"
            " WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchone()
        if report is None:
            raise InvalidDatasetError(
                f"{dataset_id}: no validation report; refusing unvalidated data"
            )
        verdict, report_schema = report
        if verdict != "VALID":
            raise InvalidDatasetError(
                f"{dataset_id}: verdict={verdict!r}, only VALID is loadable"
            )
        if report_schema != config.EXPECTED_VALIDATION_SCHEMA_VERSION:
            raise InvalidDatasetError(
                f"{dataset_id}: validation schema={report_schema!r},"
                f" expected {config.EXPECTED_VALIDATION_SCHEMA_VERSION!r}"
            )
        rows = con.execute(
            "SELECT timestamp, open, high, low, close, volume, open_interest"
            " FROM historical_candles WHERE dataset_id = ? ORDER BY timestamp",
            (dataset_id,),
        ).fetchall()
    finally:
        con.close()
    if not rows:
        raise InvalidDatasetError(f"{dataset_id}: VALID but zero candles")

    step = bar_ms(unit, interval)
    stamps = [r[0] for r in rows]
    for prev, cur in zip(stamps, stamps[1:]):
        if cur <= prev:
            raise InvalidDatasetError(
                f"{dataset_id}: non-monotonic timestamps at {cur}"
            )
        if cur - prev != step:
            raise InvalidDatasetError(
                f"{dataset_id}: non-uniform spacing {cur - prev}ms"
                f" after {prev}, expected {step}ms"
            )

    frame = pd.DataFrame(
        rows,
        columns=["timestamp", "open", "high", "low", "close", "volume", "open_interest"],
    )
    bar_start = pd.to_datetime(frame["timestamp"], unit="ms", utc=True).dt.tz_convert(
        config.IST
    )
    frame.insert(0, "dataset_id", dataset_id)
    frame.insert(1, "instrument_key", instrument_key)
    frame.insert(2, "unit", unit)
    frame.insert(3, "interval", interval)
    frame.insert(4, "bar_start", bar_start)
    frame.insert(
        5, "decision_ts", bar_start + pd.to_timedelta(step, unit="ms")
    )
    return frame.reset_index(drop=True)


def snapshot(
    frame: pd.DataFrame,
    dataset_id: str,
    out_dir: str | Path = config.DATA_DIR,
) -> Path:
    """Save data/{dataset_id}.parquet. Never overwrites an existing file."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{dataset_id}.parquet"
    if path.exists():
        raise FileExistsError(f"snapshot exists, refusing to overwrite: {path}")
    frame.to_parquet(path, engine="pyarrow", index=False)
    return path
