"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// A fake relay and a fake Supabase on one local server.
const received = {};
const server = http.createServer((req, res) => {
  const send = body => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url.startsWith("/api/anomalies")) return send([{ id: 1, ts: "2026-10-09T00:00:00Z", symbol: "BTCUSDT", kind: "price_shock", severity: "high", price: 1, zscore: -5, reason: "x", secret_extra: "dropped" }]);
  if (req.url.startsWith("/api/")) return send([]);
  if (req.url === "/quant") return send({ at: "2026-10-09T00:01:00Z", source: "live", pairs: {} });
  if (req.url === "/neural") { res.writeHead(503); return res.end("{}"); }
  if (req.url.startsWith("/rest/v1/")) {
    let b = ""; req.on("data", c => (b += c));
    return req.on("end", () => { received[req.url] = { body: JSON.parse(b), headers: req.headers }; res.writeHead(201); res.end(); });
  }
  res.writeHead(404); res.end();
});

test("sync mirrors allowed columns only, upserts, and tolerates a missing neural engine", async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.OMEGA_API_URL = base; process.env.SUPABASE_URL = base; process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key_000000";
  delete require.cache[require.resolve("../sync.js")];
  const { syncOnce } = require("../sync.js");
  const sent = await syncOnce();
  server.close();

  assert.equal(sent.anomalies, 1);
  assert.equal(sent.whales, 0);
  assert.equal(sent.snapshots, 1);
  const a = received["/rest/v1/omega_anomalies"];
  assert.equal(a.body[0].secret_extra, undefined);
  assert.equal(a.headers.apikey, "sb_secret_test_key_000000");
  assert.equal(a.headers.authorization, undefined);            // secret keys are not JWTs
  assert.match(a.headers.prefer, /merge-duplicates/);
  assert.equal(received["/rest/v1/omega_snapshots"].body[0].engine, "quant");
});
