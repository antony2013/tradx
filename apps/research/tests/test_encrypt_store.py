"""encrypt_store tests: round-trip, wrong password, rerun skips."""

import sys

sys.path.insert(0, ".")

import pandas as pd
import pytest

import encrypt_store as es


def _frame():
    return pd.DataFrame(
        {
            "dataset_id": ["d1"] * 3,
            "timestamp": [1, 2, 3],
            "open": [1.0, 1.1, 1.2],
            "high": [1.1, 1.2, 1.3],
            "low": [0.9, 1.0, 1.1],
            "close": [1.05, 1.15, 1.25],
            "volume": [10.0, 20.0, 30.0],
            "oi": [100.0, 110.0, 120.0],
            "strike": [100, 100, 100],
            "type": ["CE", "CE", "CE"],
            "expiry": ["2024-10-03"] * 3,
            "atm_strike": [100, 100, 100],
            "offset": [0, 0, 0],
        }
    )


def _seed(tmp_path):
    _frame().to_parquet(tmp_path / "expired_options_2024-10-03.parquet")
    (tmp_path / "expired_options_2024-10-03.meta.json").write_text(
        '{"summary": "s", "failed": []}'
    )


def test_round_trip_and_rerun_skips(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(es, "IN_DIR", tmp_path)
    monkeypatch.setattr(es, "OUT_DB", tmp_path / "enc.sqlite")
    monkeypatch.setenv("RESEARCH_DB_KEY", "test-pw")
    _seed(tmp_path)
    assert es.main() == 0
    out = capsys.readouterr().out
    assert "rows_added=3" in out

    import sqlcipher3

    db = sqlcipher3.connect(str(tmp_path / "enc.sqlite"))
    db.execute("PRAGMA key='test-pw'")
    assert db.execute("SELECT COUNT(*) FROM candles").fetchone()[0] == 3
    assert db.execute("SELECT summary FROM day_meta").fetchone()[0] == "s"
    db.close()

    assert es.main() == 0  # rerun: skips
    assert "skipped=1" in capsys.readouterr().out


def test_wrong_password_fails_loudly(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(es, "IN_DIR", tmp_path)
    monkeypatch.setattr(es, "OUT_DB", tmp_path / "enc.sqlite")
    monkeypatch.setenv("RESEARCH_DB_KEY", "right-pw")
    _seed(tmp_path)
    assert es.main() == 0
    monkeypatch.setenv("RESEARCH_DB_KEY", "wrong-pw")
    assert es.main() == 2
    assert "INPUT_ERROR" in capsys.readouterr().out


def test_missing_password_refuses(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(es, "IN_DIR", tmp_path)
    monkeypatch.setattr(es, "OUT_DB", tmp_path / "enc.sqlite")
    monkeypatch.delenv("RESEARCH_DB_KEY", raising=False)
    assert es.main() == 2
    assert "RESEARCH_DB_KEY" in capsys.readouterr().out
