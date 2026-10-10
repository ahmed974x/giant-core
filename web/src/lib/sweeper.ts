// Profit Sweeper (ADR-033): works out how much gain Ahmad's own rules would set aside into a reserve, and turns it into
// a Director 00 proposal. It never trades, never holds exchange keys and never moves money: approval only records the
// plan, and Ahmad carries out any sweep himself on his exchange.
export type Rules = { min_gain_pct: number; sweep_share: number; min_sweep_usd: number; reserve: string };
export type Position = { symbol: string; qty: number; cost_usd: number };
export type Line = { symbol: string; qty: number; price: number; value: number; cost: number; gain: number; gainPct: number;
  sweepUsd: number; sweepQty: number; reason: "sweep" | "below-threshold" | "too-small" | "loss" | "no-price" };
export type Plan = { lines: Line[]; totalSweepUsd: number; reserve: string };

const SYMBOL = /^[A-Z0-9]{5,20}$/;

export function validRules(r: unknown): Rules {
  const x = r as Partial<Rules>;
  const ok = x && typeof x.min_gain_pct === "number" && x.min_gain_pct >= 0 && x.min_gain_pct <= 1000
    && typeof x.sweep_share === "number" && x.sweep_share > 0 && x.sweep_share <= 1
    && typeof x.min_sweep_usd === "number" && x.min_sweep_usd >= 0 && typeof x.reserve === "string" && /^[A-Z]{2,10}$/.test(x.reserve);
  if (!ok) throw new Error("sweeper rules are out of range");
  return { min_gain_pct: x.min_gain_pct!, sweep_share: x.sweep_share!, min_sweep_usd: x.min_sweep_usd!, reserve: x.reserve! };
}

export function validPositions(p: unknown): Position[] {
  const list = (p as { positions?: unknown })?.positions;
  if (!Array.isArray(list)) throw new Error("positions.json needs a positions list");
  return list.slice(0, 100).map((x: Partial<Position>) => {
    if (!x || typeof x.symbol !== "string" || !SYMBOL.test(x.symbol) || !(Number(x.qty) > 0) || !(Number(x.cost_usd) >= 0))
      throw new Error(`bad position: ${JSON.stringify(x).slice(0, 80)}`);
    return { symbol: x.symbol, qty: Number(x.qty), cost_usd: Number(x.cost_usd) };
  });
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Sweep = share of the gain, only when the gain clears the threshold and the amount is worth a transaction. */
export function planSweep(positions: Position[], prices: Record<string, number>, rules: Rules): Plan {
  const lines = positions.map((p): Line => {
    const price = prices[p.symbol];
    const base = { symbol: p.symbol, qty: p.qty, price: price ?? NaN, cost: p.cost_usd };
    if (!(price > 0)) return { ...base, value: NaN, gain: NaN, gainPct: NaN, sweepUsd: 0, sweepQty: 0, reason: "no-price" };
    const value = p.qty * price, gain = value - p.cost_usd, gainPct = p.cost_usd > 0 ? (gain / p.cost_usd) * 100 : Infinity;
    const out = { ...base, value: round(value), gain: round(gain), gainPct: round(gainPct, 1) };
    if (gain <= 0) return { ...out, sweepUsd: 0, sweepQty: 0, reason: "loss" };
    if (gainPct < rules.min_gain_pct) return { ...out, sweepUsd: 0, sweepQty: 0, reason: "below-threshold" };
    const sweepUsd = gain * rules.sweep_share;
    if (sweepUsd < rules.min_sweep_usd) return { ...out, sweepUsd: 0, sweepQty: 0, reason: "too-small" };
    return { ...out, sweepUsd: round(sweepUsd), sweepQty: round(sweepUsd / price, 8), reason: "sweep" };
  });
  return { lines, totalSweepUsd: round(lines.reduce((s, l) => s + l.sweepUsd, 0)), reserve: rules.reserve };
}

/** The Director 00 request: a "remember: TASK" proposal, so it waits in the approval inbox and runs nothing. */
export function sweepRequest(plan: Plan, at = new Date()): string | null {
  const go = plan.lines.filter(l => l.reason === "sweep");
  if (!go.length) return null;
  const parts = go.map(l => `${l.symbol} sell ${l.sweepQty} (~$${l.sweepUsd}) of $${l.gain} gain (${l.gainPct}%)`);
  return `remember: TASK: profit sweep plan ${at.toISOString().slice(0, 10)}, move ~$${plan.totalSweepUsd} into ${plan.reserve}: ${parts.join("; ")}. Manual: Ahmad executes on his exchange; OMEGA does not trade.`;
}

/** Latest prices from Binance's public market-data mirror (keyless, read-only). */
export async function fetchPrices(symbols: string[], f: typeof fetch = fetch): Promise<Record<string, number>> {
  const list = [...new Set(symbols.filter(s => SYMBOL.test(s)))];
  if (!list.length) return {};
  const r = await f(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(list))}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`prices unavailable (${r.status})`);
  const j = await r.json() as { symbol: string; price: string }[];
  return Object.fromEntries(j.map(x => [x.symbol, Number(x.price)]));
}
