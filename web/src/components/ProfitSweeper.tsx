"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Plan } from "@/lib/sweeper";

type State = { state: "ok" | "no-positions" | "no-prices" | "error"; plan?: Plan; error?: string };

/** Profit Sweeper (ADR-033): the plan under Ahmad's rules, sent to Director 00 as a proposal. It never trades. */
export default function ProfitSweeper() {
  const t = useTranslations("market.sweeper");
  const f = useFormatter();
  const [pin, setPin] = useState("");
  const [data, setData] = useState<State | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ } }, []);
  const load = useCallback(async () => {
    if (pin.length < 6) return;
    try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ }
    const r = await fetch("/api/sweeper", { headers: { "x-omega-pin": pin }, cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { state: "error", error: t("offline") };
    setData(r?.ok ? j : { state: "error", error: j.error });
  }, [pin, t]);
  useEffect(() => { load(); }, [load]);

  const propose = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/sweeper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    setMsg(r?.ok ? { ok: true, text: t("sent") } : { ok: false, text: j.error ?? t("failed") });
    setBusy(false);
  };

  const usd = (n: number) => (Number.isFinite(n) ? f.number(n, { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "—");
  const plan = data?.plan;
  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
          placeholder={t("pin")} aria-label={t("pin")} className="ms-auto w-28 rounded-md border border-line bg-panel-2 px-2 py-1 text-sm" dir="ltr" />
      </div>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>

      {data?.state === "no-positions" && <p className="mt-3 rounded-md bg-panel-2 p-3 text-sm text-muted">{t("noPositions")}</p>}
      {(data?.state === "no-prices" || data?.state === "error") && <p className="mt-3 rounded-md bg-bad/10 p-3 text-sm text-bad">{data.error ?? t("failed")}</p>}

      {plan && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="num w-full text-sm" dir="ltr">
              <thead className="text-xs text-muted">
                <tr><th className="py-1 text-start font-normal">{t("cols.symbol")}</th><th className="text-end font-normal">{t("cols.value")}</th>
                  <th className="text-end font-normal">{t("cols.gain")}</th><th className="text-end font-normal">{t("cols.sweep")}</th><th className="text-end font-normal">{t("cols.why")}</th></tr>
              </thead>
              <tbody>
                {plan.lines.map(l => (
                  <tr key={l.symbol} className="border-t border-line/60">
                    <td className="py-1.5 font-mono">{l.symbol}</td>
                    <td className="text-end">{usd(l.value)}</td>
                    <td className={`text-end ${l.gain > 0 ? "text-good" : l.gain < 0 ? "text-bad" : ""}`}>{usd(l.gain)}{Number.isFinite(l.gainPct) ? ` (${l.gainPct}%)` : ""}</td>
                    <td className="text-end text-brass">{l.sweepUsd ? usd(l.sweepUsd) : "—"}</td>
                    <td className="text-end text-xs text-muted">{t(`reasons.${l.reason}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <span className="text-sm">{t("total", { amount: usd(plan.totalSweepUsd), reserve: plan.reserve })}</span>
            <button disabled={busy || plan.totalSweepUsd <= 0} onClick={propose}
              className="ms-auto rounded-md bg-brass px-4 py-1.5 text-sm font-semibold text-[#071526] disabled:opacity-40">{t("propose")}</button>
          </div>
        </>
      )}
      {msg && (
        <p className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>
          {msg.text} {msg.ok && <Link href="/#inbox" className="underline">{t("openInbox")}</Link>}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">{t("safety")} <Link href="/review" className="underline">{t("rules")}</Link></p>
    </section>
  );
}
