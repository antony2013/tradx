"""Spot collector tests: fully mocked HTTP + DB reads."""

import json

import pandas as pd

from research import spot_collect as sc


def _candles(n=375):
    base = 1790567100000
    return [(base + i * 60000, 100.0, 101.0, 99.0, 100.5, 0.0)
            for i in range(n)]


class Script:
    def __init__(self, candles=375, verdict="VALID"):
        self.candles = candles
        self.verdict = verdict
        self.posts = []

    def install(self, monkeypatch):
        import urllib.request

        def fake_urlopen(request, timeout=0):
            url = request.full_url
            self.posts.append(url)
            if url.endswith("/historical/datasets"):
                body = {"dataset_id": "ds-spot", "status": "COMPLETE",
                        "reused": False}
            else:
                body = {"verdict": self.verdict, "completeness": 1.0,
                        "gap_count": 0, "gaps": [], "notes": []}
            import io

            class R:
                status = 200

                def __enter__(self):
                    return self

                def __exit__(self, *a):
                    return False

                def read(self, *a):
                    return json.dumps(body).encode()

            return R()

        monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
        monkeypatch.setattr(
            sc, "read_candles",
            lambda dsid: _candles(self.candles),
        )


def test_full_day_stores_and_metas(monkeypatch, tmp_path):
    Script().install(monkeypatch)
    monkeypatch.setattr(sc, "OUT_DIR", tmp_path)
    line = sc.run("2026-09-28")
    assert line == "2026-09-28 | rows=375 | VALID"
    frame = pd.read_parquet(tmp_path / "spot_1m_2026-09-28.parquet")
    assert len(frame) == 375
    assert set(frame.columns) >= {"timestamp", "open", "close", "volume",
                                  "dataset_id"}
    meta = json.loads(
        (tmp_path / "spot_1m_2026-09-28.meta.json").read_text()
    )
    assert meta["verdict"] == "VALID" and meta["rows"] == 375
    assert sc.run("2026-09-28").startswith("ALREADY_COLLECTED")


def test_empty_is_no_data_spot(monkeypatch, tmp_path):
    s = Script(candles=0)
    s.install(monkeypatch)
    monkeypatch.setattr(sc, "OUT_DIR", tmp_path)
    assert sc.run("2026-09-28") == "NO_DATA_SPOT 2026-09-28"


def test_auth_error_raises(monkeypatch):
    import urllib.error

    import urllib.request

    def boom(request, timeout=0):
        raise sc.AuthError("HTTP 401")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    try:
        sc.run("2026-09-28")
    except sc.AuthError:
        pass
    else:
        raise AssertionError("expected AuthError")
