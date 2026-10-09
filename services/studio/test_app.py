"""Studio tests: run with `pytest services/studio` (demo data, no stack needed)."""

import os

os.environ["OMEGA_STUDIO_DEMO"] = "1"

import pandas as pd  # noqa: E402

import app  # noqa: E402
import data  # noqa: E402


def test_demo_candles_shape_and_window():
    df = data.candles("BTCUSDT", 6)
    assert list(df.columns) == data.CANDLE_COLS
    assert len(df) == 6 * 12 and df["close"].gt(0).all()
    assert df.equals(data.candles("BTCUSDT", 6))  # deterministic


def test_mood_score_weights_impact():
    news = pd.DataFrame({"sentiment": [1.0, -1.0], "impact": ["high", "low"]})
    assert app.mood_score(news) == (3 - 1) / 4
    assert app.mood_score(news.iloc[0:0]) is None


def test_window_filters_old_rows():
    now = pd.Timestamp.now(tz="UTC")
    df = pd.DataFrame({"ts": [now - pd.Timedelta(hours=1), now - pd.Timedelta(hours=30)]})
    assert len(app.window(df, "ts", 24)) == 1


def test_studio_reacts_to_symbol_and_hours():
    s = app.OmegaStudio()
    assert s._candles()["symbol"].eq("BTCUSDT").all()
    s.symbol, s.hours = "ETHUSDT", 6
    assert s._candles()["symbol"].eq("ETHUSDT").all() and len(s._candles()) == 72
    assert s._sym_anomalies()["symbol"].eq("ETHUSDT").all()
    for view in (s._price_plot, s._volume_plot, s._news_plot, s._anomaly_table, s._whale_table, s._news_table,
                 s._price, s._change, s._anomaly_count, s._whale_flow, s._mood):
        assert view() is not None


def test_app_builds():
    assert app.OmegaStudio.create_app().title == "OMEGA Studio"
