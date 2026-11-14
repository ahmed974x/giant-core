// ADR-165: the runbook. One goal and the skills it needs, run through engines that already exist, in order:
//   1 shield   the privacy shield (ADR-158) cleans the goal; a secret check gives only its SHA-1 prefix
//   2 docs     project search (ADR-164) finds the records and reviews that match the cleaned goal
//   3 order    Kahn's order of the chosen skills and what they load (ADR-163), from the dependency snapshot
//   4 tree     the workbench (ADR-160) on the cleaned goal, read as a behaviour tree (ADR-163)
//   5 plan     UCB1 over the three meta-code plans from the person's own record (ADR-163), [INFERENCE]
//   6 routes   one fixed probe per page through the engine behind it; #/diagnostics reads the running server,
//              so it is listed as server only
// A chain hash binds the stages in order. Pure: no network, no process, no file; nothing is sent or installed.
// The same answers come from .claude/skills/replica-runbook/runbook.py (tests/golden.json).
import { sha256Hex } from "./snapshot.mjs";
import { scrubPrivate, kAnonymity, planFossStack } from "./foss-atlas.mjs";
import { searchProject } from "./project-search.mjs";
import { skillOrder, workbenchTree, planOrder } from "./plan-order.mjs";
import { runWorkbench } from "./unified-workbench.mjs";
import { runPolymath } from "./polymath-engine.mjs";
import { buildTree } from "./skill-tree.mjs";
import { universalAgent } from "./universal-agent.mjs";
import { solve as solveMath } from "./universal-math.mjs";
import { optics } from "./hyper-studio.mjs";

export const RB_STAGES = ["shield", "docs", "order", "tree", "plan", "routes"];
export const RB_ROUTES = [
  { route: "#/docs", adr: "ADR-164", engine: "project-search" },
  { route: "#/order", adr: "ADR-163", engine: "plan-order" },
  { route: "#/tree", adr: "ADR-162", engine: "skill-tree" },
  { route: "#/polymath", adr: "ADR-161", engine: "polymath-engine" },
  { route: "#/workbench", adr: "ADR-160", engine: "unified-workbench" },
  { route: "#/universal", adr: "ADR-159", engine: "universal-agent" },
  { route: "#/atlas", adr: "ADR-158", engine: "foss-atlas" },
  { route: "#/math", adr: "ADR-154", engine: "universal-math" },
  { route: "#/hyper", adr: "ADR-155", engine: "hyper-studio" },
  { route: "#/diagnostics", adr: "ADR-148", engine: "readiness" },
];
export class RunbookError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const rbFail = (m, d) => { throw new RunbookError(m, d); };

function rbStage(id, fn) {
  try { return { id, status: "ok", summary: fn() }; } catch (e) {
    if (e.status !== 400) throw e;
    return { id, status: "error", summary: { error: e.message, detail: e.detail ?? null } };
  }
}

// One fixed probe per page: [whether the engine gave its checked answer, the engine's whole answer]. The answer is
// reported as the first 12 hex characters of its SHA-256, so any change in the probe or the engine shows.
function rbProbe(route, ctx) {
  if (route === "#/docs") { const s = searchProject(ctx.corpus, { query: "contrast healer", limit: 3 }); return [s.found, s]; }
  if (route === "#/order") { const k = Object.keys(ctx.deps).sort(); if (!k.length) return [false, k]; const o = skillOrder(ctx.deps, [k[0]]); return [o.verified, o]; }
  if (route === "#/tree") { const t = buildTree(ctx.tree); return [t.counts.skills > 0, t]; }
  if (route === "#/polymath") { const p = runPolymath({ question: "Solve the equation", math: { task: "calculus", expression: "x^2-4" } }); return [!p.grounding.abstained, p]; }
  if (route === "#/workbench") { const w = runWorkbench({ task: "Check the plan" }); return [w.verified, w]; }
  if (route === "#/universal") { const u = universalAgent({ mode: "catalog" }); return [u.claude.length > 0, u]; }
  if (route === "#/atlas") { const a = planFossStack({ selectedIds: ["libreoffice"] }); return [a.verified, a]; }
  if (route === "#/math") { const m = solveMath({ task: "calculus", expression: "x^2-4", interval: [-5, 5] }); return [m.verified, m]; }
  const o = optics({ focal_mm: 50, f_stop: 2.8, subject_distance_m: 3 });
  return [o.verified, o];
}
export function probeRoutes(ctx) {
  return RB_ROUTES.map(p => {
    if (p.route === "#/diagnostics") return { ...p, status: "server_only", value: null };
    try { const [pass, answer] = rbProbe(p.route, ctx); return { ...p, status: pass ? "ok" : "failed", value: sha256Hex(JSON.stringify(answer)).slice(0, 12) }; } catch (e) {
      if (e.status !== 400) throw e;
      return { ...p, status: "error", value: null };
    }
  });
}

export function runbook(req, ctx) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : rbFail("Send an object with a goal.", "");
  const goal = typeof r.goal === "string" && r.goal.trim() && r.goal.length <= 2000 ? r.goal : rbFail("The goal is text of 1 to 2000 characters.", "goal");
  const c = ctx ?? {};
  const snap = { corpus: c.corpus ?? { docs: [] }, deps: c.deps ?? {}, tree: c.tree ?? { skills: [] } };
  const lang = r.lang === "ar" ? "ar" : "en";
  const shield = scrubPrivate(goal);
  const clean = shield.text;
  // The workbench takes any goal the shield returns, so this stage cannot be refused.
  const w = workbenchTree(runWorkbench({ task: clean, lang }));
  const stages = [
    { id: "shield", status: "ok", summary: { replaced: shield.total, rules: shield.redactions.map(x => x.rule), secret_prefix: r.secretCheck === undefined ? null : kAnonymity(r.secretCheck).prefix, looked_up: false } },
    rbStage("docs", () => {
      const s = searchProject(snap.corpus, { query: clean, limit: 5 });
      return { found: s.found, counts: s.counts, top: s.results.map(x => ({ id: x.id, kind: x.kind, title: x.title, score: x.score, ranks: x.ranks, snippet: x.snippet })) };
    }),
    rbStage("order", () => { const k = skillOrder(snap.deps, r.skills); return { chosen: k.chosen, added: k.added, layers: k.layers, cycle: k.cycle, verified: k.verified }; }),
    { id: "tree", status: "ok", summary: { status: w.status, stopped_at: w.stopped_at, waiting: w.waiting, leaves: w.ticked } },
    rbStage("plan", () => {
      const p = planOrder({ mode: "plans", prompt: clean, lang, ...(r.record === undefined ? {} : { record: r.record }), ...(r.c === undefined ? {} : { c: r.c }) });
      return { chosen: p.chosen, reason: p.reason, ranked: p.ranked, tag: p.tag };
    }),
    rbStage("routes", () => { const rt = probeRoutes(snap); return { routes: rt, ok: rt.filter(x => x.status === "ok").length, server_only: rt.filter(x => x.status === "server_only").length }; }),
  ];
  const chain = stages.reduce((h, s) => sha256Hex(h + JSON.stringify([s.id, s.status, s.summary])), "0".repeat(64));
  return { lang, goal: clean, stages, locked: w.waiting, ready: stages.every(s => s.status === "ok"), chain_sha256: chain, sent: false };
}
