"""Independent binomial European pricer (Black world, no libraries).

Oracle for the research pipeline: cross-checks py_vollib and the closed
form. European options on forwards; futures-style driftless tree.
"""

from __future__ import annotations

import math

import numpy as np


def binomial_european(
    flag: str, forward: float, strike: float, years: float, rate: float,
    sigma: float, steps: int = 1000,
) -> float:
    """CRR price of a European call/put on a forward (Black-76 world)."""
    if flag not in ("c", "p"):
        raise ValueError(f"flag must be 'c' or 'p', got {flag!r}")
    if years <= 0 or sigma <= 0 or forward <= 0 or strike <= 0:
        raise ValueError("years, sigma, forward, strike must be positive")
    dt = years / steps
    up = math.exp(sigma * math.sqrt(dt))
    down = 1.0 / up
    prob = (1.0 - down) / (up - down)
    ratio = up / down
    terminal = forward * (down**steps) * ratio ** np.arange(steps + 1)
    if flag == "c":
        values = np.maximum(terminal - strike, 0.0)
    else:
        values = np.maximum(strike - terminal, 0.0)
    discount_step = math.exp(-rate * years / steps)
    for _ in range(steps):
        values = discount_step * (prob * values[1:] + (1.0 - prob) * values[:-1])
    return float(values[0])


def black76_implied_volatility(
    flag: str, price: float, forward: float, strike: float,
    years: float, rate: float,
) -> float:
    """Black-76 IV via lets_be_rational.

    LBR solves on the UNDISCOUNTED price with q = +1 (call) / -1 (put);
    the discount is removed here so callers pass market (discounted) prices.
    Raises on below-intrinsic / above-maximum prices (fail loudly).
    """
    import warnings

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore")
        from vollib.lets_be_rational import (
            implied_volatility_from_a_transformed_rational_guess as lbr_iv,
        )
    if flag not in ("c", "p"):
        raise ValueError(f"flag must be 'c' or 'p', got {flag!r}")
    if years <= 0 or forward <= 0 or strike <= 0:
        raise ValueError("years, forward, strike must be positive")
    undiscounted = price * math.exp(rate * years)
    return float(lbr_iv(undiscounted, forward, strike, years, 1 if flag == "c" else -1))
