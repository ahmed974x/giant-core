// OMEGA Quant: pure risk metrics over 5-minute closes, built on stdlib's incremental accumulators.
// Every function takes plain arrays and returns plain JSON, so it is testable without the stack.
"use strict";
const incrmstdev = require("@stdlib/stats-incr-mstdev");
const incrmmean = require("@stdlib/stats-incr-mmean");
const increwvariance = require("@stdlib/stats-incr-ewvariance");
const incrmpcorr = require("@stdlib/stats-incr-mpcorr");
const normalCdf = require("@stdlib/stats-base-dists-normal-cdf");

const BAR_MIN = 5;                                   // candles_5m
const BARS_PER_HOUR = 60 / BAR_MIN;
const BARS_PER_YEAR = 365 * 24 * BARS_PER_HOUR;      // crypto trades around the clock
const LAMBDA = 0.94;                                 // RiskMetrics decay for EWMA volatility
const Z_WINDOW = 24 * BARS_PER_HOUR;                 // z-score baseline: the last 24h of bars

const round = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/** Log returns of a close series. */
function logReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  return r;
}

/** Percent change over the last `bars` bars (null when the series is too short). */
function momentum(closes, bars) {
  if (closes.length <= bars) return null;
  const a = closes[closes.length - 1 - bars], b = closes[closes.length - 1];
  return round((b / a - 1) * 100, 3);
}

/** Largest peak-to-trough fall, in percent (negative). */
function maxDrawdown(closes) {
  let peak = -Infinity, dd = 0;
  for (const c of closes) { peak = Math.max(peak, c); dd = Math.min(dd, c / peak - 1); }
  return round(dd * 100, 3);
}

/** Risk metrics for one pair. */
function analyse(closes) {
  const r = logReturns(closes);
  if (r.length < 12) return null;

  // realised volatility over the whole window, annualised
  const sd = incrmstdev(r.length);
  let realised = 0; for (const x of r) realised = sd(x);
  // EWMA variance (RiskMetrics): reacts within hours instead of days
  const ew = increwvariance(1 - LAMBDA);
  let ewv = 0; for (const x of r) ewv = ew(x);

  // z-score of the newest return against the trailing baseline (newest excluded from its own baseline)
  const W = Math.min(Z_WINDOW, r.length - 1), mu = incrmmean(W), sigma = incrmstdev(W);
  let m = 0, s = 0; for (const x of r.slice(-W - 1, -1)) { m = mu(x); s = sigma(x); }
  const last = r[r.length - 1], z = s > 0 ? (last - m) / s : 0;
  const tail = 2 * (1 - normalCdf(Math.abs(z), 0, 1));     // two-sided odds of a move this size under a normal baseline

  const volAnn = realised * Math.sqrt(BARS_PER_YEAR), ewAnn = Math.sqrt(ewv) * Math.sqrt(BARS_PER_YEAR);
  const regime = ewAnn > volAnn * 1.5 ? "turbulent" : ewAnn < volAnn * 0.7 ? "calm" : "normal";
  return {
    close: closes[closes.length - 1],
    bars: closes.length,
    vol_ann_pct: round(volAnn * 100, 2),
    ewma_vol_ann_pct: round(ewAnn * 100, 2),
    regime,
    last_return_pct: round(last * 100, 4),
    zscore: round(z, 2),
    tail_prob: round(tail, 5),
    momentum_pct: { "1h": momentum(closes, BARS_PER_HOUR), "6h": momentum(closes, 6 * BARS_PER_HOUR), "24h": momentum(closes, 24 * BARS_PER_HOUR) },
    max_drawdown_pct: maxDrawdown(closes),
  };
}

/** Pearson correlation of returns for every pair of symbols, aligned on timestamp. */
function correlations(seriesBySymbol) {
  const syms = Object.keys(seriesBySymbol).sort(), out = {};
  const returnsByTs = {};
  for (const s of syms) {
    const rows = seriesBySymbol[s], m = new Map();
    for (let i = 1; i < rows.length; i++) if (rows[i - 1].close > 0) m.set(rows[i].ts, Math.log(rows[i].close / rows[i - 1].close));
    returnsByTs[s] = m;
  }
  for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) {
    const a = returnsByTs[syms[i]], b = returnsByTs[syms[j]], common = [...a.keys()].filter(t => b.has(t));
    if (common.length < 12) { out[`${syms[i]}/${syms[j]}`] = null; continue; }
    const pc = incrmpcorr(common.length);
    let c = 0; for (const t of common) c = pc(a.get(t), b.get(t));
    out[`${syms[i]}/${syms[j]}`] = round(c, 3);
  }
  return out;
}

/** Full snapshot from {symbol: [{ts, close}, ...]} sorted ascending. */
function snapshot(seriesBySymbol, source) {
  const pairs = {};
  for (const [s, rows] of Object.entries(seriesBySymbol)) pairs[s] = analyse(rows.map(r => Number(r.close)));
  return { at: new Date().toISOString(), source, bar_minutes: BAR_MIN, pairs, correlations: correlations(seriesBySymbol) };
}

module.exports = { logReturns, momentum, maxDrawdown, analyse, correlations, snapshot, BARS_PER_HOUR };
