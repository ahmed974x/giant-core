"use client";
import { useEffect, useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";

type Check = { state: "up" | "down" | "idle" | "unknown"; detail: string; at?: string | null };
const ORDER = ["director", "caddy", "database", "relay", "web", "backup"] as const;
const TONE: Record<Check["state"], string> = { up: "bg-good", down: "bg-bad", idle: "bg-warn", unknown: "bg-muted" };

/** Local platform health (Director 00, Caddy, DB, relay, web app, last backup), refreshed every 30 s. */
export default function SystemHealth() {
  const t = useTranslations("company.health");
  const f = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [checks, setChecks] = useState<Record<string, Check> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = () => fetch("/api/health", { cache: "no-store" }).then(r => r.json())
      .then(j => { setChecks(j.checks); setFailed(false); }).catch(() => setFailed(true));
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="panel p-4">
      <h2 className="mb-3 font-semibold">{t("title")}</h2>
      {failed && <p className="text-sm text-bad">{t("failed")}</p>}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map(k => {
          const c = checks?.[k];
          return (
            <li key={k} className="rounded-lg bg-panel-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${c ? TONE[c.state] : "animate-pulse bg-muted"}`} />
                <span className="text-sm font-medium">{t(`items.${k}`)}</span>
                <span className="ms-auto text-[11px] text-muted">{c ? t(`state.${c.state}`) : "…"}</span>
              </div>
              {c && <p className="mt-1 truncate text-xs text-muted" dir="ltr" title={c.detail}>{c.detail}</p>}
              {c?.at && <p className="text-[11px] text-muted/80">{f.relativeTime(new Date(c.at), now)}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
