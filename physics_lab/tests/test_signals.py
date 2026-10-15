"""Known-answer tests for the signal functions (no network)."""
import numpy as np
import pandas as pd
import pytest

from physics_lab.backtest import auc, compute_signals, expanding_pct
from physics_lab.signals import (hurst_dfa, hurst_rs, lyapunov_rosenstein,
                                 realized_vol, reynolds_style)

RNG = np.random.default_rng(0)


def fgn(h: float, n: int) -> np.ndarray:
    """Fractional Gaussian noise with Hurst h (Davies-Harte)."""
    k = np.arange(n)
    g = 0.5 * (np.abs(k - 1) ** (2 * h) - 2 * np.abs(k) ** (2 * h) + np.abs(k + 1) ** (2 * h))
    c = np.concatenate([g, g[-2:0:-1]])
    lam = np.clip(np.fft.fft(c).real, 0, None)
    z = RNG.standard_normal(len(c)) + 1j * RNG.standard_normal(len(c))
    return np.fft.fft(np.sqrt(lam / len(c)) * z).real[:n]


def test_hurst_white_noise_is_half():
    assert hurst_dfa(RNG.standard_normal(4000)) == pytest.approx(0.5, abs=0.05)


@pytest.mark.parametrize("h", [0.3, 0.7])
def test_hurst_recovers_fgn(h):
    assert hurst_dfa(fgn(h, 4000)) == pytest.approx(h, abs=0.06)


def test_rs_is_biased_up_on_noise():
    # Documented small-sample bias; why DFA is the primary estimator.
    vals = [hurst_rs(RNG.standard_normal(252)) for _ in range(30)]
    assert np.mean(vals) > 0.52


def test_hurst_short_input_is_nan():
    assert np.isnan(hurst_dfa(np.ones(10)))


def logistic(n=2000, r=4.0):
    x = np.empty(n)
    x[0] = 0.3
    for i in range(1, n):
        x[i] = r * x[i - 1] * (1 - x[i - 1])
    return x


def test_lyapunov_logistic_map_is_ln2():
    assert lyapunov_rosenstein(logistic(), m=2, fit_k=3) == pytest.approx(np.log(2), abs=0.05)


def test_lyapunov_periodic_is_zero():
    assert lyapunov_rosenstein(np.sin(np.arange(2000) * 0.3), m=2) == pytest.approx(0, abs=0.02)


def test_lyapunov_noise_is_positive_so_needs_null():
    # Pure noise gives lambda > 0: "lambda > 0 means chaos" is false on returns.
    vals = [lyapunov_rosenstein(RNG.standard_normal(252)) for _ in range(10)]
    assert np.mean(vals) > 0.1


def test_reynolds_equals_scaled_tstat():
    x = RNG.normal(0.001, 0.01, 20)
    t = abs(x.mean()) / (x.std(ddof=1) / np.sqrt(20))
    assert reynolds_style(x) == pytest.approx(t * np.sqrt(20))
    assert reynolds_style(x, volume_ratio=2.0) == pytest.approx(2 * t * np.sqrt(20))


def test_reynolds_is_scale_free():
    x = RNG.normal(0.001, 0.01, 20)
    assert reynolds_style(x) == pytest.approx(reynolds_style(100 * x))


def test_reynolds_cannot_reach_pipe_threshold_without_extreme_trend():
    # Re* = rho*|t|*sqrt(L); reaching 2000 at L=20, rho=1 needs |t| ~ 447.
    x = RNG.normal(0.0, 0.02, 20)
    assert reynolds_style(x) < 2000


def test_realized_vol_annualised():
    x = RNG.normal(0, 0.01, 5000)
    assert realized_vol(x) == pytest.approx(0.01 * np.sqrt(252), rel=0.05)


def test_auc_extremes():
    y = np.array([0, 0, 1, 1])
    assert auc(np.array([1., 2, 3, 4]), y) == 1.0
    assert auc(np.array([4., 3, 2, 1]), y) == 0.0


def test_no_lookahead_in_signals():
    idx = pd.bdate_range("2000-01-03", periods=400)
    p = pd.Series(np.exp(np.cumsum(RNG.normal(0, 0.01, 400))) * 100, index=idx)
    df = pd.DataFrame({"price": p, "volume": np.nan})
    full = compute_signals(df)
    cut = compute_signals(df.iloc[:300])
    cols = ["hurst", "lyapunov", "reynolds", "vol20"]
    pd.testing.assert_frame_equal(full[cols].iloc[:299], cut[cols], check_exact=False)


def test_expanding_pct_uses_past_only():
    s = pd.Series([1., 2, 3] * 20 + [100.], index=pd.bdate_range("2020-01-01", periods=61))
    assert expanding_pct(s, s.index[-1]) == 100.0
