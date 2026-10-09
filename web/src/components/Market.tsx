"use client";
import { useFormatter, useNow, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import LiveBadge from "./LiveBadge";
import Severity from "./Severity";

const PriceChart = dynamic(() => import("./PriceChart"), { ssr: false, loading: () => <div className="panel h-[430px] animate-pulse" /> });
import { useLive } from "@/lib/relay";

export default function Market() {
  const t = useTranslations("market");
  const f = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const live = useLive();
  const prices = live.pulse?.symbols ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <LiveBadge connected={live.connected} demo={live.demo} />
      </div>

      <PriceChart anomalies={live.anomalies} />

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="panel overflow-hidden lg:col-span-2">
          <h2 className="border-b border-line px-4 py-3 font-semibold">{t("prices")}</h2>
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr><th className="px-4 py-2 text-start font-normal">{t("symbol")}</th><th className="px-4 py-2 text-end font-normal">{t("close")}</th><th className="px-4 py-2 text-end font-normal">{t("time")}</th></tr>
            </thead>
            <tbody>
              {(prices.length ? prices : live.symbols.map(symbol => ({ symbol, close: NaN, ts: "" }))).map(p => (
                <tr key={p.symbol} className="border-t border-line/60">
                  <td className="px-4 py-2 font-mono" dir="ltr">{p.symbol}</td>
                  <td className="num px-4 py-2 text-end">{Number.isFinite(p.close) ? f.number(p.close, { maximumFractionDigits: 2 }) : "—"}</td>
                  <td className="px-4 py-2 text-end text-muted">{p.ts ? f.dateTime(new Date(p.ts), { timeStyle: "short" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel lg:col-span-3">
          <h2 className="border-b border-line px-4 py-3 font-semibold">{t("anomalies")}</h2>
          {live.anomalies.length === 0 ? <p className="p-4 text-sm text-muted">{t("none")}</p> : (
            <ul className="max-h-[420px] divide-y divide-line/60 overflow-y-auto">
              {live.anomalies.map(a => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <Severity level={a.severity} />
                  <span className="font-mono" dir="ltr">{a.symbol}</span>
                  <span className="text-muted" dir="ltr">{a.reason}</span>
                  <span className="ms-auto text-xs text-muted">{f.relativeTime(new Date(a.ts), now)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <h2 className="border-b border-line px-4 py-3 font-semibold">{t("news")}</h2>
        {live.news.length === 0 ? <p className="p-4 text-sm text-muted">{t("noNews")}</p> : (
          <ul className="divide-y divide-line/60">
            {live.news.slice(0, 15).map(n => {
              const s = n.sentiment ?? 0;
              return (
                <li key={n.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`num w-12 shrink-0 text-center text-xs font-semibold ${s > 0.15 ? "text-good" : s < -0.15 ? "text-bad" : "text-muted"}`} dir="ltr">
                    {s > 0 ? "+" : ""}{s.toFixed(2)}
                  </span>
                  <span className="min-w-0 flex-1 truncate" dir="auto">{n.title}</span>
                  <span className="shrink-0 text-xs text-muted">{f.relativeTime(new Date(n.published_at), now)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
