import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEvents, replay, type PaperEvent } from "../src/lib/paper.ts";
import { appendProposalEvent, approve, loadProposalEvents, makeProposal, MAX_DRIFT, PROPOSAL_TTL_MS, PROPOSAL_USD, proposalsFromSignals,
  reject, replayProposals, validId, type ProposalEvent } from "../src/lib/paper-proposals.ts";
import type { Result } from "../src/lib/strategies.ts";

const at = new Date("2026-10-15T12:00:00Z");
const start: PaperEvent = { type: "reset", at: at.toISOString(), start_usd: 10_000 };
const results: Result[] = [
  { id: "trend", signal: "buy", reason: { sma20: 101, sma50: 99 }, backtest: { returnPct: 12, buyHoldPct: 8, maxDrawdownPct: -9, trades: 4, winRatePct: 50, exposurePct: 60, equity: [] } },
  { id: "meanrev", signal: "hold", reason: { rsi: 50 }, backtest: null },
  { id: "breakout", signal: "sell", reason: { high20: 120 }, backtest: null },
  { id: "news", signal: "buy", reason: { asset: "btc", lean: 2 }, backtest: null },
];
const evidence = { source: "manual", summary: { note: "test" }, url: "https://example.org/data", observed_price: 100, observed_at: at.toISOString() };

test("signals become proposals with their numbers and a link to the raw data; holds and unheld sells are skipped", () => {
  const ps = proposalsFromSignals({ symbol: "BTCUSDT", interval: "1d", price: 100, results, account: replay([start]), pending: [] }, at);
  assert.deepEqual(ps.map(p => [p.side, p.evidence.source]), [["buy", "strategy:trend 1d"], ["buy", "strategy:news 1d"]]);
  const trend = ps[0];
  assert.equal(trend.usd, PROPOSAL_USD);
  assert.equal(trend.evidence.url, "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=500");
  assert.deepEqual(trend.evidence.summary, { sma20: 101, sma50: 99, backtestReturnPct: 12, buyHoldPct: 8, maxDrawdownPct: -9 });
  assert.equal(trend.evidence.observed_price, 100);
  assert.equal(ps[1].evidence.url, "/api/worldpulse");
  // A second scan doesn't duplicate what is still pending.
  const pending = replayProposals(ps.map(p => ({ type: "proposed", ...p }) as ProposalEvent), at);
  assert.equal(proposalsFromSignals({ symbol: "BTCUSDT", interval: "1d", price: 100, results, account: replay([start]), pending }, at).length, 0);
});

test("a proposal without evidence, source or price is refused", () => {
  assert.throws(() => makeProposal({ symbol: "BTCUSDT", side: "buy", evidence: { ...evidence, url: "" } }), /link to its evidence/);
  assert.throws(() => makeProposal({ symbol: "BTCUSDT", side: "buy", evidence: { ...evidence, url: "javascript:alert(1)" } }), /link to its evidence/);
  assert.throws(() => makeProposal({ symbol: "BTCUSDT", side: "buy", evidence: { ...evidence, source: "" } }), /source/);
  assert.throws(() => makeProposal({ symbol: "BTCUSDT", side: "buy", evidence: { ...evidence, observed_price: 0 } }), /price it saw/);
  assert.throws(() => makeProposal({ symbol: "BTC-EUR", side: "buy", evidence }), /USDT pair/);
  assert.throws(() => validId("../etc"), /invalid proposal id/);
});

test("nothing is recorded until approval; approval fills once on paper and can't be repeated", () => {
  const p = makeProposal({ symbol: "BTCUSDT", side: "buy", usd: 100, evidence }, at);
  const log: ProposalEvent[] = [{ type: "proposed", ...p }];
  const [row] = replayProposals(log, at);
  assert.equal(row.status, "pending");
  const acc = replay([start]);
  assert.equal(acc.fills.length, 0, "a proposal alone leaves the account untouched");
  const { fill, event } = approve(row, acc, 101, "web:Ahmad", at);
  assert.equal(fill.side, "buy");
  assert.equal(fill.usd, 100);
  const after = replayProposals([...log, event], at);
  assert.equal(after[0].status, "approved");
  assert.equal(after[0].fill_id, fill.id);
  assert.throws(() => approve(after[0], acc, 101, "web:Ahmad", at), /already approved/);
  assert.throws(() => reject(after[0], "web:Ahmad", "late", at), /already approved/);
});

test("stale, drifted and rejected proposals can't be approved", () => {
  const p = makeProposal({ symbol: "BTCUSDT", side: "buy", usd: 100, evidence }, at);
  const log: ProposalEvent[] = [{ type: "proposed", ...p }];
  const acc = replay([start]);
  const later = new Date(at.getTime() + PROPOSAL_TTL_MS + 1);
  const [stale] = replayProposals(log, later);
  assert.equal(stale.status, "expired");
  assert.throws(() => approve(stale, acc, 100, "web:Ahmad", later), /already expired/);
  const [row] = replayProposals(log, at);
  assert.throws(() => approve(row, acc, 100 * (1 + MAX_DRIFT + 0.01), "web:Ahmad", at), /price moved/);
  assert.throws(() => approve(row, acc, NaN, "web:Ahmad", at), /no live price/);
  assert.throws(() => approve(undefined, acc, 100, "web:Ahmad", at), /no such proposal/);
  const rej = reject(row, "web:Ahmad", "not convinced", at);
  const [r] = replayProposals([...log, rej], at);
  assert.deepEqual([r.status, r.reason], ["rejected", "not convinced"]);
  assert.throws(() => approve(r, acc, 100, "web:Ahmad", at), /already rejected/);
});

test("the queue log is append-only JSON lines beside the paper ledger, and scanning never writes a fill", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "omega-proposals-"));
  const p = makeProposal({ symbol: "ETHUSDT", side: "buy", evidence }, at);
  await appendProposalEvent(dir, { type: "proposed", ...p });
  assert.equal((await loadProposalEvents(dir)).length, 1);
  assert.deepEqual(await loadEvents(dir), [], "the paper ledger is untouched by a proposal");
  // In the route, the paper ledger is written only inside the approve branch.
  const route = readFileSync(path.resolve(import.meta.dirname, "..", "src/app/api/paper/proposals/route.ts"), "utf8");
  const writes = [...route.matchAll(/appendEvent\(/g)].length;
  assert.equal(writes, 1, "one place writes fills");
  const approveBranch = route.slice(route.indexOf('body?.action === "approve"'), route.indexOf('body?.action === "reject"'));
  assert.ok(approveBranch.includes("appendEvent("), "that place is the approve branch");
});

test("both paper routes are PIN-guarded, and no trading code ships on the public landing page", () => {
  for (const f of ["src/app/api/paper/route.ts", "src/app/api/paper/proposals/route.ts"]) {
    const src = readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8");
    assert.equal([...src.matchAll(/export async function (GET|POST)/g)].length, [...src.matchAll(/const blocked = guard\(/g)].length, `${f}: every handler checks the PIN`);
  }
  // The public site (GitHub Pages, site-landing/) is static marketing copy; it must never call the private trading API.
  const landing = path.resolve(import.meta.dirname, "..", "..", "site-landing");
  let files: string[] = [];
  try { files = readdirSync(landing); } catch { /* not on this branch */ }
  for (const f of files) {
    const src = readFileSync(path.join(landing, f), "utf8");
    for (const bad of [/\/api\/paper/, /\/api\/strategies/, /\/api\/director/, /\/api\/sweeper/]) assert.ok(!bad.test(src), `site-landing/${f} must not contain ${bad}`);
  }
});
