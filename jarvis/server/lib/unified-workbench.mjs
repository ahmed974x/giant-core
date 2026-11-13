// ADR-160: the unified workbench. One deterministic pipeline over engines that already exist, in this order:
//   1 shield    the privacy shield (ADR-158) cleans the task text; a secret check gives only its SHA-1 prefix
//   2 metacodes the prompt meta-codes (ADR-156) on the cleaned text: proved plans; the first is followed
//   3 request   the universal agent (ADR-159) builds the model request; nothing is sent
//   4 design    the reversal engine with the contrast healer (ADR-150, ADR-153) on the CSS, with its SHA-256
//   5 math      the universal maths solver (ADR-154) on an expression
//   6 atlas     the FOSS atlas planner (ADR-158): savings only from the prices typed
//   7 security  the universal agent's verdicts (ADR-159)
// Then one plan joins every stage, with every install, outbound and money step as a locked approval, proved by
// prover.mjs, and a chain hash binds the stages' summaries in order. Pure: no network, no process, no file.
// The same answers come from .claude/skills/replica-unified-workbench/unified_workbench.py (tests/golden.json).
import { sha256Hex } from "./snapshot.mjs";
import { provePlan } from "./prover.mjs";
import { compileMetacodes } from "./prompt-metacodes.mjs";
import { universalAgent } from "./universal-agent.mjs";
import { solve as solveMath } from "./universal-math.mjs";
import { planFossStack, scrubPrivate, kAnonymity } from "./foss-atlas.mjs";

export const UW_STAGES = ["shield", "metacodes", "request", "design", "math", "atlas", "security"];
export const UW_LINKS = { shield: "#/atlas", metacodes: "#/missions", request: "#/universal", design: "#/studio", math: "#/math", atlas: "#/atlas", security: "#/universal" };
export class WorkbenchError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const uwFail = (m, d) => { throw new WorkbenchError(m, d); };
const uwSha = text => sha256Hex(text);

// A stage that is not asked for is skipped; a stage whose engine refuses its input is an error with the
// engine's own message, and the other stages still run.
function runStage(id, given, fn) {
  if (!given) return { id, status: "skipped", summary: null, link: UW_LINKS[id] ?? null };
  try { return { id, status: "ok", ...fn(), link: UW_LINKS[id] ?? null }; } catch (e) {
    if (e.status !== 400) throw e;
    return { id, status: "error", summary: { error: e.message, detail: e.detail ?? null }, link: UW_LINKS[id] ?? null };
  }
}
function lockedOf(steps, stage) { return steps.filter(s => s.locked === true).map(s => ({ stage, category: s.category, title: s.title })); }

export function runWorkbench(req) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : uwFail("Send an object with a task.", "");
  const task = typeof r.task === "string" && r.task.trim() && r.task.length <= 4000 ? r.task : uwFail("The task is text of 1 to 4000 characters.", "task");
  const lang = r.lang === "ar" ? "ar" : "en";
  const locked = [];
  let clean = task;
  const stages = [];
  stages.push(runStage("shield", true, () => {
    const s = scrubPrivate(task);
    clean = s.text;
    const secret = r.secretCheck === undefined ? null : kAnonymity(r.secretCheck);
    return { summary: { replaced: s.total, rules: s.redactions.map(x => x.rule), secret_prefix: secret ? secret.prefix : null, looked_up: false } };
  }));
  stages.push(runStage("metacodes", true, () => {
    const m = compileMetacodes({ prompt: clean, lang, codes: Array.isArray(r.codes) ? r.codes : [] });
    // The options are alternatives; the joined plan follows the first one, and its locks.
    locked.push(...lockedOf(m.options[0].steps, "metacodes"));
    return { summary: { codes: m.codes, options: m.options.length, followed: m.options[0].id, verified: m.verified, sha256: m.sha256 } };
  }));
  stages.push(runStage("request", true, () => {
    const q = universalAgent({ mode: "request", model: r.model ?? "claude-opus-5-5", ...(r.effort === undefined ? {} : { effort: r.effort }), ...(r.gateway === undefined ? {} : { gateway: r.gateway }), messages: [{ role: "user", content: clean }] });
    locked.push(...lockedOf(q.plan, "request"));
    return { summary: { model: q.model, effort: q.body.output_config.effort, dropped: q.dropped, verified: q.proof.verified, sent: false } };
  }));
  stages.push(runStage("design", r.css !== undefined, () => {
    const d = universalAgent({ mode: "design", css: r.css });
    return { summary: { rules: d.rules, after_sha256: d.after_sha256, verified: d.verified } };
  }));
  stages.push(runStage("math", r.math !== undefined, () => {
    const m = solveMath(r.math); // solve refuses anything that is not a task
    return { summary: { task: m.task, checks: m.checks.length, passed: m.checks.filter(c => c.ok).length, verified: m.verified } };
  }));
  stages.push(runStage("atlas", r.atlas !== undefined, () => {
    const a = planFossStack(r.atlas);
    locked.push(...lockedOf(a.steps, "atlas"));
    return { summary: { picks: a.picks.length, usd_per_year: a.savings ? a.savings.usd_per_year : null, verified: a.verified } };
  }));
  stages.push(runStage("security", r.candidates !== undefined, () => {
    const s = universalAgent({ mode: "security", candidates: r.candidates });
    return { summary: s.counts };
  }));
  // One plan: a tool step per stage that ran, then every locked step the stages asked for, each after the last.
  const steps = [...stages.filter(s => s.status === "ok").map(s => ({ kind: "tool", title: "Run " + s.id, category: null })),
    ...locked.map(l => ({ kind: "approval", title: l.stage + ": " + l.title, category: l.category, gate: "approval", locked: true, status: "pending_approval" }))]
    .map((s, i) => ({ ...s, depends: i ? [i - 1] : [] }));
  const proof = provePlan(steps);
  const chain = stages.reduce((h, s) => uwSha(h + JSON.stringify([s.id, s.status, s.summary])), "0".repeat(64));
  const ran = stages.filter(s => s.status === "ok").length;
  return { lang, stages, plan: steps, proof, locked: locked.length, ran, verified: proof.verified && stages.every(s => s.status !== "error"), chain_sha256: chain, sent: false };
}
