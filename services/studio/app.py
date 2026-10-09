"""OMEGA Studio: the deep-analysis room of the Ops Room, built with HoloViz Panel + Material UI.

Serve:    panel serve app.py --port 5006            (inside the stack: docker compose --profile studio up -d)
Preview:  python app.py                             (opens a browser; demo data when the relay is down)
"""

from __future__ import annotations

import hvplot.pandas  # noqa: F401  registers .hvplot on DataFrames
import pandas as pd
import panel as pn
import panel_material_ui as pmui
import param

import data

pn.extension("tabulator", throttled=True)
pmui.Paper.param.margin.default = 10

# Ops Room palette: one accent per signal, readable on the dark page.
COLORS = {"BTCUSDT": "#f59e0b", "ETHUSDT": "#818cf8", "SOLUSDT": "#2dd4bf"}
ACCENT = {"cyan": "#22d3ee", "violet": "#a78bfa", "magenta": "#f472b6", "amber": "#fbbf24", "lime": "#a3e635"}
SEV = {"high": "#fb7185", "watch": "#fbbf24"}
THEME = {
    "palette": {
        "mode": "dark",
        "primary": {"main": ACCENT["cyan"]},
        "secondary": {"main": ACCENT["violet"]},
        "background": {"default": "#04060c", "paper": "#0b1122"},
    },
    "shape": {"borderRadius": 14},
    "components": {
        "MuiAppBar": {"styleOverrides": {"root": {
            "backgroundColor": "#0b1122", "color": "#eef3fb",
            "backgroundImage": "linear-gradient(90deg, rgba(34,211,238,.18), rgba(167,139,250,.18) 50%, rgba(244,114,182,.14))",
            "borderBottom": "1px solid rgba(140,170,230,.22)", "boxShadow": "none",
        }}},
    },
    "typography": {"fontFamily": '"Segoe UI Variable", "Segoe UI", Inter, Roboto, sans-serif'},
}
KPI_SX = {"fontWeight": 700, "fontSize": "1.08rem", "whiteSpace": "nowrap", "overflow": "hidden", "textOverflow": "ellipsis", "lineHeight": 1.3}
RANGES = {"6 h": 6, "24 h": 24, "48 h": 48}


# ── transforms (pure, tested) ───────────────────────────────────────────────────
def window(df: pd.DataFrame, col: str, hours: int) -> pd.DataFrame:
    """Rows of ``df`` whose ``col`` timestamp falls in the last ``hours``."""
    if df.empty:
        return df
    return df[df[col] >= pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=hours)]


def mood_score(news: pd.DataFrame) -> float | None:
    """Impact-weighted mean sentiment, in [-1, 1]; None without headlines."""
    if news.empty:
        return None
    w = news["impact"].map({"low": 1, "medium": 2, "high": 3}).fillna(1)
    return float((news["sentiment"] * w).sum() / w.sum())


def when(s: pd.Series) -> pd.Series:
    """Timestamps as short Kuwait-time labels for tables."""
    return s.dt.tz_convert("Asia/Kuwait").dt.strftime("%d %b %H:%M")


def fmt_usd(v: float) -> str:
    return f"${v / 1e9:.2f}B" if v >= 1e9 else f"${v / 1e6:.1f}M"


# ── the app ────────────────────────────────────────────────────────────────────
class OmegaStudio(pn.viewable.Viewer):
    """Price, anomalies, whales and news for one pair over a chosen window."""

    symbol = param.Selector(default=data.SYMBOLS[0], objects=data.SYMBOLS, doc="Market pair")
    hours = param.Selector(default=24, objects=list(RANGES.values()), doc="Look-back window in hours")
    tick = param.Integer(default=0, doc="Bumped by the refresh timer to reload data")

    def __init__(self, **params):
        super().__init__(**params)
        with pn.config.set(sizing_mode="stretch_width"):
            self._symbol_input = pmui.RadioButtonGroup.from_param(self.param.symbol, label="Pair", options=data.SYMBOLS, margin=(10, 20))
            self._hours_input = pmui.RadioButtonGroup.from_param(self.param.hours, label="Window", options=RANGES, margin=(10, 20))
            self._refresh = pmui.Button(label="Refresh now", icon="refresh", variant="outlined", margin=(10, 20))
            self._refresh.on_click(lambda _: self._reload())
            self._inputs = pmui.Column(self._symbol_input, self._hours_input, self._refresh, self._source)
            self._kpis = pmui.Grid(
                self._kpi("Price", self._price, "show_chart", ACCENT["cyan"]),
                self._kpi("Change", self._change, "trending_up", ACCENT["lime"]),
                self._kpi("Anomalies", self._anomaly_count, "warning_amber", ACCENT["magenta"]),
                self._kpi("Exchange flow", self._whale_flow, "water", ACCENT["violet"]),
                self._kpi("News mood", self._mood, "newspaper", ACCENT["amber"]),
                container=True, spacing=2,
            )
            self._main = pmui.Column(
                self._kpis,
                pmui.Paper(pmui.Column(self._title("Price · anomalies marked", ACCENT["cyan"]), self._price_plot)),
                pmui.Grid(
                    pmui.Grid(pmui.Paper(pmui.Column(self._title("Volume", ACCENT["lime"]), self._volume_plot)), size={"xs": 12, "md": 6}),
                    pmui.Grid(pmui.Paper(pmui.Column(self._title("Headline sentiment", ACCENT["amber"]), self._news_plot)), size={"xs": 12, "md": 6}),
                    container=True, spacing=2,
                ),
                pmui.Paper(pmui.Tabs(("Anomalies", self._anomaly_table), ("Whales", self._whale_table), ("News", self._news_table))),
                margin=15,
            )

    # ── data reloading ──
    def _reload(self):
        pn.state.clear_caches()
        self.tick += 1

    @param.depends("tick")
    def _source(self):
        live = data.is_live()
        return pmui.Alert(
            object="Live: reading the stack through the relay." if live else "Demo data: the relay is not reachable, so these numbers are simulated.",
            severity="success" if live else "warning", variant="outlined", margin=(10, 20),
        )

    # ── frames for the current state ──
    def _candles(self) -> pd.DataFrame:
        return data.candles(self.symbol, self.hours)

    def _sym_anomalies(self) -> pd.DataFrame:
        df = data.anomalies()
        return window(df[df["symbol"] == self.symbol], "ts", self.hours)

    def _base(self) -> str:
        return self.symbol.removesuffix("USDT")

    def _sym_news(self) -> pd.DataFrame:
        df = window(data.news(), "published_at", self.hours)
        base = self._base()
        return df[df["symbols"].map(lambda s: not s or base in (s or []))]

    # ── KPIs ──
    @staticmethod
    def _title(text: str, color: str):
        return pmui.Typography(text, variant="overline", sx={"color": color, "fontWeight": 700, "letterSpacing": "0.14em"})

    def _kpi(self, label: str, value, icon: str, color: str):
        return pmui.Grid(
            pmui.Paper(
                pmui.Column(
                    pmui.Typography(f'<span class="material-icons" style="font-size:1.25rem;vertical-align:-4px;color:{color}">{icon}</span>'
                                    f'&nbsp; {label}', variant="overline", sx={"color": "text.secondary", "lineHeight": 1.6, "whiteSpace": "nowrap"}),
                    value,
                ),
                sx={"borderTop": f"3px solid {color}", "p": 1},
            ),
            size={"xs": 12, "sm": 6, "lg": 2.4},
        )

    @param.depends("symbol", "tick")
    def _price(self):
        row = data.latest().set_index("symbol").get("close", pd.Series(dtype=float)).get(self.symbol)
        txt = "—" if row is None or pd.isna(row) else f"{row:,.2f}"
        return pmui.Typography(txt, variant="h6", sx=KPI_SX)

    @param.depends("symbol", "hours", "tick")
    def _change(self):
        c = self._candles()["close"]
        pct = (c.iloc[-1] / c.iloc[0] - 1) * 100 if len(c) > 1 else 0.0
        color = "#34d399" if pct >= 0 else SEV["high"]
        return pmui.Typography(f"{'▲' if pct >= 0 else '▼'} {abs(pct):.2f}%", variant="h6", sx={**KPI_SX, "color": color})

    @param.depends("symbol", "hours", "tick")
    def _anomaly_count(self):
        df = self._sym_anomalies()
        high = int((df["severity"] == "high").sum())
        return pmui.Typography(f"{len(df)} · {high} high", variant="h6", sx=KPI_SX)

    @param.depends("hours", "tick")
    def _whale_flow(self):
        df = window(data.whales(), "ts", self.hours)
        into = df.loc[df["verdict"] == "to_exchange", "usd_value"].sum()
        out = df.loc[df["verdict"] == "from_exchange", "usd_value"].sum()
        net = into - out
        sign, color = ("in", SEV["high"]) if net > 0 else ("out", "#34d399")   # into exchanges = sell pressure
        return pmui.Typography(f"{fmt_usd(abs(net))} {sign}" if len(df) else "—", variant="h6", sx={**KPI_SX, "color": color})

    @param.depends("symbol", "hours", "tick")
    def _mood(self):
        s = mood_score(self._sym_news())
        if s is None:
            return pmui.Typography("—", variant="h6", sx=KPI_SX)
        color = "#34d399" if s >= 0.2 else SEV["high"] if s <= -0.2 else "text.primary"
        word = "bullish" if s >= 0.2 else "bearish" if s <= -0.2 else "neutral"
        return pmui.Typography(f"{s:+.2f} {word}", variant="h6", sx={**KPI_SX, "color": color})

    # ── plots ──
    _plot_opts = dict(height=320, responsive=True, active_tools=["pan"], bgcolor="#0b1122", grid=True, fontscale=1.05, toolbar="above")

    @param.depends("symbol", "hours", "tick")
    def _price_plot(self):
        df = self._candles()
        color = COLORS.get(self.symbol, ACCENT["cyan"])
        lo, hi = df["close"].min() * 0.998, df["close"].max() * 1.002
        line = df.hvplot.line(x="ts", y="close", color=color, line_width=2.4, xlabel="", ylabel="USDT",
                              hover_cols=["open", "high", "low"], ylim=(lo, hi), **self._plot_opts)
        an = self._sym_anomalies()
        if not an.empty:
            pts = an.hvplot.scatter(x="ts", y="price", c="severity", cmap=SEV, size=140, marker="triangle",
                                    hover_cols=["kind", "reason", "zscore"], legend="top_left")
            line = line * pts
        return pn.pane.HoloViews(line, sizing_mode="stretch_width", theme="dark_minimal")

    @param.depends("symbol", "hours", "tick")
    def _volume_plot(self):
        df = self._candles().set_index("ts")["volume"].resample("1h").sum().reset_index()
        bars = df.hvplot.area(x="ts", y="volume", color=ACCENT["lime"], alpha=0.35, line_color=ACCENT["lime"], line_width=1.8,
                              xlabel="", ylabel=f"{self._base()} / hour", **{**self._plot_opts, "height": 240})
        return pn.pane.HoloViews(bars, sizing_mode="stretch_width", theme="dark_minimal")

    @param.depends("symbol", "hours", "tick")
    def _news_plot(self):
        df = self._sym_news().sort_values("published_at")
        if df.empty:
            return pmui.Typography("No headlines in this window.", sx={"color": "text.secondary", "p": 2})
        df = df.assign(color=df["sentiment"].map(lambda v: "#34d399" if v >= 0.2 else SEV["high"] if v <= -0.2 else "#94a3b8"))
        pts = df.hvplot.scatter(x="published_at", y="sentiment", c="color", size=160, hover_cols=["source", "title", "impact"],
                                xlabel="", ylabel="sentiment", ylim=(-1.05, 1.05), **{**self._plot_opts, "height": 240})
        return pn.pane.HoloViews(pts, sizing_mode="stretch_width", theme="dark_minimal")

    # ── tables ──
    _table_opts = dict(theme="materialize", pagination="local", page_size=8, show_index=False, disabled=True,
                       sizing_mode="stretch_width", header_align="left")

    @param.depends("symbol", "hours", "tick")
    def _anomaly_table(self):
        df = self._sym_anomalies().assign(time=lambda d: when(d["ts"]), price=lambda d: d["price"].round(2))
        return pn.widgets.Tabulator(df[["time", "severity", "kind", "price", "zscore", "reason"]], **self._table_opts)

    @param.depends("hours", "tick")
    def _whale_table(self):
        df = window(data.whales(), "ts", self.hours).assign(usd=lambda d: d["usd_value"].map(fmt_usd), time=lambda d: when(d["ts"]),
                                                            amount=lambda d: d["amount"].round(2))
        return pn.widgets.Tabulator(df[["time", "severity", "chain", "asset", "usd", "from_entity", "to_entity", "verdict"]], **self._table_opts)

    @param.depends("symbol", "hours", "tick")
    def _news_table(self):
        df = self._sym_news().assign(time=lambda d: when(d["published_at"]))[["time", "source", "title", "sentiment", "impact"]]
        return pn.widgets.Tabulator(df, **self._table_opts)

    def __panel__(self):
        return self._main

    @classmethod
    def create_app(cls, **params):
        studio = cls(**params)
        if pn.state.served:
            pn.state.add_periodic_callback(lambda: setattr(studio, "tick", studio.tick + 1), period=60_000)
        return pmui.Page(
            title="OMEGA Studio",
            sidebar=[
                pmui.Typography("Deep analysis for the Ops Room. Pick a pair and a window; data refreshes every minute.",
                                variant="body2", sx={"color": "text.secondary", "px": 2.5, "pt": 1}),
                *studio._inputs,
                pmui.Button(label="Back to the Ops Room", icon="hub", variant="text", href="http://localhost:8088", target="_self", margin=(10, 20)),
            ],
            main=[studio],
            dark_theme=True,
            theme_config=THEME,
        )


if __name__ == "__main__":
    OmegaStudio.create_app().show(port=5006, open=True)
elif pn.state.served:
    OmegaStudio.create_app().servable()
