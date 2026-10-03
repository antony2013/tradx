"""Single-option feature unit tests (synthetic) + stub contract tests."""

import numpy as np
import pandas as pd
import pytest

from research.errors import InvalidDatasetError, MissingDataError
from research import features as F


def _opt(n=40, volume=500.0, oi=10000.0):
    idx = pd.date_range("2026-09-15 09:15", periods=n, freq="D", tz="Asia/Kolkata")
    return pd.DataFrame(
        {
            "bar_start": idx,
            "open": 200.0,
            "high": 205.0,
            "low": 198.0,
            "close": 202.0 + np.arange(n) * 0.5,
            "volume": [volume + i * 10.0 for i in range(n)],
            "open_interest": [oi + i * 100.0 for i in range(n)],
        }
    )


def test_oi_change_exact():
    f = _opt()
    out = F.oi_change(f)
    assert out.name == "oi_change"
    assert np.isnan(out.iloc[0])
    assert (out.iloc[1:] == 100.0).all()


def test_oi_change_null_stays_nan():
    f = _opt()
    f.loc[5, "open_interest"] = None
    out = F.oi_change(f)
    assert np.isnan(out.iloc[5])
    assert np.isnan(out.iloc[6])


def test_volume_zscore_zero_volume_nan_and_logged(caplog):
    f = _opt()
    f.loc[25, "volume"] = 0.0
    with caplog.at_level("INFO", logger="research.features"):
        out = F.volume_zscore(f, window=10)
    assert np.isnan(out.iloc[25])
    assert not out.iloc[30:].isna().any()
    assert "zero-volume" in caplog.text
    with pytest.raises(InvalidDatasetError):
        F.volume_zscore(f, window=1)


def test_truncation_invariance_option():
    f = _opt(n=40)
    for name, func in F.SINGLE_OPTION_FEATURES.items():
        full = func(f)
        for t in (25, 39):
            cut = f.iloc[: t + 1]
            got = func(cut).iloc[-1]
            want = full.iloc[t]
            if np.isnan(want):
                assert np.isnan(got), name
            else:
                assert got == pytest.approx(want, abs=1e-12), name


def test_all_stubs_raise_missing_data():
    f = _opt(n=5)
    stubs = [
        F.moneyness,
        F.option_iv,
        F.iv_change,
        F.option_delta,
        F.option_gamma,
        F.option_theta,
        F.option_vega,
        F.dte,
        F.expiry_day_flag,
        F.ce_pe_iv_skew,
        F.iv_minus_realized_vol,
        F.iv_vix_ratio,
    ]
    assert len(stubs) == 12
    for stub in stubs:
        with pytest.raises(MissingDataError):
            stub(f)
    from research.panel import join_snapshots, load_manifest

    with pytest.raises(MissingDataError, match="futures"):
        join_snapshots(f, f)
    with pytest.raises(MissingDataError, match="manifest"):
        load_manifest("data/research/manifest.parquet")
