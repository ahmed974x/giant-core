import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendEvent, assertPaper, FEE, fillOrder, loadEvents, replay, SLIPPAGE, snapshot, validStart, type PaperEvent } from "../src/lib/paper.ts";

const at = new Date("2026-10-10T12:00:00Z");
const ev = (f: ReturnType<typeof fillOrder>): PaperEvent => ({ type: "fill", ...f });

test("a buy spends cash plus fee at a slightly worse price; the position carries the fee in its cost", () => {
  const acc = replay([{ type: "reset", at: at.toISOString(), start_usd: 10_000 }]);
  const buy = fillOrder(acc, { symbol: "btcusdt", side: "buy", usd: 1000 }, 50_000, at);
  assert.equal(buy.symbol, "BTCUSDT");
  assert.equal(buy.price, 50_000 * (1 + SLIPPAGE));
  assert.equal(buy.fee, 1000 * FEE);
  const after = replay([{ type: "reset", at: at.toISOString(), start_usd: 10_000 }, ev(buy)]);
  assert.equal(after.cash, 10_000 - 1000 - 1);
  assert.deepEqual(after.holdings.map(h => [h.symbol, h.cost]), [["BTCUSDT", 1001]]);
  // Marked at the same price, the account is down only by the fee and slippage.
  const snap = snapshot(after, { BTCUSDT: 50_000 });
  assert.ok(snap.equity < 10_000 && snap.equity > 9_997, String(snap.equity));
});

test("selling half then the rest realizes the gain and closes the position", () => {
  const start: PaperEvent = { type: "reset", at: at.toISOString(), start_usd: 10_000 };
  const buy = fillOrder(replay([start]), { symbol: "ETHUSDT", side: "buy", usd: 2000 }, 2000, at);
  let log: PaperEvent[] = [start, ev(buy)];
  const half = fillOrder(replay(log), { symbol: "ETHUSDT", side: "sell", qty: buy.qty / 2 }, 2400, at);
  log = [...log, ev(half)];
  assert.ok(half.realized > 190 && half.realized < 200, `realized ${half.realized}`);
  const rest = fillOrder(replay(log), { symbol: "ETHUSDT", side: "sell" }, 2400, at);   // no amount = sell all
  log = [...log, ev(rest)];
  const acc = replay(log);
  assert.deepEqual(acc.holdings, []);
  assert.equal(acc.fills.length, 3);
  assert.ok(Math.abs(acc.cash - (10_000 + acc.realized)) < 1e-6, "cash = start + realized once flat");
  assert.ok(acc.realized > 380 && acc.realized < 400);
});

test("orders the account can't cover are refused with a plain reason", () => {
  const acc = replay([{ type: "reset", at: at.toISOString(), start_usd: 100 }]);
  assert.throws(() => fillOrder(acc, { symbol: "BTCUSDT", side: "buy", usd: 100 }, 50_000), /not enough paper cash/);
  assert.throws(() => fillOrder(acc, { symbol: "BTCUSDT", side: "buy", usd: 5 }, 50_000), /smallest order/);
  assert.throws(() => fillOrder(acc, { symbol: "BTCUSDT", side: "sell", qty: 1 }, 50_000), /hold no BTCUSDT/);
  assert.throws(() => fillOrder(acc, { symbol: "BTC-EUR", side: "buy", usd: 20 }, 1), /USDT pair/);
  assert.throws(() => fillOrder(acc, { symbol: "BTCUSDT", side: "buy", usd: 20 }, NaN), /no live price/);
  assert.throws(() => fillOrder(acc, { symbol: "BTCUSDT", side: "short" as never, usd: 20 }, 1), /buy or sell/);
  assert.throws(() => validStart(5), /between 100/);
  assert.equal(validStart(undefined), 10_000);
});

test("a reset starts a fresh account; holdings without a price count at cost", () => {
  const start: PaperEvent = { type: "reset", at: at.toISOString(), start_usd: 10_000 };
  const buy = fillOrder(replay([start]), { symbol: "SOLUSDT", side: "buy", usd: 500 }, 100, at);
  const snap = snapshot(replay([start, ev(buy)]), {});
  assert.equal(snap.marked[0].price, null);
  assert.equal(snap.equity, 10_000);
  const fresh = replay([start, ev(buy), { type: "reset", at: at.toISOString(), start_usd: 2_000 }]);
  assert.deepEqual([fresh.cash, fresh.holdings.length, fresh.fills.length], [2_000, 0, 0]);
});

test("the log is append-only JSON lines and survives a damaged line", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "omega-paper-"));
  assert.deepEqual(await loadEvents(dir), []);
  await appendEvent(dir, { type: "reset", at: at.toISOString(), start_usd: 500 });
  const file = path.join(dir, "paper", "ledger.jsonl");
  const { appendFileSync } = await import("node:fs");
  appendFileSync(file, "{broken\n");
  assert.equal((await loadEvents(dir)).length, 1);
  assert.equal(replay(await loadEvents(dir)).cash, 500);
});

test("paper trading has no path to a real exchange: no order endpoint, no signing, no keys", () => {
  for (const f of ["src/lib/paper.ts", "src/app/api/paper/route.ts", "src/components/PaperTrading.tsx",
    "src/lib/paper-proposals.ts", "src/app/api/paper/proposals/route.ts", "src/components/PaperProposals.tsx"]) {
    const src = readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8");
    for (const bad of [/api\/v3\/order/i, /X-MBX-APIKEY/i, /createHmac/, /signature=/i, /BINANCE_(API_)?(KEY|SECRET)/i, /\/fapi\//, /withdraw/i])
      assert.ok(!bad.test(src), `${f} must not contain ${bad}`);
  }
});

test("the engine refuses anything that is not a paper order", () => {
  const acc = replay([{ type: "reset", at: at.toISOString(), start_usd: 10_000 }]);
  const ok = { symbol: "BTCUSDT", side: "buy" as const, usd: 100 };
  assert.equal(fillOrder(acc, { ...ok, mode: "paper" }, 50_000, at).symbol, "BTCUSDT");
  for (const mode of ["live", "real", "spot", ""])
    assert.throws(() => fillOrder(acc, { ...ok, mode } as never, 50_000, at), /paper orders only/);
  for (const k of ["apiKey", "secret", "signature", "exchange", "leverage", "margin", "live", "execute"])
    assert.throws(() => fillOrder(acc, { ...ok, [k]: "x" } as never, 50_000, at), new RegExp(`"${k}" is not accepted`));
  assert.throws(() => assertPaper(null), /not a paper order/);
});
