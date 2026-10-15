"""Neural tests: `services/neural/.venv/Scripts/python -m pytest services/neural` (CPU, a few seconds)."""

import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import model


def test_dataset_shapes_and_labels():
    closes = model.synthetic("BTCUSDT", 600)
    X, yd, yv = model.make_dataset(closes)
    assert X.shape[1] == model.N_FEATURES and len(X) == len(yd) == len(yv) > 200
    assert set(np.unique(yd)) <= {0.0, 1.0}
    assert np.isfinite(X).all() and np.isfinite(yv).all()


def test_no_lookahead_in_features():
    closes = model.synthetic("ETHUSDT", 600)
    r = model.log_returns(closes)
    t = 400
    f1 = model._features_at(r, t)
    r2 = r.copy()
    r2[t + 1:] = 0.5                                    # change only the future
    assert np.array_equal(f1, model._features_at(r2, t))


def test_train_scores_walk_forward_and_learns_volatility():
    series = {s: model.synthetic(s) for s in ("BTCUSDT", "ETHUSDT", "SOLUSDT")}
    res = model.train(series, epochs=25)
    m = res.metrics
    assert m["test_samples"] > 500 and m["params"] < 3000
    assert 0.3 < m["direction_accuracy"] < 0.7          # random walk: no magic edge
    assert m["vol_mae"] < m["vol_naive_mae"]            # clustered volatility is learnable
    assert m["brier"] < 0.26                            # calibrated: never much worse than a coin flip
    p = model.predict(res.model, series["BTCUSDT"])
    assert 0 < p["p_up_1h"] < 1 and p["vol_1h_pct"] > 0 and math.isfinite(p["vol_vs_day"])
