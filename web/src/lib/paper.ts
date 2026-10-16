// Paper trading (ADR-044, blocker 5): a practice account in made-up USDT. Orders fill at the live public Binance price
// plus a fee and slippage, so results are close to what the real thing would cost. It never talks to an exchange's
// trading API, never holds exchange keys and never moves money: the only network call is the keyless price feed.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const FEE = 0.001;          // Binance spot taker fee, 0.1%
export const SLIPPAGE = 0.0005;    // the fill is 0.05% worse than the last price
export const MIN_ORDER_USD = 10;   // Binance's minimum notional
export const DEFAULT_START = 10_000;
const SYMBOL = /^[A-Z0-9]{2,15}USDT$/;

export type Side = "buy" | "sell";
export type Fill = { id: string; at: string; symbol: string; side: Side; qty: number; price: number; fee: number; usd: number; realized: number };
export type PaperEvent = { type: "reset"; at: string; start_usd: number } | ({ type: "fill" } & Fill);
export type Holding = { symbol: string; qty: number; avg: number; cost: number };
export type Account = { start_usd: number; since: string | null; cash: number; holdings: Holding[]; fills: Fill[]; realized: number; fees: number };
export type Order = { symbol: string; side: Side; usd?: number; qty?: number; mode?: "paper" };
export type Marked = Holding & { price: number | null; value: number | null; gain: number | null; gainPct: number | null };
export type Snapshot = Account & { marked: Marked[]; equity: number; returnPct: number };

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const DUST = 1e-9;

/** Rebuild the account from its event log; the log is the only state, so every number can be audited. */
export function replay(events: PaperEvent[]): Account {
  let acc: Account = { start_usd: DEFAULT_START, since: null, cash: DEFAULT_START, holdings: [], fills: [], realized: 0, fees: 0 };
  const book = new Map<string, Holding>();
  for (const e of events) {
    if (e.type === "reset") {
      acc = { start_usd: e.start_usd, since: e.at, cash: e.start_usd, holdings: [], fills: [], realized: 0, fees: 0 };
      book.clear();
      continue;
    }
    const h = book.get(e.symbol) ?? { symbol: e.symbol, qty: 0, avg: 0, cost: 0 };
    if (e.side === "buy") {
      acc.cash -= e.usd + e.fee;
      h.cost += e.usd + e.fee;      // fees are part of what the position cost
      h.qty += e.qty;
    } else {
      const share = h.qty > 0 ? e.qty / h.qty : 1;
      h.cost -= h.cost * share;
      h.qty -= e.qty;
      acc.cash += e.usd - e.fee;
      acc.realized += e.realized;
    }
    h.avg = h.qty > DUST ? h.cost / h.qty : 0;
    if (h.qty > DUST) book.set(e.symbol, h); else book.delete(e.symbol);
    acc.fees += e.fee;
    acc.fills.push({ id: e.id, at: e.at, symbol: e.symbol, side: e.side, qty: e.qty, price: e.price, fee: e.fee, usd: e.usd, realized: e.realized });
  }
  acc.cash = round(acc.cash, 6);
  acc.realized = round(acc.realized, 6);
  acc.fees = round(acc.fees, 6);
  acc.holdings = [...book.values()].map(h => ({ ...h, qty: round(h.qty, 10), cost: round(h.cost, 6), avg: round(h.avg, 8) }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return acc;
}

// Anything that would only make sense for a real exchange order. Their presence alone gets the order refused.
const LIVE_ONLY = ["apiKey", "api_key", "secret", "signature", "exchange", "leverage", "margin", "live", "real", "execute"];

/** The engine takes paper orders only: a mode other than "paper", or any live-order field, is refused outright. */
export function assertPaper(order: unknown): void {
  if (!order || typeof order !== "object") throw new Error("not a paper order");
  const o = order as Record<string, unknown>;
  if (o.mode !== undefined && o.mode !== "paper") throw new Error("paper orders only: OMEGA never places real orders");
  const bad = LIVE_ONLY.find(k => k in o);
  if (bad) throw new Error(`paper orders only: "${bad}" is not accepted`);
}

/** Validate an order against the account and the last price; returns the fill or throws a message for the screen. */
export function fillOrder(acc: Account, order: Order, lastPrice: number, now = new Date()): Fill {
  assertPaper(order);
  const symbol = String(order.symbol ?? "").toUpperCase();
  if (!SYMBOL.test(symbol)) throw new Error("pick a USDT pair, like BTCUSDT");
  if (order.side !== "buy" && order.side !== "sell") throw new Error("side must be buy or sell");
  if (!(lastPrice > 0)) throw new Error(`no live price for ${symbol}`);
  const base = { id: randomBytes(6).toString("hex"), at: now.toISOString(), symbol, side: order.side };

  if (order.side === "buy") {
    const usd = Number(order.usd);
    if (!(usd >= MIN_ORDER_USD)) throw new Error(`the smallest order is ${MIN_ORDER_USD} USDT`);
    const fee = usd * FEE;
    if (usd + fee > acc.cash + DUST) throw new Error(`not enough paper cash (${round(acc.cash)} USDT left)`);
    const price = lastPrice * (1 + SLIPPAGE);
    return { ...base, qty: round(usd / price, 10), price: round(price, 8), fee: round(fee, 6), usd: round(usd, 6), realized: 0 };
  }

  const held = acc.holdings.find(h => h.symbol === symbol);
  if (!held) throw new Error(`you hold no ${symbol} in the paper account`);
  // usd sells that much at the current price; qty sells exactly that much; neither sells it all.
  const want = order.qty != null ? Number(order.qty) : order.usd != null ? Number(order.usd) / lastPrice : held.qty;
  if (!(want > 0)) throw new Error("the amount must be more than zero");
  const qty = want > held.qty * (1 - 1e-6) ? held.qty : want;   // rounding near "all" sells all
  const price = lastPrice * (1 - SLIPPAGE);
  const usd = qty * price;
  if (usd < MIN_ORDER_USD && qty !== held.qty) throw new Error(`the smallest order is ${MIN_ORDER_USD} USDT`);
  const fee = usd * FEE;
  const costShare = held.cost * (qty / held.qty);
  return { ...base, qty: round(qty, 10), price: round(price, 8), fee: round(fee, 6), usd: round(usd, 6), realized: round(usd - fee - costShare, 6) };
}

/** Value every holding at the latest prices. Holdings without a price count at cost, and say so. */
export function snapshot(acc: Account, prices: Record<string, number>): Snapshot {
  const marked = acc.holdings.map((h): Marked => {
    const price = prices[h.symbol];
    if (!(price > 0)) return { ...h, price: null, value: null, gain: null, gainPct: null };
    const value = h.qty * price;
    return { ...h, price, value: round(value), gain: round(value - h.cost), gainPct: h.cost > 0 ? round(((value - h.cost) / h.cost) * 100, 2) : null };
  });
  const equity = acc.cash + marked.reduce((s, m) => s + (m.value ?? m.cost), 0);
  return { ...acc, marked, equity: round(equity), returnPct: round(((equity - acc.start_usd) / acc.start_usd) * 100, 2) };
}

export function validStart(n: unknown): number {
  const v = Number(n ?? DEFAULT_START);
  if (!(v >= 100 && v <= 10_000_000)) throw new Error("the starting balance must be between 100 and 10,000,000 USDT");
  return round(v);
}

// The log lives with Director 00's data (git-ignored, inside the restic backup).
export const ledgerPath = (dataDir: string) => path.join(dataDir, "paper", "ledger.jsonl");

export async function loadEvents(dataDir: string): Promise<PaperEvent[]> {
  let raw = "";
  try { raw = await readFile(ledgerPath(dataDir), "utf8"); } catch { return []; }
  return raw.split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as PaperEvent]; } catch { return []; } });
}

export async function appendEvent(dataDir: string, e: PaperEvent): Promise<void> {
  await mkdir(path.dirname(ledgerPath(dataDir)), { recursive: true });
  await appendFile(ledgerPath(dataDir), JSON.stringify(e) + "\n");
}

/** One write at a time across the paper routes, so two quick taps (or an order and an approval) can't spend the same cash. */
let queue: Promise<unknown> = Promise.resolve();
export const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => null); return p; };
