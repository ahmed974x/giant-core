"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReviewItem } from "@/lib/review";

type Sources = { tiers: Record<string, { score: number; about: string }>; domains: Record<string, string> };
type Assumptions = { root_prior: number; likelihood: Record<string, number>; runs: number };

/** Phase 3 sign-off: the Truth Layer's source tiers, the Butterfly Engine's assumptions, and the backup password. */
export default function Review() {
  const t = useTranslations("review");
  const f = useFormatter();
  const [pin, setPin] = useState("");
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ } }, []);

  const load = useCallback(async () => {
    if (pin.length < 6) return;
    try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ }
    const r = await fetch("/api/review", { headers: { "x-omega-pin": pin }, cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (r?.ok) { setItems(j.items); setError(""); } else setError(j.error ?? t("failed"));
  }, [pin, t]);
  useEffect(() => { load(); }, [load]);

  const sign = async (it: ReviewItem) => {
    setBusy(it.id);
    const r = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, id: it.id, hash: it.hash }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (!r?.ok) setError(j.error ?? t("failed"));
    setBusy(null); load();
  };

  const status = (it: ReviewItem) => it.current
    ? <span className="rounded bg-good/15 px-2 py-0.5 text-xs text-good">{t("approved", { date: f.dateTime(new Date(it.approval!.at), { dateStyle: "medium" }) })}</span>
    : it.approval
      ? <span className="rounded bg-warn/15 px-2 py-0.5 text-xs text-warn">{t("changed")}</span>
      : <span className="rounded bg-panel-2 px-2 py-0.5 text-xs text-muted">{t("notYet")}</span>;

  const footer = (it: ReviewItem) => (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
      {status(it)}
      {it.id !== "restic" && <span className="font-mono text-[11px] text-muted" dir="ltr">v {it.hash}</span>}
      {!it.current && (
        <button disabled={busy === it.id} onClick={() => sign(it)} className="ms-auto rounded-md bg-brass px-4 py-1.5 text-sm font-semibold text-[#071526] disabled:opacity-50">
          {t(it.id === "restic" ? "saved" : "approve")}
        </button>
      )}
    </div>
  );

  const sources = items?.find(i => i.id === "sources");
  const butterfly = items?.find(i => i.id === "butterfly");
  const restic = items?.find(i => i.id === "restic");
  const sweeper = items?.find(i => i.id === "sweeper");
  const sw = sweeper?.content as Record<string, number | string> | undefined;
  const src = sources?.content as Sources | undefined, as = butterfly?.content as Assumptions | undefined;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end gap-3">
        <div className="me-auto">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">{t("lead")}</p>
        </div>
        <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
          placeholder={t("pin")} aria-label={t("pin")} className="w-32 rounded-md border border-line bg-panel px-3 py-2 text-sm" dir="ltr" />
      </div>
      {pin.length < 6 && <p className="mt-4 text-sm text-muted">{t("needPin")}</p>}
      {error && <p role="alert" className="mt-4 rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {sources && src && (
        <section className="panel mt-5 p-4">
          <h2 className="font-semibold">{t("sources.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("sources.lead")}</p>
          <ul className="mt-3 divide-y divide-line">
            {Object.entries(src.tiers).sort((a, b) => b[1].score - a[1].score).map(([tier, v]) => {
              const domains = Object.entries(src.domains).filter(([, x]) => x === tier).map(([d]) => d);
              return (
                <li key={tier} className="py-3">
                  <div className="flex items-center gap-3">
                    <span className="num w-12 text-lg font-semibold text-accent" dir="ltr">{v.score.toFixed(2)}</span>
                    <span className="font-medium">{t(`sources.tiers.${tier}`)}</span>
                    <span className="ms-auto text-xs text-muted">{t("sources.count", { n: domains.length })}</span>
                  </div>
                  <div className="ms-15 mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2"><div className="h-full bg-accent/70" style={{ width: `${v.score * 100}%` }} /></div>
                  {domains.length > 0 && <p className="mt-2 text-xs leading-relaxed text-muted" dir="ltr">{domains.join(" · ")}</p>}
                </li>
              );
            })}
          </ul>
          {footer(sources)}
        </section>
      )}

      {butterfly && as && (
        <section className="panel mt-5 p-4">
          <h2 className="font-semibold">{t("butterfly.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("butterfly.lead")}</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {[["root_prior", `${Math.round(as.root_prior * 100)}%`], ...Object.entries(as.likelihood).map(([k, v]) => [k, `×${v}`]), ["runs", f.number(as.runs)]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-panel-2 p-3">
                <dt className="text-xs text-muted">{t(`butterfly.keys.${k}`)}</dt>
                <dd className="num mt-1 text-lg font-semibold text-accent" dir="ltr">{v}</dd>
              </div>
            ))}
          </dl>
          {footer(butterfly)}
        </section>
      )}

      {sweeper && sw && (
        <section className="panel mt-5 p-4">
          <h2 className="font-semibold">{t("sweeper.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("sweeper.lead")}</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {([["min_gain_pct", `${sw.min_gain_pct}%`], ["sweep_share", `${Math.round(Number(sw.sweep_share) * 100)}%`], ["min_sweep_usd", `${sw.min_sweep_usd}`], ["reserve", String(sw.reserve)]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-panel-2 p-3">
                <dt className="text-xs text-muted">{t(`sweeper.keys.${k}`)}</dt>
                <dd className="num mt-1 text-lg font-semibold text-accent" dir="ltr">{v}</dd>
              </div>
            ))}
          </dl>
          {footer(sweeper)}
        </section>
      )}

      {restic && (
        <section className="panel mt-5 p-4">
          <h2 className="font-semibold">{t("restic.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("restic.lead")}</p>
          {footer(restic)}
        </section>
      )}
    </div>
  );
}
