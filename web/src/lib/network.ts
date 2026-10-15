// Nervous system (ADR-028): one registry of every part of OMEGA (people, screens, services, stores, infra, MCP tools,
// data feeds, atlas categories) and how they connect, plus a deterministic force layout so the map is stable between
// visits. Pure functions only; the screen and the API both use them.
import type { Atlas } from "./awesome.ts";

export const KINDS = ["core", "screen", "service", "store", "infra", "mcp", "feed", "atlas"] as const;
export type Kind = (typeof KINDS)[number];
export const EDGE_TYPES = ["uses", "calls", "guards", "shows", "feeds", "stores", "heals", "depends"] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];
export type State = "up" | "idle" | "down" | "unknown" | "needs-key" | "static";

export type NetNode = {
  id: string; kind: Kind; en: string; ar: string; descEn: string; descAr: string;
  health?: string; key?: string; href?: string; file?: string; count?: number;
};
export type NetEdge = { from: string; to: string; type: EdgeType };
export type Registry = { nodes: NetNode[]; edges: NetEdge[] };
export type LiveNode = NetNode & { state: State; detail?: string };

/** Problems in a registry: duplicate ids, unknown kinds or edge types, edges to missing nodes, isolated nodes. */
export function validate(r: Registry): string[] {
  const errs: string[] = [], ids = new Set<string>();
  for (const n of r.nodes) {
    if (ids.has(n.id)) errs.push(`duplicate node ${n.id}`);
    ids.add(n.id);
    if (!(KINDS as readonly string[]).includes(n.kind)) errs.push(`${n.id}: unknown kind ${n.kind}`);
  }
  const linked = new Set<string>();
  for (const e of r.edges) {
    if (!ids.has(e.from)) errs.push(`edge from missing ${e.from}`);
    if (!ids.has(e.to)) errs.push(`edge to missing ${e.to}`);
    if (!(EDGE_TYPES as readonly string[]).includes(e.type)) errs.push(`${e.from}->${e.to}: unknown type ${e.type}`);
    linked.add(e.from); linked.add(e.to);
  }
  for (const n of r.nodes) if (!linked.has(n.id)) errs.push(`${n.id} is not connected`);
  return errs;
}

type Check = { state: string; detail?: string };

/** A node's live state: its System Health check if it has one, "needs-key" if its key isn't set, otherwise static. */
export function nodeState(n: NetNode, checks: Record<string, Check>, keys: Record<string, boolean>): { state: State; detail?: string } {
  if (n.key && keys[n.key] === false) return { state: "needs-key", detail: n.key };
  if (n.health) {
    const c = checks[n.health];
    if (!c) return { state: "unknown" };
    const s = (["up", "idle", "down"] as const).find(x => x === c.state) ?? "unknown";
    return { state: s, detail: c.detail };
  }
  return { state: "static" };
}

export function neighbours(r: Registry, id: string): { node: string; type: EdgeType; out: boolean }[] {
  return r.edges.flatMap((e): { node: string; type: EdgeType; out: boolean }[] => (e.from === id ? [{ node: e.to, type: e.type, out: true }] : e.to === id ? [{ node: e.from, type: e.type, out: false }] : []));
}

/** Small seeded PRNG so the layout is the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Kinds sit on rings around the core: the eye reads inside-out from Ahmad and Director 00 to the outside world.
const RING: Record<Kind, number> = { core: 0, screen: 0.32, service: 0.5, store: 0.55, infra: 0.62, mcp: 0.72, feed: 0.86, atlas: 1 };

/** Force layout in a unit square (-1..1): springs on edges, repulsion between all nodes, a pull toward each kind's ring. */
export function layout(r: Registry, iterations = 400, seed = 7): Record<string, { x: number; y: number }> {
  const rand = rng(seed), n = r.nodes.length, idx = new Map(r.nodes.map((v, i) => [v.id, i]));
  const x = new Float64Array(n), y = new Float64Array(n);
  r.nodes.forEach((v, i) => { const a = rand() * Math.PI * 2, rad = RING[v.kind] * 0.9 + rand() * 0.05; x[i] = Math.cos(a) * rad; y[i] = Math.sin(a) * rad; });
  const links = r.edges.map(e => [idx.get(e.from)!, idx.get(e.to)!]).filter(([a, b]) => a !== undefined && b !== undefined);
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations, fx = new Float64Array(n), fy = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = x[i] - x[j], dy = y[i] - y[j], d2 = dx * dx + dy * dy + 1e-4, f = 0.0016 / d2;
      fx[i] += dx * f; fy[i] += dy * f; fx[j] -= dx * f; fy[j] -= dy * f;
    }
    for (const [a, b] of links) {
      const dx = x[b] - x[a], dy = y[b] - y[a], d = Math.sqrt(dx * dx + dy * dy) + 1e-6, f = (d - 0.22) * 0.05;
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f; fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
    }
    r.nodes.forEach((v, i) => {
      const d = Math.sqrt(x[i] * x[i] + y[i] * y[i]) + 1e-6, want = RING[v.kind] * 0.92, f = (want - d) * 0.08;
      fx[i] += (x[i] / d) * f; fy[i] += (y[i] / d) * f;
      const step = 0.05 * cool + 0.002, m = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]), s = m > step ? step / m : 1;
      x[i] += fx[i] * s; y[i] += fy[i] * s;
    });
  }
  return Object.fromEntries(r.nodes.map((v, i) => [v.id, { x: Math.round(x[i] * 1e4) / 1e4, y: Math.round(y[i] * 1e4) / 1e4 }]));
}

/** Adds each Awesome atlas category as a satellite of the Atlas screen. */
export function withAtlas(r: Registry, atlas: Atlas): Registry {
  const nodes: NetNode[] = atlas.categories.map(c => {
    const count = atlas.entries.filter(e => e.category === c).length;
    return { id: `atlas:${c}`, kind: "atlas", en: c, ar: c, count, href: `/atlas?cat=${encodeURIComponent(c)}`,
      descEn: `${count} curated lists in the Awesome atlas.`, descAr: `${count} قائمة منتقاة في أطلس Awesome.` };
  });
  const edges: NetEdge[] = nodes.map(n => ({ from: "screen-atlas", to: n.id, type: "shows" }));
  return { nodes: [...r.nodes, ...nodes], edges: [...r.edges, ...edges] };
}
