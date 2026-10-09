"""OMEGA Neural: a small PyTorch network that reads the last 2 hours of 5-minute returns and estimates,
for the next hour, (a) the probability the price ends higher and (b) the volatility.

It is deliberately tiny (~1.5k parameters, trains in seconds on one CPU thread) and deliberately honest:
every training run is scored walk-forward on the most recent 20% of history it never saw, against the
naive baselines (majority class for direction, "same as the last day" for volatility). The Ops Room shows
those scores next to the forecast. Short-horizon direction is close to a coin flip on liquid markets;
the volatility head is the useful part. This is a research signal, not trading advice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import torch
from torch import nn

torch.set_num_threads(1)          # 7 GB laptop: never take more than one core

LAGS = 24                         # 24 x 5 min = 2 h of returns as input
HORIZON = 12                      # predict the next 12 bars = 1 h
BASELINE = 288                    # 24 h trailing window used to standardise returns
N_FEATURES = LAGS + 3


def log_returns(closes: np.ndarray) -> np.ndarray:
    closes = np.asarray(closes, dtype=np.float64)
    return np.diff(np.log(closes))


def _features_at(r: np.ndarray, t: int) -> np.ndarray | None:
    """Features from returns r[..t] inclusive (t is the newest known bar)."""
    if t + 1 < BASELINE:
        return None
    base = r[t + 1 - BASELINE: t + 1]
    sd = base.std() or 1e-9
    lagged = r[t + 1 - LAGS: t + 1] / sd
    ew = np.sqrt(np.average(base[-36:] ** 2)) / sd                    # last 3 h vol vs the day's
    mom1 = r[t + 1 - 12: t + 1].sum() / (sd * math.sqrt(12))
    mom6 = r[t + 1 - 72: t + 1].sum() / (sd * math.sqrt(72))
    return np.concatenate([lagged, [ew, mom1, mom6]]).astype(np.float32)


def make_dataset(closes: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """X, y_dir (1 = next hour up), y_vol (log of next-hour vol / trailing vol) for one series."""
    r = log_returns(closes)
    X, yd, yv = [], [], []
    for t in range(BASELINE - 1, len(r) - HORIZON):
        f = _features_at(r, t)
        if f is None:
            continue
        nxt = r[t + 1: t + 1 + HORIZON]
        sd = r[t + 1 - BASELINE: t + 1].std() or 1e-9
        X.append(f)
        yd.append(1.0 if nxt.sum() > 0 else 0.0)
        yv.append(math.log((nxt.std() or 1e-9) / sd))
    return np.array(X, np.float32).reshape(-1, N_FEATURES), np.array(yd, np.float32), np.array(yv, np.float32)


class Net(nn.Module):
    """Shared trunk, two heads: direction logit and log-volatility ratio."""

    def __init__(self):
        super().__init__()
        self.trunk = nn.Sequential(nn.Linear(N_FEATURES, 32), nn.GELU(), nn.Dropout(0.1), nn.Linear(32, 16), nn.GELU())
        self.direction = nn.Linear(16, 1)
        self.vol = nn.Linear(16, 1)
        # temperature for the direction logit, fitted after training so probabilities are calibrated
        self.register_buffer("temperature", torch.ones(()))

    def forward(self, x):
        h = self.trunk(x)
        return self.direction(h).squeeze(-1) / self.temperature, self.vol(h).squeeze(-1)


@dataclass
class TrainResult:
    model: Net
    metrics: dict


def train(series: dict[str, np.ndarray], epochs: int = 60, seed: int = 7) -> TrainResult:
    """Pool every symbol; hold out the most recent 20% of each for a walk-forward test."""
    torch.manual_seed(seed)
    tr, te = [], []
    for closes in series.values():
        X, yd, yv = make_dataset(closes)
        if len(X) < 50:
            continue
        cut = int(len(X) * 0.8) - HORIZON          # gap of one horizon so test labels never overlap training
        tr.append((X[:cut], yd[:cut], yv[:cut]))
        te.append((X[cut + HORIZON:], yd[cut + HORIZON:], yv[cut + HORIZON:]))
    if not tr:
        raise ValueError("not enough history to train (need ~1.5 days of 5-minute bars)")
    Xtr, ydtr, yvtr = (torch.from_numpy(np.concatenate([p[i] for p in tr])) for i in range(3))
    Xte, ydte, yvte = (torch.from_numpy(np.concatenate([p[i] for p in te])) for i in range(3))

    # The newest 15% of the training rows are held back from fitting and used only to calibrate.
    fit = int(len(Xtr) * 0.85)
    net, bce, mse = Net(), nn.BCEWithLogitsLoss(), nn.MSELoss()
    opt = torch.optim.AdamW(net.parameters(), lr=3e-3, weight_decay=1e-3)
    for _ in range(epochs):
        net.train()
        for idx in torch.randperm(fit).split(256):
            dl, vl = net(Xtr[idx])
            loss = bce(dl, ydtr[idx]) + mse(vl, yvtr[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()

    # Temperature scaling on the held-back rows: an over-confident coin flip becomes an honest ~0.5.
    net.eval()
    cal = slice(fit, None)
    with torch.no_grad():
        logits = net(Xtr[cal])[0]
    best = min((bce(logits / t, ydtr[cal]).item(), t) for t in np.linspace(0.5, 25, 99))[1]
    net.temperature.fill_(float(best))

    with torch.no_grad():
        dl, vl = net(Xte)
        p = torch.sigmoid(dl)
        acc = ((p > 0.5).float() == ydte).float().mean().item()
        majority = float(ydtr.mean() >= 0.5)
        base_acc = (ydte == majority).float().mean().item()
        brier = ((p - ydte) ** 2).mean().item()
        vol_mae = (vl - yvte).abs().mean().item()
        naive_vol_mae = (yvte - yvtr.mean()).abs().mean().item()
        vol_corr = float(np.corrcoef(vl.numpy(), yvte.numpy())[0, 1]) if len(yvte) > 2 else float("nan")
    metrics = {
        "train_samples": len(Xtr), "test_samples": len(Xte), "params": sum(p.numel() for p in net.parameters()),
        "direction_accuracy": round(acc, 4), "direction_baseline": round(base_acc, 4), "brier": round(brier, 4),
        "vol_mae": round(vol_mae, 4), "vol_naive_mae": round(naive_vol_mae, 4), "vol_corr": round(vol_corr, 3),
        "direction_edge": round(acc - base_acc, 4), "brier_coin_flip": 0.25, "temperature": round(float(best), 2),
    }
    return TrainResult(net, metrics)


def predict(net: Net, closes: np.ndarray) -> dict | None:
    """Forecast the next hour from the newest bars of one series."""
    r = log_returns(closes)
    f = _features_at(r, len(r) - 1)
    if f is None:
        return None
    net.eval()
    with torch.no_grad():
        dl, vl = net(torch.from_numpy(f).unsqueeze(0))
    sd = r[-BASELINE:].std()
    vol_1h = math.exp(vl.item()) * float(sd) * math.sqrt(HORIZON) * 100
    return {"p_up_1h": round(torch.sigmoid(dl).item(), 4), "vol_1h_pct": round(vol_1h, 3),
            "vol_vs_day": round(math.exp(vl.item()), 3)}


def synthetic(symbol: str, bars: int = 2016) -> np.ndarray:
    """Seven days of 5-minute closes with clustered volatility (GARCH-like), for demo and tests."""
    rng = np.random.default_rng(sum(map(ord, symbol)))
    base = {"BTCUSDT": 62_000.0, "ETHUSDT": 2_450.0, "SOLUSDT": 148.0}.get(symbol, 100.0)
    var, r = 1e-6, np.empty(bars)
    for i in range(bars):
        var = 2e-8 + 0.1 * (r[i - 1] ** 2 if i else 0) + 0.88 * var
        r[i] = rng.normal(0, math.sqrt(var))
    return base * np.exp(np.cumsum(r))
