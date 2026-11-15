// ADR-169: release readiness. Three deterministic checks over facts this repository already holds:
//   audit    the skill tree's states (ADR-162: proved, tested, rules, reference, attention) and the decision records and
//            security reviews in the project-search corpus (ADR-164). Ready when no skill needs attention.
//   regress  two snapshots of the checks' counts that the person gives, baseline and candidate. A count that should
//            grow (tests passed, mutants killed) must not fall; a failure count must be 0. Each check and the release
//            get one verdict: regression, progress or steady.
//   bundle   the skills a change touched and an optional model, through impact analysis (ADR-168): each skill's
//            blast radius, the pages and test commands joined, the model's licence and memory verdict, and an LCS
//            diff of the release notes; a SHA-256 chain binds the sections. Publishing stays a locked approval.
// The checks belong to the engines called here; this file adds no second guard for them. Pure: no network, no
// process, no file; nothing is sent, installed or published. The same answers come from
// .claude/skills/replica-release-gate/release_gate.py (tests/golden.json).
import { sha256Hex } from "./snapshot.mjs";
import { buildTree } from "./skill-tree.mjs";
import { impactAnalysis, IA_PAGES } from "./impact-analysis.mjs";

export const RG_MODES = ["audit", "regress", "bundle"];
// Counts that should only grow, and counts that must be 0 for a release.
export const RG_GROWTH = ["server_passed", "app_passed", "live_passed", "mutants_killed"];
export const RG_FAILURE = ["server_failed", "app_failed", "live_failed", "mutants_survived", "skillspector_critical", "skillspector_high", "contrast_failing", "purity_violations"];
export class ReleaseError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const rgFail = (m, d) => { throw new ReleaseError(m, d); };
function rgR(v) { return Math.round(v * 10000) / 10000; }

// The decision-record numbers (at most four digits) missing between the first and the last one.
export function adrGaps(ids) {
  const nums = [...new Set(ids.map(id => /ADR-([0-9]{1,4})/.exec(id)).filter(Boolean).map(m => Number(m[1])))].sort((a, b) => a - b);
  if (!nums.length) return { first: null, last: null, missing: [] };
  const have = new Set(nums), missing = [];
  for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!have.has(n)) missing.push(n);
  return { first: nums[0], last: nums[nums.length - 1], missing };
}

export function auditRepo(ctx) {
  const t = buildTree(ctx.tree);
  const s = t.counts.status, total = t.counts.skills;
  const docs = Array.isArray(ctx.corpus?.docs) ? ctx.corpus.docs.filter(d => d && typeof d.id === "string") : [];
  const adrs = docs.filter(d => d.kind === "adr").map(d => d.id), reviews = docs.filter(d => d.kind === "review").map(d => d.id);
  const share = n => (total ? rgR(n / total) : 0);
  return { mode: "audit", skills: total, status: s, shares: { proved: share(s.proved), tested: share(s.tested), proved_or_tested: share(s.proved + s.tested) },
    records: { adrs: adrs.length, reviews: reviews.length, ...adrGaps(adrs) },
    verdict: s.attention > 0 ? "attention" : total ? "ready" : "empty", sent: false };
}

function snapshot(x, name) {
  const o = x && typeof x === "object" && !Array.isArray(x) ? x : rgFail("Send the " + name + " snapshot as an object.", name);
  return k => (Number.isInteger(o[k]) && o[k] >= 0 && o[k] <= 1e9 ? o[k] : rgFail("Each count is a whole number from 0 to 1000000000.", name + "." + k));
}

// A count that should grow regresses when it falls; a failure count regresses when it is above 0 and is progress
// when it falls to 0 from above.
export function regressGate(r) {
  const base = snapshot(r.baseline, "baseline"), cand = snapshot(r.candidate, "candidate");
  const checks = [
    ...RG_GROWTH.map(k => { const b = base(k), c = cand(k); return { check: k, kind: "growth", baseline: b, candidate: c, delta: c - b, verdict: c < b ? "regression" : c > b ? "progress" : "steady" }; }),
    ...RG_FAILURE.map(k => { const b = base(k), c = cand(k); return { check: k, kind: "failure", baseline: b, candidate: c, delta: c - b, verdict: c > 0 ? "regression" : b > 0 ? "progress" : "steady" }; }),
  ];
  const n = v => checks.filter(x => x.verdict === v).length;
  return { mode: "regress", checks, counts: { regression: n("regression"), progress: n("progress"), steady: n("steady") },
    verdict: n("regression") ? "reject_regression" : n("progress") ? "proven_progress" : "steady", sent: false };
}

export function releaseBundle(r, ctx) {
  const skills = Array.isArray(r.skills) && r.skills.length >= 1 && r.skills.length <= 12 ? [...new Set(r.skills)] : rgFail("Choose 1 to 12 skills.", "skills");
  const blasts = skills.map(skill => impactAnalysis({ mode: "blast", skill }, ctx));
  const parts = blasts.map(b => ({ skill: b.skill, layers: b.upstream.layers, cycle: b.upstream.cycle, dependents: b.dependents.map(d => d.name), pages: b.pages.map(p => p.route) }));
  const pages = IA_PAGES.map(p => p.route).filter(route => parts.some(p => p.pages.includes(route)));
  const tests = [...new Set(blasts.flatMap(b => b.tests.map(t => t.command).filter(Boolean)))];
  const shared = [...new Set(blasts.flatMap(b => b.shared_tests))];
  const model = r.model === undefined ? null : impactAnalysis({ mode: "catalog", model: r.model, use: r.use, bits: r.bits, memory_gb: r.memory_gb, context_tokens: r.context_tokens, batch_size: r.batch_size, kv_bits: r.kv_bits }, ctx);
  const notes = r.notes === undefined ? null : impactAnalysis({ mode: "diff", a: r.notes?.a, b: r.notes?.b }, ctx);
  const steps = [{ action: "publish", target: "release", gate: "approval", locked: true, status: "pending_approval" }, ...(model ? model.steps : [])];
  const sections = [parts, pages, tests, shared, model, notes && notes.chain_sha256, steps];
  return { mode: "bundle", skills: parts, pages, tests, shared_tests: shared, model, notes, steps,
    chain_sha256: sections.reduce((h, s) => sha256Hex(h + sha256Hex(JSON.stringify(s))), "0".repeat(64)), sent: false };
}

export function releaseGate(req, ctx) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : rgFail("Send an object with a mode.", "");
  const c = ctx ?? {};
  if (r.mode === "audit") return auditRepo(c);
  if (r.mode === "regress") return regressGate(r);
  if (r.mode === "bundle") return releaseBundle(r, c);
  return rgFail("The mode is audit, regress or bundle.", "mode");
}
