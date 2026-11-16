// ADR-168: impact analysis. Three deterministic checks over facts this repository already holds:
//   catalog  one model name against the open-weight catalog (ADR-167): which family it is, what its documented
//            licence allows for personal use or for serving it to others, and, when the person types the bits per
//            weight, the memory its weights take (parameters x bits / 8 / 10^9 GB, the weights only). A name that
//            does not say which size or version is not guessed. Running the model stays a locked approval.
//   blast    one skill: what it loads (Kahn's layers from ADR-163, a cycle named), what loads it (a reverse
//            breadth-first search), the pages and engines that would need testing again, each skill's real test
//            command, and the project documents that match it (ADR-164, BM25 and RRF).
//   diff     two texts or plans line by line by longest common subsequence, with SHA-256 of each text, of the
//            difference and of the chain that binds them.
// Nothing is ranked, measured or guessed. Pure: no network, no process, no file; nothing is sent or installed.
// The same answers come from .claude/skills/replica-impact-analysis/impact_analysis.py (tests/golden.json).
import { sha256Hex } from "./snapshot.mjs";
import { skillOrder } from "./plan-order.mjs";
import { searchProject } from "./project-search.mjs";

export const IA_MODES = ["catalog", "blast", "diff"];
export const IA_USES = ["personal", "service"];
// The page each engine serves; a skill on this list changes that page when it changes.
export const IA_PAGES = [
  { skill: "replica-architect-studio", route: "#/architect", engine: "architect-studio" },
  { skill: "replica-release-gate", route: "#/release", engine: "release-gate" },
  { skill: "replica-impact-analysis", route: "#/impact", engine: "impact-analysis" },
  { skill: "replica-runbook", route: "#/runbook", engine: "runbook" },
  { skill: "replica-project-search", route: "#/docs", engine: "project-search" },
  { skill: "replica-plan-order", route: "#/order", engine: "plan-order" },
  { skill: "replica-skill-tree", route: "#/tree", engine: "skill-tree" },
  { skill: "replica-polymath-engine", route: "#/polymath", engine: "polymath-engine" },
  { skill: "replica-unified-workbench", route: "#/workbench", engine: "unified-workbench" },
  { skill: "replica-universal-agent", route: "#/universal", engine: "universal-agent" },
  { skill: "replica-foss-atlas", route: "#/atlas", engine: "foss-atlas" },
  { skill: "replica-universal-math", route: "#/math", engine: "universal-math" },
  { skill: "replica-hyper-studio", route: "#/hyper", engine: "hyper-studio" },
];
export const IA_SHARED_TESTS = ["node jarvis/server/test/test-server.mjs", "node jarvis/scripts/test-app.mjs"];
export const IA_MUTATION = "node jarvis/scripts/mutation-harness.mjs && python3 jarvis/scripts/mutation_harness.py";
export const IA_MAX_LINES = 500;
export class ImpactError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const iaFail = (m, d) => { throw new ImpactError(m, d); };

// The catalog as plain data: each family's pattern as its source text, read case-insensitively.
export function catalogJson(profiles) {
  return profiles.map(p => ({ family: p.family, match: p.match.source, maker: p.maker, origin: p.origin, licence: p.licence, role: p.role, params: p.params, card: p.card, created: p.created, read: p.read, terms: p.terms ?? null, config: p.config }));
}

// What a documented licence allows. ADR-171: a licence whose terms were read in full (terms) says so directly: serving
// the model to others needs a licence always, or only above the stated revenue. Otherwise the rule reads the licence
// text in the catalog, and a note in brackets is kept as written.
export function licenceRule(licence, use, terms) {
  if (terms && typeof terms === "object" && !Array.isArray(terms)) return { verdict: use !== "service" ? "allowed" : terms.when === "always" ? "commercial_licence" : "revenue_threshold", note: null };
  const open = licence.indexOf("("), close = licence.lastIndexOf(")"), note = open >= 0 && close > open ? licence.slice(open + 1, close) : null;
  if (/Non-Production/.test(licence)) return { verdict: use === "service" ? "not_allowed" : "non_production", note };
  if (/Model-as-a-Service/.test(licence)) return { verdict: use === "service" ? "commercial_licence" : "allowed_note", note };
  if (/^(MIT|Apache 2\.0)$/.test(licence)) return { verdict: "allowed", note: null };
  if (/^(MIT|Apache 2\.0) \(/.test(licence)) return { verdict: "allowed_note", note };
  return { verdict: "read_licence", note };
}

// The weights' memory: parameters x bits / 8 bytes, in GB of 10^9 bytes, to two decimals. Cache and runtime are not counted.
export function weightsGb(params, bits) {
  return Math.round(params * bits / 8 / 1e9 * 100) / 100;
}

// ADR-171: the context (KV cache) memory, in GB of 10^9 bytes, to two decimals. Uniform attention only:
//   gqa  2 x layers x kv_heads x head_dim values per token (a key and a value per head and layer)
//   mla  layers x (kv_lora_rank + qk_rope_head_dim) values per token (the compressed latent and the rope key)
// times tokens x batch x kv_bits / 8 bytes. Runtime buffers and the weights are not counted here.
// ADR-172: hybrid_sliding counts 2 x kv_heads x head_dim values for each cached token of each layer: a full layer keeps
// every token, a sliding layer at most its window, so the values are 2 x kv_heads x head_dim x (full_layers x tokens +
// sliding_layers x min(tokens, sliding_window)). That product is a whole number below 2^53, so both languages hold it exactly.
export function kvCacheGb(c, tokens, batch, kvBits) {
  if (c.attention === "hybrid_sliding") return Math.round(2 * c.kv_heads * c.head_dim * (c.full_layers * tokens + c.sliding_layers * Math.min(tokens, c.sliding_window)) * batch * kvBits / 8 / 1e9 * 100) / 100;
  const perToken = c.attention === "mla" ? c.layers * (c.kv_lora_rank + c.qk_rope_head_dim) : 2 * c.layers * c.kv_heads * c.head_dim;
  return Math.round(perToken * tokens * batch * kvBits / 8 / 1e9 * 100) / 100;
}

// The context check for one card. The memory is estimated only for the card the config was read from, with uniform
// attention and bits to count by; otherwise the basis says why. The longest documented context is checked whenever known.
export function contextMemory(f, sameCard, tokens, batch, kvBits, weights, memoryGb) {
  const c = f.config && typeof f.config === "object" ? f.config : null;
  const basis = !sameCard ? "other_card" : !c || c.attention === "not_read" ? "not_read" : c.attention === "not_estimated" ? "not_estimated" : kvBits === null ? "no_bits" : "card";
  const max = sameCard && c ? c.max_context : null;
  const kv = basis === "card" ? kvCacheGb(c, tokens, batch, kvBits) : null;
  const total = kv !== null && weights !== null ? Math.round((weights + kv) * 100) / 100 : null;
  return { tokens, batch_size: batch, kv_bits: kvBits, max_context: max, exceeds: max === null ? null : tokens > max, basis, reason: c && basis === "not_estimated" ? c.reason : basis === "not_read" && c ? c.reason : null,
    blocking: basis === "not_estimated" ? c.blocking ?? null : null, sliding_window: basis === "card" ? c.sliding_window ?? null : null,
    attention: c ? c.attention : null, kv_gb: kv, total_gb: total, fits: total === null || memoryGb === null ? null : total <= memoryGb };
}

// ADR-172: where the model can run. The memory typed is the laptop's; the total is the weights and the context
// memory (ADR-171). Equal fits. With no total (no context asked, or a memory not estimated) nothing is decided.
// Running it on a site of your own is personal use while only you use it, and serving it to others once others do.
export function offloadRoute(context, memoryGb, f) {
  const total = context ? context.total_gb : null;
  const verdict = total === null ? "undecided" : total <= memoryGb ? "local" : "web_offload";
  return { laptop_gb: memoryGb, total_gb: total, verdict, reason: total !== null ? null : context ? "memory_not_estimated" : "no_context",
    margin_gb: verdict === "local" ? Math.round((memoryGb - total) * 100) / 100 : null, shortfall_gb: verdict === "web_offload" ? Math.round((total - memoryGb) * 100) / 100 : null,
    own_use: licenceRule(f.licence, "personal", f.terms).verdict, others_use: licenceRule(f.licence, "service", f.terms).verdict };
}

function checkCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 200) iaFail("Send the model catalog.", "catalog");
  return catalog.map((p, i) => {
    if (!p || typeof p.family !== "string" || typeof p.match !== "string" || typeof p.licence !== "string" || !(p.params === null || Number.isInteger(p.params))) iaFail("Each family has a name, a pattern, a licence and a parameter count or null.", "catalog[" + i + "]");
    return { ...p, re: new RegExp(p.match, "i") };
  });
}

export function checkModel(r, catalog) {
  const fams = checkCatalog(catalog);
  const model = typeof r.model === "string" && r.model.trim() && r.model.length <= 120 ? r.model.trim() : iaFail("The model name is text of 1 to 120 characters.", "model");
  const use = IA_USES.includes(r.use) ? r.use : iaFail("The use is personal or service.", "use");
  const bits = r.bits === undefined ? null : Number.isInteger(r.bits) && r.bits >= 1 && r.bits <= 32 ? r.bits : iaFail("Bits per weight is a whole number from 1 to 32.", "bits");
  const memoryGb = r.memory_gb === undefined ? null : typeof r.memory_gb === "number" && Number.isFinite(r.memory_gb) && r.memory_gb > 0 && r.memory_gb <= 100000 ? r.memory_gb : iaFail("The memory is a number of GB above 0 and at most 100000.", "memory_gb");
  const tokens = r.context_tokens === undefined ? null : Number.isInteger(r.context_tokens) && r.context_tokens >= 1 && r.context_tokens <= 100000000 ? r.context_tokens : iaFail("The context is a whole number of tokens from 1 to 100000000.", "context_tokens");
  const batch = r.batch_size === undefined ? 1 : Number.isInteger(r.batch_size) && r.batch_size >= 1 && r.batch_size <= 4096 ? r.batch_size : iaFail("The batch size is a whole number from 1 to 4096.", "batch_size");
  const kvBits = r.kv_bits === undefined ? bits : Number.isInteger(r.kv_bits) && r.kv_bits >= 1 && r.kv_bits <= 32 ? r.kv_bits : iaFail("Bits per cache value is a whole number from 1 to 32.", "kv_bits");
  const out = { mode: "catalog", model, use, bits, memory_gb: memoryGb };
  const f = fams.find(p => p.re.test(model));
  if (!f) {
    const base = model.slice(model.lastIndexOf("/") + 1).split(":")[0].toLowerCase();
    const candidates = base.length >= 2 ? fams.filter(p => p.family.startsWith(base + "-")).map(p => ({ family: p.family, licence: p.licence })) : [];
    return { ...out, found: false, verdict: candidates.length ? "size_unnamed" : "unknown", note: null, family: null, candidates, memory: null, context: null, offload: null, steps: [], sent: false };
  }
  const rule = licenceRule(f.licence, use, f.terms);
  // A family's parameter count belongs to the one card it was read from; another size of the family is not guessed.
  const name = model.toLowerCase(), sameCard = name === f.card.toLowerCase() || name === f.card.slice(f.card.indexOf("/") + 1).toLowerCase();
  const memory = bits === null ? null : f.params === null
    ? { basis: "no_count", params: null, bits, weights_gb: null, fits: null }
    : !sameCard ? { basis: "other_card", params: null, bits, weights_gb: null, fits: null }
      : { basis: "card", params: f.params, bits, weights_gb: weightsGb(f.params, bits), fits: memoryGb === null ? null : weightsGb(f.params, bits) <= memoryGb };
  const context = tokens === null ? null : contextMemory(f, sameCard, tokens, batch, kvBits, memory && memory.weights_gb, memoryGb);
  const offload = memoryGb === null ? null : offloadRoute(context, memoryGb, f);
  const steps = [{ action: "install", target: f.family, gate: "approval", locked: true, status: "pending_approval" }];
  if (offload && offload.verdict === "web_offload") steps.push({ action: "publish", target: "web host", gate: "approval", locked: true, status: "pending_approval" });
  return { ...out, found: true, verdict: rule.verdict, note: rule.note,
    family: { family: f.family, maker: f.maker, origin: f.origin, licence: f.licence, role: f.role, params: f.params, card: f.card, created: f.created, read: f.read, terms: f.terms ?? null },
    candidates: [], memory, context, offload, steps, sent: false };
}

// The skills that load a skill, nearest first: a breadth-first search over the dependency snapshot read backwards.
export function dependentsOf(deps, skill) {
  const names = Object.keys(deps).sort(), rev = new Map(names.map(n => [n, []]));
  for (const n of names) for (const m of Array.isArray(deps[n]) ? deps[n] : []) if (rev.has(m)) rev.get(m).push(n);
  const depth = new Map([[skill, 0]]), queue = [skill];
  while (queue.length) {
    const n = queue.shift();
    for (const m of rev.get(n) || []) if (!depth.has(m)) { depth.set(m, depth.get(n) + 1); queue.push(m); }
  }
  return [...depth].filter(([n]) => n !== skill).map(([name, d]) => ({ name, depth: d })).sort((a, b) => a.depth - b.depth || (a.name < b.name ? -1 : 1));
}

export function blastRadius(r, ctx) {
  const deps = ctx.deps && typeof ctx.deps === "object" && !Array.isArray(ctx.deps) ? ctx.deps : iaFail("Send the dependency snapshot.", "deps");
  const skill = typeof r.skill === "string" && Object.hasOwn(deps, r.skill) ? r.skill : iaFail("That skill is not in the snapshot.", typeof r.skill === "string" ? r.skill : "skill");
  // Project search checks the query itself (text of 1 to 300 characters).
  const query = r.query === undefined ? skill : r.query;
  const up = skillOrder(deps, [skill]);
  const dependents = dependentsOf(deps, skill);
  const touched = [skill, ...dependents.map(d => d.name)];
  const facts = new Map((Array.isArray(ctx.tree?.skills) ? ctx.tree.skills : []).filter(s => s && typeof s.name === "string").map(s => [s.name, s]));
  const pages = IA_PAGES.filter(p => touched.includes(p.skill));
  const tests = touched.map(n => ({ skill: n, command: facts.get(n)?.tests ? "python3 -m unittest discover -s .claude/skills/" + n + "/tests" : null }));
  const shared = pages.length ? [...IA_SHARED_TESTS, ...(touched.some(n => facts.get(n)?.mutation) ? [IA_MUTATION] : [])] : [];
  const s = searchProject(ctx.corpus ?? { docs: [] }, { query, limit: 5 });
  return { mode: "blast", skill, query, upstream: { layers: up.layers, added: up.added, cycle: up.cycle, verified: up.verified }, dependents, pages, tests, shared_tests: shared,
    docs: { found: s.found, top: s.results.map(x => ({ id: x.id, kind: x.kind, title: x.title, score: x.score })) }, sent: false };
}

function lines(text, name) {
  if (typeof text !== "string" || text.length > 20000 || !text.isWellFormed()) iaFail("Each text is well-formed text of at most 20000 characters.", name);
  const out = text.split(/\r?\n/);
  return out.length <= IA_MAX_LINES ? out : iaFail("Each text has at most " + IA_MAX_LINES + " lines.", name);
}

// Longest common subsequence, line by line: equal lines are kept, then a line only in a is removed before a
// line only in b is added when both choices keep the same length.
export function lcsDiff(a, b) {
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push({ op: "=", a: i + 1, b: j + 1, text: a[i] }); i++; j++; }
    else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) { out.push({ op: "-", a: i + 1, b: null, text: a[i] }); i++; }
    else { out.push({ op: "+", a: null, b: j + 1, text: b[j] }); j++; }
  }
  return out;
}

export function diffTexts(r) {
  const ops = lcsDiff(lines(r.a, "a"), lines(r.b, "b"));
  const hashes = [sha256Hex(r.a), sha256Hex(r.b), sha256Hex(JSON.stringify(ops))];
  return { mode: "diff", counts: { same: ops.filter(x => x.op === "=").length, removed: ops.filter(x => x.op === "-").length, added: ops.filter(x => x.op === "+").length }, lines: ops,
    a_sha256: hashes[0], b_sha256: hashes[1], diff_sha256: hashes[2], chain_sha256: hashes.reduce((h, x) => sha256Hex(h + x), "0".repeat(64)), sent: false };
}

export function impactAnalysis(req, ctx) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : iaFail("Send an object with a mode.", "");
  const c = ctx ?? {};
  if (r.mode === "catalog") return checkModel(r, c.catalog);
  if (r.mode === "blast") return blastRadius(r, c);
  if (r.mode === "diff") return diffTexts(r);
  return iaFail("The mode is catalog, blast or diff.", "mode");
}
