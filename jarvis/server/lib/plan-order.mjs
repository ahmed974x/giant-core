// ADR-163: plan order. Three deterministic tools for the engines that already exist:
//   kahn   Kahn's topological order of a dependency graph, in layers, ties broken by name; a cycle is named, never
//          broken. The skill composer's dependencies come from each skill's own sys.path lines (EXTRACTED), written by
//          .claude/skills/replica-plan-order/plan_order.py deps (jarvis/app/data/skill-deps.json).
//   tree   a behaviour tree with Sequence and Fallback nodes over leaves that are success, failure or running.
//          The workbench (ADR-160) is read as one: its stages in a Sequence, each optional stage a Fallback of
//          "ran" or "skipped", and the locked approvals last, which stay running until Director 00 decides.
//   uct    UCB1 (UCT's rule at one node) over the person's own record of past tries only: an arm never tried is
//          tried first, then mean + c * sqrt(ln N / n). With the meta-codes (ADR-156) the arms are the three plans.
// Pure: no network, no process, no file, no model. The same answers come from
// .claude/skills/replica-plan-order/plan_order.py (tests/golden.json).
import { runWorkbench } from "./unified-workbench.mjs";
import { compileMetacodes } from "./prompt-metacodes.mjs";

export const PO_MODES = ["kahn", "skills", "tree", "workbench", "uct", "plans"];
export const PO_LEAF = ["success", "failure", "running"];
export const PO_OPTIONAL = ["design", "math", "atlas", "security"];
export class OrderError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const poFail = (m, d) => { throw new OrderError(m, d); };
function poR(v) { return Math.round(v * 10000) / 10000; }
function poName(s) { return typeof s === "string" && s.length >= 1 && s.length <= 80; }

// Kahn's algorithm by layers: every node with no unplaced dependency joins the layer, sorted by name.
// Edges are [before, after]. A node left over sits on a cycle or behind one.
export function kahnOrder(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > 200 || !nodes.every(poName)) poFail("Give 1 to 200 node names of 1 to 80 characters.", "nodes");
  if (new Set(nodes).size !== nodes.length) poFail("Each node appears once.", "nodes");
  if (!Array.isArray(edges) || edges.length > 2000) poFail("Edges are a list of at most 2000 [before, after] pairs.", "edges");
  const known = new Set(nodes), indeg = new Map(nodes.map(n => [n, 0])), after = new Map(nodes.map(n => [n, []]));
  for (const [i, e] of edges.entries()) {
    if (!Array.isArray(e) || e.length !== 2 || !known.has(e[0]) || !known.has(e[1])) poFail("Each edge joins two named nodes.", "edges[" + i + "]");
    after.get(e[0]).push(e[1]);
    indeg.set(e[1], indeg.get(e[1]) + 1);
  }
  const layers = [];
  let ready = nodes.filter(n => indeg.get(n) === 0).sort();
  while (ready.length) {
    layers.push(ready);
    const next = [];
    for (const n of ready) for (const m of after.get(n)) { indeg.set(m, indeg.get(m) - 1); if (indeg.get(m) === 0) next.push(m); }
    ready = next.sort();
  }
  const order = layers.flat();
  const cycle = nodes.filter(n => indeg.get(n) > 0).sort();
  return { order, layers, cycle, acyclic: cycle.length === 0, verified: orderKept(order, edges) };
}
// The check, on its own: every edge between two placed nodes runs forwards in the order.
export function orderKept(order, edges) {
  const pos = new Map(order.map((n, i) => [n, i]));
  return edges.every(([a, b]) => !pos.has(a) || !pos.has(b) || pos.get(a) < pos.get(b));
}

// The chosen skills and everything they load, in an order where each skill comes after what it loads.
export function skillOrder(deps, names) {
  const d = deps && typeof deps === "object" && !Array.isArray(deps) ? deps : poFail("Send the dependency snapshot.", "deps");
  const pick = Array.isArray(names) && names.length >= 1 && names.length <= 12 ? names : poFail("Choose 1 to 12 skills.", "names");
  for (const n of pick) if (!poName(n) || !Object.hasOwn(d, n)) poFail("That skill is not in the snapshot.", typeof n === "string" ? n : "");
  const seen = new Set(), stack = [...new Set(pick)];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of Array.isArray(d[n]) ? d[n] : []) if (Object.hasOwn(d, m)) stack.push(m);
  }
  const nodes = [...seen].sort();
  const edges = nodes.flatMap(n => (Array.isArray(d[n]) ? d[n] : []).filter(m => seen.has(m)).map(m => [m, n]));
  const k = kahnOrder(nodes, edges);
  return { chosen: [...new Set(pick)], added: nodes.filter(n => !pick.includes(n)), edges, ...k, source: "EXTRACTED" };
}

// One tick of a behaviour tree. Sequence stops at the first child that is not success; Fallback stops at the first
// child that is not failure. A leaf missing from leaves is failure.
function poCheck(node, depth, count) {
  if (depth > 8) poFail("A tree is at most 8 levels deep.", "tree");
  if (++count.n > 100) poFail("A tree has at most 100 nodes.", "tree");
  if (!node || typeof node !== "object") poFail("Each node is an object.", "tree");
  if (node.type === "leaf") { if (!poName(node.id)) poFail("A leaf needs an id of 1 to 80 characters.", "tree"); return; }
  if (node.type !== "sequence" && node.type !== "fallback") poFail("A node is a sequence, a fallback or a leaf.", String(node.type));
  if (!Array.isArray(node.children) || node.children.length < 1 || node.children.length > 20) poFail("A sequence or fallback has 1 to 20 children.", "tree");
  for (const c of node.children) poCheck(c, depth + 1, count);
}
function poTick(node, leaves, path, trace) {
  if (node.type === "leaf") {
    const s = Object.hasOwn(leaves, node.id) ? leaves[node.id] : "failure";
    trace.push({ path, type: "leaf", id: node.id, status: s });
    return s;
  }
  const stopOn = node.type === "sequence" ? "success" : "failure";
  let s = stopOn;
  for (const [i, c] of node.children.entries()) {
    s = poTick(c, leaves, path + "." + i, trace);
    if (s !== stopOn) break;
  }
  trace.push({ path, type: node.type, id: node.id ?? null, status: s });
  return s;
}
export function tickTree(tree, leaves) {
  poCheck(tree, 1, { n: 0 });
  const l = leaves && typeof leaves === "object" && !Array.isArray(leaves) ? leaves : poFail("Leaves are an object of id to success, failure or running.", "leaves");
  for (const k of Object.keys(l)) if (!PO_LEAF.includes(l[k])) poFail("A leaf is success, failure or running.", k);
  const trace = [];
  const status = poTick(tree, l, "0", trace);
  return { status, trace, ticked: trace.filter(t => t.type === "leaf").length };
}

// The workbench read as a behaviour tree: the task is done only when every stage it needs ran and nothing waits
// for an approval. The workbench itself still runs every stage; the tree says whether the whole task is done.
export function workbenchTree(result) {
  const r = result && Array.isArray(result.stages) ? result : poFail("Send a workbench result.", "workbench");
  const leaves = {};
  for (const s of r.stages) { leaves[s.id] = s.status === "ok" ? "success" : "failure"; leaves[s.id + ":skipped"] = s.status === "skipped" ? "success" : "failure"; }
  leaves.approvals = r.locked > 0 ? "running" : "success";
  const tree = { type: "sequence", id: "workbench", children: [
    ...r.stages.map(s => (PO_OPTIONAL.includes(s.id) ? { type: "fallback", id: s.id, children: [{ type: "leaf", id: s.id }, { type: "leaf", id: s.id + ":skipped" }] } : { type: "leaf", id: s.id })),
    { type: "leaf", id: "approvals" }] };
  const t = tickTree(tree, leaves);
  const stopped = t.status === "success" ? null : t.trace.find(x => /^0\.\d+$/.test(x.path) && x.status !== "success").id;
  return { tree, leaves, ...t, stopped_at: stopped, waiting: r.locked, chain_sha256: r.chain_sha256 ?? null };
}

// UCB1 over the person's record. reward is the sum of 0-to-1 outcomes over visits.
export function uctSelect(arms, c) {
  const cc = c === undefined ? Math.SQRT2 : typeof c === "number" && c >= 0 && c <= 4 ? c : poFail("c is a number from 0 to 4.", "c");
  if (!Array.isArray(arms) || arms.length < 2 || arms.length > 12) poFail("Give 2 to 12 arms.", "arms");
  const ids = new Set();
  for (const [i, a] of arms.entries()) {
    if (!a || !poName(a.id) || ids.has(a.id)) poFail("Each arm has its own id of 1 to 80 characters.", "arms[" + i + "]");
    ids.add(a.id);
    if (!Number.isInteger(a.visits) || a.visits < 0 || a.visits > 1e6) poFail("visits is a whole number from 0 to 1000000.", a.id);
    if (typeof a.reward !== "number" || !(a.reward >= 0) || a.reward > a.visits) poFail("reward is from 0 to visits.", a.id);
  }
  const N = arms.reduce((s, a) => s + a.visits, 0);
  const ranked = arms.map((a, i) => {
    if (a.visits === 0) return { id: a.id, visits: 0, mean: null, bonus: null, score: null, order: i };
    const mean = a.reward / a.visits, bonus = cc * Math.sqrt(Math.log(N) / a.visits);
    return { id: a.id, visits: a.visits, mean: poR(mean), bonus: poR(bonus), score: poR(mean + bonus), order: i };
  });
  const untried = ranked.filter(a => a.score === null);
  // sort is stable, so equal scores keep the order the arms were given in.
  const tried = ranked.filter(a => a.score !== null).sort((a, b) => b.score - a.score);
  const list = [...untried, ...tried].map(({ order, ...a }) => a);
  return { c: poR(cc), N, chosen: list[0].id, ranked: list,
    reason: untried.length ? "untried" : tried[0].score === tried[1].score ? "tie" : "score", tag: "[INFERENCE]" };
}

export function planOrder(req, deps) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : poFail("Send an object with a mode.", "");
  if (r.mode === "kahn") return { mode: "kahn", ...kahnOrder(r.nodes, r.edges) };
  if (r.mode === "skills") return { mode: "skills", ...skillOrder(deps, r.names) };
  if (r.mode === "tree") return { mode: "tree", ...tickTree(r.tree, r.leaves) };
  if (r.mode === "workbench") return { mode: "workbench", ...workbenchTree(runWorkbench(r.request)) };
  if (r.mode === "uct") return { mode: "uct", ...uctSelect(r.arms, r.c) };
  if (r.mode === "plans") {
    const m = compileMetacodes({ prompt: typeof r.prompt === "string" ? r.prompt : poFail("The prompt is text.", "prompt"), lang: r.lang === "ar" ? "ar" : "en", codes: ["ALT3"] });
    const rec = r.record === undefined ? {} : r.record && typeof r.record === "object" && !Array.isArray(r.record) ? r.record : poFail("The record is an object of plan id to {visits, reward}.", "record");
    for (const k of Object.keys(rec)) if (!m.options.some(o => o.id === k)) poFail("The record names a plan that is not one of the three.", k);
    const u = uctSelect(m.options.map(o => ({ id: o.id, visits: rec[o.id]?.visits ?? 0, reward: rec[o.id]?.reward ?? 0 })), r.c);
    return { mode: "plans", options: m.options.map(o => ({ id: o.id, title: o.title, proved: o.proved === true })), sha256: m.sha256, ...u };
  }
  return poFail("Choose a mode: " + PO_MODES.join(", ") + ".", typeof r.mode === "string" ? r.mode : "");
}
