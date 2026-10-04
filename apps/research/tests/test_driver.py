"""Driver helper tests (no subprocesses, no network)."""

import json
import sys

sys.path.insert(0, ".")

import driver


def test_parse_summary_line():
    rec = driver.parse_summary_line(
        "2024-10-03 | 2024-10-03 | 25450 | 14 | 27 | 1 | 0 | short_series(0)"
    )
    assert rec == {
        "date": "2024-10-03",
        "expiry": "2024-10-03",
        "stored": 27,
        "skipped": 1,
        "failed": 0,
        "short": 0,
    }
    assert driver.parse_summary_line("AUTH_ERROR") is None
    assert driver.parse_summary_line("NO_DATA_SPOT 2024-10-03") is None
    assert driver.parse_summary_line("") is None


def test_already_done_needs_parquet_and_clean_meta(tmp_path, monkeypatch):
    monkeypatch.setattr(driver, "OUT_DIR", tmp_path)
    assert driver.already_done("2024-10-03") is False
    (tmp_path / "expired_options_2024-10-03.parquet").write_bytes(b"x")
    assert driver.already_done("2024-10-03") is False
    (tmp_path / "expired_options_2024-10-03.meta.json").write_text(
        json.dumps({"failed": []})
    )
    assert driver.already_done("2024-10-03") is True
    (tmp_path / "expired_options_2024-10-03.meta.json").write_text(
        json.dumps({"failed": ["1CE"]})
    )
    assert driver.already_done("2024-10-03") is False
