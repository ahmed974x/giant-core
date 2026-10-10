"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, Time, UTCTimestamp } from "lightweight-charts";
import type { Anomaly } from "@/lib/types";

const SYMBOLS = [
  { id: "BTCUSDT", label: "BTC" }, { id: "ETHUSDT", label: "ETH" }, { id: "SOLUSDT", label: "SOL" }, { id: "PAXGUSDT", label: "GOLD" },
] as const;
const INTERVALS = ["15m", "1h", "4h", "1d"] as const;
const SECONDS: Record<(typeof INTERVALS)[number], number> = { "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/** TradingView Lightweight Charts: candles, volume and the relay's anomaly flags pinned on the bars. */
export default function PriceChart({ anomalies }: { anomalies: Anomaly[] }) {
  const t = useTranslations("market");
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]["id"]>("BTCUSDT");
  const [interval, setIntervalId] = useState<(typeof INTERVALS)[number]>("1h");
  const [last, setLast] = useState<{ close: number; change: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let disposed = false;
    import("lightweight-charts").then(({ createChart, CandlestickSeries, HistogramSeries, createSeriesMarkers, ColorType, CrosshairMode }) => {
      if (disposed || !el.current) return;
      const c = createChart(el.current, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8b98a8", fontFamily: "var(--font-inter), system-ui", attributionLogo: true },
        grid: { vertLines: { color: "rgba(35,50,70,0.5)" }, horzLines: { color: "rgba(35,50,70,0.5)" } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: "#233246" },
        timeScale: { borderColor: "#233246", timeVisible: true, secondsVisible: false },
      });
      candles.current = c.addSeries(CandlestickSeries, { upColor: "#4cd38a", downColor: "#f2685c", borderVisible: false, wickUpColor: "#4cd38a", wickDownColor: "#f2685c" });
      volume.current = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
      c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      markers.current = createSeriesMarkers(candles.current, []);
      chart.current = c;
    });
    return () => { disposed = true; chart.current?.remove(); chart.current = null; };
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/klines?symbol=${symbol}&interval=${interval}`, { cache: "no-store" });
        if (!r.ok) throw new Error();
        const { candles: rows } = (await r.json()) as { candles: Candle[] };
        if (stop || !candles.current || !volume.current) return;
        candles.current.setData(rows.map(k => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
        volume.current.setData(rows.map(k => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? "rgba(76,211,138,0.35)" : "rgba(242,104,92,0.35)" })));
        const a = rows[rows.length - 1], b = rows[0];
        if (a && b) setLast({ close: a.close, change: ((a.close - b.open) / b.open) * 100 });
        setError(false);
      } catch {
        if (!stop) setError(true);
      }
    };
    // The chart library loads lazily, so retry briefly until the series exist.
    const boot = setInterval(() => { if (candles.current) { clearInterval(boot); load(); } }, 100);
    const poll = setInterval(load, 30_000);
    return () => { stop = true; clearInterval(boot); clearInterval(poll); };
  }, [symbol, interval]);

  useEffect(() => {
    // Anomalies snap to the start of the bar they fall in.
    const step = SECONDS[interval];
    const marks = anomalies.filter(a => a.symbol === symbol).map(a => {
      const ts = Math.floor(new Date(a.ts).getTime() / 1000);
      return { time: (ts - (ts % step)) as UTCTimestamp, position: "aboveBar" as const, shape: "arrowDown" as const,
        color: a.severity === "high" ? "#f2685c" : "#f2b84b", text: a.kind.replace(/_/g, " ") };
    }).sort((x, y) => x.time - y.time);
    markers.current?.setMarkers(marks);
  }, [anomalies, symbol, interval]);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="font-semibold">{t("chart")}</h2>
        {last && (
          <span className="num font-mono text-sm" dir="ltr">
            {last.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            <span className={last.change >= 0 ? "text-good" : "text-bad"}>{last.change >= 0 ? "+" : ""}{last.change.toFixed(2)}%</span>
          </span>
        )}
        <div className="ms-auto flex flex-wrap gap-2" dir="ltr">
          <div className="flex overflow-hidden rounded-lg border border-line text-xs">
            {SYMBOLS.map(s => (
              <button key={s.id} onClick={() => setSymbol(s.id)} aria-pressed={symbol === s.id}
                className={`px-2.5 py-1 ${symbol === s.id ? "bg-accent font-semibold text-[#071526]" : "text-muted hover:text-ink"}`}>{s.label}</button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-line text-xs">
            {INTERVALS.map(i => (
              <button key={i} onClick={() => setIntervalId(i)} aria-pressed={interval === i}
                className={`px-2.5 py-1 ${interval === i ? "bg-panel-2 font-semibold text-accent" : "text-muted hover:text-ink"}`}>{i}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative h-[380px]" dir="ltr">
        <div ref={el} className="absolute inset-0" />
        {error && <p className="absolute inset-0 grid place-items-center text-sm text-muted">{t("chartError")}</p>}
      </div>
    </section>
  );
}
