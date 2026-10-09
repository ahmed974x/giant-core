"use client";
import { useEffect, useState } from "react";
import { useFormatter, useNow, useLocale, useTranslations } from "next-intl";
import LiveBadge from "./LiveBadge";
import { DEMO_NODES } from "@/lib/demo";
import { relayJson, useLive } from "@/lib/relay";
import type { GeoNode } from "@/lib/types";

const tone = (v: string | null) => (v === "ok" ? "good" : v === "unknown" || v == null ? "unknown" : "down");

export default function Company() {
  const t = useTranslations("company");
  const f = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const locale = useLocale() as "ar" | "en";
  const live = useLive();
  const [nodes, setNodes] = useState<GeoNode[] | null>(null);

  useEffect(() => {
    relayJson<{ nodes: GeoNode[] }>(`geo/nodes?lang=${locale}`).then(r => setNodes(r.nodes)).catch(() => setNodes(DEMO_NODES[locale]));
  }, [locale]);

  const services = Object.entries(live.status).filter(([k]) => k !== "checkedAt");
  const kpis = [
    { key: "nodes", value: nodes?.length },
    { key: "alerts", value: live.anomalies.length },
    { key: "symbols", value: live.symbols.length },
    { key: "news", value: live.news.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <LiveBadge connected={live.connected} demo={live.demo} />
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(k => (
          <div key={k.key} className="panel p-4">
            <div className="text-sm text-muted">{t(`kpis.${k.key}`)}</div>
            <div className="num mt-1 text-3xl font-semibold">{k.value ?? "…"}</div>
          </div>
        ))}
      </section>

      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">{t("services")}</h2>
          <span className="text-xs text-muted">
            {live.status.checkedAt ? t("checked", { time: f.relativeTime(new Date(live.status.checkedAt), now) }) : t("never")}
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {services.map(([name, v]) => {
            const s = tone(v);
            return (
              <li key={name} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2">
                <span className="font-mono text-sm" dir="ltr">{name}</span>
                <span className={`inline-flex items-center gap-1.5 text-xs ${s === "good" ? "text-good" : s === "down" ? "text-bad" : "text-muted"}`}>
                  <span className={`size-2 rounded-full ${s === "good" ? "bg-good" : s === "down" ? "bg-bad" : "bg-muted"}`} />
                  {t(`state.${s === "good" ? "ok" : s}`)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
