"use client";
import { useEffect, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";

type Candle = { time: number; close: number };

/** A small TradingView Lightweight Charts area of BTC/USDT over the last 300 hours. Reports the latest price and
 *  the 24 h change to the card. */
export default function MarketMini({ onQuote }: { onQuote?: (q: { price: number; change24h: number }) => void }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose: (() => void) | null = null, cancelled = false;
    Promise.all([import("lightweight-charts"), fetch("/api/klines?symbol=BTCUSDT&interval=1h", { cache: "no-store" }).then(r => r.json()).catch(() => null)])
      .then(([{ createChart, AreaSeries, ColorType }, data]) => {
        const candles = (data?.candles ?? []) as Candle[];
        if (cancelled || !el.current || !candles.length) return;
        const last = candles[candles.length - 1].close, dayAgo = candles[Math.max(0, candles.length - 25)].close;
        const up = last >= dayAgo;
        onQuote?.({ price: last, change24h: ((last - dayAgo) / dayAgo) * 100 });
        const chart = createChart(el.current, {
          autoSize: true, handleScroll: false, handleScale: false,
          layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94a0b8", attributionLogo: false },
          grid: { vertLines: { visible: false }, horzLines: { color: "rgba(148,160,184,0.08)" } },
          rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, visible: false }, crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
        });
        const line = up ? "#06B6D4" : "#EC4899";
        chart.addSeries(AreaSeries, { lineColor: line, lineWidth: 2, topColor: up ? "rgba(6,182,212,0.35)" : "rgba(236,72,153,0.35)", bottomColor: "rgba(10,14,26,0)", priceLineVisible: false, lastValueVisible: true })
          .setData(candles.map(c => ({ time: c.time as UTCTimestamp, value: c.close })));
        chart.timeScale().fitContent();
        dispose = () => chart.remove();
      });
    return () => { cancelled = true; dispose?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={el} className="size-full" aria-hidden />;
}
