"""Oracle agreement: binomial vs py_vollib Black-76 vs scipy closed form."""

import warnings

import pytest
from scipy.stats import norm

with warnings.catch_warnings():
    warnings.filterwarnings("ignore")
    from vollib.black import black as vollib_black76

from research.oracle import binomial_european, black76_implied_volatility

CASES = [
    # flag, forward, strike, years, rate, sigma
    ("c", 22800.0, 22600.0, 0.02, 0.053, 0.15),
    ("p", 22800.0, 22600.0, 0.02, 0.053, 0.15),
    ("c", 22800.0, 22800.0, 0.05, 0.053, 0.25),
    ("p", 22800.0, 23000.0, 0.10, 0.053, 0.35),
]


def scipy_black76(flag, forward, strike, years, rate, sigma):
    """Closed-form Black-76 (independent of vollib)."""
    import math

    df = math.exp(-rate * years)
    d1 = (math.log(forward / strike) + 0.5 * sigma**2 * years) / (
        sigma * math.sqrt(years)
    )
    d2 = d1 - sigma * math.sqrt(years)
    if flag == "c":
        return df * (forward * norm.cdf(d1) - strike * norm.cdf(d2))
    return df * (strike * norm.cdf(-d2) - forward * norm.cdf(-d1))


def test_three_pricers_agree():
    for flag, forward, strike, years, rate, sigma in CASES:
        closed = scipy_black76(flag, forward, strike, years, rate, sigma)
        lib = vollib_black76(flag, forward, strike, years, rate, sigma)
        tree = binomial_european(flag, forward, strike, years, rate, sigma)
        assert lib == pytest.approx(closed, rel=1e-9)
        assert tree == pytest.approx(closed, rel=2e-3)


def test_iv_round_trips():
    for flag, forward, strike, years, rate, sigma in CASES:
        price = vollib_black76(flag, forward, strike, years, rate, sigma)
        implied = black76_implied_volatility(
            flag, price, forward, strike, years, rate
        )
        assert implied == pytest.approx(sigma, rel=1e-6)
        assert vollib_black76(flag, forward, strike, years, rate, implied) == (
            pytest.approx(price, rel=1e-9)
        )


def test_oracle_rejects_bad_inputs():
    with pytest.raises(ValueError):
        binomial_european("x", 1.0, 1.0, 0.02, 0.05, 0.2)
    with pytest.raises(ValueError):
        binomial_european("c", 1.0, 1.0, 0.0, 0.05, 0.2)
