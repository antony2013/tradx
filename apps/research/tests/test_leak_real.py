"""Leak tests on REAL snapshots (guarded: skip if DB/datasets absent).

- snapshot() two VALID datasets to tmp (never the package data dir),
- truncation invariance for every computable feature at several t,
- shuffled-timestamp sanity: order-dependent features must change.
"""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from research import config
from research.errors import InvalidDatasetError, MissingDataError
from research.features import SINGLE_OPTION_FEATURES, UNDERLYING_FEATURES
from research.loader import load_dataset, snapshot

SPOT_ID = "ef6530935b28fe6d151fcf99c29eb3c144316b5e2d18aeb4ff1f51470199b805"
OPT_ID = "96e63a96ac636d932ed15ce885a6fb6af8a183609d2d565f6b8c1144d4efab3c"


def _load_or_skip(dataset_id):
    if not Path(config.TRADX_DB_PATH).exists():
        pytest.skip("no tradx DB")
    try:
        return load_dataset(config.TRADX_DB_PATH, dataset_id)
    except (MissingDataError, InvalidDatasetError) as exc:
        pytest.skip(f"dataset unavailable: {exc}")


def _snapshot_tmp(frame, dataset_id, tmp_path):
    return snapshot(frame, dataset_id, out_dir=tmp_path)


def test_snapshots_real_spot_and_option(tmp_path):
    spot = _load_or_skip(SPOT_ID)
    opt = _load_or_skip(OPT_ID)
    p1 = _snapshot_tmp(spot, SPOT_ID, tmp_path)
    p2 = _snapshot_tmp(opt, OPT_ID, tmp_path)
    assert pd.read_parquet(p1).shape[0] == 375
    assert pd.read_parquet(p2).shape[0] == 6
    with pytest.raises(FileExistsError):
        snapshot(spot, SPOT_ID, out_dir=tmp_path)


def _check_invariance(frame, funcs, points):
    for name, func in funcs.items():
        full = func(frame)
        for t in points:
            cut = frame.iloc[: t + 1]
            got = func(cut).iloc[-1]
            want = full.iloc[t]
            if pd.isna(want):
                assert pd.isna(got), (name, t)
            else:
                assert got == pytest.approx(want, abs=1e-12), (name, t)


def test_leak_underlying_on_real_snapshot(tmp_path):
    spot = _load_or_skip(SPOT_ID)
    _snapshot_tmp(spot, SPOT_ID, tmp_path)
    _check_invariance(spot, UNDERLYING_FEATURES, (50, 150, 300, 374))


def test_leak_single_option_on_real_snapshot(tmp_path):
    opt = _load_or_skip(OPT_ID)
    _snapshot_tmp(opt, OPT_ID, tmp_path)
    _check_invariance(opt, SINGLE_OPTION_FEATURES, (3, 5))


def test_shuffled_timestamps_change_order_dependent_features():
    spot = _load_or_skip(SPOT_ID)
    rng = np.random.default_rng(7)
    shuffled = spot.sample(frac=1.0, random_state=rng).reset_index(drop=True)
    from research.features import log_return, realized_vol, vwap_distance

    assert not log_return(shuffled, 1).equals(log_return(spot, 1))
    assert not realized_vol(shuffled).equals(realized_vol(spot))
    # Spot volume is structurally zero, so VWAP is all-NaN ordered and
    # shuffled alike (trivially invariant). Order-sensitivity of VWAP is
    # proven on a volume-bearing frame instead.
    assert vwap_distance(shuffled).equals(vwap_distance(spot))
    vol_frame = pd.DataFrame(
        {
            "bar_start": pd.date_range(
                "2026-09-28 09:15", periods=30, freq="min", tz="Asia/Kolkata"
            ),
            "high": 101.0,
            "low": 99.0,
            "close": 100.0 + np.arange(30) * 0.1,
            "volume": 1000.0,
        }
    )
    vol_shuffled = vol_frame.sample(frac=1.0, random_state=rng).reset_index(
        drop=True
    )
    assert not vwap_distance(vol_shuffled).equals(vwap_distance(vol_frame))
