"""Pilot feature set: pure functions, backward-looking only.

Conventions (leak discipline):
- Every window uses bars at or before the current bar (pandas rolling /
  shift are past-inclusive by default; never use future data).
- Session-reset indicators group by the IST calendar date of bar_start.
- Undefined values are NaN (zero-volume VWAP, short warmup), never
  fabricated. Drop counts are logged (stdlib logging) wherever a rule
  forces NaN; matrix assembly counts them again.
- Required columns are checked explicitly; a missing column raises
  InvalidDatasetError (programmer error, fail loudly).
- Anything needing futures, VIX, a PE pair, or the contract manifest
  raises MissingDataError: those inputs do not exist yet.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from .errors import InvalidDatasetError, MissingDataError

logger = logging.getLogger(__name__)

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


def oi_change(frame: pd.DataFrame) -> pd.Series:
    """oi_t - oi_{t-1}. Null OI yields NaN (never filled)."""
    _require(frame, "open_interest")
    out = frame["open_interest"] - frame["open_interest"].shift(1)
    return pd.Series(out, index=frame.index, name="oi_change")


def volume_zscore(frame: pd.DataFrame, window: int = 20) -> pd.Series:
    """(volume - rolling mean) / rolling std, past bars only.

    Zero-volume bars are set to NaN and counted in the log: a trade that
    did not happen carries no volume signal.
    """
    _require(frame, "volume")
    if window < 2:
        raise InvalidDatasetError(f"window must be >= 2, got {window}")
    mean = frame["volume"].rolling(window).mean()
    std = frame["volume"].rolling(window).std(ddof=1)
    out = (frame["volume"] - mean) / std.replace(0.0, np.nan)
    zero = frame["volume"] == 0
    n_zero = int(zero.sum())
    if n_zero:
        logger.info("volume_zscore: %d zero-volume bars set to NaN", n_zero)
        out = out.mask(zero)
    return pd.Series(out, index=frame.index, name=f"volume_zscore_{window}")


SINGLE_OPTION_FEATURES = {
    "oi_change": oi_change,
    "volume_zscore_20": volume_zscore,
}


def _stub(name: str, need: str):
    raise MissingDataError(
        f"{name} needs {need}, which does not exist yet;"
        " acquire it first (separate task)"
    )


def moneyness(frame: pd.DataFrame) -> pd.Series:
    """Strike/forward moneyness. Needs futures closes + manifest."""
    _stub("moneyness", "futures closes and the contract manifest")


def option_iv(frame: pd.DataFrame) -> pd.Series:
    """Black-76 IV. Needs futures closes (forward) + manifest (T)."""
    _stub("option_iv", "futures closes and the contract manifest")


def iv_change(frame: pd.DataFrame) -> pd.Series:
    """IV change. Needs option_iv."""
    _stub("iv_change", "option_iv")


def option_delta(frame: pd.DataFrame) -> pd.Series:
    """Black-76 delta. Needs futures closes + manifest."""
    _stub("option_delta", "futures closes and the contract manifest")


def option_gamma(frame: pd.DataFrame) -> pd.Series:
    """Black-76 gamma. Needs futures closes + manifest."""
    _stub("option_gamma", "futures closes and the contract manifest")


def option_theta(frame: pd.DataFrame) -> pd.Series:
    """Black-76 theta. Needs futures closes + manifest."""
    _stub("option_theta", "futures closes and the contract manifest")


def option_vega(frame: pd.DataFrame) -> pd.Series:
    """Black-76 vega. Needs futures closes + manifest."""
    _stub("option_vega", "futures closes and the contract manifest")


def dte(frame: pd.DataFrame) -> pd.Series:
    """Days to expiry. Needs the contract manifest."""
    _stub("dte", "the contract manifest")


def expiry_day_flag(frame: pd.DataFrame) -> pd.Series:
    """1 on expiry day, else 0. Needs the contract manifest."""
    _stub("expiry_day_flag", "the contract manifest")


def ce_pe_iv_skew(frame: pd.DataFrame) -> pd.Series:
    """Same-strike CE minus PE IV. Needs a paired PE dataset + manifest."""
    _stub("ce_pe_iv_skew", "a paired PE dataset and the contract manifest")


def iv_minus_realized_vol(frame: pd.DataFrame) -> pd.Series:
    """IV minus realized vol. Needs futures closes + manifest."""
    _stub("iv_minus_realized_vol", "futures closes and the contract manifest")


def iv_vix_ratio(frame: pd.DataFrame) -> pd.Series:
    """IV / VIX. Needs a VIX dataset."""
    _stub("iv_vix_ratio", "a VIX dataset")
