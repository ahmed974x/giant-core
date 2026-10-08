// OMEGA relay: the single doorway between the Sentinel back end and the Neural Constellation.
// Zero dependencies.
//   POST /ingest/pulse     n8n → "a minute of market memory was stored"   (token required)
//   POST /ingest/anomaly   n8n → one detected anomaly                     (token required)
//   GET  /events           SSE fan-out: hello, pulse, anomaly, status
//   GET  /api/<view>       read-only proxy to PostgREST (allowlisted views)
//   GET  /llm/providers    live state of the Cortex LLM gateway's providers
//   POST /llm/chat         same-origin only: the dashboard's console → Cortex (token added here)
//   GET  /status           health of every node in the constellation
//   GET  /                 the dashboard
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const crypto = require("node:crypto");

const PORT = 8080;
const TOKEN = process.env.OMEGA_RELAY_TOKEN || "";
const N8N_HEALTH = process.env.N8N_HEALTH_URL || "http://n8n:5678/healthz";
const PGRST_URL = process.env.PGRST_URL || "http://postgrest:3000";
const PGRST_ADMIN = process.env.PGRST_ADMIN_URL || "http://postgrest:3001";
const CORTEX_URL = process.env.CORTEX_URL || "http://cortex:8090";
const GATEWAY_TOKEN = process.env.OMEGA_GATEWAY_TOKEN || "";
const SYMBOLS = new Set((process.env.OMEGA_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT").split(",").map(s => s.trim()).filter(Boolean));
const DASHBOARD = "/srv/dashboard/index.html";
const API_VIEWS = new Set(["latest", "candles", "candles_5m", "anomalies", "llm_perf", "llm_perf_1h", "llm_calls"]);
const MAX_BODY = 8192;
const MAX_CHAT_BODY = 64 * 1024;
const CHAT_ROUTES = new Set(["omega/fast", "omega/smart", "omega/free-smart", "omega/local", "claude"]);
const KEEP = 50;
const STATUS_EVERY_MS = 15000;

if (TOKEN.length < 32) { console.error("OMEGA_RELAY_TOKEN missing or shorter than 32 chars"); process.exit(1); }
const tokenHash = crypto.createHash("sha256").update(TOKEN).digest();

const recent = [];          // last anomalies
let lastPulse = null;
let lastStatus = { relay: "ok", n8n: "unknown", postgrest: "unknown", timescale: "unknown", cortex: "unknown", checkedAt: null };
const clients = new Set();

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { ...SEC_HEADERS, "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function authorised(req) {
  const given = crypto.createHash("sha256").update(String(req.headers["x-omega-token"] || "")).digest();
  return crypto.timingSafeEqual(given, tokenHash);
}

// ── Strict schemas: anything else is rejected, so nothing untrusted reaches the browser. ──
const num = v => typeof v === "number" && Number.isFinite(v);
const numOrNull = v => v === null || v === undefined || num(v);
const isoOk = v => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const round = (v, d) => (num(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function validatePulse(p) {
  if (!p || !Array.isArray(p.symbols) || p.symbols.length > 50) return null;
  const symbols = [];
  for (const s of p.symbols) {
    if (!s || !SYMBOLS.has(s.symbol) || !num(s.close) || !isoOk(s.ts)) return null;
    symbols.push({ symbol: s.symbol, close: s.close, ts: new Date(s.ts).toISOString() });
  }
  if (!num(p.stored) || !num(p.anomalies)) return null;
  return { symbols, stored: Math.trunc(p.stored), anomalies: Math.trunc(p.anomalies), at: new Date().toISOString() };
}

const KINDS = new Set(["price_shock", "volume_spike", "drawdown_1h"]);
function validateAnomaly(a) {
  if (!a || typeof a !== "object") return null;
  if (!Number.isInteger(Number(a.id)) || !SYMBOLS.has(a.symbol) || !KINDS.has(a.kind)) return null;
  if (!["watch", "high"].includes(a.severity) || !isoOk(a.ts)) return null;
  if (!num(a.price) || !num(a.value) || !numOrNull(a.baseline) || !numOrNull(a.zscore)) return null;
  if (typeof a.reason !== "string" || a.reason.length > 200) return null;
  return {
    id: Number(a.id), ts: new Date(a.ts).toISOString(), symbol: a.symbol, kind: a.kind, severity: a.severity,
    price: a.price, value: round(a.value, 6), baseline: round(a.baseline, 6), zscore: round(a.zscore, 2),
    reason: a.reason, at: new Date().toISOString(),
  };
}

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(frame);
}

function readJson(req, res, cb, limit = MAX_BODY) {
  let size = 0; const chunks = [];
  req.on("data", c => { size += c.length; if (size > limit) { send(res, 413, { error: "too large" }); req.destroy(); } else chunks.push(c); });
  req.on("end", () => {
    if (res.writableEnded) return;
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
    cb(body);
  });
}

// ── Health of every node, pushed to the constellation ──
async function probe(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); return r.ok ? "ok" : "degraded"; }
  catch { return "down"; }
}
async function refreshStatus() {
  const [n8n, postgrest, cortex] = await Promise.all([probe(N8N_HEALTH), probe(PGRST_ADMIN + "/live"), probe(CORTEX_URL + "/healthz")]);
  // PostgREST's /ready is 200 only while its DB pool is connected: that is our Timescale signal.
  const timescale = postgrest === "down" ? "unknown" : await probe(PGRST_ADMIN + "/ready");
  const next = { relay: "ok", n8n, postgrest, timescale, cortex, checkedAt: new Date().toISOString() };
  const changed = ["n8n", "postgrest", "timescale", "cortex"].some(k => next[k] !== lastStatus[k]);
  lastStatus = next;
  if (changed) broadcast("status", lastStatus);
}
setInterval(refreshStatus, STATUS_EVERY_MS).unref();
refreshStatus();

// The console posts here. A cross-site page cannot: it would need a JSON content type (preflight,
// which we never answer) and our own Origin. The gateway token never reaches the browser.
function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || o === `http://${req.headers.host}`;
}
function chat(req, res) {
  if (!GATEWAY_TOKEN) return send(res, 503, { error: "cortex not configured" });
  if (!sameOrigin(req) || !/^application\/json\b/.test(req.headers["content-type"] || "")) return send(res, 403, { error: "forbidden" });
  return readJson(req, res, body => {
    const model = body && body.route;
    if (!CHAT_ROUTES.has(model) || !Array.isArray(body.messages) || body.messages.length > 40) return send(res, 400, { error: "invalid chat" });
    const messages = [];
    for (const m of body.messages) {
      if (!m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 16000) return send(res, 400, { error: "invalid message" });
      messages.push({ role: m.role, content: m.content });
    }
    fetch(`${CORTEX_URL}/v1/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(180000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GATEWAY_TOKEN}` },
      body: JSON.stringify({ model, messages, max_tokens: 4096 }),
    })
      .then(async r => {
        const j = await r.json().catch(() => ({}));
        const o = j.omega || {};
        broadcast("cortex", { ok: r.ok, route: model, provider: o.provider || null, latency_ms: o.latency_ms ?? null,
          tokens: j.usage ? j.usage.total_tokens : null, attempts: (o.attempts || []).filter(a => a.called).map(a => ({ provider: a.provider, ok: !!a.ok })) });
        send(res, r.status, j);
      })
      .catch(() => send(res, 503, { error: "cortex unreachable" }));
  }, MAX_CHAT_BODY);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://relay");

  if (req.method === "POST" && url.pathname === "/llm/chat") return chat(req, res);

  if (req.method === "POST" && url.pathname.startsWith("/ingest/")) {
    if (!authorised(req)) return send(res, 401, { error: "unauthorised" });
    const kind = url.pathname.slice("/ingest/".length);
    if (kind !== "pulse" && kind !== "anomaly") return send(res, 404, { error: "not found" });
    return readJson(req, res, body => {
      if (kind === "pulse") {
        const pulse = validatePulse(body);
        if (!pulse) return send(res, 400, { error: "invalid pulse" });
        lastPulse = pulse;
        broadcast("pulse", pulse);
        return send(res, 202, { ok: true, listeners: clients.size });
      }
      const a = validateAnomaly(body);
      if (!a) return send(res, 400, { error: "invalid anomaly" });
      if (!recent.some(r => r.id === a.id)) { recent.push(a); if (recent.length > KEEP) recent.shift(); }
      broadcast("anomaly", a);
      console.log(`ANOMALY ${a.symbol} ${a.kind} ${a.severity}: ${a.reason}`);
      return send(res, 202, { ok: true, id: a.id, listeners: clients.size });
    });
  }

  if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });

  if (url.pathname.startsWith("/api/")) {
    const view = url.pathname.slice(5);
    if (!API_VIEWS.has(view)) return send(res, 404, { error: "unknown view" });
    return fetch(`${PGRST_URL}/${view}${url.search}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } })
      .then(async r => send(res, r.status, await r.text()))
      .catch(() => send(res, 503, { error: "memory core unreachable" }));
  }

  if (url.pathname === "/llm/providers") {
    return fetch(`${CORTEX_URL}/providers`, { signal: AbortSignal.timeout(4000) })
      .then(async r => send(res, r.status, await r.text()))
      .catch(() => send(res, 503, { error: "cortex unreachable" }));
  }

  switch (url.pathname) {
    case "/events": {
      res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "text/event-stream", Connection: "keep-alive" });
      res.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ recent: recent.slice(-10), pulse: lastPulse, status: lastStatus, symbols: [...SYMBOLS] })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    case "/status":
      return send(res, 200, lastStatus);
    case "/healthz":
      return send(res, 200, { status: "ok", listeners: clients.size });
    case "/":
    case "/index.html":
      return fs.readFile(DASHBOARD, (err, html) => {
        if (err) return send(res, 404, { error: "dashboard not mounted" });
        res.writeHead(200, {
          ...SEC_HEADERS,
          "Content-Type": "text/html; charset=utf-8",
          // Self-contained page: it may only talk back to this relay.
          "Content-Security-Policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; " +
            "connect-src 'self'; frame-ancestors 'none'",
        });
        res.end(html);
      });
    default:
      return send(res, 404, { error: "not found" });
  }
});

server.listen(PORT, () => console.log(`omega relay listening on :${PORT} · symbols ${[...SYMBOLS].join(",")}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { for (const c of clients) c.end(); server.close(() => process.exit(0)); });
