// OMEGA core · النواة (ADR-121): pure functions and sourced data shared by the core page
// (omega-ops-room-v1/omega-core.html), the PRIME agent in the Ops Room (both inlined between the OMEGA_CORE markers
// by scripts/build-core-inline.mjs, because the pages must work from file:// with no build step), the local data
// proxy (it checks plans written by the local model) and the Node tests (scripts/test-core.mjs). No network, no
// storage and no clock except where a time is passed in.
//
// What it holds:
//   1. The research register: AI models (closed frontier and open weights), agent frameworks and the agent
//      techniques from published papers, each with the public source it was read from and the date it was read.
//      Nothing here is secret or leaked; a field the sources do not give, or give two different values for, is
//      null and says so. Closed models are listed for reference only: their weights are not public and nothing
//      copies them.
//   2. The agent's working parts, written from the papers' ideas, not their code: a planner (steps with
//      dependencies, topological order, a plan checker that refuses unknown or order-like tools), retries with
//      exponential backoff and full jitter, a circuit breaker per helper, a memory with recency × importance ×
//      relevance recall (Generative Agents), lessons from repeated failures (Reflexion), and long missions that
//      checkpoint after every step, repeat on a timer, switch to another approach after failures and stop at a
//      budget, then hand the decision to Director 00. Paper only: no tool here signs, sends or sizes an order.
//   3. 3D maths for the core page: rotation, perspective projection, Fibonacci sphere and rings, and the layout
//      of the core, its loop, its helpers, the models, frameworks and techniques, joined only by links that exist.

const finite = v => typeof v === "number" && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const HOUR = 3600000, DAY = 86400000;

/* ================= 1. research register ================= */
// Read on 2026-10-24 from the pages named in each row. Benchmarks and prices are what the source printed on its
// as-of date; they are the source's numbers, not ours.
const AS_OF = "2026-10-24";
const SRC = {
  benchlm: { url: "https://benchlm.ai/frontier-ai-models", date: "2026-10-23", name: "BenchLM frontier ranking" },
  tcMuse: { url: "https://techcrunch.com/2026/10/12/meta-releases-its-first-frontier-model-muse-wonder/", date: "2026-10-12", name: "TechCrunch" },
  ds41: { url: "https://smartscope.blog/en/blog/deepseek-v4-1-flash-1017-release-benchmarks-price-2026/", date: "2026-10-17", name: "SmartScope" },
  wavect: { url: "https://wavect.io/blog/open-weight-llm-comparison-2026/", date: "2026-10-24", name: "Wavect open-weight comparison" },
  kimi: { url: "https://www.unite.ai/moonshot-opens-kimi-k3-weights-under-a-revenue-tiered-license/", date: "2026-07-27", name: "Unite.AI" },
  glm: { url: "https://gigazine.net/gsc_news/en/20260829-glm-5-3-open/", date: "2026-08-29", name: "GIGAZINE" },
  qwen: { url: "https://www.eweek.com/news/alibaba-qwen3-8-27b-license-apac-china/", date: "2026-08-17", name: "eWeek" },
  glimmer: { url: "https://artificialanalysis.ai/articles/muse-glimmer", date: "2026-08-10", name: "Artificial Analysis" },
  gemma: { url: "https://datanorth.ai/news/google-releases-gemma-4-open-models", date: "2026-04-02", name: "DataNorth" },
  timeline: { url: "https://llmgateway.io/timeline", date: "2026-10-24", name: "LLM Gateway release timeline" },
  frameworks: { url: "https://futureagi.com/blog/oss-agent-frameworks-2026/", date: "2026-10-24", name: "FutureAGI (a vendor of evaluation tools)" }
};
// kind: "closed" (weights not published), "open" (weights published under the named licence), "unverified"
// (released, but the sources read do not say whether the weights are public).
const MODELS = [
  { id: "opus55", name: "Claude Opus 5.5", maker: "Anthropic", kind: "closed", date: null, params: null, active: null, ctx: null, licence: "proprietary", score: 86.6, outUsd: 20, src: "benchlm" },
  { id: "gpt61sol", name: "GPT-6.1 Sol", maker: "OpenAI", kind: "closed", date: null, params: null, active: null, ctx: null, licence: "proprietary", score: 84.2, outUsd: 10, src: "benchlm" },
  { id: "gpt6astra", name: "GPT-6 Astra", maker: "OpenAI", kind: "closed", date: null, params: null, active: null, ctx: null, licence: "proprietary", score: 84.0, outUsd: 50, src: "benchlm" },
  { id: "fable51", name: "Claude Fable 5.1", maker: "Anthropic", kind: "closed", date: null, params: null, active: null, ctx: null, licence: "proprietary", score: 83.1, outUsd: 50, src: "benchlm" },
  { id: "gemini4argon", name: "Gemini 4 Argon", maker: "Google", kind: "closed", date: null, params: null, active: null, ctx: null, licence: "proprietary", score: 82.8, outUsd: 10, src: "benchlm" },
  { id: "sonnet55", name: "Claude Sonnet 5.5", maker: "Anthropic", kind: "closed", date: null, params: null, active: null, ctx: null, licence: "proprietary", score: 82.2, outUsd: 10, src: "benchlm" },
  { id: "musewonder", name: "Muse Wonder", maker: "Meta", kind: "closed", date: "2026-10-12", params: null, active: null, ctx: null, licence: "API only in the report", score: null, outUsd: 20, src: "tcMuse", note: "Meta's own benchmark claims, not independently checked" },
  { id: "ds41flash", name: "DeepSeek V4.1 Flash 1017", maker: "DeepSeek", kind: "open", date: "2026-10-17", params: null, active: null, ctx: 1000000, licence: "MIT", score: null, outUsd: null, src: "ds41", note: "size: one source estimates about 763B from the file sizes, another says 552B, so it is left blank" },
  { id: "ds4pro", name: "DeepSeek V4 Pro-0813", maker: "DeepSeek", kind: "open", date: null, params: 1700, active: null, ctx: 1000000, licence: "MIT", score: null, outUsd: null, src: "wavect" },
  { id: "kimik3", name: "Kimi K3", maker: "Moonshot AI", kind: "open", date: "2026-07-27", params: 2800, active: 104, ctx: 1000000, licence: "Kimi K3 License (permissive; separate deal for hosted services above $20M a year)", score: null, outUsd: null, src: "kimi" },
  { id: "kimik31", name: "Kimi K3.1 Pro", maker: "Moonshot AI", kind: "unverified", date: "2026-10-23", params: null, active: null, ctx: null, licence: null, score: null, outUsd: null, src: "timeline", note: "weights and licence not stated in the source read" },
  { id: "glm53", name: "GLM-5.3", maker: "Z.ai", kind: "open", date: "2026-08-29", params: 744, active: 40, ctx: null, licence: "GLM-5.3 License (security review above $10B annual revenue)", score: null, outUsd: null, src: "glm", note: "another source gives 753B total" },
  { id: "qwen38max", name: "Qwen3.8-2.4T-A95B", maker: "Alibaba", kind: "open", date: null, params: 2400, active: 95, ctx: null, licence: "Qwen3.8-Max License (separate licence above $50M a year for hosted services)", score: null, outUsd: null, src: "qwen" },
  { id: "qwen3827", name: "Qwen3.8-27B", maker: "Alibaba", kind: "open", date: null, params: 27, active: 27, ctx: 262144, licence: "Apache-2.0", score: null, outUsd: null, src: "qwen", note: "weights reported on 2026-08-17; native 262K context, 1M with YaRN" },
  { id: "glimmer30", name: "Muse Glimmer 30B", maker: "Meta", kind: "open", date: null, params: 30, active: 30, ctx: 131072, licence: "Apache-2.0", score: null, outUsd: null, src: "glimmer", note: "reviewed on 2026-08-10; Artificial Analysis Intelligence Index 35; about 18 GB at 4-bit" },
  { id: "gemma431", name: "Gemma 4 31B", maker: "Google", kind: "open", date: "2026-04-02", params: 31, active: 31, ctx: 262144, licence: "Apache-2.0", score: null, outUsd: null, src: "gemma" },
  { id: "gemma426", name: "Gemma 4 26B MoE", maker: "Google", kind: "open", date: "2026-04-02", params: 26, active: 3.8, ctx: 262144, licence: "Apache-2.0", score: null, outUsd: null, src: "gemma" },
  { id: "gemma4e4", name: "Gemma 4 E4B", maker: "Google", kind: "open", date: "2026-04-02", params: 4.5, active: 4.5, ctx: 131072, licence: "Apache-2.0", score: null, outUsd: null, src: "gemma", note: "4.5B effective parameters" },
  { id: "llama4scout", name: "Llama 4 Scout", maker: "Meta", kind: "open", date: null, params: 109, active: 17, ctx: 10000000, licence: "Llama 4 Community License (EU limit on the multimodal grant)", score: null, outUsd: null, src: "wavect" }
];
// Frameworks: what each is for, and the one idea the core took from it (as text; none is installed or run).
const FRAMEWORKS = [
  { id: "langgraph", name: "LangGraph", licence: "MIT", repo: "https://github.com/langchain-ai/langgraph", good: "graphs of agents with shared state and checkpoints; resume, retry a node, human review", took: "missions checkpoint after every step and resume after a reload", to: "mission" },
  { id: "letta", name: "Letta (MemGPT)", licence: "Apache-2.0", repo: "https://github.com/letta-ai/letta", good: "long-lived agents with self-edited memory blocks across sessions", took: "a bounded long-term memory that keeps lessons longer than events", to: "memory" },
  { id: "crewai", name: "CrewAI", licence: "MIT", repo: "https://github.com/crewAIInc/crewAI", good: "roles, tasks with expected outputs, crews and flows", took: "one task and one tool set per helper", to: "lead" },
  { id: "smolagents", name: "smolagents", licence: "Apache-2.0", repo: "https://github.com/huggingface/smolagents", good: "ReAct-style code agents; its local executor is not a security boundary", took: "tools are plain functions from a fixed allow-list; no generated code runs", to: "act" },
  { id: "autogen", name: "AutoGen", licence: "MIT (code)", repo: "https://github.com/microsoft/autogen", good: "message-passing agents; in maintenance mode", took: "nothing; named for comparison", to: null },
  { id: "ag2", name: "AG2", licence: "Apache-2.0", repo: "https://github.com/ag2ai/ag2", good: "community fork of AutoGen's conversational API", took: "nothing; named for comparison", to: null },
  { id: "agno", name: "Agno", licence: "Apache-2.0 (the source also lists MPL-2.0)", repo: "https://github.com/agno-agi/agno", good: "memory, knowledge and guardrails in one SDK, OpenTelemetry tracing", took: "a measured time for every helper run", to: "observe" },
  { id: "llamaindex", name: "LlamaIndex agents", licence: "MIT", repo: "https://github.com/run-llama/llama_index", good: "agent workflows over retrieval and indexes", took: "recall ranks memories by their words against the task", to: "memory" }
];
// Techniques from published papers (arXiv ids), and where the core uses each idea.
const TECHNIQUES = [
  { id: "react", name: "ReAct", arxiv: "2210.03629", idea: "interleave reasoning and acting with observations", use: "each cycle observes, plans, acts and records", to: "act" },
  { id: "plansolve", name: "Plan-and-Solve", arxiv: "2305.04091", idea: "write a plan first, then carry it out step by step", use: "missions are written as steps with dependencies before they run", to: "plan" },
  { id: "reflexion", name: "Reflexion", arxiv: "2303.11366", idea: "turn failures into written lessons kept in memory", use: "three failures of one helper with one error become a lesson that slows it and tries the other approach first", to: "reflect" },
  { id: "genagents", name: "Generative Agents", arxiv: "2304.03442", idea: "recall memories by recency, importance and relevance", use: "recall score = 0.995^hours + importance + word overlap", to: "memory" },
  { id: "memgpt", name: "MemGPT", arxiv: "2310.08560", idea: "tiered memory: a small working set and a long-term store", use: "working memory is the current mission; long-term memory is capped at 400 items", to: "memory" },
  { id: "voyager", name: "Voyager", arxiv: "2305.16291", idea: "a growing library of skills that worked", use: "an approach that succeeded after a switch is kept as the helper's first choice", to: "reflect" },
  { id: "tot", name: "Tree of Thoughts", arxiv: "2305.10601", idea: "explore alternatives and back off from dead ends", use: "each step has other approaches to try before it is blocked", to: "plan" },
  { id: "selfcons", name: "Self-Consistency", arxiv: "2203.11171", idea: "agree across several independent paths", use: "the brief notes when scout and analyst disagree on the top market", to: "observe" }
];
const TECH_URL = t => `https://arxiv.org/abs/${t.arxiv}`;

// Rough fit of an open model on a machine with `ramGB` of memory: 4-bit weights take about 0.55 GB per billion
// parameters plus 2 GB for the runtime and context, and only three quarters of the memory is counted as free.
// A rule of thumb [INFERENCE], not a measurement; closed and unverified models never fit.
function localFit(m, ramGB) {
  if (!m || m.kind !== "open" || !finite(m.params) || !finite(ramGB)) return { fit: false, gb: NaN };
  const gb = m.params * 0.55 + 2;
  return { fit: gb <= ramGB * 0.75, gb };
}

/* ================= 2. the agent's working parts ================= */
// The tools a plan may name. Each maps to a PRIME helper; none places, signs or sizes an order.
const TOOLS = Object.freeze({
  scout: "rank 12 markets from Binance public 24 h tickers",
  analyst: "read hourly candles of the desk markets (EMA, RSI, ATR, Bollinger)",
  quant: "read the desk's order flow and the neural direction head",
  sentinel: "read OSIRIS PWSI and the cyber and space index",
  risk: "check the risk gate and the court's veto line",
  audit: "re-verify the SHA-256 receipt chain",
  research: "prepare an ORACLE brief link on the focus market",
  ops: "check the site's health: sources, readings, self-test, timer drift",
  recall: "recall the memories that match the mission",
  note: "write the mission's summary into the journal and memory"
});
const FORBIDDEN = /order|sign|withdraw|transfer|leverage|margin|api[_ -]?key|secret|wallet[_ -]?move|live/i;

// Topological order of plan steps (Kahn). Returns { ok, order } or { ok: false, cycle } with the ids left over.
function topo(steps) {
  const ids = new Set(steps.map(s => s.id)), indeg = new Map(), next = new Map();
  for (const s of steps) { indeg.set(s.id, 0); next.set(s.id, []); }
  for (const s of steps) for (const d of s.after || []) if (ids.has(d)) { indeg.set(s.id, indeg.get(s.id) + 1); next.get(d).push(s.id); }
  const q = steps.filter(s => indeg.get(s.id) === 0).map(s => s.id), order = [];
  while (q.length) {
    const id = q.shift(); order.push(id);
    for (const n of next.get(id)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) q.push(n); }
  }
  return order.length === steps.length ? { ok: true, order } : { ok: false, cycle: steps.map(s => s.id).filter(id => !order.includes(id)) };
}

// Checks a plan before it may run, whoever wrote it (a template or the local model): known tools only, nothing
// order-like, unique ids, dependencies that exist, no cycle, at most `max` steps, sane repeats. Returns the cleaned
// steps and every problem found.
function checkPlan(plan, opt = {}) {
  const max = opt.max || 12, errors = [], tools = opt.tools || TOOLS;
  const raw = plan && Array.isArray(plan.steps) ? plan.steps : Array.isArray(plan) ? plan : null;
  if (!raw) return { ok: false, errors: ["the plan has no steps list"], steps: [] };
  if (!raw.length) errors.push("the plan is empty");
  if (raw.length > max) errors.push(`the plan has ${raw.length} steps; at most ${max}`);
  const seen = new Set(), steps = [];
  raw.slice(0, max).forEach((s, i) => {
    const id = String(s && s.id || `s${i + 1}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || `s${i + 1}`;
    const tool = String(s && s.tool || "").trim().toLowerCase();
    if (seen.has(id)) errors.push(`step id ${id} is used twice`);
    seen.add(id);
    if (FORBIDDEN.test(tool) || FORBIDDEN.test(String(s && s.why || ""))) errors.push(`step ${id}: "${tool}" is not allowed (paper only, no orders, keys or money moves)`);
    else if (!Object.prototype.hasOwnProperty.call(tools, tool)) errors.push(`step ${id}: unknown tool "${tool}"`);
    const after = (Array.isArray(s && s.after) ? s.after : []).map(x => String(x).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)).filter(Boolean);
    const alt = (Array.isArray(s && s.alt) ? s.alt : []).map(x => String(x).slice(0, 24)).slice(0, 3);
    let repeat = null;
    if (s && s.repeat) {
      const every = +s.repeat.every, times = +s.repeat.times;
      if (!(every >= 60000 && every <= DAY && Number.isInteger(times) && times >= 1 && times <= 96)) errors.push(`step ${id}: repeat must be every 1 min to 24 h, 1 to 96 times`);
      else repeat = { every, times };
    }
    steps.push({ id, tool, after, alt, repeat, why: String(s && s.why || tools[tool] || "").slice(0, 160) });
  });
  for (const s of steps) for (const d of s.after) if (!seen.has(d)) errors.push(`step ${s.id} waits for ${d}, which is not in the plan`);
  if (!errors.length) { const t = topo(steps); if (!t.ok) errors.push(`the steps wait on each other in a loop: ${t.cycle.join(", ")}`); }
  return { ok: !errors.length, errors, steps };
}

// Exponential backoff with full jitter (the AWS architecture blog's "full jitter"): a random wait in
// [0, min(cap, base × factor^attempt)). `u` in [0, 1) is the random draw, passed in so tests are exact; without it
// the ceiling is returned.
function backoff(attempt, u, cfg = {}) {
  const base = cfg.base || 2000, cap = cfg.cap || 300000, factor = cfg.factor || 2;
  const ceil = Math.min(cap, base * Math.pow(factor, Math.max(0, attempt)));
  return finite(u) ? Math.floor(clamp(u, 0, 0.999999) * ceil) : ceil;
}

// Circuit breaker per helper: closed (runs), open (skipped until the cool-down ends) and half-open (one trial run).
// `failures` failures in a row open it; a success closes it; a failed trial opens it again for twice as long.
const BREAKER = { failures: 3, coolMs: 120000, maxCoolMs: 1800000 };
function breakerNew() { return { s: "closed", fails: 0, until: 0, cool: BREAKER.coolMs }; }
function breakerAllow(b, now) {
  if (!b || b.s === "closed") return { allow: true, b: b || breakerNew() };
  if (b.s === "open" && now >= b.until) return { allow: true, b: { ...b, s: "half" } };
  return { allow: b.s === "half", b };
}
function breakerResult(b, ok, now, cfg = BREAKER) {
  b = b || breakerNew();
  if (ok) return breakerNew();
  if (b.s === "half") { const cool = Math.min(cfg.maxCoolMs, b.cool * 2); return { s: "open", fails: b.fails + 1, until: now + cool, cool }; }
  const fails = b.fails + 1;
  return fails >= cfg.failures ? { s: "open", fails, until: now + b.cool, cool: b.cool } : { ...b, s: "closed", fails };
}

/* ---------- memory ---------- */
function normAr(w) { return String(w).replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه"); }
const STOP = new Set("the a an of to in on at for and or is are was be with by from it this that as ال في من على الى عن مع هذا هذه".split(" "));
function words(text) {
  return normAr(String(text || "").toLowerCase()).split(/[^\p{L}\p{N}]+/u).map(w => w.startsWith("ال") && w.length > 4 ? w.slice(2) : w).filter(w => w.length > 1 && !STOP.has(w));
}
function overlap(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.sqrt(A.size * B.size);
}
const MEM_CAP = 400;
// Retention for eviction: importance plus a 7-day half-life; lessons keep a floor so events go first.
const retention = (it, now) => (it.kind === "lesson" ? 0.5 : 0) + (finite(it.imp) ? it.imp : 0.3) + Math.pow(0.5, Math.max(0, now - it.t) / (7 * DAY));
function memNew() { return { seq: 0, items: [] }; }
function remember(mem, item, now, cap = MEM_CAP) {
  mem = mem && Array.isArray(mem.items) ? mem : memNew();
  const it = { id: mem.seq + 1, t: finite(item.t) ? item.t : now, kind: item.kind || "event", agent: String(item.agent || "lead").slice(0, 16), text: String(item.text || "").replace(/\s+/g, " ").slice(0, 280), imp: clamp(finite(item.imp) ? item.imp : 0.3, 0, 1), ok: item.ok !== false, key: item.key ? String(item.key).slice(0, 80) : undefined, rule: item.rule };
  let items = mem.items.concat(it);
  if (items.length > cap) {
    const keep = items.map((x, i) => [retention(x, now), i]).sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, cap).map(x => x[1]).sort((a, b) => a - b);
    items = keep.map(i => items[i]);
  }
  return { seq: it.id, items };
}
// Generative Agents recall: recency 0.995^hours since the memory, its importance and its word overlap with the
// query, each in [0, 1], summed with equal weights. Returns the top k with each part shown.
function recall(mem, query, now, k = 5) {
  if (!mem || !Array.isArray(mem.items)) return [];
  return mem.items.map(it => {
    const rec = Math.pow(0.995, Math.max(0, now - it.t) / HOUR), rel = overlap(query, it.text + " " + it.agent);
    return { ...it, rec, rel, score: rec + it.imp + rel };
  }).sort((a, b) => b.score - a.score || b.t - a.t).slice(0, k);
}
// Reflexion as fixed rules: within `win`, three or more failed events of one helper with one error key become a
// lesson (slow that helper ×2 and try its other approach first); an approach that succeeded after a switch becomes
// a "prefer" lesson. A lesson already in memory is not added twice. Returns the new lessons and the memory.
function reflect(mem, now, win = DAY) {
  mem = mem && Array.isArray(mem.items) ? mem : memNew();
  const recent = mem.items.filter(it => it.kind === "event" && now - it.t <= win), groups = new Map();
  for (const it of recent) if (!it.ok && it.key) { const g = `${it.agent}|${it.key}`; groups.set(g, (groups.get(g) || 0) + 1); }
  const have = new Set(mem.items.filter(it => it.kind === "lesson").map(it => it.key)), lessons = [];
  for (const [g, n] of groups) {
    if (n < 3) continue;
    const [agent, key] = g.split("|"), lk = `slow:${agent}:${key}`;
    if (have.has(lk)) continue;
    lessons.push({ kind: "lesson", agent, key: lk, imp: 0.9, text: `${agent}: ${n} failures "${key}" in ${Math.round(win / HOUR)} h → run it half as often and try its other approach first [INFERENCE]`, rule: { agent, slow: 2, altFirst: true } });
  }
  for (const it of recent) if (it.ok && it.key && it.key.startsWith("alt:")) {
    const lk = `prefer:${it.agent}:${it.key.slice(4)}`;
    if (have.has(lk) || lessons.some(l => l.key === lk)) continue;
    lessons.push({ kind: "lesson", agent: it.agent, key: lk, imp: 0.8, text: `${it.agent}: the approach "${it.key.slice(4)}" worked after a switch → keep it as the first choice [INFERENCE]`, rule: { agent: it.agent, prefer: it.key.slice(4) } });
  }
  for (const l of lessons) mem = remember(mem, l, now);
  return { lessons, mem };
}
// The rules the lessons in memory set for one helper: the slow-down factor and the approach to try first.
function rulesFor(mem, agent) {
  const out = { slow: 1, prefer: null, altFirst: false };
  for (const it of (mem && mem.items) || []) if (it.kind === "lesson" && it.rule && it.rule.agent === agent) {
    if (it.rule.slow) out.slow = Math.max(out.slow, it.rule.slow);
    if (it.rule.altFirst) out.altFirst = true;
    if (it.rule.prefer) out.prefer = it.rule.prefer;
  }
  return out;
}

/* ---------- long missions ---------- */
// Templates PRIME offers. Each step names a tool from TOOLS; `alt` lists other approaches the helper knows; a
// repeat runs the step again on a timer, which is what makes a mission long (a 24 h watch survives reloads because
// the mission is saved after every step).
const TEMPLATES = [
  { id: "brief", en: "Desk brief", ar: "موجز المكتب", goal: "One complete picture of the paper desk now", steps: [
    { id: "audit", tool: "audit" }, { id: "scout", tool: "scout", alt: ["scout:per-market"] }, { id: "analyst", tool: "analyst", after: ["scout"], alt: ["analyst:short"] },
    { id: "quant", tool: "quant" }, { id: "sentinel", tool: "sentinel" }, { id: "risk", tool: "risk", after: ["audit", "analyst", "sentinel"] },
    { id: "recall", tool: "recall", after: ["risk"] }, { id: "research", tool: "research", after: ["risk"] }, { id: "note", tool: "note", after: ["recall", "research", "quant"] }] },
  { id: "watch24", en: "24-hour market watch", ar: "مراقبة السوق ٢٤ ساعة", goal: "Rank the markets every hour for a day and keep what led", steps: [
    { id: "scout", tool: "scout", alt: ["scout:per-market"], repeat: { every: HOUR, times: 24 } }, { id: "analyst", tool: "analyst", alt: ["analyst:short"], repeat: { every: 4 * HOUR, times: 6 } },
    { id: "note", tool: "note", after: ["scout", "analyst"] }] },
  { id: "chain24", en: "Receipt guard for a day", ar: "حراسة الفواتير يوماً", goal: "Re-verify the receipt chain every 30 minutes for 24 hours", steps: [
    { id: "audit", tool: "audit", repeat: { every: 30 * 60000, times: 48 } }, { id: "risk", tool: "risk", repeat: { every: HOUR, times: 24 } }, { id: "note", tool: "note", after: ["audit", "risk"] }] },
  { id: "health", en: "Site health check", ar: "فحص صحة الموقع", goal: "Check sources, readings, the receipt chain and the shocks", steps: [
    { id: "ops", tool: "ops" }, { id: "audit", tool: "audit" }, { id: "sentinel", tool: "sentinel" }, { id: "recall", tool: "recall", after: ["ops"] }, { id: "note", tool: "note", after: ["ops", "audit", "sentinel", "recall"] }] }
];
const MISSION = { maxTries: 6, switchEvery: 2, maxMs: 26 * HOUR };
function missionNew(tpl, now, goal) {
  const c = checkPlan(tpl);
  if (!c.ok) return { ok: false, errors: c.errors };
  return { ok: true, mission: {
    id: `${tpl.id || "plan"}-${now.toString(36)}`, tpl: tpl.id || "plan", title: String(tpl.en || "Plan").slice(0, 60), ar: String(tpl.ar || "").slice(0, 60), goal: String(goal || tpl.goal || "").slice(0, 200),
    created: now, status: "active", deadline: now + MISSION.maxMs,
    steps: c.steps.map(s => ({ ...s, status: "todo", tries: 0, runs: 0, altIx: -1, next: now, out: "", at: 0 }))
  } };
}
// The next step that may run now: its dependencies are done (a repeating dependency counts once it has run once),
// it is waiting, and its time has come. Earliest due first, then plan order.
function missionNext(m, now) {
  if (!m || m.status !== "active") return null;
  const byId = new Map(m.steps.map(s => [s.id, s]));
  const ready = s => (s.after || []).every(d => { const x = byId.get(d); return x && (x.status === "done" || (x.repeat && x.runs >= 1 && x.status !== "blocked")); });
  const due = m.steps.filter(s => (s.status === "todo" || s.status === "retry") && s.next <= now && ready(s));
  // A summary step waits for repeating steps to finish.
  const fin = due.filter(s => !(s.tool === "note" && (s.after || []).some(d => { const x = byId.get(d); return x && x.status !== "done"; })));
  return fin.sort((a, b) => a.next - b.next || m.steps.indexOf(a) - m.steps.indexOf(b))[0] || null;
}
// The approach a step uses now: its own tool, or one of its alternatives after a switch.
const approach = s => s.altIx >= 0 && s.alt && s.alt[s.altIx] ? s.alt[s.altIx] : s.tool;
// Records a step's result and returns the new mission. Success: done, or due again for a repeat. Failure: retry
// after a backoff, switch to the next approach every `switchEvery` tries, and block after `maxTries`, which hands
// the mission to Director 00 instead of giving up silently. Past the deadline the mission stops.
function missionApply(m, stepId, res, now, u) {
  const steps = m.steps.map(s => {
    if (s.id !== stepId) return s;
    const t = { ...s, at: now, out: String(res && (res.out || res.err) || "").slice(0, 240) };
    if (res && res.ok) {
      t.runs = s.runs + 1; t.tries = 0;
      if (s.repeat && t.runs < s.repeat.times) { t.status = "todo"; t.next = now + s.repeat.every; }
      else t.status = "done";
      return t;
    }
    t.tries = s.tries + 1;
    if (t.tries >= MISSION.maxTries) { t.status = "blocked"; return t; }
    if (t.tries % MISSION.switchEvery === 0 && s.alt && s.altIx + 1 < s.alt.length) t.altIx = s.altIx + 1;
    else if (t.tries % MISSION.switchEvery === 0 && s.altIx >= 0) t.altIx = -1;
    t.status = "retry"; t.next = now + backoff(t.tries, u);
    return t;
  });
  const next = { ...m, steps };
  const left = steps.filter(s => s.status !== "done");
  if (!left.length) next.status = "done";
  else if (now >= m.deadline) next.status = "stopped";
  else if (left.every(s => stuck(steps, s.id))) next.status = "blocked";
  return next;
}
// A step is stuck when it is blocked or waits, directly or through other steps, on a blocked step.
function stuck(steps, id, seen = new Set()) {
  if (seen.has(id)) return false;
  seen.add(id);
  const s = steps.find(x => x.id === id);
  return !!s && (s.status === "blocked" || (s.after || []).some(d => stuck(steps, d, seen)));
}
// A mission still active past its deadline stops; the PRIME loop calls this before it looks for the next step.
const missionExpire = (m, now) => m && m.status === "active" && now >= m.deadline ? { ...m, status: "stopped" } : m;
function missionProgress(m) {
  if (!m) return { done: 0, total: 0, pct: 0, runs: 0, planned: 0 };
  let runs = 0, planned = 0;
  for (const s of m.steps) { const n = s.repeat ? s.repeat.times : 1; planned += n; runs += Math.min(n, s.status === "done" ? n : s.runs); }
  return { done: m.steps.filter(s => s.status === "done").length, total: m.steps.length, pct: planned ? runs / planned : 0, runs, planned };
}
// Plans written by the local model come back as text; this pulls the first JSON object out and checks it.
function parseModelPlan(text) {
  const s = String(text || ""), i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return { ok: false, errors: ["no JSON object in the model's answer"], steps: [] };
  let obj;
  try { obj = JSON.parse(s.slice(i, j + 1)); } catch { return { ok: false, errors: ["the model's JSON does not parse"], steps: [] }; }
  return checkPlan(obj);
}

/* ================= 3. 3D maths for the core page ================= */
function rotate(p, yaw, pitch) {
  const [x, y, z] = p, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}
// Perspective projection: camera on the z axis at distance `dist`, focal length `f` in pixels.
function project(p, cam) {
  const [x, y, z] = rotate(p, cam.yaw, cam.pitch), d = cam.dist - z;
  if (d <= 1e-6) return { x: NaN, y: NaN, z, s: 0 };
  const s = cam.f / d;
  return { x: cam.cx + x * s, y: cam.cy - y * s, z, s };
}
// n points spread evenly on a sphere of radius r (golden-angle spiral).
function fibSphere(n, r) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), t = g * i; out.push([Math.cos(t) * rr * r, y * r, Math.sin(t) * rr * r]); }
  return out;
}
// n points on a circle of radius r, tilted by `tilt` about the x axis, starting at `phase`.
function ring(n, r, tilt = 0, phase = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = phase + (i / n) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r; out.push([x, -z * Math.sin(tilt), z * Math.cos(tilt)]); }
  return out;
}
const STAGES = [
  { id: "plan", en: "Plan", ar: "خطّط" }, { id: "act", en: "Act", ar: "نفّذ" }, { id: "observe", en: "Observe", ar: "راقب" },
  { id: "reflect", en: "Reflect", ar: "تأمّل" }, { id: "memory", en: "Remember", ar: "تذكّر" }, { id: "mission", en: "Mission", ar: "المهمة" }
];
const HELPERS = [
  ["scout", "Scout", "الكشاف"], ["analyst", "Technical analyst", "المحلل الفني"], ["quant", "Quant", "الكمّي"], ["sentinel", "Sentinel", "الحارس"], ["risk", "Risk officer", "ضابط المخاطر"],
  ["exec", "Paper executor", "المنفذ الورقي"], ["audit", "Auditor", "المدقق"], ["research", "Researcher", "الباحث"], ["ops", "Organizer", "المنظم"]
];
// Which stage each helper serves, for the links drawn on the core page.
const HELPER_STAGE = { scout: "observe", analyst: "observe", quant: "observe", sentinel: "observe", risk: "plan", exec: "act", audit: "reflect", research: "plan", ops: "reflect" };
function layout(ramGB = 16) {
  const nodes = [], edges = [];
  nodes.push({ id: "core", kind: "core", p: [0, 0, 0], r: 26, en: "PRIME lead", ar: "القائد" });
  ring(STAGES.length, 150, 0.35).forEach((p, i) => { const s = STAGES[i]; nodes.push({ id: s.id, kind: "stage", p, r: 12, en: s.en, ar: s.ar }); edges.push({ a: "core", b: s.id, kind: "runs" }); });
  STAGES.forEach((s, i) => { if (i < 5) edges.push({ a: s.id, b: STAGES[(i + 1) % 5].id, kind: "loop" }); });
  edges.push({ a: "plan", b: "mission", kind: "loop" }, { a: "mission", b: "act", kind: "loop" });
  ring(HELPERS.length, 240, -0.5, 0.3).forEach((p, i) => { const [id, en, ar] = HELPERS[i]; nodes.push({ id: "h-" + id, kind: "helper", p, r: 8, en, ar }); edges.push({ a: HELPER_STAGE[id], b: "h-" + id, kind: "serves" }); });
  nodes.push({ id: "llm", kind: "bridge", p: [0, 200, 0], r: 9, en: "Local model bridge (Ollama, optional)", ar: "جسر النموذج المحلي" });
  edges.push({ a: "plan", b: "llm", kind: "asks" });
  const pts = fibSphere(MODELS.length, 380);
  MODELS.forEach((m, i) => {
    const fit = localFit(m, ramGB).fit;
    nodes.push({ id: "m-" + m.id, kind: "model", sub: m.kind, p: pts[i], r: m.kind === "closed" ? 6 : 5 + Math.min(5, Math.log10(1 + (m.params || 1)) * 1.6), en: m.name, ar: m.maker, fit, ref: m.id });
    if (fit) edges.push({ a: "llm", b: "m-" + m.id, kind: "canRun" });
  });
  const belt = FRAMEWORKS.concat(TECHNIQUES.map(t => ({ ...t, isTech: true })));
  ring(belt.length, 300, 1.2, 0.1).forEach((p, i) => {
    const f = belt[i], id = (f.isTech ? "t-" : "f-") + f.id;
    nodes.push({ id, kind: f.isTech ? "technique" : "framework", p, r: 5, en: f.name, ar: f.isTech ? "arXiv " + f.arxiv : f.licence, ref: f.id });
    if (f.to) edges.push({ a: id, b: f.to === "lead" ? "core" : f.to, kind: "idea" });
  });
  return { nodes, edges };
}

export const OMEGA_CORE = Object.freeze({
  VERSION: "omega-core-v1", AS_OF, SRC, MODELS, FRAMEWORKS, TECHNIQUES, TECH_URL, TOOLS, TEMPLATES, STAGES, HELPERS, BREAKER, MISSION, MEM_CAP,
  localFit, topo, checkPlan, backoff, breakerNew, breakerAllow, breakerResult, words, overlap, memNew, remember, recall, reflect, rulesFor,
  missionNew, missionNext, missionApply, missionExpire, missionProgress, approach, parseModelPlan, rotate, project, fibSphere, ring, layout
});
