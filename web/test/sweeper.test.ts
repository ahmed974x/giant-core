import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchPrices, planSweep, sweepRequest, validPositions, validRules } from "../src/lib/sweeper.ts";

const rules = validRules({ min_gain_pct: 15, sweep_share: 0.5, min_sweep_usd: 25, reserve: "USDT" });

test("sweeps half the gain only above the threshold and the minimum", () => {
  const plan = planSweep([
    { symbol: "BTCUSDT", qty: 0.05, cost_usd: 2500 },  // value 3250, gain 750 (30%) -> sweep 375
    { symbol: "ETHUSDT", qty: 1, cost_usd: 3000 },     // value 3300, gain 300 (10%) -> below threshold
    { symbol: "SOLUSDT", qty: 1, cost_usd: 100 },      // value 130, gain 30 (30%) -> 15 < 25, too small
    { symbol: "PAXGUSDT", qty: 1, cost_usd: 3000 },    // value 2900 -> loss
    { symbol: "XRPUSDT", qty: 10, cost_usd: 5 },       // no price
  ], { BTCUSDT: 65000, ETHUSDT: 3300, SOLUSDT: 130, PAXGUSDT: 2900 }, rules);
  assert.deepEqual(plan.lines.map(l => [l.symbol, l.reason, l.sweepUsd]),
    [["BTCUSDT", "sweep", 375], ["ETHUSDT", "below-threshold", 0], ["SOLUSDT", "too-small", 0], ["PAXGUSDT", "loss", 0], ["XRPUSDT", "no-price", 0]]);
  assert.equal(plan.lines[0].sweepQty, 0.00576923);
  assert.equal(plan.totalSweepUsd, 375);
});

test("the proposal is a remember-TASK that says OMEGA does not trade", () => {
  const plan = planSweep([{ symbol: "BTCUSDT", qty: 0.05, cost_usd: 2500 }], { BTCUSDT: 65000 }, rules);
  const req = sweepRequest(plan, new Date("2026-10-10T10:00:00Z"))!;
  assert.match(req, /^remember: TASK: profit sweep plan 2026-10-10, move ~\$375 into USDT: BTCUSDT sell 0\.00576923/);
  assert.match(req, /OMEGA does not trade/);
  assert.equal(sweepRequest(planSweep([{ symbol: "BTCUSDT", qty: 1, cost_usd: 1e6 }], { BTCUSDT: 65000 }, rules)), null, "nothing to sweep");
});

test("rules and positions are validated", () => {
  for (const bad of [{}, { ...rules, sweep_share: 1.5 }, { ...rules, sweep_share: 0 }, { ...rules, reserve: "usd t" }, { ...rules, min_gain_pct: -1 }])
    assert.throws(() => validRules(bad));
  assert.throws(() => validPositions({ positions: [{ symbol: "../x", qty: 1, cost_usd: 1 }] }));
  assert.throws(() => validPositions({ positions: [{ symbol: "BTCUSDT", qty: 0, cost_usd: 1 }] }));
  assert.throws(() => validPositions({}));
  const shipped = JSON.parse(readFileSync(new URL("../../services/sweeper/rules.json", import.meta.url), "utf8"));
  assert.doesNotThrow(() => validRules(shipped));
  const example = JSON.parse(readFileSync(new URL("../../services/sweeper/positions.example.json", import.meta.url), "utf8"));
  assert.equal(validPositions(example).length, 2);
});

test("prices come from the public Binance mirror for valid symbols only", async () => {
  let url = "";
  const f = (async (u: string | URL) => { url = String(u); return Response.json([{ symbol: "BTCUSDT", price: "65000.10" }]); }) as typeof fetch;
  assert.deepEqual(await fetchPrices(["BTCUSDT", "BTCUSDT", "bad sym"], f), { BTCUSDT: 65000.1 });
  assert.equal(decodeURIComponent(url), 'https://data-api.binance.vision/api/v3/ticker/price?symbols=["BTCUSDT"]');
});
