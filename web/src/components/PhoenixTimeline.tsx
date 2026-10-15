"use client";
import { useEffect, useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";

type Ev = { ts: string; service: string; action: string; result: string; detail: string };
type Data = { state: Record<string, { result: "ok" | "down"; ts: string; detail: string }>; lastRun: Ev | null; incidents: Ev[] };
const TONE: Record<string, string> = { ok: "bg-good", down: "bg-bad", failed: "bg-bad", skipped: "bg-muted" };

/** What the self-healing watchdog saw and did (ADR-020): state per service and the latest incidents. */
export default function PhoenixTimeline() {
  const t = useTranslations("company.phoenix");
  const f = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/phoenix", { cache: "no-store" }).then(r => r.json()).then(setData).catch(() => null);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const when = (ts: string) => f.relativeTime(new Date(ts.replace(" ", "T")), now);
  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <span className="text-xs text-muted">{data?.lastRun ? t("lastRun", { when: when(data.lastRun.ts) }) : t("never")}</span>
      </div>
      {data && Object.keys(data.state).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" dir="ltr">
          {Object.entries(data.state).map(([svc, s]) => (
            <span key={svc} title={s.detail} className="flex items-center gap-1.5 rounded-full bg-panel-2 px-2.5 py-1 text-xs">
              <span className={`size-1.5 rounded-full ${TONE[s.result]}`} />{svc}
            </span>
          ))}
        </div>
      )}
      {data && data.incidents.length === 0 ? <p className="text-sm text-muted">{t("quiet")}</p> : (
        <ol className="space-y-1.5 text-sm">
          {data?.incidents.map((e, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE[e.result] ?? "bg-muted"}`} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{e.service}</span>{" "}
                <span className="text-muted">{t(`actions.${e.action}`)} → {t(`results.${e.result}`)}</span>
                {e.detail && <span className="block truncate text-xs text-muted/80" dir="ltr" title={e.detail}>{e.detail}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted">{when(e.ts)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
