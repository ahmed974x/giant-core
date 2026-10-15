"""Signal functions: Hurst (DFA and R/S), Rosenstein divergence, Reynolds-style ratio.

All functions take plain numpy arrays of daily log returns (or prices where
stated) and return floats. No I/O, no trading.
"""
from __future__ import annotations

import numpy as np


# ---------------------------------------------------------------- Hurst

def _log_scales(n_min: int, n_max: int, count: int = 10) -> np.ndarray:
    s = np.unique(np.floor(np.logspace(np.log10(n_min), np.log10(n_max), count)).astype(int))
    return s[s >= n_min]


def hurst_dfa(returns: np.ndarray, n_min: int = 8, n_max: int | None = None) -> float:
    """Hurst exponent via detrended fluctuation analysis (DFA-1) on increments.

    For i.i.d. returns the expected value is ~0.5; >0.5 persistent (trending),
    <0.5 anti-persistent (mean-reverting).
    """
    x = np.asarray(returns, dtype=float)
    x = x[np.isfinite(x)]
    n = len(x)
    if n_max is None:
        n_max = n // 4
    if n < 4 * n_min or n_max <= n_min:
        return float("nan")
    profile = np.cumsum(x - x.mean())
    scales = _log_scales(n_min, n_max)
    flucts = []
    for s in scales:
        segs = n // s
        y = profile[: segs * s].reshape(segs, s)
        t = np.arange(s)
        # vectorised linear detrend per segment
        tm = t.mean()
        tc = t - tm
        slope = (y * tc).sum(axis=1) / (tc ** 2).sum()
        trend = y.mean(axis=1, keepdims=True) + slope[:, None] * tc
        flucts.append(np.sqrt(((y - trend) ** 2).mean()))
    flucts = np.asarray(flucts)
    ok = flucts > 0
    if ok.sum() < 3:
        return float("nan")
    return float(np.polyfit(np.log(scales[ok]), np.log(flucts[ok]), 1)[0])


def hurst_rs(returns: np.ndarray, n_min: int = 8, n_max: int | None = None) -> float:
    """Classic rescaled-range (R/S) Hurst estimate. Biased upward on short samples."""
    x = np.asarray(returns, dtype=float)
    x = x[np.isfinite(x)]
    n = len(x)
    if n_max is None:
        n_max = n // 2
    if n < 4 * n_min or n_max <= n_min:
        return float("nan")
    scales = _log_scales(n_min, n_max)
    rs = []
    for s in scales:
        segs = n // s
        y = x[: segs * s].reshape(segs, s)
        dev = np.cumsum(y - y.mean(axis=1, keepdims=True), axis=1)
        r = dev.max(axis=1) - dev.min(axis=1)
        sd = y.std(axis=1)
        good = sd > 0
        rs.append((r[good] / sd[good]).mean() if good.any() else np.nan)
    rs = np.asarray(rs)
    ok = np.isfinite(rs) & (rs > 0)
    if ok.sum() < 3:
        return float("nan")
    return float(np.polyfit(np.log(scales[ok]), np.log(rs[ok]), 1)[0])


# ------------------------------------------------------------ Lyapunov

def lyapunov_rosenstein(series: np.ndarray, m: int = 5, tau: int = 1,
                        theiler: int = 10, k_max: int = 8, fit_k: int = 4) -> float:
    """Largest-Lyapunov-style divergence rate (Rosenstein et al. 1993), per step.

    Embeds the series in m dimensions, pairs every point with its nearest
    neighbour outside a Theiler window, and fits the slope of the mean log
    distance over the first `fit_k` steps. On noisy financial returns this is
    NOT a proof of chaos: noise also gives a positive slope, so results must be
    compared with a shuffled-surrogate baseline (see backtest.null_band).
    """
    x = np.asarray(series, dtype=float)
    x = x[np.isfinite(x)]
    sd = x.std()
    if sd == 0:
        return float("nan")
    x = (x - x.mean()) / sd
    n_vec = len(x) - (m - 1) * tau
    usable = n_vec - k_max
    if usable < 2 * theiler + 10:
        return float("nan")
    emb = np.stack([x[i * tau: i * tau + n_vec] for i in range(m)], axis=1)
    a = emb[:usable]
    d = np.sqrt(((a[:, None, :] - a[None, :, :]) ** 2).sum(-1))
    idx = np.arange(usable)
    d[np.abs(idx[:, None] - idx[None, :]) <= theiler] = np.inf
    nn = d.argmin(axis=1)
    div = []
    for k in range(k_max + 1):
        dist = np.sqrt(((emb[idx + k] - emb[nn + k]) ** 2).sum(-1))
        dist = dist[dist > 0]
        div.append(np.log(dist).mean())
    div = np.asarray(div)
    return float(np.polyfit(np.arange(fit_k + 1), div[: fit_k + 1], 1)[0])


# ---------------------------------------------------- Reynolds-style ratio

def reynolds_style(returns: np.ndarray, volume_ratio: float = 1.0) -> float:
    """Dimensionless 'inertia over friction' ratio Re* = rho * |v| * L / mu.

    rho = volume relative to its 1-year median (1.0 when no volume data),
    v   = mean daily log return over the window (drift "velocity"),
    L   = window length in days,
    mu  = daily return standard deviation over the window ("friction").

    This is an analogy, not fluid dynamics: Re* equals rho * |t-stat of the
    drift| * sqrt(L). The pipe-flow thresholds 2000/4000 have no derived
    meaning here and are tested empirically in backtest.py.
    """
    x = np.asarray(returns, dtype=float)
    x = x[np.isfinite(x)]
    if len(x) < 5:
        return float("nan")
    mu = x.std(ddof=1)
    if mu == 0:
        return float("nan")
    return float(volume_ratio * abs(x.mean()) * len(x) / mu)


# ----------------------------------------------------------- baseline

def realized_vol(returns: np.ndarray) -> float:
    """Annualised standard deviation of daily log returns (plain baseline)."""
    x = np.asarray(returns, dtype=float)
    x = x[np.isfinite(x)]
    return float(x.std(ddof=1) * np.sqrt(252)) if len(x) > 2 else float("nan")
