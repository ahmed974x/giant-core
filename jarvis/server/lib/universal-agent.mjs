// The universal agent (ADR-159), pure: used by the server (POST /api/w/:slug/agent/universal) and inlined into
// the page (#/agent). It plans and checks; it never calls a model. Each mode is a fixed, testable rule set:
//   catalog   models with the facts that could be checked, and where they came from; the rest say so
//   request   a Messages API request body for a Claude model, built to the current API rules, never sent
//   route     a weighted score over candidate models from numbers the caller measured, with a circuit breaker
//   relay     a structured handoff summary for moving work from one model to the next
//   compress  repeated lines and blank runs removed from a context, with the measured saving
//   security  findings sorted by Cloudflare's audit verdicts (confirmed, needs_validation, rejected) and
//             hardening notes, an independent verifier required for anything confirmed
//   graph     the path between two nodes over EXTRACTED and INFERRED edges, its confidence the weakest hop
//   lean      units checked against the "ponytail" ladder and the test rule: risky logic ships with a test
//   design    a stylesheet run through the reversal engine: no gradient, contrast healed (ADR-150, ADR-153)
// Sending anything to a model is a locked step: a hosted endpoint is locked by ADR-141, and a local gateway
// such as OmniRoute is an install that has not been approved. Both wait for Director 00 (AGENTS.md §1).
// The same engine is in .claude/skills/replica-universal-agent/universal_agent.py, with the same answers.
import { provePlan } from "./prover.mjs";
import { reverseTemplate } from "./reversal.mjs";

export const UA_READ = "2026-11-12";
export const UA_SOURCE = "claude-api skill, model table cached 2026-11-03";
export const UA_LIMITS = { candidates: 40, edges: 2000, units: 400, text: 200000, items: 50, css: 100000 };
export const UA_EFFORT = ["low", "medium", "high", "xhigh", "max"];
// Claude models, as the claude-api reference lists them. Prices are USD per million tokens.
export const UA_CLAUDE = [
  ["claude-fable-5-2", "Claude Fable 5.2", "general", 8, 40, "high", true],
  ["claude-mythos-5-2", "Claude Mythos 5.2", "verified organisations only", 8, 40, "high", true],
  ["claude-opus-5-5", "Claude Opus 5.5", "general", 4, 20, "medium", true],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5", "general", 2, 10, "high", true],
  ["claude-haiku-5-5", "Claude Haiku 5.5", "general", 0.1, 0.5, "medium", false],
].map(([id, name, access, input, output, effort, noForcedTool]) => ({ id, name, kind: "claude", access, context: 1000000, max_output: 128000,
  price_per_mtok: { input, output }, default_effort: effort, forced_tool_choice: noForcedTool ? "rejected" : "allowed", source: UA_SOURCE, read: UA_READ }));
// Names from the request that could not be checked from this sandbox: no number is given for them.
export const UA_UNVERIFIED = ["openrouter/free", "nvidia/nemotron-3-ultra:free", "nvidia/nemotron-3.5-lightning:free", "nvidia/nemotron-3.5-super-vl:free",
  "google/gemma-4-31b:free", "google/gemma-4-26b-a4b:free", "groq/gpt-oss-120b", "groq/gpt-oss-20b", "gemini-3.8-flash", "mistral/codestral-latest",
  "deepseek-v4.1-flash", "deepseek-v4-pro", "kimi-k3.1-pro", "glm-5.3-flash", "glm-5.2", "qwen3.8-27b", "qwen3-coder-next"]
  .map(id => ({ id, kind: id.includes("/") || id.startsWith("gemini") ? "hosted" : "open-weights", source: null, read: null, note: "تعذر التحقق منها" }));

// The 13 projects named in the request, reviewed read-only on 2026-11-12 (docs/security/THIRD-PARTY-SKILLS-REVIEW-2026-11-12.md).
// Nothing was installed or run. "rules-adopted" means text rules were taken into this code; the project itself is not installed.
export const UA_REVIEWED = [
  ["browser-use/browser-use", "MIT", "LICENSE", "pip install / uv tool install; needs a model API key", "not-installed", null],
  ["rohitg00/agentmemory", "Apache-2.0", "LICENSE", "npx -y …@latest; a daemon on ports 3111 and 3113 with hooks", "not-installed", null],
  ["K-Dense-AI/scientific-agent-skills", "MIT", "LICENSE.md", "npx skills add (a large skill pack)", "not-installed", null],
  ["mukul975/Anthropic-Cybersecurity-Skills", "Apache-2.0", "LICENSE", "npx skills add (a large skill pack)", "not-installed", null],
  ["ai-boost/awesome-harness-engineering", "CC0-1.0", "LICENSE", "a list; nothing to install", "reference", null],
  ["volcengine/OpenViking", "AGPL-3.0", "LICENSE", "uv tool install, or a downloaded script piped into a shell; runs a server", "not-installed", null],
  ["nextlevelbuilder/ui-ux-pro-max-skill", "MIT", "LICENSE", "/plugin install, or npm install -g", "rules-adopted", "UI checklists beside DESIGN.md (ADR-143)"],
  ["DietrichGebert/ponytail", "MIT", "LICENSE", "/plugin install, with hooks", "rules-adopted", "the six-rung lean ladder (lean mode)"],
  ["cloudflare/security-audit-skill", "MIT", "LICENSE", "npx skills add; zero-dependency .cjs validators", "rules-adopted", "the verdicts and six phases (security mode)"],
  ["obra/superpowers", "MIT", "LICENSE", "/plugin install, with hooks and optional telemetry", "rules-adopted", "tests first and small task splits (ADR-143)"],
  ["Graphify-Labs/graphify", "Apache-2.0", "LICENSE", "uv tool install", "rules-adopted", "EXTRACTED and INFERRED edges, weakest-hop confidence (graph mode)"],
  ["Jakeschincariol/replica-skill", "MIT", "LICENSE", "/plugin install", "rules-adopted", "skills vendored after review in ADR-132 to ADR-134"],
  ["cheaper-inference/OmniRoute", "MIT", "LICENSE", "npm install -g; a postinstall script and a daemon on port 20128", "not-installed", null],
].map(([repo, licence, file, install, verdict, adopted]) => ({ repo, licence, licence_file: "https://raw.githubusercontent.com/" + repo + "/HEAD/" + file,
  install, verdict, adopted, installed: false, read: UA_READ }));

export class AgentError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const uaFail = (m, d) => { throw new AgentError(m, d); };
function uaR(v, d = 4) { const p = 10 ** d; return Math.round(v * p) / p; }
function unit(v, name) { return typeof v === "number" && v >= 0 && v <= 1 ? v : uaFail("A score is a number from 0 to 1.", name); }
function list(v, name, max) { return Array.isArray(v) && v.length <= max ? v : uaFail("Give a list of at most " + max + ".", name); }
function text(v, name, max) { return typeof v === "string" && v.length <= max ? v : uaFail("Give text of at most " + max + " characters.", name); }
export const isLoopback = url => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/|$)/i.test(String(url));

// ---- catalog and request -------------------------------------------------------------------------------
export function catalog() { return { claude: UA_CLAUDE, unverified: UA_UNVERIFIED, reviewed: UA_REVIEWED, source: UA_SOURCE, read: UA_READ }; }

// A request body built to the rules the reference states for these models: thinking is always on, so the
// thinking field is left out; depth is output_config.effort; temperature, top_p and top_k are refused; a forced
// tool_choice (any or tool) is refused on every model here but Haiku 5.5. What was dropped is listed.
export function buildRequest(req) {
  const r = req; // universalAgent passes objects only
  const model = UA_CLAUDE.find(m => m.id === r.model) || uaFail("Choose one of the Claude models in the catalog.", typeof r.model === "string" ? r.model : "");
  const effort = r.effort === undefined ? model.default_effort : UA_EFFORT.includes(r.effort) ? r.effort : uaFail("Effort is low, medium, high, xhigh or max.", "effort");
  const maxTokens = r.max_tokens === undefined ? 16000 : Number.isInteger(r.max_tokens) && r.max_tokens >= 1 && r.max_tokens <= model.max_output ? r.max_tokens : uaFail("max_tokens is a whole number from 1 to 128000.", "max_tokens");
  const dropped = ["temperature", "top_p", "top_k", "thinking"].filter(k => r[k] !== undefined);
  const tc = r.tool_choice && typeof r.tool_choice === "object" && !Array.isArray(r.tool_choice) ? r.tool_choice : null;
  const forced = tc && (tc.type === "any" || tc.type === "tool") && model.forced_tool_choice === "rejected";
  if (forced) dropped.push("tool_choice");
  const body = { model: model.id, max_tokens: maxTokens, output_config: { effort }, messages: list(r.messages === undefined ? [] : r.messages, "messages", UA_LIMITS.items) };
  if (tc && !forced) body.tool_choice = tc;
  const via = r.gateway === undefined ? "anthropic" : text(r.gateway, "gateway", 200);
  const steps = [{ kind: "tool", title: "Build the request body", category: null }];
  if (via !== "anthropic" && isLoopback(via)) steps.push({ kind: "approval", title: "Install the local gateway after a security review", category: "install", gate: "approval", locked: true, status: "pending_approval" });
  steps.push({ kind: "approval", title: via === "anthropic" ? "Send to the hosted Claude API (locked by ADR-141)" : "Send through " + via + " to a hosted model", category: "outbound", gate: "approval", locked: true, status: "pending_approval" });
  const plan = steps.map((s, i) => ({ ...s, depends: i ? [i - 1] : [] }));
  return { model: model.id, body, dropped, stream: maxTokens > 16000, plan, proof: provePlan(plan), sent: false };
}

// ---- route, relay, compress ----------------------------------------------------------------------------
export const UA_WEIGHTS = { health: 0.25, quota: 0.2, zero_cost: 0.2, speed: 0.15, fit: 0.1, stability: 0.1 };
export const UA_BREAKER = 0.2;
export function scoreCandidate(c) {
  const zero = c.cost === 0 ? 1 : 0;
  return uaR(UA_WEIGHTS.health * c.health + UA_WEIGHTS.quota * c.quota + UA_WEIGHTS.zero_cost * zero + UA_WEIGHTS.speed * c.speed + UA_WEIGHTS.fit * c.fit + UA_WEIGHTS.stability * c.stability);
}
export function route(req) {
  const cs = list(req && req.candidates, "candidates", UA_LIMITS.candidates);
  if (!cs.length) uaFail("Give at least one candidate.", "candidates");
  const seen = new Set();
  const rows = cs.map((c, i) => {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id) uaFail("Each candidate needs an id.", "candidates[" + i + "]");
    if (seen.has(c.id)) uaFail("Each candidate id appears once.", c.id);
    seen.add(c.id);
    for (const k of ["health", "quota", "speed", "fit", "stability"]) unit(c[k], c.id + "." + k);
    if (c.cost !== null && !(typeof c.cost === "number" && c.cost >= 0)) uaFail("cost is a price in USD per million tokens, or null when unknown.", c.id + ".cost");
    const known = UA_CLAUDE.find(m => m.id === c.id) ? "checked" : UA_UNVERIFIED.find(m => m.id === c.id) ? "unverified" : "not in catalog";
    return { id: c.id, score: scoreCandidate(c), open: c.health >= UA_BREAKER, catalog: known, local: c.local === true };
  });
  const order = rows.filter(r => r.open).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return { weights: UA_WEIGHTS, breaker: UA_BREAKER, ranked: order, tripped: rows.filter(r => !r.open).map(r => r.id), chosen: order.length ? order[0].id : null,
    send: order.length && !order[0].local ? "locked: a hosted model waits for Director 00 (ADR-141)" : order.length ? "local: 127.0.0.1 only" : "none", tag: "[INFERENCE]" };
}
export function relay(req) {
  const r = req; // universalAgent passes objects only
  const goal = text(r.goal, "goal", 2000);
  const part = k => list(r[k] === undefined ? [] : r[k], k, UA_LIMITS.items).map((x, i) => text(x, k + "[" + i + "]", 500));
  const done = part("done"), next = part("next"), decisions = part("decisions"), files = part("files");
  const lines = ["Goal: " + goal, "Done (" + done.length + "):", ...done.map(x => "- " + x), "Next (" + next.length + "):", ...next.map((x, i) => (i + 1) + ". " + x),
    "Decisions (" + decisions.length + "):", ...decisions.map(x => "- " + x), "Files (" + files.length + "):", ...files.map(x => "- " + x),
    "Rules: AGENTS.md §1 locks stay locked; no invented numbers; run the checks before calling anything done."];
  return { summary: lines.join("\n"), counts: { done: done.length, next: next.length, decisions: decisions.length, files: files.length }, first_step: next.length ? next[0] : null };
}
export function compress(req) {
  const t = text(req && req.text, "text", UA_LIMITS.text);
  const seen = new Set(), out = [];
  let blank = 0, dupes = 0;
  for (const raw of t.split("\n")) {
    const line = raw.replace(/[ \t]+$/, "");
    if (!line) { blank++; if (blank <= 1) out.push(""); continue; }
    blank = 0;
    if (seen.has(line)) { dupes++; continue; }
    seen.add(line); out.push(line);
  }
  const result = out.join("\n");
  return { text: result, before_chars: t.length, after_chars: result.length, saved_percent: t.length ? uaR(100 * (t.length - result.length) / t.length, 1) : 0, repeated_lines_removed: dupes, unit: "characters, not tokens" };
}

// ---- security, graph, lean, design ---------------------------------------------------------------------
export function triageOne(c) {
  if (c.disproved === true) return { id: c.id, verdict: "rejected", reason: "an independent verifier disproved it", severity: null };
  if (typeof c.verifier !== "string" || !c.verifier || c.verifier === c.finder) return { id: c.id, verdict: "needs_validation", reason: "needs a verifier that is not its finder", severity: null };
  if (c.prevented_upstream === true) return { id: c.id, verdict: "hardening_note", reason: "an earlier layer already prevents it", severity: null };
  if (c.boundary_failure !== true || c.source_trace !== true) return { id: c.id, verdict: "needs_validation", reason: typeof c.unresolved === "string" && c.unresolved ? c.unresolved : "the boundary failure is not established", severity: null };
  const risk = uaR(c.likelihood * c.impact);
  if (risk <= 0) return { id: c.id, verdict: "needs_validation", reason: "no impact shown", severity: null };
  return { id: c.id, verdict: "confirmed", reason: "complete source trace and a shown impact", risk, severity: risk >= 0.6 ? "high" : risk >= 0.3 ? "medium" : "low" };
}
export function security(req) {
  const cs = list(req && req.candidates, "candidates", UA_LIMITS.candidates);
  const rows = cs.map((c, i) => {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || !c.id) uaFail("Each candidate needs an id.", "candidates[" + i + "]");
    const likelihood = unit(c.likelihood ?? 0, c.id + ".likelihood"), impact = unit(c.impact ?? 0, c.id + ".impact");
    return triageOne({ ...c, likelihood, impact });
  });
  const count = v => rows.filter(r => r.verdict === v).length;
  return { phases: ["reconnaissance", "coverage-led hunting", "candidate validation", "structured output", "independent record verification", "target-neutral reporting"],
    findings: rows, counts: { confirmed: count("confirmed"), needs_validation: count("needs_validation"), rejected: count("rejected"), hardening_note: count("hardening_note") } };
}
export function graph(req) {
  const r = req; // universalAgent passes objects only
  const edges = list(r.edges, "edges", UA_LIMITS.edges).map((e, i) => {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") uaFail("Each edge needs from and to.", "edges[" + i + "]");
    if (e.kind !== "EXTRACTED" && e.kind !== "INFERRED") uaFail("An edge is EXTRACTED or INFERRED.", "edges[" + i + "]");
    return { from: e.from, to: e.to, kind: e.kind, confidence: e.kind === "EXTRACTED" ? 1 : unit(e.confidence, "edges[" + i + "].confidence") };
  });
  const from = text(r.from, "from", 200), to = text(r.to, "to", 200);
  const prev = new Map([[from, null]]), queue = [from];
  while (queue.length && !prev.has(to)) {
    const n = queue.shift();
    for (const e of edges) if (e.from === n && !prev.has(e.to)) { prev.set(e.to, e); queue.push(e.to); }
  }
  if (!prev.has(to)) return { from, to, path: null, hops: 0, confidence: 0, extracted: 0, inferred: 0 };
  const path = [];
  for (let e = prev.get(to); e; e = prev.get(e.from)) path.unshift(e);
  return { from, to, path, hops: path.length, confidence: path.length ? Math.min(...path.map(e => e.confidence)) : 1,
    extracted: path.filter(e => e.kind === "EXTRACTED").length, inferred: path.filter(e => e.kind === "INFERRED").length };
}
export const UA_LADDER = ["does it need to exist", "is it already in this codebase", "does the standard library do it", "does the platform do it natively", "does an installed dependency do it", "write it, with tests"];
export function lean(req) {
  const units = list(req && req.units, "units", UA_LIMITS.units).map((u, i) => {
    if (!u || typeof u.name !== "string" || !u.name) uaFail("Each unit needs a name.", "units[" + i + "]");
    if (!Number.isInteger(u.lines) || u.lines < 0) uaFail("lines is a whole number.", u.name);
    if (!Number.isInteger(u.rung) || u.rung < 1 || u.rung > UA_LADDER.length) uaFail("rung is 1 to 6, the first ladder step that holds.", u.name);
    return { name: u.name, lines: u.lines, risky: u.risky === true, tested: u.tested === true, rung: u.rung, new_dependency: u.new_dependency === true };
  });
  const risky = units.filter(u => u.risky);
  const mustFix = risky.filter(u => !u.tested).map(u => ({ name: u.name, reason: "risky logic without a test" }));
  const review = units.filter(u => u.new_dependency).map(u => ({ name: u.name, reason: "a new dependency needs a security review and Director 00's approval (AGENTS.md §1)" }));
  return { ladder: UA_LADDER, units: units.length, lines: units.reduce((n, u) => n + u.lines, 0), risky: risky.length,
    risky_tested_percent: risky.length ? uaR(100 * (risky.length - mustFix.length) / risky.length, 1) : null, must_fix: mustFix, needs_review: review, verified: mustFix.length === 0 && review.length === 0 };
}
export function design(req) {
  const css = text(req && req.css, "css", UA_LIMITS.css);
  const r = reverseTemplate(css);
  return { corrections: r.corrections.map(c => ({ rule: c.rule, selector: c.selector ?? null })), rules: [...new Set(r.corrections.map(c => c.rule))], css: r.text, after_sha256: r.after, verified: r.corrections.length === 0 };
}

export const UA_MODES = ["catalog", "request", "route", "relay", "compress", "security", "graph", "lean", "design"];
export function universalAgent(req) {
  const mode = req && typeof req === "object" ? req.mode : undefined;
  if (mode === "catalog") return { mode, ...catalog() };
  if (mode === "request") return { mode, ...buildRequest(req) };
  if (mode === "route") return { mode, ...route(req) };
  if (mode === "relay") return { mode, ...relay(req) };
  if (mode === "compress") return { mode, ...compress(req) };
  if (mode === "security") return { mode, ...security(req) };
  if (mode === "graph") return { mode, ...graph(req) };
  if (mode === "lean") return { mode, ...lean(req) };
  if (mode === "design") return { mode, ...design(req) };
  return uaFail("Choose a mode: " + UA_MODES.join(", ") + ".", typeof mode === "string" ? mode : "");
}
