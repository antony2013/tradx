"""Underlying feature unit tests on synthetic frames."""

import numpy as np
import pandas as pd
import pytest

from research.errors import InvalidDatasetError
from research.features import (
    atr_ratio,
    cos_minute_of_day,
    log_return,
    realized_vol,
    sin_minute_of_day,
    vwap_distance,
)


def _frame(n=60, sessions=2, volume=1000.0, start="2026-09-28 09:15"):
    idx = pd.date_range(start, periods=n, freq="min", tz="Asia/Kolkata")
    # roll to a second session halfway (next weekday 09:15)
    if sessions == 2:
        first, second = idx[: n // 2], idx[n // 2 :]
        second = second + pd.Timedelta(days=1)
        second = second.normalize() + pd.Timedelta(hours=9, minutes=15) + pd.to_timedelta(
            range(len(second)), unit="min"
        )
        idx = first.append(second)
    close = 100.0 + np.arange(n) * 0.1
    return pd.DataFrame(
        {
            "bar_start": idx,
            "open": close - 0.05,
            "high": close + 0.05,
            "low": close - 0.1,
            "close": close,
            "volume": [volume] * n,
        }
    )


def test_log_returns_exact_and_warmup():
    f = _frame()
    out = log_return(f, 1)
    assert out.name == "logret_1"
    assert np.isnan(out.iloc[0])
    assert out.iloc[1] == pytest.approx(np.log(f["close"].iloc[1] / f["close"].iloc[0]))
    out3 = log_return(f, 3)
    assert out3.iloc[:3].isna().all()
    assert not out3.iloc[3:].isna().any()
    with pytest.raises(InvalidDatasetError):
        log_return(f, 0)


def test_realized_vol_backward_only():
    f = _frame(n=30)
    out = realized_vol(f, window=5, bars_per_year=252.0)
    assert out.iloc[:5].isna().all()
    expected = (
        np.log(f["close"] / f["close"].shift(1)).rolling(5).std(ddof=1)
        * np.sqrt(252.0)
    )
    pd.testing.assert_series_equal(out, expected.rename("realized_vol_5"), check_names=False)
    with pytest.raises(InvalidDatasetError):
        realized_vol(f, window=1)


def test_atr_ratio_uses_prior_close():
    f = _frame(n=20)
    out = atr_ratio(f, window=5)
    # TR is defined from row 0 (high-low needs no prior close), so the
    # 5-bar mean is first valid at index 4.
    assert out.iloc[:4].isna().all()
    assert (out.iloc[4:] > 0).all()
    with pytest.raises(InvalidDatasetError):
        atr_ratio(f.drop(columns=["high"]), window=5)


def test_vwap_distance_session_reset_and_zero_volume():
    f = _frame(n=60, sessions=2)
    out = vwap_distance(f)
    # first bar of each session: vwap == typical of that bar only
    assert out.iloc[0] == pytest.approx(
        (f["close"].iloc[0] - (f["high"].iloc[0] + f["low"].iloc[0] + f["close"].iloc[0]) / 3.0)
        / ((f["high"].iloc[0] + f["low"].iloc[0] + f["close"].iloc[0]) / 3.0)
    )
    mid = 30
    assert out.iloc[mid] == pytest.approx(
        (f["close"].iloc[mid] - (f["high"].iloc[mid] + f["low"].iloc[mid] + f["close"].iloc[mid]) / 3.0)
        / ((f["high"].iloc[mid] + f["low"].iloc[mid] + f["close"].iloc[mid]) / 3.0)
    )
    zero = _frame(n=10, sessions=1, volume=0.0)
    assert vwap_distance(zero).isna().all()


def test_sin_cos_minute():
    f = _frame(n=3, sessions=1)
    assert sin_minute_of_day(f).iloc[0] == pytest.approx(
        np.sin(2 * np.pi * (9 * 60 + 15) / 1440.0)
    )
    assert cos_minute_of_day(f).iloc[0] == pytest.approx(
        np.cos(2 * np.pi * (9 * 60 + 15) / 1440.0)
    )
    naive = f.copy()
    naive["bar_start"] = pd.to_datetime(naive["bar_start"]).dt.tz_localize(None)
    with pytest.raises(InvalidDatasetError):
        sin_minute_of_day(naive)


def test_truncation_invariance_spot():
    """Value at t on data cut at t == value at t on full data."""
    from research.features import UNDERLYING_FEATURES

    f = _frame(n=60, sessions=2)
    for name, func in UNDERLYING_FEATURES.items():
        full = func(f)
        for t in (20, 35, 59):
            cut = f.iloc[: t + 1]
            assert func(cut).iloc[-1] == pytest.approx(full.iloc[t], abs=1e-12), name
