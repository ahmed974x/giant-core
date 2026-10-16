"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { Row } from "@/lib/paper-proposals";

type Data = { pending: Row[]; recent: Row[] };

/** Paper proposal queue (ADR-073): the system proposes, Ahmad approves each one before it is recorded. Paper only. */
export default function PaperProposals() {
  const t = useTranslations("market.proposals");
  const f = useFormatter();
  const [pin, setPin] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ } }, []);
  const load = useCallback(async () => {
    if (pin.length < 6) return;
    const r = await fetch("/api/paper/proposals", { headers: { "x-omega-pin": pin }, cache: "no-store" }).catch(() => null);
    if (r?.ok) setData(await r.json());
  }, [pin]);
  useEffect(() => { load(); }, [load]);

  const send = async (payload: Record<string, unknown>, done: (j: Record<string, unknown>) => string) => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/paper/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, ...payload }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (r?.ok) { setData(j); setMsg({ ok: true, text: done(j) }); window.dispatchEvent(new Event("omega-paper-changed")); }
    else setMsg({ ok: false, text: j.error ?? t("failed") });
    setBusy(false);
  };

  const usd = (n: number) => f.number(n, { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 4 : 2 });
  const summary = (s: Row["evidence"]["summary"]) => Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(" · ");

  return (
    <section className="panel p-4" aria-labelledby="proposals-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="proposals-title" className="font-semibold">{t("title")}</h2>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">{t("badge")}</span>
        <button disabled={busy || pin.length < 6} onClick={() => send({ action: "scan" }, j => t("scanned", { n: Number(j.added ?? 0) }))}
          className="ms-auto rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40">{t("scan")}</button>
      </div>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>
      {pin.length < 6 && <p className="mt-2 text-xs text-muted">{t("needPin")}</p>}
      {msg && <p role="status" className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>{msg.text}</p>}

      {data && data.pending.length === 0 && <p className="mt-3 text-sm text-muted">{t("empty")}</p>}
      <ul className="mt-3 space-y-2">
        {data?.pending.map(p => (
          <li key={p.id} className="rounded-lg bg-panel-2 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={p.side === "buy" ? "text-good" : "text-bad"}>{t(p.side)}</span>
              <span className="font-mono" dir="ltr">{p.symbol}</span>
              <span className="num" dir="ltr">{p.usd != null ? usd(p.usd) : t("all")}</span>
              <span className="text-xs text-muted" dir="ltr">{p.evidence.source} @ {usd(p.evidence.observed_price)}</span>
            </div>
            <div className="mt-1 text-xs text-muted" dir="ltr">{summary(p.evidence.summary)}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a href={p.evidence.url} target="_blank" rel="noopener noreferrer" className="text-xs underline">{t("evidence")}</a>
              <button disabled={busy} onClick={() => confirm(t("approveConfirm", { side: t(p.side), symbol: p.symbol })) && send({ action: "approve", id: p.id }, () => t("approved"))}
                className="ms-auto rounded-md bg-brass px-3 py-1 text-xs font-semibold text-[#0A0E1A] disabled:opacity-40">{t("approve")}</button>
              <button disabled={busy} onClick={() => send({ action: "reject", id: p.id }, () => t("rejected"))}
                className="rounded-md border border-line px-3 py-1 text-xs disabled:opacity-40">{t("reject")}</button>
            </div>
          </li>
        ))}
      </ul>

      {data && data.recent.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">{t("history", { n: data.recent.length })}</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted" dir="ltr">
            {data.recent.map(r => (
              <li key={r.id} className="num flex flex-wrap gap-x-3">
                <span>{f.dateTime(new Date(r.at), { dateStyle: "short", timeStyle: "short" })}</span>
                <span>{t(r.side)} {r.symbol}</span>
                <span>{t(`status.${r.status}`)}</span>
                <a href={r.evidence.url} target="_blank" rel="noopener noreferrer" className="underline">{t("evidence")}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 border-t border-line pt-3 text-xs text-muted">{t("safety")}</p>
    </section>
  );
}
