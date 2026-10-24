// Tests for the trade lab engine (scripts/lib/trade-lab.mjs, ADR-116), the TRADE LAB page's inline copy and the
// proxy API document (docs/api/omega-data-proxy.openapi.json).
//   node scripts/test-tradelab.mjs        exits 0 when every test passes
// No network, no dependencies. The receipts below are small hand-made fixtures in the Ops Room's receipt shape
// (ADR-091); they are never shown on a page. CI runs this in the skillspector workflow.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OMEGA_TRADELAB as L } from "./lib/trade-lab.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function test(name, f) {
  try { f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const T0 = Date.parse("2026-10-20T08:00:00Z"), MIN = 60000;
const S = (total, trading) => ({ cash: 0, locked_base: 20, trading, safe_vault: 0, split: 0, total });

// Two round trips (one win in two sells, one loss), an emergency stop over a third open trip and a test trade.
function fixture() {
  return L.buildChain([
    { ts: T0, type: "LOCK", amount: 20, before: S(0, 0), after: S(20, 20), reason: "Lock base 20.00" },
    { ts: T0 + 10 * MIN, type: "FILL_BUY", amount: 5, before: S(20, 20), after: S(20, 20), reason: "Auto engine: BUY score 0.42; 25.0% half-Kelly; L2 VWAP 100.00 over 2 of 25 levels", exec: { vwap: 100, qty: 0.04995, quote: 4.995, slippage_bps: 2, taker_fee: 0.005 } },
    { ts: T0 + 40 * MIN, type: "FILL_SELL", amount: 2.7, before: S(20, 20), after: S(20, 20), reason: "TP1 reached at L2 VWAP 108.00 over 1 of 25 levels", exec: { vwap: 108, qty: 0.025, quote: 2.7027, slippage_bps: 1, taker_fee: 0.0027 } },
    { ts: T0 + 70 * MIN, type: "FILL_SELL", amount: 2.75, before: S(20, 20), after: S(20.45, 20.45), reason: "TP2 reached at L2 VWAP 110.00 over 1 of 25 levels", exec: { vwap: 110, qty: 0.02495, quote: 2.7445, slippage_bps: 1, taker_fee: 0.00274 } },
    { ts: T0 + 80 * MIN, type: "FILL_BUY", amount: 5, before: S(20.45, 20.45), after: S(20.45, 20.45), reason: "STRONG BUY score 0.70; 25.0% half-Kelly; L2 VWAP 110.00 over 2 of 25 levels", exec: { vwap: 110, qty: 0.0454, quote: 4.995, slippage_bps: 3, taker_fee: 0.005 } },
    { ts: T0 + 200 * MIN, type: "FILL_SELL", amount: 4.4, before: S(20.45, 20.45), after: S(19.85, 19.85), reason: "Stop loss hit at L2 VWAP 97.00 over 1 of 25 levels", exec: { vwap: 97, qty: 0.0454, quote: 4.4038, slippage_bps: 2, taker_fee: 0.0044 } },
    { ts: T0 + 205 * MIN, type: "FILL_BUY", amount: 4, before: S(19.85, 19.85), after: S(19.85, 19.85), reason: "BUY score 0.31; 20.0% half-Kelly; L2 VWAP 97.00 over 1 of 25 levels", exec: { vwap: 97, qty: 0.0412, quote: 3.996, slippage_bps: 1, taker_fee: 0.004 } },
    { ts: T0 + 220 * MIN, type: "KILL", amount: 19.7, before: S(19.85, 19.85), after: S(19.7, 0), reason: "Emergency stop" },
    { ts: T0 + 300 * MIN, type: "SIM_TRADE", amount: 0.3, before: S(19.7, 10), after: S(20, 10.3), reason: "Test trade +3.0% on the trading balance" }
  ]);
}

test("pure SHA-256 matches node:crypto, including Arabic text", () => {
  for (const s of ["", "abc", "a".repeat(1000), "سجل التداول الورقي ✓", JSON.stringify({ x: 1.123456789 })]) ok(L.sha256Hex(s) === createHash("sha256").update(s, "utf8").digest("hex"), "hash differs for " + s.slice(0, 20));
});
test("canonical form rounds to 8 decimals, sorts keys and drops hash", () => {
  ok(JSON.stringify(L.canon({ b: 1.123456789, a: [2], hash: "x" })) === '{"a":[2],"b":1.12345679}', "canon");
});
test("built chain verifies; a changed amount, a broken link and a live receipt are refused", () => {
  const c = fixture();
  ok(L.verifyChain(c).ok, "fixture should verify");
  const a = JSON.parse(JSON.stringify(c)); a[3].amount = 99; ok(!L.verifyChain(a).ok && L.verifyChain(a).at === 3, "edited amount");
  const b = JSON.parse(JSON.stringify(c)); b.splice(2, 1); ok(!L.verifyChain(b).ok, "missing receipt");
  const d = L.buildChain([{ ts: T0, type: "DEPOSIT", amount: 1, before: S(0, 0), after: S(1, 0), reason: "x" }]); d[0].mode = "live"; d[0].hash = L.hashOf(d[0]); ok(L.verifyChain(d).why === "receipt is not a paper receipt", "live mode");
});
test("checkpoints: a valid Merkle checkpoint chains to the kept receipts", () => {
  const c = fixture(), batch = c.slice(0, 4), kept = c.slice(4);
  const cp = { format: "omega-merkle-checkpoint-v1", from_seq: 1, to_seq: 4, count: 4, first_prev_hash: L.GENESIS, last_hash: batch[3].hash, merkle_root: L.merkleRoot(batch.map(r => r.hash)), ts: "2026-10-20T12:00:00.000Z", prev_checkpoint: L.GENESIS };
  cp.hash = L.hashOf(cp);
  ok(L.verifyChain(kept, [cp]).ok, "checkpoint + kept should verify");
  const bad = { ...cp, count: 5 }; ok(!L.verifyChain(kept, [bad]).ok, "bad checkpoint");
});
test("export parser accepts the Ops Room format and a bare array, refuses others", () => {
  ok(L.parseExport(JSON.stringify({ format: "omega-receipt-chain-v1", receipts: fixture(), checkpoints: [] })).ok, "export");
  ok(L.parseExport(fixture()).ok, "array");
  ok(!L.parseExport("{oops").ok && !L.parseExport({ format: "x", receipts: [] }).ok, "refusals");
});
test("round trips: partial exits join, KILL and unclosed trips are left out with a gap, test trades kept", () => {
  const { trips, gaps } = L.tripsFromReceipts(fixture());
  ok(trips.length === 4, "4 trips, got " + trips.length);
  const [a, b, k, s] = trips;
  ok(a.status === "closed" && a.exits.length === 2 && a.auto && a.signal === "BUY", "trip 1");
  near(a.pnl, 0.45, 1e-9, "trip 1 P/L"); near(a.exit, (2.7027 + 2.7445) / (0.025 + 0.02495), 1e-9, "trip 1 exit VWAP");
  near(a.hold, 60 * MIN, 0, "hold");
  ok(b.signal === "STRONG BUY" && b.pnl < 0, "trip 2 loss");
  ok(k.status === "killed" && gaps.some(g => /emergency stop/.test(g)), "kill gap");
  ok(s.src === "sim" && s.pnl === 0.3, "test trade");
});
test("metrics: win rate, payoff, profit factor, drawdown and streaks on known trips", () => {
  const { trips } = L.tripsFromReceipts(fixture());
  const m = L.metrics(trips, { startEquity: 20, riskPct: 1 });
  ok(m.n === 3 && m.wins === 2 && m.losses === 1 && m.left === 1, "counts");
  near(m.winRate, 2 / 3, 1e-12, "win rate");
  near(m.grossWin, 0.75, 1e-9, "gross win"); near(m.grossLoss, 0.6, 1e-9, "gross loss");
  near(m.profitFactor, 1.25, 1e-9, "profit factor");
  near(m.expectancy, 0.05, 1e-9, "expectancy");
  near(m.maxDD, 0.6 / 20.45, 1e-9, "max drawdown");
  ok(m.maxLossStreak === 1 && m.streak === 1, "streaks");
  near(m.R[0], 0.45 / 0.2, 1e-9, "R of trip 1 = pnl / (equity × 1%)");
  near(m.breakevenWinRate, 0.6 / (0.375 + 0.6), 1e-9, "breakeven win rate");
});
test("manual trips: long and short P/L, stop side and time checks", () => {
  const l = L.manualTrip({ symbol: "ethusdt", side: "long", entry: 100, exit: 110, qty: 2, fees: 1, stop: 95, openTs: "2026-10-20T08:00Z", closeTs: "2026-10-20T09:00Z" });
  ok(l.ok && l.trip.pnl === 19 && l.trip.symbol === "ETHUSDT", "long");
  near(L.riskUnit(l.trip, L.PLAN_DEFAULTS), 10, 1e-12, "R from the stop");
  const s = L.manualTrip({ side: "short", entry: 100, exit: 90, qty: 1, openTs: "2026-10-20T08:00Z", closeTs: "2026-10-20T08:30Z" });
  ok(s.ok && s.trip.pnl === 10, "short");
  ok(!L.manualTrip({ side: "long", entry: 100, exit: 90, qty: 1, stop: 120, openTs: "2026-10-20T08:00Z", closeTs: "2026-10-20T08:30Z" }).ok, "stop on the wrong side");
  ok(!L.manualTrip({ entry: 100, exit: 90, qty: 1, openTs: "2026-10-20T09:00Z", closeTs: "2026-10-20T08:30Z" }).ok, "close before open");
});
test("plan compliance flags size, daily count, cool-down and 1R breaches", () => {
  const { trips } = L.tripsFromReceipts(fixture());
  const c = L.compliance(trips, { maxPositionPct: 20, maxTradesPerDay: 1, cooldownMin: 60, riskPct: 1 });
  ok(c.n === 3, "3 trips");
  ok(c.counts.size === 3, "two buys of 5 on ~20 equity and the test trade on the whole balance are above 20%: " + c.counts.size);
  ok(c.counts.count === 2, "count over 1 per day: " + c.counts.count);
  ok(c.counts.loss === 1, "the stop-out lost 0.6 > 1R of 0.2045");
  ok(L.sanitizePlan({ hourFrom: 10, hourTo: 5 }).hourTo === 11, "hours sanitised");
});
test("paper discipline challenge: running, failed on the daily limit, passed", () => {
  const { trips } = L.tripsFromReceipts(fixture());
  ok(L.challenge(trips, {}, {}).status === "running", "running");
  const f = L.challenge(trips, { dailyLossPct: 0.5 }, {});
  ok(f.status === "failed" && f.failed.rule === "daily", "failed daily");
  const p = L.challenge(trips, { targetPct: 0.5, minDays: 1 }, {});
  ok(p.status === "passed", "passed: " + p.status);
});
test("journal notes are sanitised and mistakes priced", () => {
  const { trips } = L.tripsFromReceipts(fixture());
  const n = L.sanitizeNote({ tags: ["fomo", "evil<script>", "fomo"], emotion: 9, grade: "Z", lesson: "x\u0001y", followed: false });
  ok(n.tags.length === 1 && n.emotion === null && n.grade === "" && n.lesson === "xy", "sanitise");
  const k = L.mistakeStats(trips, { T5: { ...n, tags: ["moved-stop"] }, T2: L.sanitizeNote({ followed: true }) });
  ok(k.noted === 2 && k.tags[0].k === "moved-stop" && Math.abs(k.tags[0].cost - 0.6) < 1e-9, "costliest tag");
});
test("indicators: SMA, EMA, Wilder RSI, MACD, Bollinger and ATR on a known series", () => {
  const xs = Array.from({ length: 40 }, (_, i) => 100 + i);
  ok(L.sma(xs, 5)[4] === 102, "SMA");
  ok(L.rsi(xs, 14)[39] === 100, "RSI is 100 on a rising line");
  const down = xs.slice().reverse(); ok(L.rsi(down, 14)[39] === 0, "RSI is 0 on a falling line");
  const e = L.ema([1, 2, 3, 4, 5, 6], 3); near(e[2], 2, 1e-12, "EMA seed"); near(e[3], 3, 1e-12, "EMA step");
  const m = L.macd(xs); ok(m.line[39] > 0 && Math.abs(m.hist[39]) < 1e-9 + Math.abs(m.line[39]), "MACD on a line");
  const b = L.bollinger(Array(30).fill(5)); ok(b.up[29] === 5 && b.lo[29] === 5, "flat Bollinger");
  const kl = xs.map((c, i) => ({ t: i, o: c, h: c + 1, l: c - 1, c, v: 1 })); near(L.atr(kl)[39], 2, 1e-9, "ATR of ±1 candles");
});
test("klines URL refuses odd symbols and intervals; the lens reads a trend", () => {
  ok(L.klinesUrl("BTCUSDT", "4h") === "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=300", "url");
  ok(L.klinesUrl("btc", "4h") === null && L.klinesUrl("BTCUSDT", "1m") === null, "refusals");
  const raw = Array.from({ length: 260 }, (_, i) => [i * 3600e3, "" + (100 + i), "" + (101 + i), "" + (99 + i), "" + (100.5 + i), "10"]);
  const lens = L.marketLens(L.parseKlines(raw));
  ok(lens.ok && lens.trend === "up" && lens.rsi > 70 && lens.readings.some(r => r.k === "rsi" && r.level === "watch"), "uptrend lens");
  ok(!L.marketLens(L.parseKlines(raw.slice(0, 20))).ok, "too few candles");
});
test("bootstrap is seeded and bounded", () => {
  ok(!L.monteCarlo([0.01, -0.01]).ok, "needs 10");
  const rets = [0.02, -0.01, 0.015, -0.012, 0.01, -0.02, 0.03, -0.01, 0.005, -0.004, 0.012];
  const a = L.monteCarlo(rets, { ddLimitPct: 5 }), b = L.monteCarlo(rets, { ddLimitPct: 5 });
  ok(a.ok && a.pRuin === b.pRuin && a.p50 === b.p50 && a.pRuin >= 0 && a.pRuin <= 1 && a.label === "[INFERENCE - Quant Model]", "seeded");
});
test("desk manager agent: no data, a losing desk, a stop on drawdown, proposals with plan patches", () => {
  const empty = L.coach({ metrics: L.metrics([], {}), compliance: L.compliance([], {}), mistakes: L.mistakeStats([], {}), challenge: null, plan: {}, sources: { receipts: 0, manual: 0 } });
  ok(empty.findings.some(f => f.id === "no-data") && empty.label === "[INFERENCE]", "empty");
  const losers = Array.from({ length: 12 }, (_, i) => ({ id: "M" + i, src: "manual", status: "closed", openTs: T0 + i * 3600e3, closeTs: T0 + i * 3600e3 + 30 * MIN, hold: 30 * MIN, cost: 5, pnl: i % 3 ? -0.5 : 0.2, ret: 0, fees: 0, equityBefore: 20, signal: "manual", qty: 1, entry: 5 }));
  const plan = { maxDrawdownPct: 10, riskPct: 1 };
  const st = { metrics: L.metrics(losers, plan), compliance: L.compliance(losers, plan), mistakes: L.mistakeStats(losers, {}), challenge: L.challenge(losers, {}, plan), plan, planSet: true, sources: { receipts: 0, manual: 12 } };
  st.mc = L.monteCarlo(st.metrics.retPerTrade, { ddLimitPct: 10 });
  const c = L.coach(st);
  ok(c.verdict === "stop" && c.findings[0].level === "stop", "drawdown stops the desk");
  ok(c.findings.some(f => f.id === "edge") && c.proposals.some(p => p.id === "pause-auto"), "negative edge proposal");
  ok(c.proposals.some(p => p.patch && p.patch.maxPositionPct), "plan patch proposal");
  ok(c.score < 50 && c.facts.length > 2, "score and facts");
  ok(!JSON.stringify(c).match(/order|exchange|api key|real money/i) || JSON.stringify(c).indexOf("place a real order") < 0, "no real-order wording");
});
test("six data layers: identity and cross-account risk are n/a by design", () => {
  const ly = L.layers({ receipts: 3, manual: 0, trips: 1, notes: 0, lifecycle: 1 });
  ok(ly.length === 6 && ly.find(x => x.k === "identity").state === "n/a" && ly.find(x => x.k === "behaviour").state === "partial", "layers");
});
test("teaching example is a valid chain of 37 receipts with 18 closed trips", () => {
  const ex = L.teachingExample();
  ok(ex.length === 37 && L.verifyChain(ex).ok, "chain");
  const { trips } = L.tripsFromReceipts(ex);
  ok(trips.filter(t => t.status === "closed").length === 18, "18 trips");
});
test("the TRADE LAB page carries the current inline copy", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-tradelab-inline.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stderr || r.stdout).trim());
});
test("the proxy API document covers every proxy route and matches the generated Markdown", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-api-docs.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stderr || r.stdout).trim());
});

test("live readiness gate: the fixture fails, counts only receipt trips and never unlocks", () => {
  const trips = L.tripsFromReceipts(fixture()).trips;
  const g = L.liveGate(trips, {}, true);
  ok(g.locked === true && g.ready === false && g.total === 6, "gate shape");
  ok(g.checks.find(x => x.key === "chain").pass, "chain check passes on a verified chain");
  ok(g.checks.find(x => x.key === "trips").value === 2 && !g.checks.find(x => x.key === "trips").pass, "two trips, needs 100");
  ok(!L.liveGate(trips, {}, false).checks[0].pass, "unverified chain fails");
  const manual = trips.map(t => ({ ...t, src: "manual" }));
  ok(L.liveGate(manual, {}, true).checks.find(x => x.key === "trips").value === 0, "manual trips do not count");
});
test("live readiness gate: a long clean winning record passes every check but stays locked", () => {
  const ev = [{ ts: T0, type: "LOCK", amount: 20, before: S(0, 0), after: S(20, 20), reason: "Lock base 20.00" }];
  let eq = 20;
  for (let i = 0; i < 120; i++) {
    const ts = T0 + i * 7 * 3600000, win = i % 3 !== 0, sell = win ? 1.06 : 0.98;
    ev.push({ ts, type: "FILL_BUY", amount: 1, before: S(eq, eq), after: S(eq, eq), reason: "BUY score 0.40; L2 VWAP 100.00 over 1 of 25 levels", exec: { vwap: 100, qty: 0.01, quote: 1, slippage_bps: 1, taker_fee: 0 } });
    const next = +(eq + sell - 1).toFixed(6);
    ev.push({ ts: ts + 30 * MIN, type: "FILL_SELL", amount: sell, before: S(eq, eq), after: S(next, next), reason: "TP1 reached at L2 VWAP 106.00 over 1 of 25 levels", exec: { vwap: 100 * sell, qty: 0.01, quote: sell, slippage_bps: 1, taker_fee: 0 } });
    eq = next;
  }
  const trips = L.tripsFromReceipts(L.buildChain(ev)).trips;
  const g = L.liveGate(trips, { maxTradesPerDay: 10, maxPositionPct: 100, riskPct: 20 }, true);
  ok(g.checks.find(x => x.key === "trips").pass && g.checks.find(x => x.key === "days").pass, "trips and days: " + JSON.stringify(g.checks.map(x => [x.key, x.show])));
  ok(g.checks.find(x => x.key === "pf").pass && g.checks.find(x => x.key === "dd").pass, "pf and dd: " + JSON.stringify(g.checks.map(x => [x.key, x.show])));
  ok(g.locked === true, "passing the gate unlocks nothing");
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
