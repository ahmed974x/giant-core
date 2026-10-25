"""PyPortfolioOpt (MIT): minimum-volatility weights for the paper desk (ADR-129).

Paper only. It reads closing prices that the caller sends (for example the Ops Room's Binance public candles)
and returns weights and their annual volatility, labelled [INFERENCE - Quant Model]. It sizes nothing, sends
nothing and changes no rule; the risk gate can still only stop.
"""

from __future__ import annotations

import math

from .flags import require

LABEL = "[INFERENCE - Quant Model] · paper only, not an order or a size"


def check_prices(prices: dict) -> dict[str, list[float]]:
    if not isinstance(prices, dict) or not 2 <= len(prices) <= 20:
        raise ValueError("send 2 to 20 symbols, each with its list of closing prices")
    out, n = {}, None
    for sym, xs in prices.items():
        s = str(sym).upper()
        if not s.replace(".", "").replace("-", "").isalnum() or len(s) > 20:
            raise ValueError(f"{sym!r} is not a symbol")
        if not isinstance(xs, list) or not 30 <= len(xs) <= 2000:
            raise ValueError(f"{s}: send 30 to 2000 closing prices")
        try:
            vals = [float(x) for x in xs]
        except (TypeError, ValueError) as e:
            raise ValueError(f"{s}: every price must be a number") from e
        if any(not math.isfinite(v) or v <= 0 for v in vals):
            raise ValueError(f"{s}: prices must be positive numbers")
        if n is not None and len(vals) != n:
            raise ValueError("every symbol needs the same number of prices, on the same dates")
        n, out[s] = len(vals), vals
    return out


def min_volatility(prices: dict, periods_per_year: int = 365, max_weight: float = 0.6) -> dict:
    """Long-only minimum-volatility weights from the sample covariance of the given closes."""
    require("portfolio")
    import pandas as pd
    from pypfopt import EfficientFrontier, risk_models

    data = check_prices(prices)
    periods_per_year = int(periods_per_year)
    if periods_per_year not in (52, 252, 365, 8760):
        raise ValueError("periods_per_year must be 52, 252, 365 or 8760")
    if not 1 / len(data) <= float(max_weight) <= 1:
        raise ValueError("max_weight must leave room for every symbol (at least 1 / number of symbols)")
    df = pd.DataFrame(data)
    cov = risk_models.sample_cov(df, frequency=periods_per_year)
    ef = EfficientFrontier(None, cov, weight_bounds=(0, float(max_weight)))
    ef.min_volatility()
    w = {k: round(float(v), 6) for k, v in ef.clean_weights().items()}
    vol = math.sqrt(float(pd.Series(w) @ cov @ pd.Series(w)))
    return {
        "weights": w,
        "annual_volatility": round(vol, 6),
        "points": len(df),
        "periods_per_year": periods_per_year,
        "method": "PyPortfolioOpt 1.6.0 min_volatility on the sample covariance",
        "label": LABEL,
    }
