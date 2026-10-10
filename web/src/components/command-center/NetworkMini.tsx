"use client";
import { useEffect, useRef } from "react";
import { layout, type LiveNode, type NetEdge } from "@/lib/network";

const COLOR: Record<string, string> = { core: "#F5B301", screen: "#06B6D4", service: "#7C3AED", store: "#A855F7", infra: "#10B981", mcp: "#EC4899", feed: "#38BDF8", atlas: "#475569" };

/** The nervous system in miniature: every part as a dot, nerves as faint lines, and signals running along them.
 *  Reports node, link and "down" counts to the card. */
export default function NetworkMini({ onStats }: { onStats?: (s: { nodes: number; edges: number; down: number }) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0, cancelled = false;
    fetch("/api/network", { cache: "no-store" }).then(r => r.json()).then((data: { nodes: LiveNode[]; edges: NetEdge[] }) => {
      if (cancelled || !cv.current) return;
      const nodes = data.nodes.filter(n => n.kind !== "atlas"), ids = new Set(nodes.map(n => n.id));
      const edges = data.edges.filter(e => ids.has(e.from) && ids.has(e.to));
      onStats?.({ nodes: data.nodes.length, edges: data.edges.length, down: data.nodes.filter(n => n.state === "down").length });
      const raw = layout({ nodes, edges }, 300), pts = Object.values(raw);
      const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
      const half = Math.max(maxX - minX, maxY - minY) / 2 || 1, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const byId = new Map(nodes.map(n => [n.id, n]));
      const ctx = cv.current.getContext("2d")!;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const draw = (t: number) => {
        const c = cv.current;
        if (!c) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
        if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
        const r = Math.min(w, h) * 0.44, at = (id: string) => ({ x: w / 2 + ((raw[id].x - cx) / half) * r, y: h / 2 + ((raw[id].y - cy) / half) * r });
        for (const e of edges) {
          const a = at(e.from), b = at(e.to);
          ctx.strokeStyle = "rgba(148,160,184,0.14)"; ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          if (!still && byId.get(e.from)!.state !== "down") {
            const k = (t / 2600 + (e.from.length * 7 + e.to.length * 13) / 97) % 1;
            ctx.fillStyle = "rgba(245,179,1,0.75)";
            ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 1.3, 0, Math.PI * 2); ctx.fill();
          }
        }
        for (const n of nodes) {
          const p = at(n.id), rad = n.kind === "core" ? 4.5 : 2.6;
          if (n.kind === "core") { ctx.fillStyle = "rgba(245,179,1,0.18)"; ctx.beginPath(); ctx.arc(p.x, p.y, rad * 3, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = n.state === "down" ? "#EF4444" : COLOR[n.kind] ?? "#94a0b8";
          ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
        }
        if (!still) raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    }).catch(() => null);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={cv} className="size-full" aria-hidden />;
}
