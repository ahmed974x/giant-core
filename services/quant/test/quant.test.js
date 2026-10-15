"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const q = require("../quant.js");
const svc = require("../server.js");

test("log returns and momentum", () => {
  assert.deepEqual(q.logReturns([100, 100]), [0]);
  assert.equal(q.momentum([100, 110], 1), 10);
  assert.equal(q.momentum([100], 1), null);
});

test("max drawdown finds the deepest fall", () => {
  assert.equal(q.maxDrawdown([100, 120, 90, 130, 117]), -25);
  assert.equal(q.maxDrawdown([1, 2, 3]), 0);
});

test("analyse flags a shock with a large z-score and a tiny tail probability", () => {
  const closes = [];
  let p = 100;
  for (let i = 0; i < 400; i++) { p *= 1 + (i % 2 ? 0.001 : -0.001); closes.push(p); }
  closes.push(p * 0.97);                                  // -3% in one bar
  const a = q.analyse(closes);
  assert.ok(a.zscore < -10, `z=${a.zscore}`);
  assert.ok(a.tail_prob < 1e-4);
  assert.equal(a.regime, "turbulent");
  assert.ok(a.vol_ann_pct > 0 && a.ewma_vol_ann_pct > 0);
  assert.equal(q.analyse([1, 2, 3]), null);              // too short
});

test("correlation is +1 for identical moves and -1 for mirrored ones", () => {
  const mk = f => Array.from({ length: 50 }, (_, i) => ({ ts: String(i), close: 100 * (1 + f * 0.01 * Math.sin(i)) }));
  const c = q.correlations({ A: mk(1), B: mk(1), C: mk(-1) });
  assert.equal(c["A/B"], 1);
  assert.ok(c["A/C"] < -0.99);
});

test("demo snapshot covers every symbol", async () => {
  process.env.OMEGA_QUANT_DEMO = "1";
  const s = q.snapshot(svc.demoSeries(), "demo");
  assert.equal(Object.keys(s.pairs).length, 3);
  assert.equal(Object.keys(s.correlations).length, 3);
  for (const p of Object.values(s.pairs)) assert.ok(["calm", "normal", "turbulent"].includes(p.regime));
});
