"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Result } from "@/lib/strategies";

type Data = { symbol: string; interval: string; bars: number; price: number; results: Result[] };
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "PAXGUSDT"];
const INTERVALS = ["1h", "4h", "1d"];
const SIG = { buy: "bg-good/15 text-good border-good/40", sell: "bg-bad/15 text-bad border-bad/40", hold: "bg-panel-2 text-muted border-line" };

function Spark({ eq }: { eq: number[] }) {
  if (eq.length < 2) return null;
  const min = Math.min(...eq), max = Math.max(...eq), w = 96, h = 26, span = max - min || 1;
  const pts = eq.map((v, i) => `${((i / (eq.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0"><polyline points={pts} fill="none" strokeWidth="1.5" className={eq[eq.length - 1] >= 1 ? "stroke-good" : "stroke-bad"} /></svg>;
}

/** Trading strategies (ADR-052): five strategy types backtested on real candles, with today's signal. Paper only. */
export default function Strategies() {
  const t = useTranslations("market.strategies");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval_] = useState("1d");
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setD(null); setErr(false);
    fetch(`/api/strategies?symbol=${symbol}&interval=${interval}`, { cache: "no-store" }).then(r => (r.ok ? r.json() : Promise.reject())).then(setD).catch(() => setErr(true));
  }, [symbol, interval]);

  const paper = async (r: Result) => {
    let pin = ""; try { pin = sessionStorage.getItem("omega-pin") ?? ""; } catch { /* storage blocked */ }
    if (!pin) { setMsg({ ok: false, text: t("needPin") }); return; }
    const body = r.signal === "buy" ? { action: "order", symbol, side: "buy", usd: 100 } : { action: "order", symbol, side: "sell" };
    const res = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, ...body }) }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setMsg(res?.ok ? { ok: true, text: t("sent", { name: t(`name.${r.id}`) }) } : { ok: false, text: j.error ?? t("failed") });
  };

  const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;
  return (
    <section className="panel p-4" aria-labelledby="strat-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="strat-title" className="font-semibold">{t("title")}</h2>
        <select value={symbol} onChange={e => setSymbol(e.target.value)} aria-label={t("pair")} className="ms-auto rounded-md border border-line bg-panel-2 px-2 py-1 font-mono text-sm" dir="ltr">
          {SYMBOLS.map(s => <option key={s}>{s}</option>)}
        </select>
        <div role="group" aria-label={t("interval")} className="flex overflow-hidden rounded-md border border-line text-xs">
          {INTERVALS.map(i => <button key={i} aria-pressed={interval === i} onClick={() => setInterval_(i)} className={`px-2.5 py-1 ${interval === i ? "bg-accent/20 font-semibold text-accent" : "text-muted"}`}>{t(`iv.${i}`)}</button>)}
        </div>
      </div>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>
      {err && <p className="mt-3 rounded-md bg-bad/10 p-3 text-sm text-bad">{t("unreachable")}</p>}
      {!d && !err && <p className="mt-3 text-sm text-muted">{t("loading")}</p>}
      {d && (
        <ul className="mt-3 divide-y divide-line/60">
          {d.results.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-40 flex-1">
                <div className="font-semibold">{t(`name.${r.id}`)}</div>
                <div className="text-xs text-muted">{t(`how.${r.id}`)}</div>
              </div>
              {r.backtest ? (
                <div className="num flex items-center gap-3 text-xs" dir="ltr">
                  <Spark eq={r.backtest.equity} />
                  <span className={r.backtest.returnPct >= 0 ? "text-good" : "text-bad"}>{pct(r.backtest.returnPct)}</span>
                  <span className="text-muted">{t("vsHold")} {pct(r.backtest.buyHoldPct)}</span>
                  <span className="text-muted">DD {r.backtest.maxDrawdownPct}%</span>
                  <span className="text-muted">{r.backtest.trades} {t("trades")}{r.backtest.winRatePct != null ? ` · ${r.backtest.winRatePct}%` : ""}</span>
                </div>
              ) : <span className="text-xs text-muted">{t("liveOnly", { lean: String(r.reason.lean ?? 0) })}</span>}
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SIG[r.signal]}`}>{t(`sig.${r.signal}`)}</span>
              {r.signal !== "hold" && <button onClick={() => paper(r)} className="rounded-md bg-brass px-2.5 py-1 text-xs font-semibold text-[#0A0E1A]">{t("tryPaper")}</button>}
            </li>
          ))}
        </ul>
      )}
      {msg && <p role="status" className={`mt-2 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>{msg.text}</p>}
      {d && <p className="mt-2 text-xs text-muted">{t("basis", { bars: d.bars, iv: t(`iv.${d.interval}`) })}</p>}
      <p className="mt-1 text-xs text-muted">{t("safety")}</p>
    </section>
  );
}
