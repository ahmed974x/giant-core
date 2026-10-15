"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { OIL_SITES } from "@/lib/oilsites";
import type { Signal, SiteFires, TankerReading } from "@/lib/oilwatch";

const siteHref = (id: string) => { const s = OIL_SITES.find(x => x.id === id); return s ? `/earth#10/${s.lat}/${s.lon}` : "/earth"; };

type Data = { at: string; tankers: TankerReading | null; sites: SiteFires[] | null; signal: Signal; firms: string;
  hormuz: { tankers: number; moving: number; typed: number; seen: number } | null };
const TONE: Record<Signal["level"], string> = { calm: "text-good border-good/40 bg-good/10", watch: "text-warn border-warn/40 bg-warn/10", alert: "text-bad border-bad/40 bg-bad/10", learning: "text-muted border-line bg-panel-2" };

/** Oil Watch (ADR-047): tanker flow and oil-site fires turned into one signal. Context for decisions, never an order. */
export default function OilWatch() {
  const t = useTranslations("market.oil");
  const ar = useLocale() === "ar";
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/oilwatch", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => j && setD(j)).catch(() => null);
    load(); const id = setInterval(load, 5 * 60_000); return () => clearInterval(id);
  }, []);

  const hot = d?.sites?.filter(s => s.fires > 0).sort((a, b) => b.fires - a.fires).slice(0, 4) ?? [];
  return (
    <section className="panel p-4" aria-labelledby="oil-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="oil-title" className="font-semibold">{t("title")}</h2>
        {d && <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[d.signal.level]}`}>{t(`level.${d.signal.level}`)}{d.signal.level !== "learning" ? ` · ${d.signal.score}` : ""}</span>}
      </div>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>
      {!d && <p className="mt-3 text-sm text-muted">{t("loading")}</p>}
      {d && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-panel-2 p-3">
            <div className="text-xs text-muted">{t("tankerBot")}</div>
            {d.tankers ? (
              <>
                <div className="num mt-1 flex flex-wrap gap-x-4 text-sm" dir="ltr">
                  <span><b className="text-lg text-ink">{d.tankers.toRussianOilPorts}</b> {t("toRu")}</span>
                  <span><b className="text-ink">{d.tankers.moving}</b>/{d.tankers.tankers} {t("moving")}</span>
                </div>
                {d.tankers.sample.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-muted" dir="ltr">{d.tankers.sample.map(s => <li key={s} className="font-mono">{s}</li>)}</ul>}
                <Link href="/earth#6.5/59.9/27" className="mt-2 inline-block text-xs text-accent underline">{t("seeOnGlobe")}</Link>
              </>
            ) : <p className="mt-1 text-sm text-muted">{t("noAis")}</p>}
            <div className="mt-3 border-t border-line/60 pt-2 text-xs text-muted">{t("hormuz")}: {d.hormuz
              ? <span className="num text-ink" dir="ltr">{d.hormuz.tankers} ({d.hormuz.moving} {t("moving")}) / {d.hormuz.seen}</span>
              : t("hormuzOff")}{d.hormuz && <Link href="/earth#8/26.4/56.3" className="ms-2 text-accent underline">{t("seeOnGlobe")}</Link>}</div>
          </div>
          <div className="rounded-lg bg-panel-2 p-3">
            <div className="text-xs text-muted">{t("fireBot")}</div>
            {d.sites ? (
              hot.length ? (
                <ul className="mt-1 space-y-0.5 text-sm">{hot.map(s => <li key={s.id} className="flex justify-between gap-2"><Link href={siteHref(s.id)} className="underline decoration-dotted">{ar ? s.nameAr : s.name}</Link><span className="num text-warn" dir="ltr">{s.fires} 🔥</span></li>)}</ul>
              ) : <p className="mt-1 text-sm text-good">{t("noFires")}</p>
            ) : <p className="mt-1 text-sm text-muted">{t("noFirms")}</p>}
          </div>
        </div>
      )}
      {d && d.signal.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {d.signal.reasons.map((r, i) => <li key={i}>• {r.site ? <Link href={siteHref(r.site)} className="underline decoration-dotted">{t("seeOnGlobe")}</Link> : null} {t(`reason.${r.code}`, { value: r.value, normal: r.normal ?? 0, site: (ar ? d.sites?.find(s => s.id === r.site)?.nameAr : d.sites?.find(s => s.id === r.site)?.name) ?? "" })}</li>)}
        </ul>
      )}
      {d?.signal.level === "learning" && <p className="mt-2 text-xs text-muted">{t("learningHint", { n: d.signal.history })}</p>}
      <p className="mt-3 text-xs text-muted">{t("safety")}</p>
    </section>
  );
}
