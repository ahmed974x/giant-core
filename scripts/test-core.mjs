// Tests for the OMEGA core engine (scripts/lib/agent-core.mjs) and its inline copies in the core page and the
// Ops Room (ADR-121).
//   node scripts/test-core.mjs        exits 0 when every test passes
// No network, no dependencies. Times and random draws are fixed, so every number below is exact.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OMEGA_CORE as C } from "./lib/agent-core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function test(name, f) {
  try { f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const NOW = Date.UTC(2026, 9, 24, 12), HOUR = 3600000, DAY = 86400000;

/* ---------- research register ---------- */
test("every model, framework and technique names a source; no row invents a field", () => {
  for (const m of C.MODELS) {
    ok(C.SRC[m.src] && /^https:\/\//.test(C.SRC[m.src].url) && /^\d{4}-\d{2}-\d{2}$/.test(C.SRC[m.src].date), `${m.id} has no dated source`);
    ok(["closed", "open", "unverified"].includes(m.kind), `${m.id} kind ${m.kind}`);
    if (m.kind === "open") ok(typeof m.licence === "string" && m.licence.length > 2, `${m.id} open without a licence`);
    if (m.kind === "unverified") ok(m.licence === null && m.note, `${m.id} unverified but carries a licence or no note`);
    if (m.score !== null) ok(m.src === "benchlm", `${m.id} has a score from a source that is not the ranking`);
  }
  ok(new Set(C.MODELS.map(m => m.id)).size === C.MODELS.length, "duplicate model id");
  for (const f of C.FRAMEWORKS) ok(/^https:\/\/github\.com\//.test(f.repo) && f.licence, f.id);
  for (const t of C.TECHNIQUES) ok(/^\d{4}\.\d{5}$/.test(t.arxiv) && C.TECH_URL(t) === "https://arxiv.org/abs/" + t.arxiv, t.id);
});
test("local fit: 4-bit rule of thumb, closed and unverified models never fit", () => {
  const g = C.MODELS.find(m => m.id === "glimmer30"), e4 = C.MODELS.find(m => m.id === "gemma4e4");
  ok(near(C.localFit(g, 32).gb, 18.5) && C.localFit(g, 32).fit && !C.localFit(g, 16).fit, "Glimmer 30B: 18.5 GB, fits 32 not 16");
  ok(C.localFit(e4, 8).fit, "Gemma 4 E4B fits 8 GB");
  ok(!C.localFit(C.MODELS.find(m => m.id === "opus55"), 1024).fit && !C.localFit(C.MODELS.find(m => m.id === "kimik31"), 1024).fit, "a closed or unverified model fitted");
  ok(!C.localFit(C.MODELS.find(m => m.id === "ds41flash"), 1024).fit, "a model with an unknown size fitted");
});

/* ---------- planner ---------- */
test("topological order follows dependencies and finds a loop", () => {
  const t = C.topo([{ id: "c", after: ["a", "b"] }, { id: "a" }, { id: "b", after: ["a"] }]);
  ok(t.ok && t.order.join() === "a,b,c", JSON.stringify(t));
  const l = C.topo([{ id: "a", after: ["b"] }, { id: "b", after: ["a"] }, { id: "x" }]);
  ok(!l.ok && l.cycle.join() === "a,b", JSON.stringify(l));
});
test("the plan checker refuses order-like and unknown tools, missing steps, loops and bad repeats", () => {
  for (const t of C.TEMPLATES) { const r = C.checkPlan(t); ok(r.ok, t.id + ": " + r.errors.join("; ")); }
  const bad = C.checkPlan({ steps: [{ id: "a", tool: "place_order" }, { id: "b", tool: "scout", why: "then sign the withdrawal" }, { id: "c", tool: "dance" }, { id: "d", tool: "audit", after: ["zz"] }, { id: "e", tool: "risk", repeat: { every: 1000, times: 3 } }] });
  ok(!bad.ok && bad.errors.length === 5, bad.errors.join(" | "));
  ok(bad.errors.some(e => /not allowed/.test(e) && /place_order/.test(e)) && bad.errors.some(e => /unknown tool "dance"/.test(e)) && bad.errors.some(e => /zz/.test(e)) && bad.errors.some(e => /repeat/.test(e)), bad.errors.join(" | "));
  ok(!C.checkPlan({ steps: [{ id: "a", tool: "scout", after: ["b"] }, { id: "b", tool: "audit", after: ["a"] }] }).ok, "loop accepted");
  ok(!C.checkPlan({ steps: Array.from({ length: 13 }, (_, i) => ({ id: "s" + i, tool: "ops" })) }).ok, "13 steps accepted");
  ok(!C.checkPlan("scout then audit").ok && !C.checkPlan({ steps: [] }).ok, "no steps accepted");
});
test("a plan from the local model is parsed out of surrounding text and checked", () => {
  const good = C.parseModelPlan('Here is the plan:\n{"steps":[{"id":"s1","tool":"scout"},{"id":"s2","tool":"analyst","after":["s1"]},{"id":"s3","tool":"note","after":["s2"]}]}\nDone.');
  ok(good.ok && good.steps.length === 3 && good.steps[1].after[0] === "s1", good.errors.join("; "));
  ok(!C.parseModelPlan("I cannot help").ok && !C.parseModelPlan("{steps: [}").ok, "garbage accepted");
  ok(!C.parseModelPlan('{"steps":[{"id":"s1","tool":"withdraw"}]}').ok, "withdraw accepted");
});

/* ---------- retries ---------- */
test("backoff doubles to the cap and full jitter scales it", () => {
  ok(C.backoff(0) === 2000 && C.backoff(1) === 4000 && C.backoff(3) === 16000 && C.backoff(20) === 300000, [0, 1, 3, 20].map(a => C.backoff(a)).join());
  ok(C.backoff(3, 0.5) === 8000 && C.backoff(3, 0) === 0 && C.backoff(3, 1) < 16000, "jitter");
});
test("circuit breaker opens after three failures, half-opens after the cool-down and doubles it on a failed trial", () => {
  let b = C.breakerNew();
  b = C.breakerResult(b, false, NOW); b = C.breakerResult(b, false, NOW);
  ok(b.s === "closed" && C.breakerAllow(b, NOW).allow, "opened too early");
  b = C.breakerResult(b, false, NOW);
  ok(b.s === "open" && b.until === NOW + 120000 && !C.breakerAllow(b, NOW + 1000).allow, JSON.stringify(b));
  const a = C.breakerAllow(b, NOW + 120000);
  ok(a.allow && a.b.s === "half", "no half-open trial");
  const again = C.breakerResult(a.b, false, NOW + 120000);
  ok(again.s === "open" && again.cool === 240000 && again.until === NOW + 360000, JSON.stringify(again));
  ok(C.breakerResult(a.b, true, NOW).s === "closed", "success did not close it");
});

/* ---------- memory ---------- */
test("recall ranks by recency, importance and word overlap (Generative Agents)", () => {
  let m = C.memNew();
  m = C.remember(m, { agent: "scout", text: "SOL led the scout board for three hours", imp: 0.5, t: NOW - 2 * HOUR }, NOW);
  m = C.remember(m, { agent: "audit", text: "receipt chain intact, 42 receipts", imp: 0.3, t: NOW - HOUR }, NOW);
  m = C.remember(m, { agent: "risk", text: "gate closed: drawdown over the limit", imp: 0.9, t: NOW - 30 * DAY }, NOW);
  const r = C.recall(m, "which market led the scout board", NOW, 3);
  ok(r[0].agent === "scout", r.map(x => x.agent).join());
  ok(near(r[0].rec, Math.pow(0.995, 2)) && r[0].rel > 0 && near(r[0].score, r[0].rec + 0.5 + r[0].rel), JSON.stringify(r[0]));
  const old = r.find(x => x.agent === "risk");
  ok(near(old.rec, Math.pow(0.995, 720)), "recency of a 30-day-old memory");
});
test("memory stays at its cap and evicts old unimportant events before lessons", () => {
  let m = C.memNew();
  m = C.remember(m, { kind: "lesson", agent: "scout", text: "keep me", imp: 0.9, t: NOW - 60 * DAY }, NOW);
  for (let i = 0; i < 405; i++) m = C.remember(m, { agent: "ops", text: "tick " + i, imp: 0.1, t: NOW - (405 - i) * HOUR }, NOW);
  ok(m.items.length === C.MEM_CAP, "size " + m.items.length);
  ok(m.items.some(x => x.text === "keep me") && !m.items.some(x => x.text === "tick 0") && m.items.some(x => x.text === "tick 404"), "wrong items evicted");
  ok(m.seq === 406, "ids reused");
});
test("reflection turns three failures into one lesson, and a switch that worked into a preference", () => {
  let m = C.memNew();
  for (let i = 0; i < 3; i++) m = C.remember(m, { agent: "scout", text: "ticker failed", ok: false, key: "HTTP 429", t: NOW - i * HOUR }, NOW);
  m = C.remember(m, { agent: "scout", text: "per-market tickers answered", ok: true, key: "alt:scout:per-market", t: NOW }, NOW);
  m = C.remember(m, { agent: "audit", text: "one failure", ok: false, key: "x", t: NOW }, NOW);
  const r = C.reflect(m, NOW);
  ok(r.lessons.length === 2, r.lessons.map(l => l.text).join(" | "));
  const rules = C.rulesFor(r.mem, "scout");
  ok(rules.slow === 2 && rules.altFirst && rules.prefer === "scout:per-market", JSON.stringify(rules));
  ok(C.reflect(r.mem, NOW).lessons.length === 0, "the same lessons were added twice");
  ok(C.rulesFor(r.mem, "audit").slow === 1, "audit slowed after one failure");
});

/* ---------- long missions ---------- */
test("a desk brief runs in dependency order and finishes", () => {
  let { mission: m } = C.missionNew(C.TEMPLATES.find(t => t.id === "brief"), NOW);
  const order = [];
  for (let i = 0; i < 20 && m.status === "active"; i++) { const s = C.missionNext(m, NOW); if (!s) break; order.push(s.id); m = C.missionApply(m, s.id, { ok: true, out: "ok" }, NOW); }
  ok(m.status === "done" && order.length === 9, m.status + " " + order.join());
  ok(order.indexOf("scout") < order.indexOf("analyst") && order.indexOf("analyst") < order.indexOf("risk") && order[order.length - 1] === "note", order.join());
  ok(C.missionProgress(m).pct === 1, "progress");
});
test("failures back off, switch approach every second try and block after six, handing the mission to Director 00", () => {
  let { mission: m } = C.missionNew({ id: "t", steps: [{ id: "scout", tool: "scout", alt: ["scout:per-market"] }, { id: "note", tool: "note", after: ["scout"] }] }, NOW);
  let t = NOW;
  m = C.missionApply(m, "scout", { ok: false, err: "HTTP 429" }, t, 0.5);
  let s = m.steps[0];
  ok(s.status === "retry" && s.tries === 1 && s.next === t + 2000 && C.approach(s) === "scout" && !C.missionNext(m, t + 1999), JSON.stringify(s));
  t = s.next; m = C.missionApply(m, "scout", { ok: false, err: "HTTP 429" }, t, 0.5); s = m.steps[0];
  ok(s.tries === 2 && C.approach(s) === "scout:per-market" && s.next === t + 4000, JSON.stringify(s));
  for (let i = 0; i < 4; i++) { t = m.steps[0].next; m = C.missionApply(m, "scout", { ok: false, err: "down" }, t, 0.5); }
  ok(m.steps[0].status === "blocked" && m.status === "blocked", m.status + " " + m.steps[0].status);
});
test("a repeating step makes a long mission that survives a save and reload", () => {
  let { mission: m } = C.missionNew(C.TEMPLATES.find(t => t.id === "watch24"), NOW);
  let t = NOW, n = 0;
  while (m.status === "active" && n < 200) {
    m = JSON.parse(JSON.stringify(C.missionExpire(m, t)));
    const s = C.missionNext(m, t);
    if (!s) { const due = m.steps.filter(x => x.status !== "done" && x.next > t).map(x => x.next); if (!due.length) break; t = Math.min(...due); continue; }
    m = C.missionApply(m, s.id, { ok: true }, t); n++;
  }
  const sc = m.steps.find(x => x.id === "scout"), an = m.steps.find(x => x.id === "analyst");
  ok(m.status === "done" && sc.runs === 24 && an.runs === 6 && n === 31, `${m.status} scout ${sc.runs} analyst ${an.runs} steps ${n}`);
  ok(t - NOW === 23 * HOUR, "finished after " + (t - NOW) / HOUR + " h");
});
test("a mission past its deadline stops", () => {
  const { mission: m } = C.missionNew(C.TEMPLATES[0], NOW);
  ok(C.missionExpire(m, NOW + 27 * HOUR).status === "stopped" && C.missionExpire(m, NOW).status === "active", "deadline");
});

/* ---------- 3D maths ---------- */
test("rotation keeps length and projection puts the origin at the centre", () => {
  const p = C.rotate([3, 4, 12], 0.7, -0.4);
  ok(near(Math.hypot(...p), 13, 1e-9), "length " + Math.hypot(...p));
  const o = C.project([0, 0, 0], { yaw: 1, pitch: 0.3, dist: 900, f: 600, cx: 400, cy: 300 });
  ok(near(o.x, 400) && near(o.y, 300) && near(o.s, 600 / 900), JSON.stringify(o));
  const up = C.project([0, 100, 0], { yaw: 0, pitch: 0, dist: 900, f: 600, cx: 400, cy: 300 });
  ok(up.y < 300, "y grows downwards on screen");
});
test("Fibonacci sphere and rings lie on their radius", () => {
  ok(C.fibSphere(19, 380).every(p => near(Math.hypot(...p), 380, 1e-6)), "sphere");
  ok(C.ring(9, 240, -0.5).every(p => near(Math.hypot(...p), 240, 1e-6)), "ring");
});
test("layout joins only links that exist: closed models are never wired", () => {
  const L = C.layout(16), ids = new Set(L.nodes.map(n => n.id));
  ok(L.edges.every(e => ids.has(e.a) && ids.has(e.b)), "an edge points nowhere");
  const wired = new Set(L.edges.filter(e => e.kind === "canRun").map(e => e.b));
  for (const m of C.MODELS) if (m.kind !== "open") ok(!wired.has("m-" + m.id), m.id + " is wired");
  ok(wired.size === C.MODELS.filter(m => C.localFit(m, 16).fit).length, "canRun edges");
  ok(L.nodes.filter(n => n.kind === "helper").length === 9 && L.nodes.filter(n => n.kind === "model").length === C.MODELS.length, "counts");
});

/* ---------- inline copies ---------- */
test("the core page and the Ops Room carry the current engine copy", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-core-inline.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stdout + r.stderr).trim());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
