// OMEGA Cortex gateway: one OpenAI-compatible endpoint over Claude and the free LLM tiers.
//   POST /v1/chat/completions   Bearer OMEGA_GATEWAY_TOKEN. model = a route (omega/fast, omega/smart,
//                               omega/free-smart, claude) or a direct "provider:model".
//   GET  /v1/models             routes + every live provider:model
//   GET  /providers             live state of every provider (no secrets)
//   GET  /healthz
// Every attempt (never the prompt or the answer) is written to Timescale through PostgREST, and the
// adaptive routes re-rank themselves from that memory.
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Anthropic = require("@anthropic-ai/sdk");

const PORT = Number(process.env.PORT || 8090);
const TOKEN = process.env.OMEGA_GATEWAY_TOKEN || "";
const PGRST_URL = process.env.PGRST_URL || "http://postgrest:3000";
const JWT_SECRET = process.env.PGRST_JWT_SECRET || "";
const ALLOW_ANON = /^(1|true|yes)$/i.test(process.env.OMEGA_ALLOW_ANON_PROVIDERS || "");
const CLAUDE_EFFORT = process.env.CLAUDE_EFFORT || "";             // low|medium|high|xhigh|max; empty = model default
const TIMEOUT_MS = Number(process.env.OMEGA_LLM_TIMEOUT_MS || 90000);
const MAX_BODY = 1024 * 1024;
const MAX_ATTEMPTS = 6;
const REGISTRY_FILE = process.env.OMEGA_PROVIDERS_FILE || path.join(__dirname, "config", "providers.json");

if (require.main === module && TOKEN.length < 32) { console.error("OMEGA_GATEWAY_TOKEN missing or shorter than 32 chars"); process.exit(1); }

// ───────────────────────────── registry ─────────────────────────────
function loadRegistry(env = process.env) {
  const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  const providers = {};
  for (const [id, p] of Object.entries(raw.providers)) {
    const key = p.key ? env[p.key] || "" : "";
    const missing = (p.requires || []).filter(k => !env[k]);
    let reason = null;
    if (missing.length) reason = `set ${missing.join(", ")}`;
    else if (!key && !p.anonymous && !p.local) reason = `set ${p.key}`;
    else if (!key && p.anonymous && !ALLOW_ANON) reason = "anonymous: set OMEGA_ALLOW_ANON_PROVIDERS=true";
    const sub = v => (/^https?:\/\/[\w.:-]+(\/[\w./-]*)?$/.test(v) ? v : encodeURIComponent(v));   // whole URLs pass, ids are escaped
    const base = p.base ? p.base.replace(/\$\{(\w+)\}/g, (_, k) => sub(env[k] || "")) : null;
    const models = [...p.models];
    const pinned = p.model_env ? env[p.model_env] : "";          // e.g. CLAUDE_MODEL, OMEGA_LOCAL_MODEL
    if (pinned && !models.includes(pinned)) models.unshift(pinned);
    providers[id] = {
      id, label: p.label || id, kind: p.kind, base, key, models, rpm: p.rpm || 30, concurrency: p.concurrency || 8,
      timeoutMs: p.timeout_ms || TIMEOUT_MS, local: !!p.local,
      paid: !!p.paid, anonymous: !!p.anonymous && !key, trainsOnPrompts: !!p.trains_on_prompts,
      enabled: !reason, reason,
      defaultModel: pinned || models[0],
    };
  }
  const routes = {};
  for (const [name, r] of Object.entries(raw.routes)) {
    routes[name] = { name, adaptive: !!r.adaptive, chain: r.chain.map(ref => parseRef(ref, providers)).filter(Boolean) };
  }
  return { providers, routes };
}

function parseRef(ref, providers) {
  const i = ref.indexOf(":");
  if (i < 1) return null;
  const provider = ref.slice(0, i);
  let model = ref.slice(i + 1);
  const p = providers[provider];
  if (!p || !model) return null;
  if (model === "default") model = p.defaultModel;
  return { provider, model, ref: `${provider}:${model}` };
}

let REG = loadRegistry();

// ───────────────────────────── live provider state ─────────────────────────────
const live = {};          // provider -> { window: [ts], inflight, coolUntil, lastError, lastOkAt, lastLatency }
function lv(id) { return (live[id] ||= { window: [], inflight: 0, coolUntil: 0, lastError: null, lastOkAt: null, lastLatency: null }); }

function admit(p) {
  const s = lv(p.id), now = Date.now();
  if (s.coolUntil > now) return "cooling";
  while (s.window.length && s.window[0] < now - 60000) s.window.shift();
  if (s.window.length >= p.rpm) return "rpm";
  if (s.inflight >= p.concurrency) return "busy";
  s.window.push(now); s.inflight++;
  return null;
}

// How long to bench a provider after a failure, by class.
function coolFor(err) {
  if (err.retryAfterMs) return Math.min(err.retryAfterMs, 15 * 60e3);
  switch (err.kind) {
    case "rate_limited": return 60e3;
    case "auth": case "not_found": return 30 * 60e3;
    case "timeout": case "network": case "upstream": return 30e3;
    default: return 0;
  }
}

// ───────────────────────────── adaptive ranking from Timescale ─────────────────────────────
let perf = new Map();     // "provider:model" -> { calls, success_rate, p50_ms }
async function refreshPerf() {
  try {
    const r = await fetch(`${PGRST_URL}/llm_perf`, { signal: AbortSignal.timeout(4000), headers: { Accept: "application/json" } });
    if (!r.ok) return;
    const next = new Map();
    for (const row of await r.json()) next.set(`${row.provider}:${row.model}`, row);
    perf = next;
  } catch { /* memory core down: keep the last ranking */ }
}

// Lower is better. Untested entries keep their configured slot so new providers still get traffic.
function rank(route) {
  const chain = route.chain.map((c, i) => ({ ...c, i }));
  if (!route.adaptive || Math.random() < 0.1) return chain;          // 10% exploration in config order
  const score = c => {
    const m = perf.get(c.ref);
    if (!m || m.calls < 5 || m.p50_ms == null) return null;
    const sr = Math.max(Number(m.success_rate), 0.05);
    return Number(m.p50_ms) / (sr * sr);
  };
  const scored = chain.map(c => ({ c, s: score(c) }));
  const known = scored.filter(x => x.s != null).sort((a, b) => a.s - b.s).map(x => x.c);
  const slots = scored.map(x => (x.s != null ? known.shift() : x.c));
  return slots;
}

// ───────────────────────────── performance memory (batched to PostgREST) ─────────────────────────────
const queue = [];
function b64url(buf) { return Buffer.from(buf).toString("base64url"); }
function jwt() {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ role: "gateway_writer", exp: Math.floor(Date.now() / 1000) + 300 }));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
async function flush() {
  if (!queue.length || JWT_SECRET.length < 32) return;
  const rows = queue.splice(0, 500);
  try {
    const r = await fetch(`${PGRST_URL}/rpc/log_llm_calls`, {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt()}` },
      body: JSON.stringify({ rows }),
    });
    if (!r.ok) throw new Error(`postgrest ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.error("perf log failed:", e.message);
    if (queue.length < 5000) queue.unshift(...rows);                // keep for the next flush
  }
}

// ───────────────────────────── adapters ─────────────────────────────
class UpstreamError extends Error {
  constructor(kind, status, message, retryAfterMs) { super(message); this.kind = kind; this.status = status; this.retryAfterMs = retryAfterMs; }
}
function classify(status) {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "upstream";
  return "bad_request";
}
function retryAfter(h) { const v = Number(h); return Number.isFinite(v) && v > 0 ? v * 1000 : undefined; }

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter(b => b && b.type === "text").map(b => b.text).join("\n");
  return "";
}

async function callOpenAI(p, model, req) {
  const body = { model, messages: req.messages };
  for (const k of ["temperature", "top_p", "max_tokens", "stop", "seed", "response_format", "reasoning_effort"]) if (req[k] !== undefined) body[k] = req[k];
  if (body.max_tokens === undefined && req.max_completion_tokens !== undefined) body.max_tokens = req.max_completion_tokens;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (p.key) headers.Authorization = `Bearer ${p.key}`;
  if (p.id === "openrouter") { headers["HTTP-Referer"] = "http://localhost:8088"; headers["X-Title"] = "OMEGA Cortex"; }
  let r;
  try {
    r = await fetch(`${p.base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(p.timeoutMs) });
  } catch (e) {
    throw new UpstreamError(e.name === "TimeoutError" ? "timeout" : "network", null, e.message);
  }
  const text = await r.text();
  if (!r.ok) throw new UpstreamError(classify(r.status), r.status, text.slice(0, 300), retryAfter(r.headers.get("retry-after")));
  let j; try { j = JSON.parse(text); } catch { throw new UpstreamError("upstream", r.status, "non-JSON reply"); }
  const choice = j.choices && j.choices[0];
  const content = choice && choice.message ? textOf(choice.message.content) : "";
  if (!choice || (!content && choice.finish_reason !== "length")) throw new UpstreamError("empty", r.status, "empty completion");
  return {
    status: r.status, content, finish_reason: choice.finish_reason || "stop",
    usage: { prompt_tokens: j.usage?.prompt_tokens ?? null, completion_tokens: j.usage?.completion_tokens ?? null },
  };
}

const anthropicClients = new Map();
async function callAnthropic(p, model, req) {
  let client = anthropicClients.get(p.key);
  if (!client) { client = new Anthropic({ apiKey: p.key, maxRetries: 0, timeout: p.timeoutMs }); anthropicClients.set(p.key, client); }
  const system = req.messages.filter(m => m.role === "system" || m.role === "developer").map(m => textOf(m.content)).join("\n\n");
  const messages = [];
  for (const m of req.messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const t = textOf(m.content);
    if (!t) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + t; else messages.push({ role: m.role, content: t });
  }
  if (!messages.length || messages[0].role !== "user") throw new UpstreamError("bad_request", 400, "first message must be from the user");
  if (messages[messages.length - 1].role !== "user") throw new UpstreamError("bad_request", 400, "last message must be from the user");
  const params = {
    model,
    max_tokens: Math.min(Number(req.max_tokens ?? req.max_completion_tokens ?? 16000) || 16000, 64000),
    messages,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",                     // on a safety refusal the API re-runs on a fallback model
  };
  if (system) params.system = system;
  const effort = req.reasoning_effort || CLAUDE_EFFORT;
  if (["low", "medium", "high", "xhigh", "max"].includes(effort)) params.output_config = { effort };
  let msg;
  try {
    msg = await client.beta.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new UpstreamError("rate_limited", 429, e.message, retryAfter(e.headers?.get?.("retry-after")));
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new UpstreamError("timeout", null, e.message);
    if (e instanceof Anthropic.APIConnectionError) throw new UpstreamError("network", null, e.message);
    if (e instanceof Anthropic.APIError) throw new UpstreamError(classify(e.status), e.status, String(e.message).slice(0, 300));
    throw e;
  }
  const content = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
  const finish = { end_turn: "stop", stop_sequence: "stop", max_tokens: "length", refusal: "content_filter" }[msg.stop_reason] || msg.stop_reason;
  if (msg.stop_reason === "refusal") throw new UpstreamError("refused", 200, "declined by every model in the fallback chain");
  return {
    status: 200, content, finish_reason: finish, servedBy: msg.model,
    usage: {
      prompt_tokens: (msg.usage.input_tokens || 0) + (msg.usage.cache_read_input_tokens || 0) + (msg.usage.cache_creation_input_tokens || 0),
      completion_tokens: msg.usage.output_tokens ?? null,
    },
  };
}

const ADAPTERS = { openai: callOpenAI, anthropic: callAnthropic };

// ───────────────────────────── routing ─────────────────────────────
function resolve(modelField) {
  const name = modelField || "omega/fast";
  if (name === "auto") return REG.routes["omega/fast"];
  if (REG.routes[name]) return REG.routes[name];
  const ref = parseRef(name, REG.providers);
  if (ref) return { name: "direct", adaptive: false, chain: [ref] };
  return null;
}

async function complete(req) {
  const route = resolve(req.model);
  if (!route) throw Object.assign(new Error(`unknown model "${req.model}". Use a route (${Object.keys(REG.routes).join(", ")}) or provider:model.`), { http: 404 });
  const requestId = crypto.randomUUID();
  const attempts = [];
  const t0 = Date.now();
  for (const c of rank(route)) {
    if (attempts.filter(a => a.called).length >= MAX_ATTEMPTS) break;
    const p = REG.providers[c.provider];
    if (!p.enabled) { attempts.push({ provider: c.provider, model: c.model, skipped: p.reason }); continue; }
    const why = admit(p);
    if (why) { attempts.push({ provider: c.provider, model: c.model, skipped: why }); continue; }
    const s = lv(p.id), started = Date.now();
    const row = { ts: new Date(started).toISOString(), request_id: requestId, attempt: attempts.length + 1, route: route.name, provider: p.id, model: c.model };
    try {
      const out = await ADAPTERS[p.kind](p, c.model, req);
      const latency = Date.now() - started;
      s.lastOkAt = new Date().toISOString(); s.lastLatency = latency; s.lastError = null;
      queue.push({ ...row, ok: true, http_status: out.status, latency_ms: latency, ...out.usage, finish_reason: out.finish_reason });
      attempts.push({ provider: p.id, model: c.model, called: true, ok: true, latency_ms: latency });
      return {
        id: `chatcmpl-${requestId}`, object: "chat.completion", created: Math.floor(Date.now() / 1000),
        model: `${p.id}:${out.servedBy || c.model}`,
        choices: [{ index: 0, message: { role: "assistant", content: out.content }, finish_reason: out.finish_reason }],
        usage: { ...out.usage, total_tokens: (out.usage.prompt_tokens || 0) + (out.usage.completion_tokens || 0) },
        omega: { request_id: requestId, route: route.name, provider: p.id, provider_label: p.label, latency_ms: Date.now() - t0, attempts },
      };
    } catch (e) {
      const latency = Date.now() - started;
      const kind = e instanceof UpstreamError ? e.kind : "internal";
      let cool = e instanceof UpstreamError ? coolFor(e) : 0;
      if (p.local) cool = Math.min(cool, 30e3);              // a local model may still be downloading: retry soon
      if (cool) s.coolUntil = Date.now() + cool;
      s.lastError = { kind, status: e.status ?? null, at: new Date().toISOString() };
      queue.push({ ...row, ok: false, http_status: e.status ?? null, error: kind, latency_ms: latency });
      attempts.push({ provider: p.id, model: c.model, called: true, ok: false, error: kind, status: e.status ?? null, latency_ms: latency });
      console.warn(`[${requestId.slice(0, 8)}] ${p.id}:${c.model} ${kind} ${e.status ?? ""} ${String(e.message).slice(0, 160)}`);
      if (route.name === "direct" && kind === "bad_request") throw Object.assign(new Error(e.message), { http: 400, attempts });
    } finally {
      s.inflight--;
    }
  }
  throw Object.assign(new Error("no provider in the chain could answer"), { http: 503, attempts, request_id: requestId });
}

// ───────────────────────────── validation ─────────────────────────────
function validate(b) {
  if (!b || typeof b !== "object") return "body must be a JSON object";
  if (b.stream) return "stream=true is not supported yet; send a normal request";
  if (b.model !== undefined && (typeof b.model !== "string" || b.model.length > 200)) return "model must be a string";
  if (!Array.isArray(b.messages) || !b.messages.length || b.messages.length > 200) return "messages must be a non-empty array (max 200)";
  for (const m of b.messages) {
    if (!m || !["system", "developer", "user", "assistant"].includes(m.role)) return "each message needs role system|developer|user|assistant";
    if (typeof m.content !== "string" && !Array.isArray(m.content)) return "message content must be a string or an array of text parts";
  }
  return null;
}

// ───────────────────────────── http ─────────────────────────────
const SEC = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
function send(res, code, body) { res.writeHead(code, { ...SEC, "Content-Type": "application/json" }); res.end(JSON.stringify(body)); }
function authorised(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const a = crypto.createHash("sha256").update(m ? m[1] : "").digest(), b = crypto.createHash("sha256").update(TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}
function providerView() {
  return Object.values(REG.providers).map(p => {
    const s = lv(p.id), m = p.models.map(x => perf.get(`${p.id}:${x}`)).filter(Boolean);
    const calls = m.reduce((a, x) => a + Number(x.calls), 0);
    return {
      id: p.id, label: p.label, enabled: p.enabled, reason: p.reason, paid: p.paid, anonymous: p.anonymous, local: p.local,
      trains_on_prompts: p.trainsOnPrompts, models: p.models,
      state: !p.enabled ? "off" : s.coolUntil > Date.now() ? "cooling" : s.lastError && !s.lastOkAt ? "degraded" : "ok",
      cooling_until: s.coolUntil > Date.now() ? new Date(s.coolUntil).toISOString() : null,
      last_error: s.lastError, last_ok_at: s.lastOkAt, last_latency_ms: s.lastLatency,
      calls_24h: calls,
      success_24h: calls ? Math.round(m.reduce((a, x) => a + Number(x.success_rate) * Number(x.calls), 0) / calls * 1000) / 1000 : null,
    };
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://gateway");
  if (req.method === "GET") {
    if (url.pathname === "/healthz") return send(res, 200, { status: "ok", live: Object.values(REG.providers).filter(p => p.enabled).length });
    if (url.pathname === "/providers") return send(res, 200, { providers: providerView(), routes: Object.values(REG.routes).map(r => ({ name: r.name, adaptive: r.adaptive, chain: r.chain.map(c => c.ref) })) });
    if (url.pathname === "/v1/models") {
      if (!authorised(req)) return send(res, 401, { error: { message: "unauthorised" } });
      const data = [...Object.keys(REG.routes).map(id => ({ id, object: "model", owned_by: "omega" })),
        ...Object.values(REG.providers).filter(p => p.enabled).flatMap(p => p.models.map(m => ({ id: `${p.id}:${m}`, object: "model", owned_by: p.id })))];
      return send(res, 200, { object: "list", data });
    }
    return send(res, 404, { error: { message: "not found" } });
  }
  if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") return send(res, 404, { error: { message: "not found" } });
  if (!authorised(req)) return send(res, 401, { error: { message: "unauthorised" } });
  let size = 0; const chunks = [];
  req.on("data", c => { size += c.length; if (size > MAX_BODY) { send(res, 413, { error: { message: "too large" } }); req.destroy(); } else chunks.push(c); });
  req.on("end", async () => {
    if (res.writableEnded) return;
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
    const bad = validate(body);
    if (bad) return send(res, 400, { error: { message: bad, type: "invalid_request_error" } });
    try { send(res, 200, await complete(body)); }
    catch (e) {
      send(res, e.http || 500, { error: { message: e.message, type: e.http === 503 ? "no_provider_available" : "invalid_request_error" }, omega: { request_id: e.request_id, attempts: e.attempts || [] } });
    }
  });
});

if (require.main === module) {
  setInterval(flush, 2000).unref();
  setInterval(refreshPerf, 60000).unref();
  refreshPerf();
  process.on("SIGHUP", () => { try { REG = loadRegistry(); console.log("registry reloaded"); } catch (e) { console.error("registry reload failed:", e.message); } });
  server.listen(PORT, () => {
    const on = Object.values(REG.providers).filter(p => p.enabled).map(p => p.id);
    console.log(`omega cortex on :${PORT} · live providers: ${on.join(", ") || "none (add keys to .env)"}`);
    if (JWT_SECRET.length < 32) console.warn("PGRST_JWT_SECRET missing: performance memory is OFF");
  });
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, async () => { await flush(); server.close(() => process.exit(0)); });
}

module.exports = { loadRegistry, rank, validate, complete, server, _setRegistry: r => { REG = r; }, _setPerf: p => { perf = p; }, _queue: queue, _flush: flush };
