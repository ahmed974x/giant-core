// OMEGA Quant service. Every minute it reads the 5-minute candles through the relay's read-only /api,
// computes risk metrics with stdlib (quant.js) and serves the latest snapshot.
//   GET /quant     the snapshot (pairs + correlations)
//   GET /healthz   liveness
// Without the relay (or with OMEGA_QUANT_DEMO=1) it runs on a synthetic random walk, marked source "demo".
"use strict";
const http = require("node:http");
const { snapshot } = require("./quant");

const PORT = Number(process.env.PORT || 8091);
const API = (process.env.OMEGA_API_URL || "http://relay:8080").replace(/\/$/, "");
const SYMBOLS = (process.env.OMEGA_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT").split(",").map(s => s.trim()).filter(Boolean);
const DEMO = process.env.OMEGA_QUANT_DEMO === "1";
const EVERY_MS = 60_000;

let latest = { at: null, source: "starting", pairs: {}, correlations: {} };

function demoSeries() {
  const base = { BTCUSDT: 62000, ETHUSDT: 2450, SOLUSDT: 148 }, out = {}, now = Math.floor(Date.now() / 300e3) * 300e3;
  let shock = 0;
  for (const s of SYMBOLS) {
    let p = base[s] || 100, seed = [...s].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    // biome-ignore lint/suspicious/noAssignInExpressions: compact linear-congruential PRNG for demo data
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5;
    out[s] = [];
    for (let i = 575; i >= 0; i--) { shock = 0.7 * shock + rnd(); p *= 1 + 0.002 * rnd() + 0.0012 * shock / 3; out[s].push({ ts: new Date(now - i * 300e3).toISOString(), close: p }); }
  }
  return out;
}

async function liveSeries() {
  const out = {};
  for (const s of SYMBOLS) {
    const r = await fetch(`${API}/api/candles_5m?symbol=eq.${encodeURIComponent(s)}&order=ts.asc`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`relay ${r.status}`);
    out[s] = (await r.json()).map(x => ({ ts: x.ts, close: Number(x.close) }));
  }
  return out;
}

async function refresh() {
  if (DEMO) { latest = snapshot(demoSeries(), "demo"); return; }
  try { latest = snapshot(await liveSeries(), "live"); }
  catch (err) { latest = { ...snapshot(demoSeries(), "demo"), note: `relay unreachable: ${err.message}` }; }
}

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const server = http.createServer((req, res) => {
  if (req.method !== "GET") { res.writeHead(405, HEADERS); return res.end('{"error":"method not allowed"}'); }
  if (req.url === "/quant") { res.writeHead(200, HEADERS); return res.end(JSON.stringify(latest)); }
  if (req.url === "/healthz") { res.writeHead(200, HEADERS); return res.end(JSON.stringify({ status: "ok", at: latest.at, source: latest.source })); }
  res.writeHead(404, HEADERS); res.end('{"error":"not found"}');
});

if (require.main === module) {
  refresh().finally(() => setInterval(refresh, EVERY_MS).unref());
  server.listen(PORT, () => console.log(`omega quant listening on :${PORT} · ${SYMBOLS.join(",")}${DEMO ? " · demo" : ""}`));
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
}

module.exports = { server, refresh, demoSeries, get latest() { return latest; } };
