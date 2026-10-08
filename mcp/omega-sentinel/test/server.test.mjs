// End-to-end: the bundled server/index.js against a fake OMEGA relay.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ENTRY = fileURLToPath(new URL("../server/index.js", import.meta.url));
const now = Date.now();
const iso = ms => new Date(ms).toISOString();

const LATEST = [
  { symbol: "BTCUSDT", ts: iso(now - 60e3), close: 61000, change_1h_pct: -2.1, change_24h_pct: 1.4, quote_volume_24h: 9.1e8 },
  { symbol: "ETHUSDT", ts: iso(now - 60e3), close: 2400, change_1h_pct: 0.3, change_24h_pct: -0.8, quote_volume_24h: 4.2e8 },
];
const ANOMALIES = [
  { id: 2, ts: iso(now - 600e3), symbol: "BTCUSDT", kind: "drawdown_1h", severity: "high", price: 61000, value: -4.2, baseline: 63600, zscore: null, reason: "-4.2% below the 1h high of 63600", detected_at: iso(now - 590e3) },
  { id: 1, ts: iso(now - 3600e3), symbol: "BTCUSDT", kind: "volume_spike", severity: "watch", price: 62500, value: 900, baseline: 150, zscore: 5.1, reason: "Volume x6 the 24h average (z=5.1)", detected_at: iso(now - 3590e3) },
];
const CANDLES = Array.from({ length: 288 }, (_, i) => {
  const c = 63000 - i * 7;
  return { symbol: "BTCUSDT", ts: iso(now - (288 - i) * 300e3), open: c + 3, high: c + 20, low: c - 20, close: c, volume: 10 };
});

const seen = [];
let relay;
let base;

before(async () => {
  relay = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    seen.push(url);
    const json = body => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const sym = url.searchParams.get("symbol")?.replace(/^eq\./, "");
    const sev = url.searchParams.get("severity")?.replace(/^eq\./, "");
    switch (url.pathname) {
      case "/api/latest": return json(LATEST.filter(r => !sym || r.symbol === sym));
      case "/api/anomalies": return json(ANOMALIES.filter(a => (!sym || a.symbol === sym) && (!sev || a.severity === sev)));
      case "/api/candles_5m": return json(CANDLES.filter(c => c.symbol === sym));
      case "/status": return json({ relay: "ok", n8n: "ok", postgrest: "ok", timescale: "down", checkedAt: iso(now) });
      default: res.writeHead(404); res.end("{}");
    }
  });
  await new Promise(r => relay.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${relay.address().port}`;
});
after(() => relay.close());

async function connect(env) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [ENTRY], env: { ...process.env, ...env }, stderr: "pipe" }));
  return client;
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { ...r, data: r.isError ? null : JSON.parse(r.content[0].text) };
};

test("lists four read-only tools and the brief prompt", async () => {
  const c = await connect({ OMEGA_URL: base });
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ["sentinel_list_alerts", "sentinel_market_snapshot", "sentinel_price_history", "sentinel_system_status"]);
  for (const t of tools) assert.equal(t.annotations.readOnlyHint, true, t.name);
  const { prompts } = await c.listPrompts();
  assert.deepEqual(prompts.map(p => p.name), ["market_brief"]);
  await c.close();
});

test("snapshot, alerts, history and status return relay data", async () => {
  const c = await connect({ OMEGA_URL: base });

  const snap = await call(c, "sentinel_market_snapshot", { symbol: "btcusdt" });
  assert.equal(snap.data.pairs.length, 1);
  assert.equal(snap.data.pairs[0].symbol, "BTCUSDT");

  const alerts = await call(c, "sentinel_list_alerts", { severity: "high" });
  assert.equal(alerts.data.count, 1);
  assert.deepEqual(alerts.data.by_severity, { high: 1, watch: 0 });
  const q = seen.findLast(u => u.pathname === "/api/anomalies").searchParams;
  assert.equal(q.get("severity"), "eq.high");
  assert.equal(q.get("order"), "ts.desc");
  assert.match(q.get("ts"), /^gte\.\d{4}-/);

  const hist = await call(c, "sentinel_price_history", { symbol: "BTCUSDT", hours: 24, max_points: 30 });
  assert.ok(hist.data.points.length <= 31);
  assert.ok(hist.data.change_pct < 0);
  assert.ok(hist.data.max_drawdown_pct < 0);

  const status = await call(c, "sentinel_system_status");
  assert.equal(status.data.timescale, "down");
  await c.close();
});

test("rejects malformed symbols before any request is made", async () => {
  const c = await connect({ OMEGA_URL: base });
  const before = seen.length;
  const r = await c.callTool({ name: "sentinel_price_history", arguments: { symbol: "BTC&select=*" } });
  assert.equal(r.isError, true);
  assert.equal(seen.length, before);
  await c.close();
});

test("an unreachable relay gives an actionable error, not a crash", async () => {
  const c = await connect({ OMEGA_URL: "http://127.0.0.1:9" });
  const r = await call(c, "sentinel_market_snapshot");
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /docker compose up/);
  await c.close();
});

test("refuses to start against a non-local OMEGA_URL", () => {
  for (const url of ["http://example.com", "file:///etc/passwd", "http://user:pw@127.0.0.1:8088"]) {
    const p = spawnSync(process.execPath, [ENTRY], { env: { ...process.env, OMEGA_URL: url }, input: "", timeout: 5000 });
    assert.notEqual(p.status, 0, url);
    assert.match(String(p.stderr), /OMEGA_URL/, url);
  }
});
