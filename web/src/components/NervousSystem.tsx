"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { KINDS, layout, neighbours, type Kind, type LiveNode, type NetEdge, type State } from "@/lib/network";

type Data = { checkedAt: string; nodes: LiveNode[]; edges: NetEdge[] };

// Kind colours: brass for the people and the coordinator at the centre, teal for what Ahmad sees, cool blues for the
// machinery, violet for Claude's tools, sky for the outside world, faint for the atlas library.
const COLOR: Record<Kind, string> = {
  core: "#d4a72c", screen: "#3dd6c6", service: "#6f9cff", store: "#8a7cff", infra: "#58c7a0", mcp: "#c58cff", feed: "#7cc4ff", atlas: "#5b7088",
};
const STATE_RING: Partial<Record<State, string>> = { down: "#f2685c", "needs-key": "#f2b84b", idle: "#8ea3b8", unknown: "#8ea3b8" };
const FLOWS = new Set(["feeds", "calls", "stores", "heals", "guards"]);

/** OMEGA's nervous system: every part as a node, every dependency as a nerve, live state on each node. */
export default function NervousSystem() {
  const t = useTranslations("network");
  const locale = useLocale();
  const ar = locale === "ar";
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState<string | null>("director");
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showAtlas, setShowAtlas] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ scale: 1, ox: 0, oy: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const detailsRef = useRef<HTMLElement>(null);

  const load = useCallback(() => fetch("/api/network", { cache: "no-store" }).then(r => r.json()).then(setData).catch(() => null), []);
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  const graph = useMemo(() => {
    if (!data) return null;
    const nodes = data.nodes.filter(n => showAtlas || n.kind !== "atlas");
    const ids = new Set(nodes.map(n => n.id));
    const edges = data.edges.filter(e => ids.has(e.from) && ids.has(e.to));
    // Fit the layout to the frame: centre its bounding box and scale the larger side to the unit square.
    const raw = layout({ nodes, edges }), pts = Object.values(raw);
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
    const pos = Object.fromEntries(Object.entries(raw).map(([id, p]) => [id, { x: (p.x - cx) / half, y: (p.y - cy) / half }]));
    const degree: Record<string, number> = {};
    for (const e of edges) { degree[e.from] = (degree[e.from] ?? 0) + 1; degree[e.to] = (degree[e.to] ?? 0) + 1; }
    return { nodes, edges, pos, degree, byId: new Map(nodes.map(n => [n.id, n])) };
  }, [data, showAtlas]);

  const label = (n: LiveNode) => (ar ? n.ar : n.en);
  const match = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !graph) return null;
    return new Set(graph.nodes.filter(n => `${n.en} ${n.ar} ${n.descEn} ${n.descAr}`.toLowerCase().includes(s)).map(n => n.id));
  }, [q, graph]);

  // Screen position of a node for the current canvas size and pan/zoom.
  const project = useCallback((id: string, w: number, h: number) => {
    const p = graph!.pos[id], r = Math.min(w, h) * 0.43 * view.current.scale;
    return { x: w / 2 + view.current.ox + p.x * r, y: h / 2 + view.current.oy + p.y * r };
  }, [graph]);
  const radius = (n: LiveNode) => (n.kind === "atlas" ? 3 + Math.min(4, (n.count ?? 0) / 25) : n.kind === "core" ? 11 : 5 + Math.min(5, (graph?.degree[n.id] ?? 0) * 0.6));

  // Draw loop: nerves, signals travelling along live nerves, nodes with state rings, labels where they help.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !graph) return;
    const ctx = cv.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const family = getComputedStyle(document.body).fontFamily;
    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const focus = hover ?? selected;
      const near = focus ? new Set([focus, ...neighbours(graph, focus).map(x => x.node)]) : null;
      const lit = (id: string) => (match ? match.has(id) : near ? near.has(id) : true);

      for (const e of graph.edges) {
        const a = project(e.from, w, h), b = project(e.to, w, h);
        const on = near ? near.has(e.from) && near.has(e.to) && (e.from === focus || e.to === focus) : !match;
        ctx.strokeStyle = on ? "rgba(61,214,198,0.55)" : "rgba(142,163,184,0.12)";
        ctx.lineWidth = on ? 1.4 : 0.8;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const src = graph.byId.get(e.from)!;
        if (!still && FLOWS.has(e.type) && src.state !== "down" && src.state !== "needs-key" && (on || !near)) {
          const k = ((time / 2400 + (e.from.length * 7 + e.to.length * 13) / 97) % 1);
          ctx.fillStyle = on ? "#3dd6c6" : "rgba(61,214,198,0.35)";
          ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, on ? 2.2 : 1.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const n of graph.nodes) {
        const p = project(n.id, w, h), r = radius(n), on = lit(n.id);
        ctx.globalAlpha = on ? 1 : 0.22;
        if (n.kind === "core" || n.id === focus) {
          const g = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 3.2);
          g.addColorStop(0, COLOR[n.kind] + "55"); g.addColorStop(1, COLOR[n.kind] + "00");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = COLOR[n.kind];
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        const ring = STATE_RING[n.state];
        if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
        if (n.id === selected) { ctx.strokeStyle = "#e4ecf4"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.stroke(); }
        // Phones are too narrow for every label: show the centre, the focused node and search hits until zoomed in.
        const narrow = w < 640;
        const showLabel = n.kind === "core" || n.id === focus || (match?.has(n.id) ?? false) || view.current.scale > (narrow ? 1.8 : 1.6)
          || (!narrow && (n.kind === "screen" || (near?.has(n.id) ?? false)));
        if (showLabel && on) {
          ctx.font = `${n.kind === "core" ? 600 : 500} ${n.kind === "atlas" ? 11 : 12}px ${family}`;
          ctx.fillStyle = n.kind === "atlas" ? "#8ea3b8" : "#e4ecf4";
          ctx.textAlign = "center";
          ctx.fillText(label(n), p.x, p.y + r + 15);
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw); // keeps pan, zoom and hover live; only the signals pause under reduced motion
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, hover, selected, match, project, ar]);

  const hit = (ev: React.PointerEvent | React.MouseEvent) => {
    const cv = canvasRef.current!, rect = cv.getBoundingClientRect(), mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    let best: string | null = null, bestD = 18;
    for (const n of graph?.nodes ?? []) {
      const p = project(n.id, rect.width, rect.height), d = Math.hypot(p.x - mx, p.y - my) - radius(n);
      if (d < bestD) { bestD = d; best = n.id; }
    }
    return best;
  };

  const sel = selected ? graph?.byId.get(selected) : undefined;
  const links = sel && graph ? neighbours(graph, sel.id).map(l => ({ ...l, n: graph.byId.get(l.node)! })).filter(l => l.n) : [];
  const counts = useMemo(() => {
    const c: Partial<Record<State, number>> = {};
    for (const n of data?.nodes ?? []) c[n.state] = (c[n.state] ?? 0) + 1;
    return c;
  }, [data]);

  return (
    <div className="-mx-4 sm:-mx-6">
      <div className="flex flex-wrap items-end gap-3 px-4 sm:px-6">
        <div className="me-auto">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {t("lead", { nodes: graph?.nodes.length ?? 0, edges: graph?.edges.length ?? 0 })}{" "}
            {t("status", { up: counts.up ?? 0, down: counts.down ?? 0, key: counts["needs-key"] ?? 0 })}
          </p>
        </div>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")}
          className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm sm:w-56" dir="auto" />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showAtlas} onChange={e => setShowAtlas(e.target.checked)} className="accent-[#3dd6c6]" />
          {t("atlas")}
        </label>
      </div>

      <div className="mt-4 grid gap-4 px-4 sm:px-6 lg:grid-cols-[1fr_340px]">
        <div className="panel relative h-[58vh] min-h-[380px] overflow-hidden bg-[radial-gradient(ellipse_at_center,#0d2136_0%,#0A0E1A_70%)] lg:h-[68vh] lg:min-h-[460px]">
          <canvas ref={canvasRef} className="size-full touch-none cursor-grab active:cursor-grabbing" aria-label={t("title")} role="img"
            onPointerDown={e => {
              (e.target as Element).setPointerCapture(e.pointerId);
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (pointers.current.size === 2) { // second finger: switch from panning to pinch zoom
                const [a, b] = [...pointers.current.values()];
                pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.current.scale };
                if (drag.current) drag.current.moved = true;
              } else drag.current = { x: e.clientX, y: e.clientY, ox: view.current.ox, oy: view.current.oy, moved: false };
            }}
            onPointerMove={e => {
              if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (pinch.current && pointers.current.size === 2) {
                const [a, b] = [...pointers.current.values()];
                view.current.scale = Math.min(4, Math.max(0.6, pinch.current.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist));
                return;
              }
              const d = drag.current;
              if (d) {
                if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 6) d.moved = true;
                view.current.ox = d.ox + e.clientX - d.x; view.current.oy = d.oy + e.clientY - d.y;
              } else if (e.pointerType === "mouse") setHover(hit(e));
            }}
            onPointerUp={e => {
              pointers.current.delete(e.pointerId);
              if (pointers.current.size < 2) pinch.current = null;
              if (pointers.current.size > 0) return;
              const d = drag.current; drag.current = null;
              if (d && !d.moved) {
                const id = hit(e);
                if (id) { setSelected(id); if (window.innerWidth < 1024) detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }
              }
            }}
            onPointerCancel={e => { pointers.current.delete(e.pointerId); pinch.current = null; drag.current = null; }}
            onPointerLeave={() => setHover(null)}
            onWheel={e => { const s = Math.min(4, Math.max(0.6, view.current.scale * (e.deltaY < 0 ? 1.12 : 0.89))); view.current.scale = s; }} />
          <ul className="pointer-events-none absolute bottom-3 start-3 end-3 hidden flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted sm:flex">
            {KINDS.filter(k => showAtlas || k !== "atlas").map(k => (
              <li key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: COLOR[k] }} />{t(`kinds.${k}`)}</li>
            ))}
          </ul>
          <button onClick={() => { view.current = { scale: 1, ox: 0, oy: 0 }; }}
            className="absolute end-3 top-3 rounded-md border border-line bg-panel/80 px-2 py-1 text-xs text-muted hover:text-ink">{t("reset")}</button>
        </div>

        <aside ref={detailsRef} className="panel scroll-mt-20 p-4" aria-live="polite">
          {!sel ? <p className="text-sm text-muted">{t("pick")}</p> : (
            <>
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ background: COLOR[sel.kind] }} />
                <span className="text-xs text-muted">{t(`kinds.${sel.kind}`)}</span>
                <span className={`ms-auto rounded px-1.5 py-0.5 text-xs ${sel.state === "up" ? "bg-good/15 text-good" : sel.state === "down" ? "bg-bad/15 text-bad" : sel.state === "needs-key" ? "bg-warn/15 text-warn" : "bg-panel-2 text-muted"}`}>
                  {t(`states.${sel.state}`)}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-semibold">{label(sel)}</h2>
              <p className="mt-1 text-sm text-muted">{ar ? sel.descAr : sel.descEn}</p>
              {sel.detail && <p className="mt-2 font-mono text-xs text-muted" dir="ltr">{sel.detail}</p>}
              {sel.file && <p className="mt-1 font-mono text-xs text-muted/80" dir="ltr">{sel.file}</p>}
              {sel.href && (
                <Link href={sel.href} className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-[#0A0E1A]">{t("open")}</Link>
              )}
              <h3 className="mt-5 text-xs font-semibold text-muted">{t("links", { n: links.length })}</h3>
              <ul className="mt-2 max-h-[34vh] space-y-1 overflow-y-auto text-sm">
                {links.map(l => (
                  <li key={`${l.node}-${l.type}-${l.out}`}>
                    <button onClick={() => setSelected(l.node)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-start hover:bg-panel-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: COLOR[l.n.kind] }} />
                      <span className="truncate">{label(l.n)}</span>
                      <span className="ms-auto shrink-0 text-xs text-muted">{t(`${l.out ? "out" : "in"}.${l.type}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
