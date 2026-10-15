import { test } from "node:test";
import assert from "node:assert/strict";
import { backtest, newsSignal, positions, rsi, runAll, sma, type Candle } from "../src/lib/strategies.ts";

const series = (closes: number[]): Candle[] => closes.map((c, i) => ({ time: i, open: i ? closes[i - 1] : c, high: c * 1.01, low: c * 0.99, close: c, volume: 1 }));
const up = Array.from({ length: 120 }, (_, i) => 100 + i);              // steady rise
const down = Array.from({ length: 120 }, (_, i) => 220 - i);            // steady fall

test("indicators: SMA averages the window; RSI is high in a rise and low in a fall", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.ok(rsi(up)[119]! > 90);
  assert.ok(rsi(down)[119]! < 10);
});

test("trend following holds through a rise and stays out of a fall", () => {
  assert.equal(positions("trend", series(up)).at(-1), true);
  assert.equal(positions("trend", series(down)).at(-1), false);
  const bt = backtest(series(up), positions("trend", series(up)));
  assert.ok(bt.returnPct > 0 && bt.trades === 1 && bt.maxDrawdownPct === 0, JSON.stringify({ ...bt, equity: undefined }));
});

test("costs are charged: always-in loses a little against buy-and-hold", () => {
  const c = series(up), bt = backtest(c, c.map(() => true));
  assert.ok(bt.returnPct < bt.buyHoldPct && bt.buyHoldPct - bt.returnPct < 2, `${bt.returnPct} vs ${bt.buyHoldPct}`);
});

test("the news strategy follows World Pulse's lean for gold and Bitcoin only", () => {
  assert.equal(newsSignal("PAXGUSDT", [{ asset: "gold", net: 3 }]).signal, "buy");
  assert.equal(newsSignal("BTCUSDT", [{ asset: "btc", net: -3 }]).signal, "sell");
  assert.equal(newsSignal("SOLUSDT", [{ asset: "btc", net: -3 }]).signal, "hold");
});

test("runAll returns all five strategies with a backtest for the four price-based ones", () => {
  const r = runAll("BTCUSDT", series(up), []);
  assert.deepEqual(r.map(x => x.id), ["trend", "meanrev", "breakout", "momentum", "news"]);
  assert.ok(r.slice(0, 4).every(x => x.backtest && x.backtest.equity.length === 119));
  assert.equal(r[4].backtest, null);
});
