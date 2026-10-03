"""Pilot feature set: pure functions, backward-looking only.

Conventions (leak discipline):
- Every window uses bars at or before the current bar (pandas rolling /
  shift are past-inclusive by default; never use future data).
- Session-reset indicators group by the IST calendar date of bar_start.
- Undefined values are NaN (zero-volume VWAP, short warmup), never
  fabricated. Drop-count logging lives with the matrix caller, not here.
- Required columns are checked explicitly; a missing column raises
  InvalidDatasetError (programmer error, fail loudly).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .errors import InvalidDatasetError

OHLCV = ("open", "high", "low", "close", "volume")


def _require(frame: pd.DataFrame, *columns: str) -> None:
    missing = [c for c in columns if c not in frame.columns]
    if missing:
        raise InvalidDatasetError(f"feature needs missing columns: {missing}")


def _session_id(frame: pd.DataFrame) -> pd.Series:
    _require(frame, "bar_start")
    return pd.to_datetime(frame["bar_start"]).dt.date


def log_return(frame: pd.DataFrame, bars: int) -> pd.Series:
    """log(close_t / close_{t-bars}). NaN for the first `bars` rows."""
    _require(frame, "close")
    if bars < 1:
        raise InvalidDatasetError(f"bars must be >= 1, got {bars}")
    out = np.log(frame["close"] / frame["close"].shift(bars))
    return pd.Series(out, index=frame.index, name=f"logret_{bars}")


def realized_vol(
    frame: pd.DataFrame, window: int = 20, bars_per_year: float = 252.0
) -> pd.Series:
    """Annualized stdev of 1-bar log returns over `window` past bars."""
    _require(frame, "close")
    if window < 2:
        raise InvalidDatasetError(f"window must be >= 2, got {window}")
    ret = np.log(frame["close"] / frame["close"].shift(1))
    out = ret.rolling(window).std(ddof=1) * np.sqrt(bars_per_year)
    return pd.Series(out, index=frame.index, name=f"realized_vol_{window}")


def atr_ratio(frame: pd.DataFrame, window: int = 14) -> pd.Series:
    """Average true range / close. True range uses the prior close only."""
    _require(frame, *OHLCV[:4])
    if window < 1:
        raise InvalidDatasetError(f"window must be >= 1, got {window}")
    prev_close = frame["close"].shift(1)
    tr = pd.concat(
        [
            frame["high"] - frame["low"],
            (frame["high"] - prev_close).abs(),
            (frame["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    out = tr.rolling(window).mean() / frame["close"]
    return pd.Series(out, index=frame.index, name=f"atr_ratio_{window}")


def vwap_distance(frame: pd.DataFrame) -> pd.Series:
    """(close - session VWAP) / session VWAP, VWAP reset each IST session.

    Sessions with zero traded volume (e.g. index spot legs) yield NaN,
    never a fabricated zero.
    """
    _require(frame, "high", "low", "close", "volume")
    typical = (frame["high"] + frame["low"] + frame["close"]) / 3.0
    session = _session_id(frame)
    cum_pv = (typical * frame["volume"]).groupby(session).cumsum()
    cum_v = frame["volume"].groupby(session).cumsum()
    vwap = cum_pv / cum_v.replace(0.0, np.nan)
    out = (frame["close"] - vwap) / vwap
    return pd.Series(out, index=frame.index, name="vwap_distance")


def sin_minute_of_day(frame: pd.DataFrame) -> pd.Series:
    """sin(2π * minutes-since-IST-midnight / 1440) of bar_start."""
    starts = pd.to_datetime(frame["bar_start"])
    if getattr(starts.dt, "tz", None) is None:
        raise InvalidDatasetError("bar_start must be timezone-aware")
    minutes = starts.dt.hour * 60 + starts.dt.minute
    out = np.sin(2.0 * np.pi * minutes / 1440.0)
    return pd.Series(out, index=frame.index, name="sin_minute")


def cos_minute_of_day(frame: pd.DataFrame) -> pd.Series:
    """cos(2π * minutes-since-IST-midnight / 1440) of bar_start."""
    starts = pd.to_datetime(frame["bar_start"])
    if getattr(starts.dt, "tz", None) is None:
        raise InvalidDatasetError("bar_start must be timezone-aware")
    minutes = starts.dt.hour * 60 + starts.dt.minute
    out = np.cos(2.0 * np.pi * minutes / 1440.0)
    return pd.Series(out, index=frame.index, name="cos_minute")


UNDERLYING_FEATURES = {
    "logret_1": lambda f: log_return(f, 1),
    "logret_3": lambda f: log_return(f, 3),
    "logret_6": lambda f: log_return(f, 6),
    "logret_12": lambda f: log_return(f, 12),
    "realized_vol_20": realized_vol,
    "atr_ratio_14": atr_ratio,
    "vwap_distance": vwap_distance,
    "sin_minute": sin_minute_of_day,
    "cos_minute": cos_minute_of_day,
}
