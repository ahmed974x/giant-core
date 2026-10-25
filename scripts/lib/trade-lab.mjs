// Trade lab engine (ADR-116): pure functions shared by the TRADE LAB page (inlined between the OMEGA_TRADELAB markers
// by scripts/build-tradelab-inline.mjs, because the page must work from file:// with no build step) and the Node tests
// (scripts/test-tradelab.mjs). No network, no storage, no clock except where a time is passed in.
//
// It reads the Ops Room's paper receipt chain (omega-receipt-chain-v1, ADR-091 and ADR-096), checks every hash,
// rebuilds the round trips (FILL_BUY → FILL_SELL…), and measures them the way a trading journal does: win rate,
// payoff, profit factor, expectancy, drawdown, streaks, R multiples against the written plan, a bootstrap of the
// trip returns, plan compliance, a personal paper discipline challenge, mistake tags from the journal and a market
// lens (RSI, MACD, moving averages, Bollinger bands, ATR) on Binance public candles. The desk manager agent turns
// those numbers into findings and proposals with fixed rules; every heuristic carries [INFERENCE] and every model
// figure [INFERENCE - Quant Model]. Paper only: nothing here signs, sends or routes an order, moves money or
// accepts a subscriber. Proposals go to Director 00 and change nothing until he applies them himself.
// ADR-130 adds the rule desk: an ATR risk card (stop, target, size within the plan) and a backtest of one fixed rule.

const GENESIS = "0".repeat(64);
const DAY = 86400000, MIN = 60000;
const finite = v => typeof v === "number" && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, d = 8) => finite(v) ? Number(v.toFixed(d)) : v;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const utcDay = ts => new Date(ts).toISOString().slice(0, 10);

// The receipt canonical form of the Ops Room and the NABD verifier (DESIGN.md §7): keys sorted, "hash" left out,
// numbers rounded to 8 decimals. SHA-256 in plain JavaScript (FIPS 180-4), so the same check runs in Node, over
// plain http on the LAN (no WebCrypto there) and from file://.
const canon = v => {
  if (typeof v === "number") return Number.isFinite(v) ? Number(v.toFixed(8)) : null;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) if (k !== "hash") o[k] = canon(v[k]); return o; }
  return v;
};
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function utf8(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { const d = text.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function sha256Hex(text) {
  const bytes = utf8(String(text)), len = bytes.length, total = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
  m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len << 3) >>> 0);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map(x => x.toString(16).padStart(8, "0")).join("");
}
const hashOf = obj => sha256Hex(JSON.stringify(canon(obj)));

function merkleRoot(hashes) {
  let level = hashes.slice();
  if (!level.length) return GENESIS;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256Hex(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}
// Same rules as the Ops Room verifier: checkpoints chain to each other, the first kept receipt follows the last
// checkpoint, and each receipt's hash is the SHA-256 of its canonical form.
function verifyChain(receipts, checkpoints = []) {
  let prev = GENESIS, prevCp = GENESIS, seq = 0;
  for (let i = 0; i < checkpoints.length; i++) {
    const c = checkpoints[i];
    if (!c || c.format !== "omega-merkle-checkpoint-v1") return { ok: false, at: -1, why: `checkpoint ${i + 1} is malformed` };
    if (c.first_prev_hash !== prev || c.prev_checkpoint !== prevCp || c.from_seq !== seq + 1 || c.count !== c.to_seq - c.from_seq + 1) return { ok: false, at: -1, why: `checkpoint ${i + 1} does not follow the one before it` };
    if (hashOf(c) !== c.hash) return { ok: false, at: -1, why: `checkpoint ${i + 1} was changed after it was made` };
    prev = c.last_hash; prevCp = c.hash; seq = c.to_seq;
  }
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    if (!r || typeof r.hash !== "string") return { ok: false, at: i, why: "receipt is malformed" };
    if (r.prev_hash !== prev) return { ok: false, at: i, why: "prev_hash does not match the receipt before it" };
    if (hashOf(r) !== r.hash) return { ok: false, at: i, why: "content was changed after it was issued" };
    if (r.mode !== "paper") return { ok: false, at: i, why: "receipt is not a paper receipt" };
    prev = r.hash;
  }
  return { ok: true, n: receipts.length, folded: checkpoints.reduce((a, c) => a + c.count, 0), tip: prev };
}
// Accepts the Ops Room export {"format":"omega-receipt-chain-v1","receipts":[…],"checkpoints":[…]} or a bare array.
function parseExport(input) {
  let j = input;
  if (typeof j === "string") { try { j = JSON.parse(j); } catch { return { ok: false, why: "the file is not JSON" }; } }
  if (Array.isArray(j)) j = { format: "omega-receipt-chain-v1", receipts: j, checkpoints: [] };
  if (!j || j.format !== "omega-receipt-chain-v1" || !Array.isArray(j.receipts)) return { ok: false, why: "not an omega-receipt-chain-v1 export from the Ops Room" };
  const checkpoints = Array.isArray(j.checkpoints) ? j.checkpoints : [];
  if (j.receipts.length > 5000) return { ok: false, why: "more than 5000 receipts; export again after the Ops Room folds them" };
  return { ok: true, receipts: j.receipts, checkpoints };
}
// Builds a valid chain from plain events; used for the labelled teaching example and the tests.
function buildChain(events) {
  const out = [];
  let prev = GENESIS;
  events.forEach((e, i) => {
    const seq = i + 1, ts = new Date(e.ts).toISOString();
    const r = { invoice: "OMG-" + ts.slice(0, 10).replaceAll("-", "") + "-" + String(seq).padStart(5, "0"), seq, ts, mode: "paper", symbol: e.symbol || "BTCUSDT", type: e.type, amount: round(e.amount, 6), before: e.before, after: e.after, reason: e.reason, prev_hash: prev };
    if (e.exec) r.exec = e.exec;
    r.hash = hashOf(r);
    prev = r.hash;
    out.push(r);
  });
  return out;
}

/* ---------- round trips ---------- */
const SIGNAL_RE = /^(Auto engine: )?(STRONG BUY|BUY|HOLD|SELL|STRONG SELL|WHALE TRAP WARNING) score (-?[\d.]+); ([\d.]+)% half-Kelly/;
function tripsFromReceipts(receipts) {
  const trips = [], gaps = [];
  let open = null;
  const close = (status, r) => {
    open.status = status;
    if (r) { open.closeTs = Date.parse(r.ts); open.closeSeq = r.seq; }
    if (status === "closed") {
      open.pnl = round(open.proceeds - open.cost, 6);
      open.ret = open.cost > 0 ? open.pnl / open.cost : NaN;
      open.exit = open.soldQty > 0 ? open.soldQuote / open.soldQty : NaN;
    }
    trips.push(open); open = null;
  };
  for (const r of receipts) {
    if (!r || typeof r.type !== "string") continue;
    const ts = Date.parse(r.ts), ex = r.exec && typeof r.exec === "object" ? r.exec : null;
    if (r.type === "FILL_BUY") {
      if (open) { gaps.push(`receipt #${r.seq}: a new paper buy started while trip ${open.id} was still open; that trip is left out`); close("unclosed"); }
      const m = SIGNAL_RE.exec(String(r.reason || ""));
      open = {
        id: "T" + r.seq, src: "ops", symbol: r.symbol, side: "long", openTs: ts, openSeq: r.seq, cost: +r.amount,
        qty: ex && finite(+ex.qty) ? +ex.qty : NaN, entry: ex && finite(+ex.vwap) ? +ex.vwap : NaN,
        fees: ex && finite(+ex.taker_fee) ? +ex.taker_fee : 0, slip: ex && finite(+ex.slippage_bps) ? [+ex.slippage_bps] : [],
        equityBefore: r.before && finite(+r.before.total) ? +r.before.total : NaN,
        signal: m ? m[2] : "", score: m ? +m[3] : NaN, kellyPct: m ? +m[4] : NaN, auto: !!(m && m[1]),
        proceeds: 0, soldQty: 0, soldQuote: 0, exits: [], status: "open"
      };
    } else if (r.type === "FILL_SELL") {
      if (!open) { gaps.push(`receipt #${r.seq}: a paper sell with no open buy before it`); continue; }
      const why = String(r.reason || "").replace(/ at L2 VWAP.*$/, "");
      open.proceeds += +r.amount;
      open.exits.push(why);
      if (ex) {
        open.soldQty += finite(+ex.qty) ? +ex.qty : 0;
        open.soldQuote += finite(+ex.quote) ? +ex.quote : 0;
        open.fees += finite(+ex.taker_fee) ? +ex.taker_fee : 0;
        if (finite(+ex.slippage_bps)) open.slip.push(+ex.slippage_bps);
      }
      const done = finite(open.qty) && open.qty > 0 ? open.soldQty >= open.qty * (1 - 1e-9) : !/^TP1/.test(why);
      if (done) close("closed", r);
    } else if (r.type === "KILL") {
      if (open) { gaps.push(`receipt #${r.seq}: the emergency stop closed trip ${open.id}; its exit price is not in the receipt, so the trip is left out of the numbers`); close("killed", r); }
    } else if (r.type === "SIM_TRADE") {
      const cost = r.before && finite(+r.before.trading) ? +r.before.trading : NaN;
      trips.push({ id: "S" + r.seq, src: "sim", symbol: r.symbol, side: "long", openTs: ts, closeTs: ts, openSeq: r.seq, closeSeq: r.seq, cost, proceeds: cost + +r.amount, pnl: +r.amount, ret: cost > 0 ? +r.amount / cost : NaN, fees: 0, slip: [], equityBefore: r.before && finite(+r.before.total) ? +r.before.total : NaN, signal: "", exits: ["test trade"], status: "closed", qty: NaN, entry: NaN, exit: NaN });
    }
  }
  if (open) trips.push(open);
  for (const t of trips) { t.slipBps = t.slip && t.slip.length ? mean(t.slip) : NaN; t.exitWhy = (t.exits || []).join(" → "); t.hold = finite(t.closeTs) ? t.closeTs - t.openTs : NaN; }
  return { trips, gaps };
}
// A trade written by hand in the journal (paper, long or short). Returns null with a reason when a field is wrong.
function manualTrip(f, id) {
  const n = k => (f[k] === "" || f[k] === undefined || f[k] === null ? NaN : +f[k]);
  const entry = n("entry"), exit = n("exit"), qty = n("qty"), fees = finite(n("fees")) ? n("fees") : 0, stop = n("stop");
  const openTs = Date.parse(f.openTs), closeTs = Date.parse(f.closeTs);
  const side = f.side === "short" ? "short" : "long";
  if (!(entry > 0) || !(exit > 0) || !(qty > 0)) return { ok: false, why: "entry, exit and quantity must be numbers above 0" };
  if (!finite(openTs) || !finite(closeTs) || closeTs < openTs) return { ok: false, why: "the close time must be on or after the open time" };
  if (finite(stop) && stop > 0 && (side === "long" ? stop >= entry : stop <= entry)) return { ok: false, why: "the stop must be on the losing side of the entry" };
  const symbol = String(f.symbol || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 16) || "MANUAL";
  const cost = entry * qty, gross = (side === "long" ? exit - entry : entry - exit) * qty, pnl = round(gross - fees, 6);
  const eq = n("equity");
  return { ok: true, trip: { id: id || "M" + openTs.toString(36), src: "manual", symbol, side, openTs, closeTs, hold: closeTs - openTs, entry, exit, qty, cost, proceeds: cost + pnl, pnl, ret: pnl / cost, fees, slip: [], slipBps: NaN, equityBefore: eq > 0 ? eq : NaN, stop: stop > 0 ? stop : NaN, signal: "manual", exits: ["manual"], exitWhy: "manual", status: "closed" } };
}

/* ---------- plan, risk unit and metrics ---------- */
const PLAN_DEFAULTS = Object.freeze({
  name: "", markets: "BTCUSDT", setups: "", startEquity: 20, riskPct: 1, maxPositionPct: 25, maxTradesPerDay: 3, maxDailyLossPct: 3,
  maxDrawdownPct: 10, minRR: 1.5, cooldownMin: 30, hourFrom: 0, hourTo: 24, onlySignals: true, rules: ""
});
function sanitizePlan(p) {
  const d = PLAN_DEFAULTS, o = { ...d };
  if (!p || typeof p !== "object") return o;
  const num = (k, lo, hi) => { const v = +p[k]; if (Number.isFinite(v)) o[k] = clamp(v, lo, hi); };
  num("startEquity", 0.01, 1e9); num("riskPct", 0.05, 20); num("maxPositionPct", 1, 100); num("maxTradesPerDay", 1, 100); num("maxDailyLossPct", 0.1, 50);
  num("maxDrawdownPct", 0.5, 90); num("minRR", 0, 20); num("cooldownMin", 0, 1440); num("hourFrom", 0, 23); num("hourTo", 1, 24);
  for (const k of ["name", "markets", "setups", "rules"]) if (typeof p[k] === "string") o[k] = p[k].replace(/[\u0000-\u0008\u000B-\u001F]/g, "").slice(0, k === "rules" ? 2000 : 200);
  o.onlySignals = p.onlySignals !== false;
  if (o.hourTo <= o.hourFrom) o.hourTo = Math.min(24, o.hourFrom + 1);
  return o;
}
const closedOf = trips => trips.filter(t => t.status === "closed" && finite(t.pnl)).sort((a, b) => a.closeTs - b.closeTs || a.openTs - b.openTs);
// One R is the money the plan allows a trade to lose: equity before the trade × riskPct. A manual trade with a
// stop uses its own (entry − stop) × quantity instead. R multiples are therefore "against the written plan".
function riskUnit(t, plan) {
  if (t.src === "manual" && finite(t.stop) && t.stop > 0) return Math.abs(t.entry - t.stop) * t.qty;
  const eq = finite(t.equityBefore) && t.equityBefore > 0 ? t.equityBefore : plan.startEquity;
  return eq * plan.riskPct / 100;
}
function equityCurve(trips, start) {
  const pts = [{ ts: trips.length ? trips[0].openTs : 0, eq: start, dd: 0 }];
  let eq = start, peak = start, maxDD = 0, maxDDAbs = 0;
  for (const t of trips) {
    eq += t.pnl; peak = Math.max(peak, eq);
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) { maxDD = dd; maxDDAbs = peak - eq; }
    pts.push({ ts: t.closeTs, eq, dd, id: t.id });
  }
  return { pts, maxDD, maxDDAbs, end: eq };
}
function metrics(allTrips, planIn) {
  const plan = sanitizePlan(planIn), trips = closedOf(allTrips);
  const n = trips.length, pnl = trips.map(t => t.pnl), wins = trips.filter(t => t.pnl > 0), losses = trips.filter(t => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length ? grossWin / wins.length : NaN, avgLoss = losses.length ? grossLoss / losses.length : NaN;
  const winRate = n ? wins.length / n : NaN, payoff = finite(avgWin) && avgLoss > 0 ? avgWin / avgLoss : NaN;
  const R = trips.map(t => { const u = riskUnit(t, plan); return u > 0 ? t.pnl / u : NaN; }).filter(finite);
  const rets = trips.map(t => finite(t.equityBefore) && t.equityBefore > 0 ? t.pnl / t.equityBefore : t.ret).filter(finite);
  const start = trips.length && finite(trips[0].equityBefore) && trips[0].equityBefore > 0 ? trips[0].equityBefore : plan.startEquity;
  const curve = equityCurve(trips, start);
  let maxLossStreak = 0, maxWinStreak = 0, cur = 0;
  for (const t of trips) {
    if (t.pnl < 0) cur = cur < 0 ? cur - 1 : -1; else if (t.pnl > 0) cur = cur > 0 ? cur + 1 : 1; else cur = 0;
    maxLossStreak = Math.max(maxLossStreak, -cur); maxWinStreak = Math.max(maxWinStreak, cur);
  }
  const holdW = wins.map(t => t.hold).filter(finite), holdL = losses.map(t => t.hold).filter(finite);
  const slips = trips.map(t => t.slipBps).filter(finite), fees = trips.reduce((s, t) => s + (finite(t.fees) ? t.fees : 0), 0);
  const sdR = sd(R), expR = mean(R);
  const kelly = finite(payoff) && payoff > 0 && finite(winRate) ? winRate - (1 - winRate) / payoff : NaN;
  const days = new Set(trips.map(t => utcDay(t.closeTs)));
  return {
    n, open: allTrips.filter(t => t.status === "open").length, left: allTrips.filter(t => t.status === "killed" || t.status === "unclosed").length,
    wins: wins.length, losses: losses.length, flat: n - wins.length - losses.length, winRate, avgWin, avgLoss, payoff,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : NaN), grossWin, grossLoss,
    net: pnl.reduce((s, x) => s + x, 0), expectancy: mean(pnl), expectancyR: expR, sdR, R,
    sqn: R.length >= 2 && sdR > 0 ? Math.sqrt(Math.min(R.length, 100)) * expR / sdR : NaN,
    sharpeTrade: rets.length >= 2 && sd(rets) > 0 ? mean(rets) / sd(rets) : NaN,
    breakevenWinRate: finite(avgWin) && finite(avgLoss) && avgWin + avgLoss > 0 ? avgLoss / (avgWin + avgLoss) : NaN,
    kelly, halfKelly: finite(kelly) ? Math.max(0, kelly / 2) : NaN,
    start, end: curve.end, maxDD: curve.maxDD, maxDDAbs: curve.maxDDAbs, curve: curve.pts,
    maxLossStreak, maxWinStreak, streak: cur, holdWin: mean(holdW), holdLoss: mean(holdL),
    fees, feeShare: grossWin > 0 ? fees / grossWin : NaN, slipBps: mean(slips), days: days.size,
    retPerTrade: rets
  };
}
// R-multiple histogram, buckets of 0.5 R from −3 to +3 (outside values go to the end buckets).
function histogramR(R) {
  const edges = []; for (let x = -3; x < 3; x += 0.5) edges.push(x);
  const bins = edges.map(lo => ({ lo, hi: lo + 0.5, n: 0 }));
  for (const r of R) { const i = clamp(Math.floor((r + 3) / 0.5), 0, bins.length - 1); bins[i].n++; }
  return bins;
}
function byBucket(trips, kind) {
  const keyOf = t => { const d = new Date(t.openTs); return kind === "weekday" ? d.getUTCDay() : d.getUTCHours(); };
  const size = kind === "weekday" ? 7 : 24, out = Array.from({ length: size }, (_, k) => ({ k, n: 0, pnl: 0, wins: 0 }));
  for (const t of closedOf(trips)) { const b = out[keyOf(t)]; b.n++; b.pnl += t.pnl; if (t.pnl > 0) b.wins++; }
  return out;
}

/* ---------- plan compliance and the paper discipline challenge ---------- */
const RULES = Object.freeze({
  size: { ar: "حجم المركز فوق حد الخطة", en: "position above the plan's size limit" },
  loss: { ar: "الخسارة تجاوزت 1R (الوقف لم يُحترم)", en: "loss beyond 1R (stop not respected)" },
  count: { ar: "صفقات فوق الحد اليومي", en: "more trades than the daily limit" },
  daily: { ar: "تداول بعد بلوغ حد الخسارة اليومي", en: "traded after the daily loss limit" },
  revenge: { ar: "صفقة خلال فترة التهدئة بعد خسارة", en: "trade inside the cool-down after a loss" },
  hours: { ar: "خارج ساعات الخطة (UTC)", en: "outside the plan's hours (UTC)" },
  signal: { ar: "دخول بلا إشارة شراء", en: "entry without a BUY signal" }
});
function compliance(allTrips, planIn) {
  const plan = sanitizePlan(planIn), trips = allTrips.filter(t => t.status === "closed" && finite(t.pnl)).sort((a, b) => a.openTs - b.openTs);
  const rows = [], counts = Object.fromEntries(Object.keys(RULES).map(k => [k, 0]));
  const perDay = new Map(), dayLoss = new Map(), dayStart = new Map();
  let lastLossClose = -Infinity, eqRun = trips.length && finite(trips[0].equityBefore) ? trips[0].equityBefore : plan.startEquity;
  for (const t of trips) {
    const v = [], day = utcDay(t.openTs), eq = finite(t.equityBefore) && t.equityBefore > 0 ? t.equityBefore : eqRun;
    if (!dayStart.has(day)) dayStart.set(day, eq);
    if (finite(t.cost) && eq > 0 && t.cost / eq * 100 > plan.maxPositionPct + 1e-9) v.push("size");
    const u = riskUnit(t, plan);
    if (u > 0 && t.pnl < -u * 1.0001) v.push("loss");
    const c = (perDay.get(day) || 0) + 1; perDay.set(day, c);
    if (c > plan.maxTradesPerDay) v.push("count");
    if ((dayLoss.get(day) || 0) >= dayStart.get(day) * plan.maxDailyLossPct / 100) v.push("daily");
    if (plan.cooldownMin > 0 && t.openTs - lastLossClose < plan.cooldownMin * MIN) v.push("revenge");
    const hr = new Date(t.openTs).getUTCHours();
    if (hr < plan.hourFrom || hr >= plan.hourTo) v.push("hours");
    if (plan.onlySignals && t.src === "ops" && t.signal && !/BUY$/.test(t.signal)) v.push("signal");
    if (t.pnl < 0) { dayLoss.set(day, (dayLoss.get(day) || 0) - t.pnl); lastLossClose = Math.max(lastLossClose, t.closeTs); }
    eqRun = eq + t.pnl;
    for (const k of v) counts[k]++;
    rows.push({ id: t.id, v });
  }
  const clean = rows.filter(r => !r.v.length).length;
  return { rows, counts, rate: rows.length ? clean / rows.length : NaN, n: rows.length };
}
// A personal discipline test on the paper ledger, shaped like the evaluation rules prop firms publish (profit
// target, daily loss limit, overall drawdown, minimum trading days). No fee, no funding, no payout: it only says
// whether the paper record kept the rules.
const CHALLENGE_DEFAULTS = Object.freeze({ targetPct: 8, dailyLossPct: 5, maxDrawdownPct: 10, minDays: 5 });
function challenge(allTrips, rulesIn, planIn) {
  const plan = sanitizePlan(planIn), r = { ...CHALLENGE_DEFAULTS, ...(rulesIn || {}) };
  for (const k of Object.keys(CHALLENGE_DEFAULTS)) r[k] = clamp(+r[k] || CHALLENGE_DEFAULTS[k], 0.1, k === "minDays" ? 365 : 90);
  const trips = closedOf(allTrips);
  const start = trips.length && finite(trips[0].equityBefore) && trips[0].equityBefore > 0 ? trips[0].equityBefore : plan.startEquity;
  let eq = start, peak = start, worstDay = 0, maxDD = 0, failed = null;
  const day = new Map();
  for (const t of trips) {
    const d = utcDay(t.closeTs);
    if (!day.has(d)) day.set(d, { start: eq, pnl: 0 });
    const rec = day.get(d);
    rec.pnl += t.pnl; eq += t.pnl; peak = Math.max(peak, eq);
    const dayDD = rec.start > 0 ? -rec.pnl / rec.start : 0, dd = peak > 0 ? (peak - eq) / peak : 0;
    worstDay = Math.max(worstDay, dayDD); maxDD = Math.max(maxDD, dd);
    if (!failed && dayDD * 100 >= r.dailyLossPct) failed = { rule: "daily", at: t.id, ar: `خسارة يوم ${d} بلغت حد الخسارة اليومي`, en: `the loss on ${d} reached the daily limit` };
    if (!failed && dd * 100 >= r.maxDrawdownPct) failed = { rule: "drawdown", at: t.id, ar: "التراجع من القمة بلغ الحد الكلي", en: "drawdown from the peak reached the overall limit" };
  }
  const gain = start > 0 ? (eq - start) / start : 0;
  const status = failed ? "failed" : gain * 100 >= r.targetPct && day.size >= r.minDays ? "passed" : "running";
  return { rules: r, start, end: eq, gain, progress: clamp(gain * 100 / r.targetPct, 0, 1), worstDay, maxDD, days: day.size, status, failed };
}

/* ---------- journal notes and mistakes ---------- */
const MISTAKES = Object.freeze([
  { k: "fomo", ar: "دخول متأخر خوفاً من الفوات", en: "FOMO entry" },
  { k: "early", ar: "خروج مبكر قبل الهدف", en: "exited before the target" },
  { k: "moved-stop", ar: "تحريك الوقف ضد الصفقة", en: "moved the stop against the trade" },
  { k: "oversize", ar: "حجم أكبر من الخطة", en: "size above the plan" },
  { k: "revenge", ar: "صفقة انتقام بعد خسارة", en: "revenge trade" },
  { k: "no-plan", ar: "دخول بلا سبب مكتوب", en: "no written reason" },
  { k: "against-trend", ar: "عكس الاتجاه الأكبر", en: "against the higher trend" },
  { k: "news", ar: "تداول وقت خبر قوي", en: "traded into major news" },
  { k: "overtrade", ar: "إفراط في عدد الصفقات", en: "overtrading" },
  { k: "hesitation", ar: "تردد وفوّت الدخول الصحيح", en: "hesitated on a valid entry" }
]);
const MISTAKE_KEYS = new Set(MISTAKES.map(m => m.k));
// Live readiness gate (ADR-119, docs/LIVE-TRADING-READINESS.md): the paper track record that must pass before a
// live route may even be proposed. It measures only trips rebuilt from the verified Ops Room receipt chain (manual
// trips and the teaching example do not count). Passing it unlocks nothing: real trading stays locked until
// Director 00 approves the limits in his own words and the legal and security reviews are done.
const LIVE_GATE_DEFAULTS = Object.freeze({ minTrips: 100, minDays: 30, minProfitFactor: 1.2, maxDrawdownPct: 10, minCompliancePct: 90 });
function liveGate(allTrips, planIn, chainOk, rulesIn) {
  const r = { ...LIVE_GATE_DEFAULTS, ...(rulesIn || {}) };
  const ops = (allTrips || []).filter(t => t && t.src === "ops");
  const m = metrics(ops, planIn), c = compliance(ops, planIn), closed = closedOf(ops);
  const span = closed.length ? (Math.max(...closed.map(t => t.closeTs)) - Math.min(...closed.map(t => t.openTs))) / DAY : 0;
  const pf = m.profitFactor;
  const checks = [
    { key: "chain", ar: "سلسلة الإيصالات سليمة", en: "receipt chain verified", value: chainOk ? 1 : 0, need: 1, pass: !!chainOk, show: chainOk ? "✓" : "✗", needShow: "✓" },
    { key: "trips", ar: "صفقات ورقية مغلقة", en: "closed paper round trips", value: m.n, need: r.minTrips, pass: m.n >= r.minTrips, show: String(m.n), needShow: "≥ " + r.minTrips },
    { key: "days", ar: "أيام التداول الورقي", en: "days of paper trading", value: span, need: r.minDays, pass: span >= r.minDays, show: span.toFixed(1), needShow: "≥ " + r.minDays },
    { key: "pf", ar: "معامل الربح", en: "profit factor", value: pf, need: r.minProfitFactor, pass: m.n > 0 && (pf === Infinity || (finite(pf) && pf >= r.minProfitFactor)), show: pf === Infinity ? "∞" : finite(pf) ? pf.toFixed(2) : "—", needShow: "≥ " + r.minProfitFactor.toFixed(2) },
    { key: "dd", ar: "أقصى تراجع", en: "max drawdown", value: m.maxDD * 100, need: r.maxDrawdownPct, pass: m.n > 0 && m.maxDD * 100 <= r.maxDrawdownPct, show: m.n ? (m.maxDD * 100).toFixed(1) + "%" : "—", needShow: "≤ " + r.maxDrawdownPct + "%" },
    { key: "plan", ar: "الالتزام بالخطة", en: "plan compliance", value: c.rate * 100, need: r.minCompliancePct, pass: c.n > 0 && c.rate * 100 >= r.minCompliancePct, show: c.n ? (c.rate * 100).toFixed(0) + "%" : "—", needShow: "≥ " + r.minCompliancePct + "%" }
  ];
  const passed = checks.filter(x => x.pass).length;
  return { rules: r, checks, passed, total: checks.length, ready: passed === checks.length, locked: true, progress: passed / checks.length };
}
function sanitizeNote(n) {
  if (!n || typeof n !== "object") return null;
  const txt = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B-\u001F]/g, "").slice(0, max) : "";
  const tags = Array.isArray(n.tags) ? [...new Set(n.tags.filter(t => MISTAKE_KEYS.has(t)))] : [];
  const emotion = Number.isInteger(+n.emotion) && +n.emotion >= 1 && +n.emotion <= 5 ? +n.emotion : null;
  const grade = ["A", "B", "C", "D", "F"].includes(n.grade) ? n.grade : "";
  return { setup: txt(n.setup, 80), reason: txt(n.reason, 600), lesson: txt(n.lesson, 600), tags, emotion, grade, followed: n.followed === true ? true : n.followed === false ? false : null, at: finite(+n.at) ? +n.at : 0 };
}
function mistakeStats(allTrips, notes) {
  const trips = closedOf(allTrips), noted = trips.filter(t => notes && notes[t.id]);
  const tags = MISTAKES.map(m => ({ ...m, n: 0, pnl: 0, cost: 0 }));
  const byK = Object.fromEntries(tags.map(t => [t.k, t]));
  const clean = [], tagged = [], followedY = [], followedN = [], emo = [];
  for (const t of noted) {
    const n = notes[t.id];
    if (n.tags && n.tags.length) { tagged.push(t.pnl); for (const k of n.tags) if (byK[k]) { byK[k].n++; byK[k].pnl += t.pnl; if (t.pnl < 0) byK[k].cost -= t.pnl; } }
    else clean.push(t.pnl);
    if (n.followed === true) followedY.push(t.pnl); else if (n.followed === false) followedN.push(t.pnl);
    if (n.emotion) emo.push([n.emotion, t.pnl]);
  }
  let corr = NaN;
  if (emo.length >= 5) {
    const xs = emo.map(e => e[0]), ys = emo.map(e => e[1]), mx = mean(xs), my = mean(ys);
    const cov = emo.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0), vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0), vy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
    corr = vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : NaN;
  }
  return {
    coverage: trips.length ? noted.length / trips.length : NaN, noted: noted.length, total: trips.length,
    tags: tags.filter(t => t.n).sort((a, b) => b.cost - a.cost || b.n - a.n),
    avgTagged: mean(tagged), avgClean: mean(clean), nTagged: tagged.length, nClean: clean.length,
    avgFollowed: mean(followedY), avgBroken: mean(followedN), nFollowed: followedY.length, nBroken: followedN.length, emotionCorr: corr, nEmotion: emo.length
  };
}

/* ---------- market lens: indicators on public candles ---------- */
const INTERVALS = Object.freeze(["1h", "4h", "1d"]);
const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
function klinesUrl(symbol, interval, limit = 300) {
  if (!SYMBOL_RE.test(symbol) || !INTERVALS.includes(interval)) return null;
  return `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${clamp(limit | 0, 50, 1000)}`;
}
function parseKlines(j) {
  if (!Array.isArray(j)) return [];
  return j.map(k => Array.isArray(k) ? { t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] } : null).filter(k => k && [k.t, k.o, k.h, k.l, k.c].every(finite) && k.h >= k.l);
}
function sma(xs, n) { const out = new Array(xs.length).fill(NaN); let s = 0; for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i >= n) s -= xs[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
function ema(xs, n) {
  const out = new Array(xs.length).fill(NaN), k = 2 / (n + 1);
  if (xs.length < n) return out;
  let e = mean(xs.slice(0, n)); out[n - 1] = e;
  for (let i = n; i < xs.length; i++) { e = xs[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
// Wilder's RSI and ATR (J. Welles Wilder, 1978): the first average is a simple mean, then (prev × (n − 1) + x) / n.
function rsi(xs, n = 14) {
  const out = new Array(xs.length).fill(NaN);
  if (xs.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function macd(xs, f = 12, s = 26, sig = 9) {
  const a = ema(xs, f), b = ema(xs, s), line = xs.map((_, i) => finite(a[i]) && finite(b[i]) ? a[i] - b[i] : NaN);
  const firstIdx = line.findIndex(finite), signal = new Array(xs.length).fill(NaN);
  if (firstIdx >= 0) { const e = ema(line.slice(firstIdx), sig); e.forEach((v, i) => { signal[firstIdx + i] = v; }); }
  return { line, signal, hist: line.map((v, i) => finite(v) && finite(signal[i]) ? v - signal[i] : NaN) };
}
function bollinger(xs, n = 20, k = 2) {
  const mid = sma(xs, n), up = new Array(xs.length).fill(NaN), lo = new Array(xs.length).fill(NaN);
  for (let i = n - 1; i < xs.length; i++) { const w = xs.slice(i - n + 1, i + 1), m = mid[i], s = Math.sqrt(w.reduce((a, x) => a + (x - m) ** 2, 0) / n); up[i] = m + k * s; lo[i] = m - k * s; }
  return { mid, up, lo };
}
function atr(kl, n = 14) {
  const out = new Array(kl.length).fill(NaN);
  if (kl.length <= n) return out;
  const tr = kl.map((k, i) => i ? Math.max(k.h - k.l, Math.abs(k.h - kl[i - 1].c), Math.abs(k.l - kl[i - 1].c)) : k.h - k.l);
  let a = mean(tr.slice(1, n + 1)); out[n] = a;
  for (let i = n + 1; i < kl.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}
function marketLens(kl) {
  if (kl.length < 60) return { ok: false, why: `only ${kl.length} candles; the lens needs at least 60` };
  const c = kl.map(k => k.c), last = c.length - 1, px = c[last];
  const s50 = sma(c, 50), s200 = sma(c, 200), e20 = ema(c, 20), e50 = ema(c, 50), r = rsi(c), m = macd(c), bb = bollinger(c), a = atr(kl);
  const widths = bb.up.map((u, i) => finite(u) ? (u - bb.lo[i]) / bb.mid[i] : NaN).filter(finite).slice(-120);
  const wNow = (bb.up[last] - bb.lo[last]) / bb.mid[last], wRank = widths.length ? widths.filter(w => w <= wNow).length / widths.length : NaN;
  const trend = !finite(s200[last]) ? (px > s50[last] ? "up-short" : "down-short") : px > s200[last] && s50[last] > s200[last] ? "up" : px < s200[last] && s50[last] < s200[last] ? "down" : "mixed";
  const crossUp = [1, 2, 3].some(d => m.hist[last - d + 1] > 0 && m.hist[last - d] <= 0), crossDown = [1, 2, 3].some(d => m.hist[last - d + 1] < 0 && m.hist[last - d] >= 0);
  const readings = [];
  const R = r[last];
  if (R >= 70) readings.push({ k: "rsi", level: "watch", ar: `RSI ${R.toFixed(1)}: تشبّع شراء، الدخول هنا مطاردة للسعر`, en: `RSI ${R.toFixed(1)}: overbought, an entry here chases price` });
  else if (R <= 30) readings.push({ k: "rsi", level: "watch", ar: `RSI ${R.toFixed(1)}: تشبّع بيع، السكين الساقطة خطرة`, en: `RSI ${R.toFixed(1)}: oversold, catching a falling knife is risky` });
  else readings.push({ k: "rsi", level: "ok", ar: `RSI ${R.toFixed(1)}: منطقة محايدة`, en: `RSI ${R.toFixed(1)}: neutral zone` });
  readings.push(trend === "up" ? { k: "trend", level: "ok", ar: "السعر فوق متوسط 200 والمتوسط 50 فوقه: اتجاه صاعد", en: "price above SMA 200 with SMA 50 above it: uptrend" }
    : trend === "down" ? { k: "trend", level: "act", ar: "السعر تحت متوسط 200 والمتوسط 50 تحته: اتجاه هابط، صفقات الشراء عكس الاتجاه", en: "price below SMA 200 with SMA 50 below it: downtrend, longs fight the trend" }
    : { k: "trend", level: "watch", ar: finite(s200[last]) ? "المتوسطات متقاطعة: اتجاه غير واضح" : "أقل من 200 شمعة: الاتجاه من متوسط 50 فقط", en: finite(s200[last]) ? "averages crossed: no clear trend" : "under 200 candles: trend from SMA 50 only" });
  if (crossUp) readings.push({ k: "macd", level: "ok", ar: "MACD عبر فوق خط الإشارة في آخر 3 شموع", en: "MACD crossed above its signal in the last 3 candles" });
  else if (crossDown) readings.push({ k: "macd", level: "watch", ar: "MACD عبر تحت خط الإشارة في آخر 3 شموع", en: "MACD crossed below its signal in the last 3 candles" });
  const atrPct = a[last] / px;
  if (finite(wRank) && wRank <= 0.1) readings.push({ k: "squeeze", level: "watch", ar: "عرض بولنجر في أدنى 10% من آخر 120 شمعة: انضغاط قد يسبق حركة قوية", en: "Bollinger width in the lowest 10% of 120 candles: a squeeze often comes before a large move" });
  if (finite(wRank) && wRank >= 0.9) readings.push({ k: "volatile", level: "act", ar: "تذبذب في أعلى 10%: صغّر الحجم ليبقى 1R كما هو", en: "volatility in the top 10%: cut size so 1R stays the same" });
  return { ok: true, px, ts: kl[last].t, rsi: R, s50: s50[last], s200: s200[last], e20: e20[last], e50: e50[last], macd: m.line[last], signal: m.signal[last], hist: m.hist[last], up: bb.up[last], lo: bb.lo[last], atr: a[last], atrPct, bbRank: wRank, trend, readings, series: { c, s50, s200, e20, e50, up: bb.up, lo: bb.lo, rsi: r, hist: m.hist, t: kl.map(k => k.t) } };
}

/* ---------- rule desk (ADR-130): ATR risk card and one fixed-rule backtest ---------- */
// Taken from a pasted "AI fund manager" plan and rebuilt in the browser, paper only. riskParams sizes a position so
// that the stop, k × ATR away, costs riskPct of the paper balance, then caps it at the plan's position limit.
// ruleBacktest replays one long-only rule on the candles already read: EMA fast above EMA slow and RSI between
// rsiMin and rsiMax at a close; the fill is the next candle's open plus slippage; stop k × ATR below, target rr × that
// distance above; a candle that touches both counts as the stop; fees on both sides. It sends nothing and opens
// nothing: the result is a measurement of the past [INFERENCE - Quant Model], not a forecast.
const RULE_DEFAULTS = Object.freeze({ fast: 20, slow: 50, rsiMin: 40, rsiMax: 70, atrMult: 2, rr: 2, feeBps: 10, slipBps: 2 });
function sanitizeRule(r = {}) {
  const o = { ...RULE_DEFAULTS };
  const num = (k, a, b, int) => { const v = Number(r[k]); if (finite(v)) o[k] = clamp(int ? Math.round(v) : v, a, b); };
  num("fast", 2, 100, true); num("slow", 3, 300, true); num("rsiMin", 0, 99); num("rsiMax", 1, 100);
  num("atrMult", 0.25, 10); num("rr", 0.25, 20); num("feeBps", 0, 100); num("slipBps", 0, 100);
  if (o.slow <= o.fast) o.slow = Math.min(300, o.fast + 1);
  if (o.rsiMax <= o.rsiMin) o.rsiMax = Math.min(100, o.rsiMin + 1);
  return o;
}
function riskParams(o = {}) {
  const entry = Number(o.entry), atrV = Number(o.atr), balance = Number(o.balance), riskPct = Number(o.riskPct);
  const atrMult = finite(Number(o.atrMult)) ? clamp(Number(o.atrMult), 0.25, 10) : RULE_DEFAULTS.atrMult;
  const rr = finite(Number(o.rr)) ? clamp(Number(o.rr), 0.25, 20) : RULE_DEFAULTS.rr;
  const maxPos = finite(Number(o.maxPositionPct)) ? clamp(Number(o.maxPositionPct), 0.1, 100) : 100;
  const feeBps = finite(Number(o.feeBps)) ? clamp(Number(o.feeBps), 0, 100) : RULE_DEFAULTS.feeBps;
  const side = String(o.side || "long").toLowerCase() === "short" ? "short" : "long";
  if (![entry, atrV, balance, riskPct].every(v => finite(v) && v > 0)) return { ok: false, why: "entry, ATR, balance and risk % must all be positive numbers" };
  if (riskPct > 100) return { ok: false, why: "risk % cannot be above 100" };
  const dist = atrMult * atrV, dir = side === "long" ? 1 : -1;
  const stop = entry - dir * dist, target = entry + dir * rr * dist;
  if (stop <= 0) return { ok: false, why: `the stop (${atrMult} × ATR) falls at or below zero; use a smaller multiple` };
  const riskBudget = balance * riskPct / 100, cap = balance * maxPos / 100;
  let qty = riskBudget / dist, capped = false;
  if (qty * entry > cap) { qty = cap / entry; capped = true; }
  const notional = qty * entry, fees = notional * feeBps / 1e4 * 2;
  return {
    ok: true, side, entry, stop, target, dist, stopPct: dist / entry, targetPct: rr * dist / entry, rr, atrMult,
    qty: round(qty, 8), notional: round(notional, 6), riskUsd: round(qty * dist, 6), rewardUsd: round(qty * rr * dist, 6), riskBudget: round(riskBudget, 6),
    capped, capUsd: round(cap, 6), fees: round(fees, 6), feeShareOfRisk: qty * dist > 0 ? fees / (qty * dist) : NaN,
    paper: true, label: "[INFERENCE - Quant Model]"
  };
}
function ruleBacktest(kl, opts = {}) {
  const r = sanitizeRule(opts), start = finite(Number(opts.balance)) && Number(opts.balance) > 0 ? Number(opts.balance) : 10000;
  const riskPct = finite(Number(opts.riskPct)) ? clamp(Number(opts.riskPct), 0.01, 100) : 1;
  const maxPos = finite(Number(opts.maxPositionPct)) ? clamp(Number(opts.maxPositionPct), 0.1, 100) : 95;
  const need = Math.max(r.slow, 15) + 5;
  if (!Array.isArray(kl) || kl.length < need + 10) return { ok: false, why: `${Array.isArray(kl) ? kl.length : 0} candles; this rule needs at least ${need + 10}` };
  const c = kl.map(k => k.c), ef = ema(c, r.fast), es = ema(c, r.slow), rs = rsi(c), a = atr(kl);
  const fee = r.feeBps / 1e4, slip = r.slipBps / 1e4;
  let cash = start, pos = null, peak = start, maxDD = 0, inBars = 0;
  const trades = [], equity = [];
  const first = kl.findIndex((_, i) => finite(ef[i]) && finite(es[i]) && finite(rs[i]) && finite(a[i]));
  if (first < 0 || first >= kl.length - 2) return { ok: false, why: "the indicators never warmed up" };
  const close = (i, px, why) => {
    const gross = pos.qty * px, out = gross * (1 - fee), pnl = out - pos.cost;
    cash += out;
    trades.push({ inT: pos.t, outT: kl[i].t, entry: pos.entry, exit: px, qty: pos.qty, pnl, ret: pnl / pos.cost, r: pnl / pos.risk, why, bars: i - pos.i });
    pos = null;
  };
  for (let i = first; i < kl.length; i++) {
    const k = kl[i];
    if (pos) {
      inBars++;
      const hitStop = k.l <= pos.stop, hitTarget = k.h >= pos.target;
      if (hitStop) close(i, Math.min(k.o, pos.stop) * (1 - slip), "stop");
      else if (hitTarget) close(i, Math.max(k.o, pos.target) * (1 - slip), "target");
    }
    const eq = cash + (pos ? pos.qty * k.c * (1 - fee) : 0);
    equity.push({ t: k.t, eq });
    if (eq > peak) peak = eq; else maxDD = Math.max(maxDD, (peak - eq) / peak);
    if (!pos && i < kl.length - 1 && ef[i] > es[i] && rs[i] > r.rsiMin && rs[i] < r.rsiMax && a[i] > 0) {
      const nx = kl[i + 1], fill = nx.o * (1 + slip), dist = r.atrMult * a[i];
      if (fill - dist <= 0) continue;
      let qty = cash * riskPct / 100 / dist;
      const capQ = cash * maxPos / 100 / (fill * (1 + fee));
      if (qty > capQ) qty = capQ;
      const cost = qty * fill * (1 + fee);
      if (qty <= 0 || cost > cash) continue;
      cash -= cost;
      pos = { i: i + 1, t: nx.t, entry: fill, qty, cost, stop: fill - dist, target: fill + r.rr * dist, risk: qty * dist };
    }
  }
  const lastK = kl[kl.length - 1];
  if (pos) close(kl.length - 1, lastK.c * (1 - slip), "end");
  const endEq = cash; equity[equity.length - 1] = { t: lastK.t, eq: endEq };
  if (endEq < peak) maxDD = Math.max(maxDD, (peak - endEq) / peak);
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = -losses.reduce((s, t) => s + t.pnl, 0);
  const holdIn = kl[first + 1] ? kl[first + 1].o : kl[first].c, hold = lastK.c * (1 - fee) / (holdIn * (1 + fee)) - 1;
  return {
    ok: true, rule: r, start, end: round(endEq, 6), retPct: endEq / start - 1, holdPct: hold, maxDD, n: trades.length,
    wins: wins.length, losses: losses.length, winRate: trades.length ? wins.length / trades.length : NaN,
    profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : NaN), avgR: mean(trades.map(t => t.r)),
    exposure: inBars / Math.max(1, kl.length - first), from: kl[first].t, to: lastK.t, bars: kl.length - first,
    trades, equity, label: "[INFERENCE - Quant Model]",
    warning: "in-sample replay of one fixed rule on the candles read; past results do not predict, and a few trades prove nothing"
  };
}

/* ---------- bootstrap of trip returns ---------- */
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function monteCarlo(rets, opts = {}) {
  const n = rets.length, paths = clamp(opts.paths | 0 || 2000, 100, 20000), horizon = clamp(opts.horizon | 0 || 100, 10, 1000), limit = (opts.ddLimitPct || 10) / 100;
  if (n < 10) return { ok: false, why: `${n} closed trades; the bootstrap needs at least 10` };
  const rnd = mulberry32(opts.seed || 20261024), finals = [], dds = [];
  let ruin = 0;
  for (let p = 0; p < paths; p++) {
    let eq = 1, peak = 1, md = 0;
    for (let i = 0; i < horizon; i++) { eq *= 1 + rets[Math.floor(rnd() * n)]; if (eq <= 0) { eq = 0; md = 1; break; } peak = Math.max(peak, eq); md = Math.max(md, (peak - eq) / peak); }
    finals.push(eq); dds.push(md); if (md >= limit) ruin++;
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { ok: true, paths, horizon, pRuin: ruin / paths, limit, p5: q(finals, 0.05) - 1, p50: q(finals, 0.5) - 1, p95: q(finals, 0.95) - 1, dd50: q(dds, 0.5), dd95: q(dds, 0.95), label: "[INFERENCE - Quant Model]" };
}

/* ---------- the six data layers of a trading desk, as far as one paper account has them ---------- */
function layers(s) {
  const has = s.receipts > 0 || s.manual > 0;
  return [
    { k: "account", ar: "حالة الحساب", en: "account state", state: s.receipts ? "live" : "none", note: s.receipts ? "before/after of every receipt" : "no receipts read yet" },
    { k: "trades", ar: "بيانات الصفقات", en: "trade data", state: has ? "live" : "none", note: `${s.trips} trips (${s.manual} manual)` },
    { k: "behaviour", ar: "السلوك", en: "behaviour", state: s.notes ? "live" : has ? "partial" : "none", note: s.notes ? `${s.notes} journal notes, timing, plan breaks` : "timing and plan breaks only; write notes for the rest" },
    { k: "risk", ar: "المخاطر عبر الحسابات", en: "cross-account risk", state: "n/a", note: "one paper account; nothing to aggregate" },
    { k: "identity", ar: "الهوية", en: "identity", state: "n/a", note: "not collected by design: no sign-up, no KYC, no subscribers" },
    { k: "lifecycle", ar: "دورة الحساب", en: "lifecycle", state: s.lifecycle ? "live" : "none", note: s.lifecycle ? `${s.lifecycle} LOCK, SWEEP, DEPOSIT, WITHDRAW or KILL receipts` : "no lifecycle receipts" }
  ];
}

/* ---------- the desk manager agent ---------- */
// Fixed rules over the numbers above. Levels: ok (green), watch (amber), act (red), stop (red, trading should pause).
function coach(s) {
  const m = s.metrics, c = s.compliance, k = s.mistakes, ch = s.challenge, plan = sanitizePlan(s.plan), lens = s.lens && s.lens.ok ? s.lens : null, mc = s.mc && s.mc.ok ? s.mc : null;
  const F = [], P = [], facts = [];
  const add = (level, id, ar, en, evidence) => F.push({ level, id, ar, en, evidence: evidence || "", label: "[INFERENCE]" });
  const pct = v => (v * 100).toFixed(1) + "%", usd = v => (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2);
  if (!m.n) {
    add("watch", "no-data", "لا توجد صفقات مغلقة بعد. اقرأ سجل غرفة العمليات أو أضف صفقة ورقية يدوية.", "No closed trade yet. Read the Ops Room ledger or add a manual paper trade.", `${s.sources.receipts} receipts read`);
  } else {
    facts.push(`${m.n} closed paper trades, win rate ${pct(m.winRate)}, net ${usd(m.net)} (source: Ops Room receipts${s.sources.manual ? " and manual journal" : ""})`);
    if (m.n < 30) add("watch", "sample", `العينة ${m.n} صفقة فقط: أي ميزة أو عيب هنا لم يثبت إحصائياً بعد (يلزم 30 على الأقل).`, `Only ${m.n} trades: no edge or flaw is statistically shown yet (30 at least).`, `n = ${m.n}`);
    if (finite(m.expectancy)) {
      facts.push(`expectancy ${usd(m.expectancy)} per trade, ${finite(m.expectancyR) ? m.expectancyR.toFixed(2) + " R" : "R n/a"}; profit factor ${finite(m.profitFactor) ? m.profitFactor.toFixed(2) : m.profitFactor === Infinity ? "no losing trade" : "n/a"}`);
      if (m.expectancy <= 0 && m.n >= 10) {
        add("act", "edge", "التوقع الرياضي سالب: كل صفقة تخسر في المتوسط. أوقف المحرك الآلي وراجع شروط الدخول.", "Expectancy is negative: the average trade loses. Pause the auto engine and review the entry rules.", `${usd(m.expectancy)} per trade over ${m.n}`);
        P.push({ id: "pause-auto", ar: "إيقاف المحرك الورقي الآلي حتى تُراجع شروط الدخول على 10 صفقات يدوية", en: "Pause the paper auto engine until the entry rules are reviewed on 10 manual paper trades", why: `expectancy ${usd(m.expectancy)} over ${m.n} trades` });
      } else if (m.expectancy > 0) add("ok", "edge", "التوقع الرياضي موجب على الورق.", "Expectancy is positive on paper.", `${usd(m.expectancy)} per trade`);
    }
    if (finite(m.payoff) && finite(m.breakevenWinRate) && m.winRate < m.breakevenWinRate) add("act", "payoff", `نسبة الفوز ${pct(m.winRate)} أقل من نسبة التعادل ${pct(m.breakevenWinRate)} لهذه النسبة بين الربح والخسارة (${m.payoff.toFixed(2)}).`, `Win rate ${pct(m.winRate)} is under the breakeven rate ${pct(m.breakevenWinRate)} for this payoff (${m.payoff.toFixed(2)}).`, "breakeven = avg loss / (avg win + avg loss)");
    if (m.maxDD * 100 >= plan.maxDrawdownPct) {
      add("stop", "drawdown", `التراجع الأقصى ${pct(m.maxDD)} بلغ حد الخطة ${plan.maxDrawdownPct}%. توقف وراجع قبل أي صفقة جديدة.`, `Max drawdown ${pct(m.maxDD)} reached the plan's ${plan.maxDrawdownPct}% limit. Stop and review before any new trade.`, `peak-to-trough ${usd(-m.maxDDAbs)}`);
      P.push({ id: "halve-size", ar: "خفض حد حجم المركز إلى النصف في الخطة للصفقات العشر القادمة", en: "Halve the plan's position limit for the next 10 trades", why: `drawdown ${pct(m.maxDD)}`, patch: { maxPositionPct: Math.max(1, Math.round(plan.maxPositionPct / 2)) } });
    } else if (m.maxDD * 100 >= plan.maxDrawdownPct * 0.6) add("watch", "drawdown", `التراجع الأقصى ${pct(m.maxDD)} تجاوز 60% من حد الخطة.`, `Max drawdown ${pct(m.maxDD)} is past 60% of the plan's limit.`, `limit ${plan.maxDrawdownPct}%`);
    facts.push(`max drawdown ${pct(m.maxDD)}, longest losing streak ${m.maxLossStreak}`);
    if (m.streak <= -4) { add("stop", "streak", `${-m.streak} خسائر متتالية الآن. خذ استراحة يوم كامل.`, `${-m.streak} losses in a row right now. Take a full day off.`, "current streak"); P.push({ id: "day-off", ar: "يوم بلا تداول ورقي ثم مراجعة آخر 4 صفقات في السجل", en: "One day without paper trades, then review the last 4 in the journal", why: `${-m.streak} losses in a row` }); }
    else if (m.maxLossStreak >= 5) add("watch", "streak", `أطول سلسلة خسائر ${m.maxLossStreak}. خطط لحجم يتحمل 10 خسائر متتالية.`, `Longest losing streak ${m.maxLossStreak}. Size for 10 losses in a row.`, "");
    if (finite(m.holdLoss) && finite(m.holdWin) && m.holdWin > 0 && m.holdLoss > 1.5 * m.holdWin) add("act", "hold", "الصفقات الخاسرة تبقى مفتوحة أطول بكثير من الرابحة: علامة ترك الخسارة تجري وقطع الربح.", "Losers stay open far longer than winners: the sign of letting losses run and cutting profits.", `loss hold ${(m.holdLoss / MIN).toFixed(0)} min vs win ${(m.holdWin / MIN).toFixed(0)} min`);
    if (finite(m.feeShare) && m.feeShare > 0.3) add("watch", "fees", `الرسوم تأكل ${pct(m.feeShare)} من إجمالي الربح. صفقات أقل وأكبر هدفاً.`, `Fees eat ${pct(m.feeShare)} of gross profit. Fewer trades with larger targets.`, `fees ${usd(m.fees)}`);
    if (finite(m.slipBps) && m.slipBps > 5) { add("watch", "slippage", `متوسط الانزلاق ${m.slipBps.toFixed(1)} نقطة أساس: الحجم كبير على عمق الدفتر.`, `Average slippage ${m.slipBps.toFixed(1)} bps: the size is large for the book.`, "from L2 fills"); }
    if (finite(m.sqn)) facts.push(`SQN ${m.sqn.toFixed(2)} [INFERENCE - Quant Model]`);
    if (finite(m.kelly)) {
      facts.push(`measured Kelly ${pct(m.kelly)}, half ${pct(m.halfKelly)} [INFERENCE - Quant Model]`);
      if (m.kelly <= 0 && m.n >= 10) add("act", "kelly", "كيلي المقاس من صفقاتك صفر أو أقل: لا حجم مبرر حتى تتحسن النتائج.", "Kelly measured from your trades is zero or below: no size is justified until results improve.", `Kelly ${pct(m.kelly)} [INFERENCE - Quant Model]`);
    }
  }
  if (c && c.n) {
    facts.push(`plan compliance ${pct(c.rate)} of ${c.n} trades`);
    const worst = Object.entries(c.counts).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
    if (c.rate < 0.8) add("act", "plan", `${pct(c.rate)} فقط من الصفقات التزمت بالخطة.`, `Only ${pct(c.rate)} of trades kept the plan.`, worst.map(([k, v]) => `${RULES[k].en} ×${v}`).join(", "));
    else add("ok", "plan", `الالتزام بالخطة ${pct(c.rate)}.`, `Plan compliance ${pct(c.rate)}.`, "");
    if (c.counts.revenge) P.push({ id: "cooldown", ar: `رفع فترة التهدئة بعد الخسارة إلى ${Math.max(60, plan.cooldownMin * 2)} دقيقة`, en: `Raise the cool-down after a loss to ${Math.max(60, plan.cooldownMin * 2)} minutes`, why: `${c.counts.revenge} trades opened inside the cool-down`, patch: { cooldownMin: Math.max(60, plan.cooldownMin * 2) } });
    if (c.counts.count) P.push({ id: "fewer", ar: `خفض الحد اليومي إلى ${Math.max(1, plan.maxTradesPerDay - 1)} صفقة`, en: `Lower the daily limit to ${Math.max(1, plan.maxTradesPerDay - 1)} trades`, why: `${c.counts.count} trades over the daily limit`, patch: { maxTradesPerDay: Math.max(1, plan.maxTradesPerDay - 1) } });
    if (c.counts.loss) add("act", "stops", `${c.counts.loss} صفقة خسرت أكثر من 1R: الوقف لم يُنفّذ في مكانه.`, `${c.counts.loss} trades lost more than 1R: the stop was not where the plan put it.`, "1R = equity × riskPct");
  }
  if (!s.planSet) add("watch", "no-plan", "لم تُكتب خطة تداول بعد. الأرقام تقاس على القيم الافتراضية (1% لكل صفقة).", "No trading plan written yet. Numbers are measured against the defaults (1% per trade).", "");
  if (k && k.total) {
    if (k.coverage < 0.5) add("watch", "journal", `${pct(k.coverage)} فقط من الصفقات لها ملاحظة. الوكيل لا يتعلم من صفقة بلا سبب مكتوب.`, `Only ${pct(k.coverage)} of trades have a note. The agent cannot learn from a trade with no written reason.`, `${k.noted} of ${k.total}`);
    if (k.tags.length) {
      const t = k.tags[0];
      add(t.cost > 0 ? "act" : "watch", "mistake", `أغلى خطأ: «${t.ar}» في ${t.n} صفقة كلّف ${usd(-t.cost)}.`, `Costliest mistake: "${t.en}" in ${t.n} trades cost ${usd(-t.cost)}.`, "from journal tags");
      facts.push(`costliest mistake tag: ${t.en}, ${t.n} trades, cost ${usd(-t.cost)}`);
      P.push({ id: "rule-" + t.k, ar: `أضف قاعدة مكتوبة للخطة تمنع «${t.ar}»`, en: `Add a written rule to the plan against "${t.en}"`, why: `${t.n} tagged trades` });
    }
    if (k.nFollowed >= 3 && k.nBroken >= 3 && k.avgFollowed > k.avgBroken) add("ok", "followed", "الصفقات التي التزمت فيها بالخطة أفضل من التي خالفتها.", "Trades where you kept the plan did better than those where you broke it.", `${usd(k.avgFollowed)} vs ${usd(k.avgBroken)} per trade`);
    if (finite(k.emotionCorr) && k.emotionCorr < -0.3) add("watch", "emotion", "كلما ارتفع التوتر قبل الدخول ساءت النتيجة. لا تدخل وأنت متوتر.", "The higher the stress before entry, the worse the result. Do not enter stressed.", `correlation ${k.emotionCorr.toFixed(2)} over ${k.nEmotion} notes`);
  }
  if (ch) {
    facts.push(`paper discipline challenge: ${ch.status}, gain ${pct(ch.gain)} of target ${ch.rules.targetPct}%`);
    if (ch.status === "failed") add("stop", "challenge", `اختبار الانضباط الورقي فشل: ${ch.failed.ar}. ابدأ دورة جديدة بعد مراجعة السجل.`, `The paper discipline challenge failed: ${ch.failed.en}. Start a new round after reviewing the journal.`, `at trip ${ch.failed.at}`);
    else if (ch.status === "passed") add("ok", "challenge", "اختبار الانضباط الورقي نجح بكل قواعده.", "The paper discipline challenge passed every rule.", `${ch.days} trading days`);
  }
  if (mc) {
    facts.push(`bootstrap over ${mc.horizon} trades: P(drawdown ≥ ${pct(mc.limit)}) ${pct(mc.pRuin)}, median ${pct(mc.p50)} [INFERENCE - Quant Model]`);
    if (mc.pRuin >= 0.25) { add("act", "ruin", `إعادة سحب صفقاتك تعطي احتمال ${pct(mc.pRuin)} لبلوغ حد التراجع خلال ${mc.horizon} صفقة.`, `Resampling your trades gives a ${pct(mc.pRuin)} chance of hitting the drawdown limit within ${mc.horizon} trades.`, "[INFERENCE - Quant Model]"); P.push({ id: "risk-down", ar: "خفض المخاطرة لكل صفقة إلى النصف في الخطة", en: "Halve the plan's risk per trade", why: `P(ruin) ${pct(mc.pRuin)}`, patch: { riskPct: Math.max(0.05, +(plan.riskPct / 2).toFixed(2)) } }); }
  }
  if (lens) {
    for (const r of lens.readings) if (r.level !== "ok") add(r.level, "lens-" + r.k, r.ar, r.en, `${s.lensSymbol || ""} ${s.lensInterval || ""} · Binance public candles`);
    facts.push(`market lens ${s.lensSymbol || ""} ${s.lensInterval || ""}: price ${lens.px}, RSI ${lens.rsi.toFixed(1)}, trend ${lens.trend}, ATR ${(lens.atrPct * 100).toFixed(2)}% (source: Binance public klines)`);
  }
  const W = { ok: 0, watch: 6, act: 14, stop: 25 };
  const score = clamp(100 - F.reduce((a, f) => a + W[f.level], 0), 0, 100);
  const order = { stop: 0, act: 1, watch: 2, ok: 3 };
  F.sort((a, b) => order[a.level] - order[b.level]);
  const verdict = F.some(f => f.level === "stop") ? "stop" : F.some(f => f.level === "act") ? "act" : F.some(f => f.level === "watch") ? "watch" : "ok";
  return { findings: F, proposals: P.slice(0, 6), score, verdict, facts: facts.slice(0, 40), label: "[INFERENCE]" };
}

// A labelled teaching example (made-up numbers): 18 paper round trips with exec blocks, as a valid receipt chain.
function teachingExample(now = Date.UTC(2026, 9, 20, 6)) {
  const rnd = mulberry32(7), ev = [];
  let cash = 0, trading = 20, safe = 0, px = 67000;
  const snap = () => ({ cash, locked_base: 20, trading: round(trading, 6), safe_vault: round(safe, 6), split: 0, total: round(cash + trading + safe, 6) });
  ev.push({ ts: now - 6 * DAY, type: "LOCK", amount: 20, before: { cash: 20, locked_base: 0, trading: 0, safe_vault: 0, split: 0, total: 20 }, after: snap(), reason: "Lock base 20.00; sweep at 1.00" });
  let t = now - 6 * DAY + 2 * 3600e3;
  for (let i = 0; i < 18; i++) {
    const notional = round(trading * 0.2, 6), slip = 0.5 + rnd() * 3, entry = px * (1 + slip / 1e4), qty = notional * 0.999 / entry;
    const before = snap(); trading -= notional;
    ev.push({ ts: t, type: "FILL_BUY", amount: notional, before, after: snap(), reason: `${i % 4 === 0 ? "Auto engine: " : ""}${rnd() > 0.3 ? "BUY" : "STRONG BUY"} score ${(0.3 + rnd() * 0.5).toFixed(2)}; 20.0% half-Kelly; L2 VWAP ${entry.toFixed(2)} over 3 of 25 levels`, exec: { engine: "l2-vwap-25", side: "buy", vwap: entry, qty, quote: notional * 0.999, slippage_bps: slip, taker_fee: notional * 0.001 } });
    const win = rnd() < 0.5, move = win ? 0.004 + rnd() * 0.012 : -(0.003 + rnd() * 0.008), hold = (win ? 30 + rnd() * 90 : 60 + rnd() * 240) * MIN;
    px = px * (1 + move); t += hold;
    const quote = qty * px, proceeds = quote * 0.999, b2 = snap(); trading += proceeds;
    ev.push({ ts: t, type: "FILL_SELL", amount: proceeds, before: b2, after: snap(), reason: (win ? "TP2 reached" : "Stop loss hit") + ` at L2 VWAP ${px.toFixed(2)} over 2 of 25 levels`, exec: { engine: "l2-vwap-25", side: "sell", vwap: px, qty, quote, slippage_bps: 0.5 + rnd(), taker_fee: quote * 0.001 } });
    t += (rnd() < 0.25 ? 10 : 90 + rnd() * 600) * MIN;
  }
  return buildChain(ev);
}

export const OMEGA_TRADELAB = Object.freeze({
  VERSION: "omega-tradelab-v1", GENESIS, PLAN_DEFAULTS, CHALLENGE_DEFAULTS, RULES, MISTAKES, INTERVALS,
  canon, sha256Hex, hashOf, merkleRoot, verifyChain, parseExport, buildChain,
  tripsFromReceipts, manualTrip, sanitizePlan, riskUnit, metrics, equityCurve, histogramR, byBucket,
  compliance, challenge, LIVE_GATE_DEFAULTS, liveGate, sanitizeNote, mistakeStats,
  klinesUrl, parseKlines, sma, ema, rsi, macd, bollinger, atr, marketLens,
  RULE_DEFAULTS, sanitizeRule, riskParams, ruleBacktest,
  monteCarlo, layers, coach, teachingExample
});
