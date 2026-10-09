// Offline tests: fake upstreams stand in for the providers, so no keys and no network are needed.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function upstream(handler) {
  return new Promise(resolve => {
    const hits = [];
    const s = http.createServer((req, res) => {
      let b = ""; req.on("data", c => (b += c));
      req.on("end", () => { const body = b ? JSON.parse(b) : null; hits.push({ url: req.url, headers: req.headers, body }); handler(req, res, body); });
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, hits, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
const json = (res, code, obj, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };

let limited, good, claude, pgrst, gw;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-"));

test.before(async () => {
  limited = await upstream((req, res) => json(res, 429, { error: "slow down" }, { "retry-after": "7" }));
  good = await upstream((req, res, body) => json(res, 200, {
    choices: [{ message: { role: "assistant", content: `echo:${body.messages.at(-1).content}` }, finish_reason: "stop" }],
    usage: { prompt_tokens: 11, completion_tokens: 3 },
  }));
  claude = await upstream((req, res, body) => json(res, 200, {
    id: "msg_1", type: "message", role: "assistant", model: body.model,
    content: [{ type: "text", text: "claude says hi" }], stop_reason: "end_turn",
    usage: { input_tokens: 20, output_tokens: 4 },
  }));
  pgrst = await upstream((req, res) => json(res, 200, 1));
  fs.writeFileSync(path.join(dir, "providers.json"), JSON.stringify({
    providers: {
      anthropic: { kind: "anthropic", key: "T_ANTHROPIC", rpm: 10, models: ["claude-opus-5-5"] },
      slow: { kind: "openai", base: limited.url, key: "T_SLOW", rpm: 10, models: ["m1"] },
      fast: { kind: "openai", base: good.url, key: "T_FAST", rpm: 10, models: ["m2"] },
      nokey: { kind: "openai", base: good.url, key: "T_MISSING", models: ["m3"] },
      anon: { kind: "openai", base: good.url, anonymous: true, models: ["m4"] },
      local: { kind: "openai", base: "${T_LOCAL_URL}", local: true, requires: ["T_LOCAL_URL"], model_env: "T_LOCAL_MODEL", concurrency: 1, timeout_ms: 5000, models: ["tiny"] },
    },
    routes: {
      "omega/fast": { adaptive: true, chain: ["nokey:m3", "anon:m4", "slow:m1", "fast:m2"] },
      claude: { chain: ["anthropic:default"] },
      "omega/local": { chain: ["local:default"] },
    },
  }));
  Object.assign(process.env, {
    OMEGA_PROVIDERS_FILE: path.join(dir, "providers.json"), OMEGA_GATEWAY_TOKEN: "t".repeat(40),
    PGRST_URL: pgrst.url, PGRST_JWT_SECRET: "s".repeat(40),
    T_ANTHROPIC: "sk-test", T_SLOW: "k1", T_FAST: "k2", ANTHROPIC_BASE_URL: claude.url,
    T_LOCAL_URL: `${good.url}/v1`, T_LOCAL_MODEL: "llama3.2:3b",
  });
  gw = require("../server.js");
  gw._setRegistry(gw.loadRegistry());
});
test.after(() => { for (const u of [limited, good, claude, pgrst]) u.s.close(); });

test("registry: keyless and anonymous providers stay off by default", () => {
  const { providers } = gw.loadRegistry();
  assert.equal(providers.nokey.enabled, false);
  assert.match(providers.nokey.reason, /T_MISSING/);
  assert.equal(providers.anon.enabled, false);
  assert.equal(providers.fast.enabled, true);
});

test("fast route fails over past a 429 and records every attempt", async () => {
  const out = await gw.complete({ model: "omega/fast", messages: [{ role: "user", content: "ping" }] });
  assert.equal(out.choices[0].message.content, "echo:ping");
  assert.equal(out.omega.provider, "fast");
  const called = out.omega.attempts.filter(a => a.called);
  assert.deepEqual(called.map(a => [a.provider, a.ok]), [["slow", false], ["fast", true]]);
  assert.equal(good.hits.at(-1).headers.authorization, "Bearer k2");
  const rows = gw._queue.filter(r => r.request_id === out.omega.request_id);
  assert.deepEqual(rows.map(r => [r.provider, r.ok, r.error ?? null]), [["slow", false, "rate_limited"], ["fast", true, null]]);
  assert.equal(rows[1].prompt_tokens, 11);
});

test("a rate-limited provider is benched for its retry-after", async () => {
  const before = limited.hits.length;
  const out = await gw.complete({ model: "omega/fast", messages: [{ role: "user", content: "again" }] });
  assert.equal(limited.hits.length, before, "benched provider must not be called");
  assert.ok(out.omega.attempts.some(a => a.provider === "slow" && a.skipped === "cooling"));
});

test("claude route goes through the Anthropic SDK with system split out and fallbacks on", async () => {
  const out = await gw.complete({ model: "claude", messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }], temperature: 0.2 });
  assert.equal(out.choices[0].message.content, "claude says hi");
  assert.equal(out.model, "anthropic:claude-opus-5-5");
  const sent = claude.hits.at(-1);
  assert.equal(sent.url.split("?")[0], "/v1/messages");
  assert.equal(sent.headers["x-api-key"], "sk-test");
  assert.match(sent.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.system, "be brief");
  assert.equal(sent.body.fallbacks, "default");
  assert.equal(sent.body.temperature, undefined, "sampling params are not sent to Claude");
  assert.deepEqual(out.usage, { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 });
});

test("adaptive ranking promotes the measured-faster entry", () => {
  const { routes } = gw.loadRegistry();
  gw._setPerf(new Map([
    ["slow:m1", { calls: 50, success_rate: 1, p50_ms: 2000 }],
    ["fast:m2", { calls: 50, success_rate: 1, p50_ms: 300 }],
  ]));
  const orig = Math.random; Math.random = () => 0.5;
  try {
    assert.deepEqual(gw.rank(routes["omega/fast"]).map(c => c.ref), ["nokey:m3", "anon:m4", "fast:m2", "slow:m1"]);
  } finally { Math.random = orig; gw._setPerf(new Map()); }
});

test("perf rows flush to PostgREST with a gateway_writer JWT", async () => {
  await gw._flush();
  const hit = pgrst.hits.at(-1);
  assert.equal(hit.url, "/rpc/log_llm_calls");
  const claims = JSON.parse(Buffer.from(hit.headers.authorization.split(".")[1], "base64url"));
  assert.equal(claims.role, "gateway_writer");
  assert.ok(hit.body.rows.length >= 3);
  assert.ok(hit.body.rows.every(r => !("content" in r) && !("messages" in r)), "no prompt or answer text is stored");
});

test("local provider needs no key, takes a whole URL and its model from env", async () => {
  const { providers } = gw.loadRegistry();
  assert.equal(providers.local.enabled, true);
  assert.equal(providers.local.base, `${good.url}/v1`);
  assert.equal(providers.local.defaultModel, "llama3.2:3b");
  const out = await gw.complete({ model: "omega/local", messages: [{ role: "user", content: "offline?" }] });
  assert.equal(out.model, "local:llama3.2:3b");
  const hit = good.hits.at(-1);
  assert.equal(hit.url, "/v1/chat/completions");
  assert.equal(hit.headers.authorization, undefined, "no key is sent to the local model");
  const off = gw.loadRegistry({ ...process.env, T_LOCAL_URL: "" }).providers.local;
  assert.equal(off.enabled, false);
});

test("validation rejects streaming and malformed messages", () => {
  assert.match(gw.validate({ stream: true, messages: [{ role: "user", content: "x" }] }), /stream/);
  assert.match(gw.validate({ messages: [] }), /messages/);
  assert.match(gw.validate({ messages: [{ role: "tool", content: "x" }] }), /role/);
  assert.equal(gw.validate({ model: "omega/fast", messages: [{ role: "user", content: "x" }] }), null);
});
