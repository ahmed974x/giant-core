"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useLocale, useNow, useTranslations } from "next-intl";
import LiveBadge from "./LiveBadge";
import Severity from "./Severity";
import type { FeedItem, Layer, MapTarget } from "./EarthMap";
import { DEMO_NODES } from "@/lib/demo";
import { relayJson, useLive } from "@/lib/relay";
import type { GeoNode } from "@/lib/types";

const EarthMap = dynamic(() => import("./EarthMap"), { ssr: false, loading: () => <div className="panel h-[64dvh] animate-pulse" /> });

type Tab = "cams" | "flights" | "ships" | "nodes" | "alerts";
const TABS: { id: Tab; color: string }[] = [
  { id: "cams", color: "#c792ea" }, { id: "flights", color: "#ffd166" }, { id: "ships", color: "#4cd38a" },
  { id: "nodes", color: "#3dd6c6" }, { id: "alerts", color: "#f2685c" },
];

export default function Earth() {
  const t = useTranslations("earth");
  const f = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const locale = useLocale() as "ar" | "en";
  const live = useLive();
  const [nodes, setNodes] = useState<GeoNode[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("cams");
  const [items, setItems] = useState<Record<Layer, FeedItem[] | null>>({ cams: null, flights: null, ships: null });
  const [camOn, setCamOn] = useState<FeedItem | null>(null);
  const [target, setTarget] = useState<MapTarget | null>(null);

  useEffect(() => {
    relayJson<{ nodes: GeoNode[] }>(`geo/nodes?lang=${locale}`).then(r => setNodes(r.nodes)).catch(() => setNodes(DEMO_NODES[locale]));
  }, [locale]);

  const onFeed = useCallback((l: Layer, list: FeedItem[]) => setItems(s => ({ ...s, [l]: list })), []);
  const fly = (i: { lon: number; lat: number }, zoom: number) => setTarget({ lon: i.lon, lat: i.lat, zoom, seq: Date.now() });

  const count = (id: Tab) => (id === "nodes" ? nodes.length : id === "alerts" ? live.anomalies.length : items[id]?.length ?? null);
  const list = tab === "cams" || tab === "flights" || tab === "ships" ? items[tab] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted">{t("subtitle")}</p>
        </div>
        <LiveBadge connected={live.connected} demo={live.demo} />
      </div>

      {/* Sidebar sits physically on the left in both languages; its own content follows the page direction. */}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]" dir="ltr">
        <aside dir={locale === "ar" ? "rtl" : "ltr"} className="panel order-2 flex max-h-[70dvh] min-h-0 flex-col overflow-hidden lg:order-1 lg:h-[calc(100dvh-170px)] lg:max-h-none">
          <nav className="grid grid-cols-5 border-b border-line text-[11px]" role="tablist">
            {TABS.map(({ id, color }) => {
              const n = count(id);
              return (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`relative flex flex-col items-center gap-0.5 px-1 py-2.5 transition ${tab === id ? "text-ink" : "text-muted hover:text-ink"}`}>
                  <span className="font-semibold">{t(`tabs.${id}`)}</span>
                  <span className="num text-[10px] opacity-70">{n ?? "—"}</span>
                  {tab === id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full" style={{ background: color }} />}
                </button>
              );
            })}
          </nav>

          {tab === "cams" && camOn && (
            <figure className="border-b border-line">
              {camOn.image && <img src={camOn.image} alt={camOn.label} referrerPolicy="no-referrer" className="aspect-video w-full object-cover" />}
              <figcaption className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate" dir="auto">{camOn.label}</span>
                {camOn.url && /^https:\/\//.test(camOn.url) && <a href={camOn.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent">{t("openLive")} ↗</a>}
                <button onClick={() => setCamOn(null)} className="text-muted hover:text-ink" aria-label={t("close")}>✕</button>
              </figcaption>
            </figure>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {list === null && <Empty text={t("loading")} />}
            {list && list.length === 0 && <Empty text={t(`empty.${tab}`)} hint={tab !== "flights" ? t("keyHint") : undefined} />}

            {tab === "cams" && list && list.length > 0 && (
              <ul className="grid grid-cols-2 gap-2 p-2">
                {list.map(c => (
                  <li key={c.id}>
                    <button onClick={() => { setCamOn(c); fly(c, 13); }} className={`group block w-full overflow-hidden rounded-lg border text-start ${camOn?.id === c.id ? "border-[#c792ea]" : "border-line hover:border-muted"}`}>
                      <div className="relative aspect-video bg-panel-2">
                        {c.image && <img src={c.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition group-hover:scale-105" />}
                        <span className="absolute start-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">
                          <span className="size-1.5 animate-pulse rounded-full bg-bad" />{t("liveTag")}
                        </span>
                      </div>
                      <div className="truncate px-2 py-1.5 text-xs" dir="auto">{c.label}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(tab === "flights" || tab === "ships") && list && list.length > 0 && (
              <ul className="divide-y divide-line/60">
                {list.slice(0, 200).map(i => (
                  <li key={i.id}>
                    <button onClick={() => fly(i, tab === "flights" ? 10 : 12)} className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-panel-2">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-panel-2 text-sm" style={{ color: tab === "flights" ? "#ffd166" : "#4cd38a" }}>
                        <span style={{ transform: `rotate(${(i.heading ?? 0) - (tab === "flights" ? 45 : 0)}deg)` }}>{tab === "flights" ? "✈" : "▲"}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm" dir="ltr">{i.label}</span>
                        {i.sub && <span className="block truncate text-xs text-muted" dir="ltr">{i.sub}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {tab === "nodes" && (
              <ul className="divide-y divide-line/60">
                {nodes.map(n => (
                  <li key={n.slug}>
                    <button onClick={() => setFocus(n.slug)} className={`flex w-full items-center justify-between px-3 py-2.5 text-start text-sm hover:bg-panel-2 ${focus === n.slug ? "text-accent" : ""}`}>
                      <span>{n.name}</span>
                      <span className="text-xs text-muted">{t.has(`types.${n.node_type}`) ? t(`types.${n.node_type}`) : n.node_type}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {tab === "alerts" && (live.anomalies.length === 0 ? <Empty text={t("noAlerts")} /> : (
              <ul className="divide-y divide-line/60">
                {live.anomalies.slice(0, 30).map(a => (
                  <li key={a.id} className="space-y-1 px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-2"><Severity level={a.severity} /><span className="font-mono" dir="ltr">{a.symbol}</span>
                      <span className="ms-auto text-xs text-muted">{f.relativeTime(new Date(a.ts), now)}</span></div>
                    <p className="text-xs text-muted" dir="ltr">{a.reason}</p>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </aside>

        <div className="order-1 min-w-0 lg:order-2">
          <EarthMap nodes={nodes} focus={focus} onFocus={setFocus} target={target} onFeed={onFeed} />
        </div>
      </div>
    </div>
  );
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-1 px-6 py-10 text-center">
      <p className="text-sm text-muted">{text}</p>
      {hint && <p className="text-xs text-muted/70" dir="auto">{hint}</p>}
    </div>
  );
}
