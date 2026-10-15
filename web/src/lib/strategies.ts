// Trading strategies (ADR-052): five classic strategy types, each backtested on real candles and giving today's
// signal. Long-only and spot, with the same 0.1% fee and 0.05% slippage as the paper account. Results describe the
// past; they are not a promise. Nothing here places an order: the screen can send a signal to the paper account only.
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Signal = "buy" | "sell" | "hold";
export type StrategyId = "trend" | "meanrev" | "breakout" | "momentum" | "news";
export type Backtest = { returnPct: number; buyHoldPct: number; maxDrawdownPct: number; trades: number; winRatePct: number | null; exposurePct: number;
  equity: number[] };
export type Result = { id: StrategyId; signal: Signal; reason: Record<string, number | string>; backtest: Backtest | null };

const FEE = 0.001, SLIP = 0.0005;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function sma(xs: number[], n: number): (number | null)[] {
  let s = 0;
  return xs.map((x, i) => { s += x; if (i >= n) s -= xs[i - n]; return i >= n - 1 ? s / n : null; });
}
export function ema(xs: number[], n: number): (number | null)[] {
  const k = 2 / (n + 1); let e: number | null = null;
  return xs.map((x, i) => { if (i < n - 1) return null; e = e == null ? xs.slice(0, n).reduce((a, b) => a + b, 0) / n : x * k + e * (1 - k); return e; });
}
export function rsi(xs: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = [null]; let g = 0, l = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; out.push(i === n ? 100 - 100 / (1 + (g / n) / ((l / n) || 1e-12)) : null); if (i === n) { g /= n; l /= n; } continue; }
    g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
    out.push(100 - 100 / (1 + g / (l || 1e-12)));
  }
  return out;
}

/** Position wanted at each bar (true = hold the asset) for one strategy. Decisions use data up to that bar only. */
export function positions(id: Exclude<StrategyId, "news">, c: Candle[]): boolean[] {
  const close = c.map(x => x.close), out: boolean[] = [];
  let inPos = false;
  if (id === "trend") {
    const f = sma(close, 20), s = sma(close, 50);
    for (let i = 0; i < c.length; i++) { if (f[i] != null && s[i] != null) inPos = f[i]! > s[i]!; out.push(inPos); }
  } else if (id === "meanrev") {
    const r = rsi(close, 14);
    for (let i = 0; i < c.length; i++) { const v = r[i]; if (v != null) { if (!inPos && v < 30) inPos = true; else if (inPos && v > 55) inPos = false; } out.push(inPos); }
  } else if (id === "breakout") {
    for (let i = 0; i < c.length; i++) {
      if (i >= 20) {
        const prev = c.slice(i - 20, i), hi = Math.max(...prev.map(x => x.high)), lo = Math.min(...prev.slice(10).map(x => x.low));
        if (!inPos && close[i] > hi) inPos = true; else if (inPos && close[i] < lo) inPos = false;
      }
      out.push(inPos);
    }
  } else {
    const e12 = ema(close, 12), e26 = ema(close, 26);
    const macd = close.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i]! - e26[i]! : null));
    const valid = macd.map(v => v ?? 0), sig = ema(valid, 9);
    for (let i = 0; i < c.length; i++) { if (macd[i] != null && i >= 34 && sig[i] != null) inPos = macd[i]! > sig[i]!; out.push(inPos); }
  }
  return out;
}

/** Trade the wanted positions at the next bar's open, with fee and slippage. */
export function backtest(c: Candle[], want: boolean[]): Backtest {
  let cash = 1, qty = 0, entry = 0, wins = 0, trades = 0, peak = 1, maxDd = 0, held = 0;
  const equity: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const px = c[i].open;
    if (want[i - 1] && qty === 0) { const p = px * (1 + SLIP); qty = (cash * (1 - FEE)) / p; entry = p; cash = 0; }
    else if (!want[i - 1] && qty > 0) { const p = px * (1 - SLIP); cash = qty * p * (1 - FEE); trades++; if (p > entry) wins++; qty = 0; }
    if (qty > 0) held++;
    const eq = cash + qty * c[i].close;
    peak = Math.max(peak, eq); maxDd = Math.max(maxDd, (peak - eq) / peak);
    equity.push(round(eq, 4));
  }
  if (qty > 0) { trades++; if (c[c.length - 1].close > entry) wins++; }
  const last = equity[equity.length - 1] ?? 1;
  return { returnPct: round((last - 1) * 100), buyHoldPct: round((c[c.length - 1].close / c[0].close - 1) * 100), maxDrawdownPct: round(maxDd * 100),
    trades, winRatePct: trades ? round((wins / trades) * 100, 0) : null, exposurePct: round((held / Math.max(1, c.length - 1)) * 100, 0), equity };
}

function signalOf(want: boolean[]): Signal {
  const a = want[want.length - 1], b = want[want.length - 2];
  return a && !b ? "buy" : !a && b ? "sell" : "hold";
}

/** News-driven: World Pulse's lean for the asset (no backtest, because the news history isn't stored long enough). */
export function newsSignal(symbol: string, lean: { asset: string; net: number }[]): Result {
  const asset = symbol.startsWith("PAXG") ? "gold" : symbol.startsWith("BTC") ? "btc" : null;
  const net = asset ? lean.find(l => l.asset === asset)?.net ?? 0 : 0;
  return { id: "news", signal: net >= 2 ? "buy" : net <= -2 ? "sell" : "hold", reason: { asset: asset ?? "none", lean: net }, backtest: null };
}

export function runAll(symbol: string, c: Candle[], lean: { asset: string; net: number }[]): Result[] {
  const close = c.map(x => x.close), last = close.length - 1;
  const ids = ["trend", "meanrev", "breakout", "momentum"] as const;
  const out: Result[] = ids.map(id => {
    const want = positions(id, c);
    const reason: Record<string, number | string> =
      id === "trend" ? { sma20: round(sma(close, 20)[last] ?? NaN), sma50: round(sma(close, 50)[last] ?? NaN) }
      : id === "meanrev" ? { rsi: round(rsi(close, 14)[last] ?? NaN, 1) }
      : id === "breakout" ? { high20: round(Math.max(...c.slice(-21, -1).map(x => x.high))) }
      : { inMarket: want[last] ? "yes" : "no" };
    return { id, signal: signalOf(want), reason, backtest: backtest(c, want) };
  });
  out.push(newsSignal(symbol, lean));
  return out;
}
