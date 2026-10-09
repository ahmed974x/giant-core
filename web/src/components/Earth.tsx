"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useFormatter, useNow, useLocale, useTranslations } from "next-intl";
import LiveBadge from "./LiveBadge";
import Severity from "./Severity";
import { DEMO_NODES } from "@/lib/demo";
import { relayJson, useLive } from "@/lib/relay";
import type { GeoNode } from "@/lib/types";

const EarthMap = dynamic(() => import("./EarthMap"), { ssr: false, loading: () => <div className="panel h-[60dvh] animate-pulse" /> });

export default function Earth() {
  const t = useTranslations("earth");
  const f = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const locale = useLocale() as "ar" | "en";
  const live = useLive();
  const [nodes, setNodes] = useState<GeoNode[]>([]);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    relayJson<{ nodes: GeoNode[] }>(`geo/nodes?lang=${locale}`).then(r => setNodes(r.nodes)).catch(() => setNodes(DEMO_NODES[locale]));
  }, [locale]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <LiveBadge connected={live.connected} demo={live.demo} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <EarthMap nodes={nodes} focus={focus} onFocus={setFocus} />
        <aside className="space-y-4">
          <section className="panel">
            <h2 className="border-b border-line px-4 py-3 font-semibold">{t("nodes")}</h2>
            <ul className="divide-y divide-line/60">
              {nodes.map(n => (
                <li key={n.slug}>
                  <button onClick={() => setFocus(n.slug)} className={`flex w-full items-center justify-between px-4 py-2.5 text-start text-sm hover:bg-panel-2 ${focus === n.slug ? "text-accent" : ""}`}>
                    <span>{n.name}</span>
                    <span className="text-xs text-muted">{t.has(`types.${n.node_type}`) ? t(`types.${n.node_type}`) : n.node_type}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2 className="border-b border-line px-4 py-3 font-semibold">{t("alerts")}</h2>
            {live.anomalies.length === 0 ? <p className="p-4 text-sm text-muted">{t("noAlerts")}</p> : (
              <ul className="max-h-72 divide-y divide-line/60 overflow-y-auto">
                {live.anomalies.slice(0, 20).map(a => (
                  <li key={a.id} className="space-y-1 px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-2"><Severity level={a.severity} /><span className="font-mono" dir="ltr">{a.symbol}</span>
                      <span className="ms-auto text-xs text-muted">{f.relativeTime(new Date(a.ts), now)}</span></div>
                    <p className="text-xs text-muted" dir="ltr">{a.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
