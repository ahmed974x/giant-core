// Workflow graphs (ADR-137), pure: used by jarvis/server/lib/platform.mjs and inlined into the page by
// the build, so the editor checks a graph exactly as the server does. Needs llm-plan.mjs's
// lockCategory, GATE_EVIDENCE and LOCKED_CATEGORIES (imported here, in scope when inlined).
import { lockCategory, GATE_EVIDENCE, LOCKED_CATEGORIES } from "./llm-plan.mjs";

export const WF_TOOLS = ["files.read", "git.log", "notes.read", "runs.read"];
export const WF_CHECKS = ["tests", "lint", "contrast", "security"];
export const WF_CATEGORIES = [...LOCKED_CATEGORIES, "file_write"];
const MAX_NODES = 30;
const bad = msg => { throw Object.assign(new Error(msg), { status: 400 }); };

// A graph is {nodes: [{id, title, kind, tool|check|category, x, y}], edges: [{from, to}]}.
// Kinds: tool (a read tool), gate (a check on saved evidence), approval (a person decides),
// note (a note written after approval). Levels come from a topological sort (Kahn); a cycle is refused.
export function checkGraph(raw) {
  const g = raw && typeof raw === "object" ? raw : {};
  const nodes = Array.isArray(g.nodes) ? g.nodes : [], edges = Array.isArray(g.edges) ? g.edges : [];
  if (!nodes.length) bad("Add at least one step.");
  if (nodes.length > MAX_NODES) bad("A workflow has at most " + MAX_NODES + " steps.");
  const ids = new Set();
  const out = nodes.map((n, i) => {
    const id = String(n && n.id || "");
    if (!/^[a-z0-9-]{1,24}$/.test(id) || ids.has(id)) bad("Step " + (i + 1) + " needs a unique id (a-z, 0-9, -).");
    ids.add(id);
    const title = String(n.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!title) bad("Step " + (i + 1) + " needs a title.");
    const kind = ["tool", "gate", "approval", "note"].includes(n.kind) ? n.kind : bad("Step “" + title + "” has an unknown kind.");
    const node = { id, title, kind, x: clamp(n.x, 0, 2400), y: clamp(n.y, 0, 1600) };
    if (kind === "tool") node.tool = WF_TOOLS.includes(n.tool) ? n.tool : bad("Pick a read tool for “" + title + "”.");
    if (kind === "gate") node.check = WF_CHECKS.includes(n.check) ? n.check : bad("Pick a check for “" + title + "”.");
    if (kind === "approval") node.category = WF_CATEGORIES.includes(n.category) ? n.category : bad("Pick what “" + title + "” asks for.");
    return node;
  });
  const seen = new Set();
  const cleanEdges = edges.map(e => {
    const from = String(e && e.from), to = String(e && e.to);
    if (!ids.has(from) || !ids.has(to)) bad("A link points to a step that does not exist.");
    if (from === to) bad("A step cannot need itself.");
    if (seen.has(from + ">" + to)) bad("The same link is there twice.");
    seen.add(from + ">" + to);
    return { from, to };
  });
  const levels = topoLevels(out.map(n => n.id), cleanEdges);
  return { nodes: out, edges: cleanEdges, levels };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// Kahn's algorithm: each node's level is the longest chain of needs before it. Nodes left over sit on a cycle.
export function topoLevels(ids, edges) {
  const indeg = new Map(ids.map(i => [i, 0])), next = new Map(ids.map(i => [i, []])), level = new Map(ids.map(i => [i, 0]));
  for (const e of edges) { indeg.set(e.to, indeg.get(e.to) + 1); next.get(e.from).push(e.to); }
  const queue = ids.filter(i => indeg.get(i) === 0);
  let seen = 0;
  while (queue.length) {
    const n = queue.shift(); seen++;
    for (const m of next.get(n)) { level.set(m, Math.max(level.get(m), level.get(n) + 1)); indeg.set(m, indeg.get(m) - 1); if (indeg.get(m) === 0) queue.push(m); }
  }
  if (seen < ids.length) bad("These steps need each other in a loop: " + ids.filter(i => indeg.get(i) > 0).join(", ") + ". Remove one link.");
  return Object.fromEntries(level);
}

// The graph as mission steps: phase = level + 1 (at most 10), needs = incoming links. A step whose
// title mentions money, publishing, permissions, installs or outbound messages is locked whatever
// kind it was drawn as.
export function graphToSteps(graph) {
  const order = [...graph.nodes].sort((a, b) => graph.levels[a.id] - graph.levels[b.id] || a.y - b.y || a.x - b.x);
  const index = new Map(order.map((n, i) => [n.id, i]));
  return order.map(n => {
    const phase = Math.min(10, graph.levels[n.id] + 1);
    const depends = graph.edges.filter(e => e.to === n.id).map(e => index.get(e.from)).filter(d => d < index.get(n.id));
    const lock = lockCategory(n.title);
    const base = { phase, title: n.title, depends, nodeId: n.id };
    if (lock || (n.kind === "approval" && LOCKED_CATEGORIES.includes(n.category))) return { ...base, kind: "approval", category: lock || n.category, locked: true };
    if (n.kind === "approval" || n.kind === "note") return { ...base, kind: "approval", category: "file_write", locked: false };
    if (n.kind === "gate") return { ...base, kind: "gate", criteria: GATE_EVIDENCE[n.check] };
    return { ...base, kind: "tool", tool: n.tool, input: n.tool === "files.read" ? { path: "docs/adr/ADR-13*" } : {} };
  });
}


// Is this node locked? (the same rule graphToSteps applies)
export const nodeLocked = n => !!lockCategory(n.title || "") || (n.kind === "approval" && LOCKED_CATEGORIES.includes(n.category));

export function starterGraph() {
  return {
    nodes: [
      { id: "commits", title: "Read the latest commits", kind: "tool", tool: "git.log", x: 40, y: 40 },
      { id: "adrs", title: "Read the decision records", kind: "tool", tool: "files.read", x: 40, y: 140 },
      { id: "tests", title: "Tests gate", kind: "gate", check: "tests", x: 300, y: 40 },
      { id: "security", title: "Security gate", kind: "gate", check: "security", x: 300, y: 140 },
      { id: "note", title: "Save the release note", kind: "note", x: 560, y: 40 },
      { id: "publish", title: "Publish the release notes", kind: "approval", category: "publish", x: 560, y: 140 },
    ],
    edges: [{ from: "commits", to: "tests" }, { from: "adrs", to: "security" }, { from: "tests", to: "note" }, { from: "security", to: "note" }, { from: "security", to: "publish" }],
  };
}
