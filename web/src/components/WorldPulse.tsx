"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Driver, Lean } from "@/lib/worldpulse";

type Data = { at: string; drivers: Driver[]; lean: Lean[]; sources: { gdacs: number; usgs: string; gdelt: string } };
const SEV = ["", "text-muted", "text-warn", "text-bad"];

/** World Pulse (ADR-048): events that move markets, which way they push each asset, and the evidence behind each. */
export default function WorldPulse() {
  const t = useTranslations("market.pulse");
  const f = useFormatter();
  const [d, setD] = useState<Data | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const load = () => fetch("/api/worldpulse", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => j && setD(j)).catch(() => null);
    load(); const id = setInterval(load, 5 * 60_000); return () => clearInterval(id);
  }, []);

  const drivers = d ? (all ? d.drivers : d.drivers.slice(0, 6)) : [];
  return (
    <section className="panel p-4" aria-labelledby="pulse-title">
      <h2 id="pulse-title" className="font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>
      {!d && <p className="mt-3 text-sm text-muted">{t("loading")}</p>}

      {d && d.lean.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.lean.filter(l => l.net !== 0).map(l => (
            <span key={l.asset} className={`rounded-full border px-3 py-1 text-sm ${l.net > 0 ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>
              {t(`asset.${l.asset}`)} {l.net > 0 ? "▲" : "▼"} <span className="num" dir="ltr">{Math.abs(l.net)}</span>
            </span>
          ))}
        </div>
      )}

      {d && (
        <ul className="mt-3 divide-y divide-line/60">
          {drivers.map(x => (
            <li key={x.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className={`font-semibold ${SEV[x.severity]}`}>{t(`kind.${x.kind}`)}</span>
                <span className="text-ink" dir="auto">{x.title}</span>
                <span className="text-xs text-muted">{t(`region.${x.region}`)}{x.at && !Number.isNaN(Date.parse(x.at)) ? ` · ${f.relativeTime(new Date(x.at))}` : ""}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {x.assets.map(a => <span key={a.asset} className={a.dir === "up" ? "text-good" : "text-bad"}>{t(`asset.${a.asset}`)} {a.dir === "up" ? "▲" : "▼"}</span>)}
                <span className="ms-auto flex gap-3">
                  <Link href={`/earth#7/${x.lat.toFixed(2)}/${x.lon.toFixed(2)}`} className="text-accent underline">{t("seeOnGlobe")}</Link>
                  {x.url && <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{t("source", { src: x.source })}</a>}
                </span>
              </div>
            </li>
          ))}
          {d.drivers.length === 0 && <li className="py-2 text-sm text-good">{t("quiet")}</li>}
        </ul>
      )}
      {d && d.drivers.length > 6 && <button onClick={() => setAll(v => !v)} className="mt-2 text-sm text-accent underline">{all ? t("less") : t("more", { n: d.drivers.length })}</button>}
      <p className="mt-3 text-xs text-muted">{t("safety")}</p>
    </section>
  );
}
