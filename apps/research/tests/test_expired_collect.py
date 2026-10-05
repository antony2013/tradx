"""Expired collector tests: fully mocked HTTP + DB reads."""

import json

import pandas as pd
import pytest

from research import expired_collect as ec


def _spot_row(o=25000.0, h=25100.0, low=24900.0):
    return [(0, o, h, low, 25050.0, 1000.0, None)]


def _chain():
    return [
        {"strike_price": 25000, "instrument_type": "CE",
         "instrument_key": "NSE_FO|1|03-10-2024"},
        {"strike_price": 25000, "instrument_type": "PE",
         "instrument_key": "NSE_FO|2|03-10-2024"},
    ]


def _candles(n=375):
    base = 1727927100000
    return [(base + i * 60000, 1.0, 1.1, 0.9, 1.05, 10.0, 5.0)
            for i in range(n)]


class Script:
    """Scripted _post/_get/_read_candles with call counts."""

    def __init__(self):
        self.posts = []
        self.post_impl = None
        self.get_impl = None
        self.read_impl = None

    def install(self, monkeypatch):
        monkeypatch.setattr(ec, "_post", self._post)
        monkeypatch.setattr(ec, "_get", self._get)
        monkeypatch.setattr(ec, "_read_candles", self._read)

    def _post(self, path, payload):
        self.posts.append(payload)
        return self.post_impl(path, payload)

    def _get(self, path):
        return self.get_impl(path)

    def _read(self, dataset_id):
        return self.read_impl(dataset_id)


def _full_script(monkeypatch, candles_n=375):
    s = Script()
    s.post_impl = lambda path, p: {
        "status": 200,
        "body": {"dataset_id": f"ds-{p['instrumentKey']}-{p['interval']}",
                 "status": "COMPLETE", "reused": False},
    }
    s.get_impl = lambda path: (
        {"status": 200, "body": {"data": ["2024-10-03", "2024-10-10"]}}
        if "expiries" in path
        else {"status": 200, "body": {"data": _chain()}}
    )
    s.read_impl = lambda dsid: (
        _spot_row() if "Nifty" in dsid else _candles(candles_n)
    )
    s.install(monkeypatch)
    return s


def test_no_data_spot(monkeypatch, tmp_path):
    s = Script()
    s.post_impl = lambda path, p: {
        "status": 200,
        "body": {"dataset_id": "ds-spot", "status": "COMPLETE"},
    }
    s.get_impl = lambda path: {"status": 200, "body": {"data": []}}
    s.read_impl = lambda dsid: []
    s.install(monkeypatch)
    monkeypatch.setattr(ec, "OUT_DIR", tmp_path)
    assert ec.run("2024-10-03") == "NO_DATA_SPOT 2024-10-03"


def test_full_run_summary_and_parquet(monkeypatch, tmp_path):
    _full_script(monkeypatch)
    monkeypatch.setattr(ec, "OUT_DIR", tmp_path)
    line = ec.run("2024-10-03")
    # open=25000 -> atm 25000; low 24900 -> lo 24800; high 25100 -> hi 25200
    # strikes: 24800..25200 step 50 = 9; only 25000 CE/PE have contracts
    assert line.startswith("2024-10-03 | 2024-10-03 | 25000 | 9")
    parts = [p.strip() for p in line.split("|")]
    assert parts[4] == "2"  # stored CE+PE
    assert "short_series(0)" in line
    frame = pd.read_parquet(tmp_path / "expired_options_2024-10-03.parquet")
    assert len(frame) == 750
    assert set(frame.columns) >= {"strike", "type", "expiry", "atm_strike",
                                  "offset", "oi", "dataset_id"}
    assert set(frame["offset"]) == {0}
    meta = json.loads(
        (tmp_path / "expired_options_2024-10-03.meta.json").read_text()
    )
    assert meta["summary"] == line
    assert meta["failed"] == []
    assert len(meta["skipped_combos"]) == 16  # 8 unmatched strikes x CE/PE
    assert all(
        c["strike"] % 50 == 0 and c["type"] in ("CE", "PE")
        for c in meta["skipped_combos"]
    )


def test_retry_cap_never_fourth(monkeypatch, tmp_path):
    s = Script()
    s.post_impl = lambda path, p: {
        "status": 200,
        "body": {"dataset_id": f"ds-{p['instrumentKey']}",
                 "status": "COMPLETE", "reused": False},
    }
    s.get_impl = lambda path: (
        {"status": 200, "body": {"data": ["2024-10-03"]}}
        if "expiries" in path
        else {"status": 200, "body": {"data": _chain()}}
    )
    # spot ok, everything else empty -> 3 attempts each, then FAILED
    s.read_impl = lambda dsid: _spot_row() if "Nifty" in dsid else []
    s.install(monkeypatch)
    monkeypatch.setattr(ec, "OUT_DIR", tmp_path)
    line = ec.run("2024-10-03")
    ce_posts = [p for p in s.posts
                if p.get("instrumentKey") == "NSE_FO|1|03-10-2024"]
    pe_posts = [p for p in s.posts
                if p.get("instrumentKey") == "NSE_FO|2|03-10-2024"]
    assert len(ce_posts) == 3
    assert len(pe_posts) == 3
    assert "FAILED=25000CE,25000PE" in line


def test_reused_complete_skips(monkeypatch, tmp_path):
    s = Script()
    s.post_impl = lambda path, p: {
        "status": 200,
        "body": {"dataset_id": "ds-x", "status": "COMPLETE", "reused": True},
    }
    s.get_impl = lambda path: (
        {"status": 200, "body": {"data": ["2024-10-03"]}}
        if "expiries" in path
        else {"status": 200, "body": {"data": _chain()}}
    )
    s.read_impl = lambda dsid: _spot_row()
    s.install(monkeypatch)
    monkeypatch.setattr(ec, "OUT_DIR", tmp_path)
    line = ec.run("2024-10-03")
    parts = [p.strip() for p in line.split("|")]
    assert parts[4] == "0"  # stored
    assert parts[5] == "18"  # skipped: 8 unmatched strikes*2 + 2 reused


def test_auth_error_prints_and_stops(monkeypatch, tmp_path, capsys):
    def boom(method, path, payload=None):
        raise ec.AuthError("HTTP 401")

    monkeypatch.setattr(ec, "_request", boom)
    monkeypatch.setattr(ec, "OUT_DIR", tmp_path)
    assert ec.main(["--date", "2024-10-03"]) == 0
    assert capsys.readouterr().out.strip() == "AUTH_ERROR"


def test_acquire_backs_off_on_429(monkeypatch):
    calls = {"n": 0, "sleeps": []}
    responses = [
        {"status": 429, "body": {"error": "slow"}},
        {"status": 429, "body": {"error": "slow"}},
        {"status": 200, "body": {"dataset_id": "d", "status": "COMPLETE"}},
    ]

    def fake_request(path, payload=None):
        calls["n"] += 1
        return responses[min(calls["n"] - 1, 2)]

    monkeypatch.setattr(ec, "_post", fake_request)
    monkeypatch.setattr("time.sleep", lambda s: calls["sleeps"].append(s))
    out = ec.acquire("2024-10-03", "K", "1minute")
    assert out["ok"] is True
    assert calls["n"] == 3
    assert calls["sleeps"] == [2, 4]


def test_acquire_gives_up_after_429_limit(monkeypatch):
    calls = {"sleeps": []}
    monkeypatch.setattr(
        ec, "_post", lambda path, payload=None: {"status": 429, "body": {}}
    )
    monkeypatch.setattr("time.sleep", lambda s: calls["sleeps"].append(s))
    out = ec.acquire("2024-10-03", "K", "1minute")
    assert out["ok"] is False
    assert calls["sleeps"] == [2, 4, 8]


def _active_chain(expiry="2026-10-06"):
    return [
        {"strike_price": 22600, "instrument_type": "CE",
         "instrument_key": "NSE_FO|90001", "expiry": expiry},
        {"strike_price": 22600, "instrument_type": "PE",
         "instrument_key": "NSE_FO|90002", "expiry": expiry},
    ]


def _active_script(monkeypatch, tmp_path, chain):
    s = Script()
    s.post_impl = lambda path, p: {
        "status": 200,
        "body": {"dataset_id": f"ds-{p['instrumentKey']}",
                 "status": "COMPLETE", "reused": False},
    }

    def get_impl(path):
        if "expiries?" in path and "expired-option" not in path:
            return {"status": 200, "body": {"data": ["2026-09-29"]}}
        return {"status": 200, "body": {"data": chain}}

    s.get_impl = get_impl
    s.read_impl = lambda dsid: _spot_row(22700.0, 22750.0, 22650.0) if "Nifty" in dsid else _candles(375)
    s.install(monkeypatch)
    monkeypatch.setattr(ec, "OUT_DIR", tmp_path)
    return s


def test_active_fallback_for_recent_day(monkeypatch, tmp_path):
    _active_script(monkeypatch, tmp_path, _active_chain())
    line = ec.run("2026-10-01")
    assert line.startswith("2026-10-01 | 2026-10-06 | ")
    parts = [p.strip() for p in line.split("|")]
    assert parts[4] == "2"  # stored CE+PE
    assert "short_series(0)" in line


def test_active_mixed_expiries_rejected(monkeypatch, tmp_path):
    chain = _active_chain() + [
        {"strike_price": 22700, "instrument_type": "CE",
         "instrument_key": "NSE_FO|90003", "expiry": "2026-10-13"}
    ]
    _active_script(monkeypatch, tmp_path, chain)
    assert ec.run("2026-10-01").startswith("CONTRACT_ERROR")


def test_empty_chain_retried_before_skip(monkeypatch, tmp_path):
    calls = {"n": 0, "sleeps": []}
    chain = _chain()

    def get_impl(path):
        if "expired-option-contracts" in path:
            calls["n"] += 1
            if calls["n"] < 3:
                return {"status": 200, "body": {"data": []}}
            return {"status": 200, "body": {"data": chain}}
        return {"status": 200, "body": {"data": ["2024-10-03"]}}

    s = Script()
    s.post_impl = lambda path, p: {
        "status": 200,
        "body": {"dataset_id": "ds", "status": "COMPLETE", "reused": False},
    }
    s.get_impl = get_impl
    s.read_impl = lambda dsid: _spot_row()
    s.install(monkeypatch)
    monkeypatch.setattr(ec, "OUT_DIR", tmp_path)
    monkeypatch.setattr("time.sleep", lambda sec: calls["sleeps"].append(sec))
    line = ec.run("2024-10-03")
    assert calls["n"] == 3
    assert calls["sleeps"] == [5, 5]
    assert " | 2 | " in line  # 2 stored


def test_expiry_pick_and_grid_math():
    assert ec.pick_expiry(["2024-10-10", "2024-10-03"], "2024-10-03") == "2024-10-03"
    assert ec.pick_expiry(["2024-09-26", "2024-10-03"], "2024-10-03") == "2024-10-03"
    try:
        ec.pick_expiry(["2024-09-26"], "2024-10-03")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")
    atm, strikes = ec.strike_grid(25013.0, 24900.0, 25100.0)
    assert atm == 25000
    assert strikes[0] == 24800 and strikes[-1] == 25200
    assert all(s % 50 == 0 for s in strikes)
