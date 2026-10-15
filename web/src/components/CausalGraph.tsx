"use client";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ScenarioBars, { type Scenario } from "./ScenarioBars";

type GNode = { id: string; en: string; ar: string; kind: string; target: boolean };
type GEdge = { source: string; target: string; prior: number; evidence: "data" | "live" | "prior"; factor: number; note: string };
type Trace = {
  anomaly: { type: string; asset?: string; node: string; place?: string };
  created: string; mode: string;
  chains: { path: string[]; share: number; text_en: string; text_ar: string; confidence?: number; counterfactual?: { en: string; ar: string } }[];
  confidence?: number;
  scenarios?: Scenario[];
  graph: { nodes: GNode[]; edges: GEdge[] };
};

const KIND_COLOR: Record<string, string> = { world: "#4dabf7", maritime: "#3dd6c6", market: "#ffd166" };
const EVIDENCE_COLOR: Record<string, string> = { data: "#4cd38a", live: "#22d3ee", prior: "#6b7a8c" };
const ANOMALIES = [
  { id: "gold", body: { type: "price_spike", asset: "PAXGUSDT" } }, { id: "btc", body: { type: "price_spike", asset: "BTCUSDT" } },
  { id: "oil", body: { type: "oil_move" } }, { id: "ship", body: { type: "ship_deviation" } }, { id: "congestion", body: { type: "port_congestion" } },
] as const;
const PLACES = ["", "hormuz", "suez", "bab-el-mandeb", "malacca", "panama", "jebel-ali"] as const;

/** Layered layout: the anomaly on the right, each cause one column further left (distance along the edges). */
function layout(nodes: GNode[], edges: GEdge[]): Record<string, { x: number; y: number }> {
  const target = nodes.find(n => n.target)?.id;
  const depth: Record<string, number> = target ? { [target]: 0 } : {};
  for (let changed = true, guard = 0; changed && guard < 20; guard++) {
    changed = false;
    for (const e of edges) {
      if (depth[e.target] !== undefined && (depth[e.source] === undefined || depth[e.source] < depth[e.target] + 1)) {
        depth[e.source] = depth[e.target] + 1;
        changed = true;
      }
    }
  }
  const cols: Record<number, string[]> = {};
  nodes.forEach(n => (cols[depth[n.id] ?? 0] ??= []).push(n.id));
  const maxD = Math.max(0, ...Object.keys(cols).map(Number));
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of Object.entries(cols)) ids.forEach((id, i) => { pos[id] = { x: (maxD - Number(d)) * 230, y: i * 110 - ((ids.length - 1) * 110) / 2 }; });
  return pos;
}

export default function CausalGraph() {
  const t = useTranslations("research.causal");
  const locale = useLocale() as "ar" | "en";
  const [trace, setTrace] = useState<Trace | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "running" | "error" | "empty">("loading");
  const [anomaly, setAnomaly] = useState<(typeof ANOMALIES)[number]["id"]>("gold");
  const [place, setPlace] = useState<(typeof PLACES)[number]>("hormuz");

  useEffect(() => {
    fetch("/api/causal", { cache: "no-store" }).then(async r => {
      if (r.status === 404) return setState("empty");
      if (!r.ok) throw new Error();
      setTrace(await r.json());
      setState("idle");
    }).catch(() => setState("error"));
  }, []);

  const run = async () => {
    setState("running");
    try {
      const body = { ...ANOMALIES.find(a => a.id === anomaly)!.body, ...(place ? { place } : {}) };
      const r = await fetch("/api/causal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      setTrace(await r.json());
      setState("idle");
    } catch {
      setState("error");
    }
  };

  const { nodes, edges } = useMemo(() => {
    if (!trace) return { nodes: [] as Node[], edges: [] as Edge[] };
    const pos = layout(trace.graph.nodes, trace.graph.edges);
    const nodes: Node[] = trace.graph.nodes.map(n => ({
      id: n.id, position: pos[n.id] ?? { x: 0, y: 0 }, data: { label: locale === "ar" ? n.ar : n.en },
      sourcePosition: "right" as Node["sourcePosition"], targetPosition: "left" as Node["targetPosition"],
      style: { background: n.target ? "#3dd6c6" : "#111821", color: n.target ? "#0A0E1A" : "#e6edf3", fontWeight: n.target ? 700 : 500,
        border: `1.5px solid ${KIND_COLOR[n.kind] ?? "#233246"}`, borderRadius: 10, fontSize: 12, width: 180, padding: 8 },
    }));
    const edges: Edge[] = trace.graph.edges.map(e => ({
      id: `${e.source}-${e.target}`, source: e.source, target: e.target, label: `×${e.factor}`, animated: e.evidence !== "prior",
      style: { stroke: EVIDENCE_COLOR[e.evidence], strokeWidth: 1 + e.prior * 2.5, strokeDasharray: e.evidence === "prior" ? "5 4" : undefined },
      labelStyle: { fill: EVIDENCE_COLOR[e.evidence], fontSize: 10 }, labelBgStyle: { fill: "#0A0E1A" },
      markerEnd: { type: MarkerType.ArrowClosed, color: EVIDENCE_COLOR[e.evidence] },
    }));
    return { nodes, edges };
  }, [trace, locale]);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="font-semibold">{t("title")}</h2>
        <span className="text-xs text-muted">{t("subtitle")}</span>
        {trace?.confidence !== undefined && <span className="num rounded bg-accent/15 px-2 py-0.5 text-xs text-accent">{t("confidence")} {trace.confidence.toFixed(2)}</span>}
        <div className="ms-auto flex flex-wrap items-center gap-2 text-xs">
          <select value={anomaly} onChange={e => setAnomaly(e.target.value as typeof anomaly)} className="rounded-md border border-line bg-panel-2 px-2 py-1" aria-label={t("anomaly")}>
            {ANOMALIES.map(a => <option key={a.id} value={a.id}>{t(`anomalies.${a.id}`)}</option>)}
          </select>
          <select value={place} onChange={e => setPlace(e.target.value as typeof place)} className="rounded-md border border-line bg-panel-2 px-2 py-1" aria-label={t("place")}>
            {PLACES.map(p => <option key={p} value={p}>{p ? t(`places.${p}`) : t("places.none")}</option>)}
          </select>
          <button onClick={run} disabled={state === "running"} className="rounded-md bg-accent px-3 py-1 font-semibold text-[#0A0E1A] disabled:opacity-60">
            {state === "running" ? t("running") : t("trace")}
          </button>
        </div>
      </div>

      <div className="relative h-[420px]" dir="ltr">
        {trace ? (
          <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.15 }} nodesConnectable={false} proOptions={{ hideAttribution: false }}
            colorMode="dark" minZoom={0.3}>
            <Background color="#233246" gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : (
          <p className="grid h-full place-items-center px-6 text-center text-sm text-muted">
            {state === "loading" ? "…" : state === "error" ? t("error") : t("empty")}
          </p>
        )}
      </div>

      {trace && (
        <div className="grid gap-3 border-t border-line p-4 text-sm lg:grid-cols-[1fr_auto]">
          <ol className="space-y-1.5">
            {trace.chains.map((c, i) => (
              <li key={i} className="flex gap-2" dir="auto">
                <span className="num w-12 shrink-0 text-xs text-accent" title={t("confidence")}>{(c.confidence ?? c.share).toFixed(2)}</span>
                <span className="min-w-0">
                  <span className="block">{locale === "ar" ? c.text_ar : c.text_en}</span>
                  {c.counterfactual && <span className="block text-xs text-muted">→ {locale === "ar" ? c.counterfactual.ar : c.counterfactual.en}</span>}
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-start gap-3 text-xs text-muted">
            {(["data", "live", "prior"] as const).map(k => (
              <span key={k} className="flex items-center gap-1.5"><span className="h-0.5 w-5" style={{ background: EVIDENCE_COLOR[k] }} />{t(`evidence.${k}`)}</span>
            ))}
          </div>
        </div>
      )}
      {trace?.scenarios && trace.scenarios.length > 0 && <ScenarioBars scenarios={trace.scenarios} />}
    </section>
  );
}
