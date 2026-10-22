// Brain 2 maths (ADR-108): pure functions shared by the Ops Room (inlined between the OMEGA_MATH markers by
// scripts/build-brain2-inline.mjs, because the page must work from file:// with no build step), the local MCP
// bridge (scripts/omega-mcp-bridge.mjs) and the Node tests (scripts/test-brain2.mjs). No network, no storage,
// no clock except where a time is passed in. Every output is a decision aid for paper trading only.
//
// Contents
//   kalman(prices)          1D local-level Kalman filter, noise fitted live by the method of moments
//   bocpd(xs, opts)         Bayesian online changepoint detection (Adams & MacKay 2007), Normal-Gamma model
//   kyleLambda(tape)        Kyle's lambda: price impact per unit of signed volume, by OLS over time buckets
//   iceberg(tape, book)     hidden-size candidates: traded volume at a price far above the size shown there
//   entropy(book)           normalised Shannon entropy of the top 25 levels on each side
//   bs / gex / rr25         Black-Scholes greeks, naive dealer gamma exposure and its flip, 25-delta skew
//   basisTrap(prem)         perpetual mark-index basis and funding crowding
//   kepler(gp, t)           orbit position from CelesTrak mean elements with secular J2 drift (not SGP4)
//   l2Fill(book, ...)       step-by-step VWAP sweep of the top 25 levels, taker fee, maker queue estimate
//   csti(parts)             cyber and space threat index, 0-100
//   canon / merkle helpers  the receipt chain's canonical form (ADR-091, ADR-096)
export const OMEGA_MATH = (() => {
  "use strict";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const finite = v => typeof v === "number" && Number.isFinite(v);
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
  const variance = a => { const m = mean(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : NaN; };

  /* ---------- 1D Kalman latent price ---------- */
  // Local-level model: y = x + v (v ~ N(0, r), book noise), x' = x + w (w ~ N(0, q), the true price walk).
  // For this model the first difference d = y' - y has Var(d) = q + 2r and lag-1 covariance -r, so both
  // noises come from the window itself: r = max(0, -cov1), q = max(var - 2r, var / 1000). The filter runs
  // in basis points of the first price for numeric range, and the gap is the last price minus the latent one.
  function kalman(prices) {
    const y = (prices || []).filter(finite);
    if (y.length < 10) return null;
    const p0 = y[0], z = y.map(p => (p / p0 - 1) * 1e4);
    const d = [];
    for (let i = 1; i < z.length; i++) d.push(z[i] - z[i - 1]);
    const md = mean(d), vd = variance(d);
    let c1 = 0;
    for (let i = 1; i < d.length; i++) c1 += (d[i] - md) * (d[i - 1] - md);
    c1 /= Math.max(1, d.length - 1);
    const r = Math.max(0, -c1), q = Math.max(vd - 2 * r, vd / 1000, 1e-12);
    let x = z[0], P = r + q, K = 1;
    const out = [x];
    for (let i = 1; i < z.length; i++) {
      P += q;
      K = P / (P + r);
      x += K * (z[i] - x);
      P *= 1 - K;
      out.push(x);
    }
    const latent = p0 * (1 + x / 1e4), last = y[y.length - 1];
    return { latent, last, gapBps: (last / latent - 1) * 1e4, q, r, gain: K, P, n: y.length, series: out.map(v => p0 * (1 + v / 1e4)) };
  }

  /* ---------- Bayesian online changepoint detection ---------- */
  // Adams & MacKay (2007) with a constant hazard h and a Normal-Gamma prior on each run's mean and precision,
  // so the predictive is Student-t. Prior scale comes from the data (beta0 = alpha0 x variance of the first
  // 20 points). Run lengths are truncated at rmax. pRecent is the posterior mass on runs no longer than
  // `recent` steps: the chance that the regime changed within that many steps.
  function studentLogPdf(x, mu, kappa, alpha, beta) {
    const nu = 2 * alpha, s2 = beta * (kappa + 1) / (alpha * kappa);
    return lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI * s2) - (nu + 1) / 2 * Math.log(1 + (x - mu) ** 2 / (nu * s2));
  }
  // Lanczos approximation (g = 7, n = 9), accurate to about 1e-15 for x > 0.
  const LZ = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    let a = LZ[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LZ[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function bocpd(xs, opts = {}) {
    const data = (xs || []).filter(finite);
    if (data.length < 20) return null;
    const h = opts.hazard || 1 / 100, rmax = opts.rmax || 300, recent = opts.recent || 10;
    const v0 = variance(data.slice(0, 20)) || variance(data) || 1e-12;
    const mu0 = 0, k0 = 1, a0 = 1, b0 = a0 * Math.max(v0, 1e-18);
    let R = [1], mu = [mu0], ka = [k0], al = [a0], be = [b0];
    const mapRun = [];
    for (const x of data) {
      const n = R.length, logp = new Array(n);
      for (let i = 0; i < n; i++) logp[i] = studentLogPdf(x, mu[i], ka[i], al[i], be[i]);
      const mx = Math.max(...logp), pred = logp.map(l => Math.exp(l - mx));
      const grow = new Array(n);
      let cp = 0;
      for (let i = 0; i < n; i++) { const w = R[i] * pred[i]; grow[i] = w * (1 - h); cp += w * h; }
      let next = [cp, ...grow];
      const mN = [mu0], kN = [k0], aN = [a0], bN = [b0];
      for (let i = 0; i < n; i++) {
        kN.push(ka[i] + 1);
        mN.push((ka[i] * mu[i] + x) / (ka[i] + 1));
        aN.push(al[i] + 0.5);
        bN.push(be[i] + ka[i] * (x - mu[i]) ** 2 / (2 * (ka[i] + 1)));
      }
      if (next.length > rmax) {
        const tail = next.slice(rmax - 1).reduce((s, v) => s + v, 0);
        next = next.slice(0, rmax - 1).concat([tail]);
        for (const arr of [mN, kN, aN, bN]) arr.length = rmax;
      }
      const z = next.reduce((s, v) => s + v, 0) || 1;
      R = next.map(v => v / z); mu = mN; ka = kN; al = aN; be = bN;
      let best = 0;
      for (let i = 1; i < R.length; i++) if (R[i] > R[best]) best = i;
      mapRun.push(best);
    }
    const pRecent = R.slice(0, recent + 1).reduce((s, v) => s + v, 0);
    return { pRecent, map: mapRun[mapRun.length - 1], mapRun, hazard: h, recent, n: data.length };
  }

  /* ---------- Kyle's lambda ---------- */
  // Trades are grouped into buckets of `ms` milliseconds. Signed volume Q is buyer-initiated minus
  // seller-initiated size (Binance m = true means the buyer was the maker, so the seller hit the bid).
  // lambda = Cov(dP, Q) / Var(Q) by ordinary least squares, in price units per unit of base asset.
  function kyleLambda(tape, ms = 5000) {
    const t = (tape || []).filter(x => x && finite(x.T) && finite(x.p) && finite(x.q));
    if (t.length < 20) return null;
    const b = new Map();
    for (const x of t) {
      const k = Math.floor(x.T / ms);
      const e = b.get(k) || { q: 0, first: x.p, last: x.p };
      e.q += x.m ? -x.q : x.q; e.last = x.p;
      b.set(k, e);
    }
    const keys = [...b.keys()].sort((a, c) => a - c), Q = [], dP = [];
    for (let i = 1; i < keys.length; i++) { const cur = b.get(keys[i]), prev = b.get(keys[i - 1]); Q.push(cur.q); dP.push(cur.last - prev.last); }
    if (Q.length < 5) return null;
    const mq = mean(Q), mp = mean(dP);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < Q.length; i++) { sxy += (Q[i] - mq) * (dP[i] - mp); sxx += (Q[i] - mq) ** 2; syy += (dP[i] - mp) ** 2; }
    if (!(sxx > 0)) return null;
    const lambda = sxy / sxx, r2 = syy > 0 ? sxy * sxy / (sxx * syy) : 0, px = t[t.length - 1].p;
    return { lambda, bpsPerUnit: lambda / px * 1e4, r2, buckets: Q.length, ms };
  }

  /* ---------- iceberg candidates ---------- */
  // Over the last windowMs, sum the traded size at each price on each side. A price where at least `ratio`
  // times the size the book shows there now has already traded, and the level is still standing, is a
  // candidate for hidden (iceberg) size being refilled. A heuristic, labelled [INFERENCE] on screen.
  function iceberg(tape, book, windowMs = 60000, ratio = 2) {
    if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks) || !Array.isArray(tape) || !tape.length) return [];
    const end = Math.max(...tape.map(x => x.T || 0)), traded = new Map();
    for (const x of tape) {
      if (!(end - x.T <= windowMs)) continue;
      const side = x.m ? "bid" : "ask", key = side + ":" + x.p;
      traded.set(key, (traded.get(key) || 0) + x.q);
    }
    const shown = new Map();
    for (const [p, q] of book.bids.slice(0, 25)) shown.set("bid:" + p, q);
    for (const [p, q] of book.asks.slice(0, 25)) shown.set("ask:" + p, q);
    const out = [];
    for (const [key, ex] of traded) {
      const vis = shown.get(key);
      if (!(vis > 0) || ex < ratio * vis) continue;
      const [side, p] = key.split(":");
      out.push({ side, price: +p, executed: ex, visible: vis, ratio: ex / vis });
    }
    return out.sort((a, c) => c.ratio - a.ratio);
  }

  /* ---------- order-book Shannon entropy ---------- */
  // p_i = size at level i / size of the top n levels; H = -sum p ln p, divided by ln n so 1 is a flat book and
  // values near 0 mean size sits in one or two walls.
  function entropy(book, n = 25) {
    const one = side => {
      const q = (side || []).slice(0, n).map(l => +l[1]).filter(v => v > 0);
      if (q.length < 2) return NaN;
      const s = q.reduce((a, v) => a + v, 0);
      return -q.reduce((a, v) => a + (v / s) * Math.log(v / s), 0) / Math.log(q.length);
    };
    const bid = one(book && book.bids), ask = one(book && book.asks);
    return { bid, ask, mean: (bid + ask) / 2, levels: n };
  }

  /* ---------- Black-Scholes, dealer gamma exposure, 25-delta skew ---------- */
  const SQ2PI = Math.sqrt(2 * Math.PI);
  const npdf = x => Math.exp(-x * x / 2) / SQ2PI;
  // Normal CDF through erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7).
  function ncdf(x) {
    const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * e);
  }
  function bs(S, K, T, sigma) {
    if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) return null;
    const v = sigma * Math.sqrt(T), d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / v;
    return { d1, gamma: npdf(d1) / (S * v), callDelta: ncdf(d1), putDelta: ncdf(d1) - 1 };
  }
  const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  // Deribit option names look like BTC-27DEC26-100000-C; options expire at 08:00 UTC.
  function parseOption(name) {
    const m = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:d\d+)?)-([CP])$/.exec(String(name || ""));
    if (!m || !(m[3] in MONTHS)) return null;
    return { expiry: Date.UTC(2000 + +m[4], MONTHS[m[3]], +m[2], 8), strike: +m[5].replace("d", "."), type: m[6] };
  }
  function chain(summary, now) {
    const out = [];
    for (const x of summary || []) {
      const o = parseOption(x.instrument_name);
      const S = +x.underlying_price, iv = +x.mark_iv / 100, oi = +x.open_interest;
      if (!o || !(S > 0) || !(iv > 0) || !(oi >= 0)) continue;
      const T = (o.expiry - now) / (365.25 * 86400e3);
      if (!(T > 1 / 365.25)) continue;
      out.push({ ...o, S, iv, oi, T });
    }
    return out;
  }
  // Naive dealer gamma exposure (the common public convention): dealers are assumed long the calls and short
  // the puts the market holds, so GEX(x) = sum over options of sign * gamma(x) * OI * x^2 * 1%, sign +1 for
  // calls and -1 for puts, in USD per 1% move. Positive GEX means hedging damps moves (dealers buy dips);
  // negative means hedging adds to them. The flip is the price where GEX crosses zero nearest the spot.
  // That positioning is an assumption, not observed; the page says [INFERENCE - Quant Model].
  function gexAt(opts, x) {
    let g = 0;
    for (const o of opts) { const b = bs(x, o.strike, o.T, o.iv); if (b) g += (o.type === "C" ? 1 : -1) * b.gamma * o.oi * x * x * 0.01; }
    return g;
  }
  function gex(summary, now) {
    const opts = chain(summary, now);
    if (opts.length < 10) return null;
    const S = opts.reduce((a, o) => a + o.S, 0) / opts.length;
    const total = gexAt(opts, S);
    let flip = null, prev = null;
    const grid = [];
    for (let i = 0; i <= 120; i++) { const x = S * (0.7 + 0.6 * i / 120); grid.push([x, gexAt(opts, x)]); }
    for (const pt of grid) {
      if (prev && Math.sign(prev[1]) !== Math.sign(pt[1]) && prev[1] !== 0) {
        const x = prev[0] + (pt[0] - prev[0]) * (0 - prev[1]) / (pt[1] - prev[1]);
        if (flip === null || Math.abs(x - S) < Math.abs(flip - S)) flip = x;
      }
      prev = pt;
    }
    const byStrike = new Map();
    for (const o of opts) { const b = bs(S, o.strike, o.T, o.iv); if (!b) continue; const k = o.strike, e = byStrike.get(k) || { c: 0, p: 0 }; e[o.type === "C" ? "c" : "p"] += b.gamma * o.oi * S * S * 0.01; byStrike.set(k, e); }
    let callWall = null, putWall = null, cw = 0, pw = 0;
    for (const [k, e] of byStrike) { if (e.c > cw) { cw = e.c; callWall = k; } if (e.p > pw) { pw = e.p; putWall = k; } }
    return { spot: S, total, flip, callWall, putWall, n: opts.length, regime: total >= 0 ? "positive" : "negative", rr: rr25(opts, S, now), atmIv: atmIv(opts, S) };
  }
  function atmIv(opts, S) {
    const near = Math.min(...opts.map(o => o.T));
    const front = opts.filter(o => o.T === near);
    let best = null;
    for (const o of front) if (!best || Math.abs(o.strike - S) < Math.abs(best.strike - S)) best = o;
    return best ? { iv: best.iv, expiry: best.expiry, strike: best.strike } : null;
  }
  // 25-delta risk reversal on the expiry closest to 30 days: IV of the call with delta nearest +0.25 minus IV
  // of the put with delta nearest -0.25. Positive means calls are bid over puts.
  function rr25(opts, S) {
    const exps = [...new Set(opts.map(o => o.T))];
    if (!exps.length) return null;
    const T = exps.reduce((a, t) => Math.abs(t - 30 / 365.25) < Math.abs(a - 30 / 365.25) ? t : a, exps[0]);
    let c = null, p = null;
    for (const o of opts.filter(x => x.T === T)) {
      const b = bs(S, o.strike, o.T, o.iv);
      if (!b) continue;
      if (o.type === "C" && (!c || Math.abs(b.callDelta - 0.25) < Math.abs(c.d - 0.25))) c = { d: b.callDelta, iv: o.iv, k: o.strike };
      if (o.type === "P" && (!p || Math.abs(b.putDelta + 0.25) < Math.abs(p.d + 0.25))) p = { d: b.putDelta, iv: o.iv, k: o.strike };
    }
    return c && p ? { rr: c.iv - p.iv, call: c, put: p, days: T * 365.25 } : null;
  }
  // Deribit DVOL candles: [[ts, open, high, low, close], ...]; the last close is the 30-day implied volatility.
  function dvol(rows) {
    const r = (rows || []).filter(x => Array.isArray(x) && finite(+x[4]));
    if (!r.length) return null;
    const last = r[r.length - 1], first = r[0];
    return { value: +last[4], at: +last[0], change: +last[4] - +first[4], n: r.length };
  }

  /* ---------- perpetual basis and funding crowding ---------- */
  // basis = (mark - index) / index in bps; funding per 8 h and its simple annualised rate (x 3 x 365).
  // Crowded longs: funding >= 0.03% per 8 h (about 33% a year) with mark above index by 5 bps or more;
  // crowded shorts: funding <= -0.02% per 8 h. Fixed thresholds, a heuristic, labelled [INFERENCE].
  function basisTrap(p) {
    if (!p) return null;
    const mark = +p.markPrice, index = +p.indexPrice, f = +p.lastFundingRate;
    if (!(mark > 0 && index > 0) || !finite(f)) return null;
    const basisBps = (mark / index - 1) * 1e4, apr = f * 3 * 365;
    const crowd = f >= 0.0003 && basisBps >= 5 ? "longs" : f <= -0.0002 ? "shorts" : "none";
    const score = clamp(Math.max(Math.abs(f) / 0.0006, Math.abs(basisBps) / 20), 0, 1) * (crowd === "none" ? 0.5 : 1);
    return { mark, index, basisBps, funding: f, apr, crowd, score, next: +p.nextFundingTime || null, symbol: String(p.symbol || "") };
  }

  /* ---------- orbits from CelesTrak mean elements ---------- */
  // Two-body motion plus the secular J2 drift of the node and perigee (Vallado, Fundamentals of
  // Astrodynamics, 4th ed., 9.6). Drag and periodic terms are ignored, so a low orbit can be off by some tens
  // of km a day from its epoch; this is a map aid, not SGP4. Latitude is geocentric.
  const MU = 398600.4418, RE = 6378.137, J2 = 1.08262668e-3, DEG = Math.PI / 180;
  function epochMs(s) {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(String(s || ""));
    return m ? Date.parse(m[1] + (m[2] ? m[2].slice(0, 4) : "") + "Z") : NaN;
  }
  function gmst(t) {
    const jd = t / 86400000 + 2440587.5;
    return ((280.46061837 + 360.98564736629 * (jd - 2451545)) % 360 + 360) % 360 * DEG;
  }
  function kepler(gp, t) {
    const n0 = +gp.MEAN_MOTION, e = +gp.ECCENTRICITY, inc = +gp.INCLINATION * DEG, ep = epochMs(gp.EPOCH);
    if (!(n0 > 0) || !(e >= 0 && e < 1) || !finite(inc) || !finite(ep)) return null;
    const n = n0 * 2 * Math.PI / 86400, a = Math.cbrt(MU / (n * n)), p = a * (1 - e * e), dt = (t - ep) / 1000;
    const k = 1.5 * n * J2 * (RE / p) ** 2;
    const raan = +gp.RA_OF_ASC_NODE * DEG - k * Math.cos(inc) * dt;
    const argp = +gp.ARG_OF_PERICENTER * DEG + 0.5 * k * (5 * Math.cos(inc) ** 2 - 1) * dt;
    const M = ((+gp.MEAN_ANOMALY * DEG + n * dt) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    let E = e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 30; i++) { const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-12) break; }
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)), r = a * (1 - e * Math.cos(E));
    const u = argp + nu, cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(inc), si = Math.sin(inc), cu = Math.cos(u), su = Math.sin(u);
    const x = r * (cO * cu - sO * su * ci), y = r * (sO * cu + cO * su * ci), z = r * su * si;
    const th = gmst(t), xe = x * Math.cos(th) + y * Math.sin(th), ye = -x * Math.sin(th) + y * Math.cos(th);
    let lon = Math.atan2(ye, xe) / DEG;
    lon = ((lon + 540) % 360) - 180;
    return { lat: Math.atan2(z, Math.hypot(xe, ye)) / DEG, lon, alt: r - RE, a, periodMin: 2 * Math.PI / n / 60, eci: [x, y, z] };
  }
  function groundTrack(gp, t0, minutes = 90, stepS = 60) {
    const out = [];
    for (let s = -minutes * 30; s <= minutes * 30; s += stepS) { const k = kepler(gp, t0 + s * 1000); if (k) out.push([k.lat, k.lon]); }
    return out;
  }

  /* ---------- Level-2 fill engine ---------- */
  // Walks at most `levels` price levels of the visible book. A buy spends `amount` of quote currency, a sell
  // delivers `amount` of base. Returns null when those levels cannot fill it. Taker fee is charged on the
  // quote value. The maker alternative estimates the wait for a resting order at the best price: the size
  // already queued there, divided by the rate the opposite aggressors traded in the tape window.
  function l2Fill(book, side, amount, o = {}) {
    const levels = o.levels || 25, taker = finite(o.takerFee) ? o.takerFee : 0.001, maker = finite(o.makerFee) ? o.makerFee : 0.001;
    const ladder = side === "buy" ? book && book.asks : book && book.bids;
    if (!Array.isArray(ladder) || !ladder.length || !(amount > 0)) return null;
    let left = amount, qty = 0, quote = 0, used = 0;
    const steps = [];
    for (const [p, q] of ladder.slice(0, levels)) {
      if (left <= 1e-12) break;
      const take = side === "buy" ? Math.min(left, p * q) : Math.min(left, q);
      const dq = side === "buy" ? take / p : take, dv = side === "buy" ? take : take * p;
      qty += dq; quote += dv; left -= take; used++;
      steps.push([p, dq]);
    }
    if (left > 1e-9 * Math.max(1, amount)) return null;
    const best = ladder[0][0], worst = steps[steps.length - 1][0], vwap = quote / qty;
    const sgn = side === "buy" ? 1 : -1;
    const shownQuote = ladder.slice(0, levels).reduce((a, [p, q]) => a + p * q, 0);
    let queue = null;
    if (Array.isArray(o.tape) && o.tape.length > 1) {
      const end = Math.max(...o.tape.map(x => x.T)), win = o.tape.filter(x => end - x.T <= 60000);
      const span = Math.max(1, (end - Math.min(...win.map(x => x.T))) / 1000);
      // A resting buy at the best bid fills when sellers hit the bid (m = true); a resting sell when buyers lift.
      const hit = win.filter(x => side === "buy" ? x.m : !x.m).reduce((a, x) => a + x.q, 0) / span;
      const restAt = side === "buy" ? book.bids[0] : book.asks[0];
      queue = restAt ? { price: restAt[0], ahead: restAt[1], rate: hit, etaS: hit > 0 ? restAt[1] / hit : null, fee: maker } : null;
    }
    return {
      side, qty, quote, vwap, best, worst, levelsUsed: used, levels, steps,
      slipBps: sgn * (vwap / best - 1) * 1e4, impactBps: sgn * (worst / best - 1) * 1e4,
      fee: quote * taker, takerFee: taker, depthUsedPct: shownQuote > 0 ? quote / shownQuote * 100 : NaN, queue
    };
  }

  /* ---------- cyber and space threat index ---------- */
  // Each available part is 0-100 and CSTI is their mean:
  //   space   NOAA planetary Kp: 0 at Kp 4 or less, 100 at Kp 9 (G5 storm)
  //   kev     CISA KEV additions in 7 days: 8 points each, 10 more for each tied to ransomware
  //   bgp     lowest RIS visibility of the tier-1 backbones: 0 at 98% of peers or more, 100 at 80% or less
  //   ioda    country outages IODA flagged in 24 h: 10 points each
  function csti(x = {}) {
    const parts = [];
    if (finite(x.kp)) parts.push({ k: "space", v: clamp((x.kp - 4) / 5, 0, 1) * 100 });
    if (finite(x.kev7)) parts.push({ k: "kev", v: clamp(x.kev7 * 8 + (finite(x.ransom7) ? x.ransom7 : 0) * 10, 0, 100) });
    if (finite(x.bgpMin)) parts.push({ k: "bgp", v: clamp((0.98 - x.bgpMin) / 0.18, 0, 1) * 100 });
    if (finite(x.ioda)) parts.push({ k: "ioda", v: clamp(x.ioda * 10, 0, 100) });
    return parts.length ? { score: mean(parts.map(p => p.v)), parts, coverage: parts.length } : { score: NaN, parts, coverage: 0 };
  }

  /* ---------- receipts ---------- */
  const micro = v => finite(v) ? Math.round(v * 1e6) / 1e6 : v;
  const excess = (equity, base) => Math.max(0, equity - base);
  const canon = v => {
    if (typeof v === "number") return Number.isFinite(v) ? Number(v.toFixed(8)) : null;
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) if (k !== "hash") o[k] = canon(v[k]); return o; }
    return v;
  };

  /* ---------- source shapes (ADR-108) ---------- */
  // One compact form per source, used by the proxy, the hourly snapshot and the page's direct tier, so every
  // tier hands the page the same object. Each takes the upstream JSON and returns a small object with a
  // `format` tag; a shape it does not recognise throws, and the source then shows as offline.
  const RIPE_ASNS = [[3356, "Lumen (Level 3)"], [1299, "Arelion (Telia)"], [174, "Cogent"], [2914, "NTT"], [6453, "TATA Communications"]];
  const shape = {
    kev(j, now) {
      const v = j && Array.isArray(j.vulnerabilities) ? j.vulnerabilities : null;
      if (!v) throw new Error("not a KEV catalogue");
      const cut = now - 30 * 86400e3;
      const recent = v.filter(x => Date.parse(String(x.dateAdded) + "T00:00:00Z") >= cut).map(x => ({
        cve: String(x.cveID || ""), vendor: String(x.vendorProject || "").slice(0, 60), product: String(x.product || "").slice(0, 60),
        name: String(x.vulnerabilityName || "").slice(0, 140), added: String(x.dateAdded || ""), ransomware: String(x.knownRansomwareCampaignUse || "") === "Known"
      })).sort((a, b) => b.added.localeCompare(a.added));
      return { format: "omega-kev-v1", version: String(j.catalogVersion || ""), released: String(j.dateReleased || ""), count: v.length, recent };
    },
    gp(arr) {
      if (!Array.isArray(arr)) throw new Error("not a GP list");
      const keep = ["OBJECT_NAME", "OBJECT_ID", "NORAD_CAT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY"];
      const sats = arr.filter(x => x && Number(x.MEAN_MOTION) > 0).slice(0, 400).map(x => Object.fromEntries(keep.map(k => [k, x[k]])));
      if (!sats.length) throw new Error("empty GP list");
      return { format: "omega-gp-v1", sats };
    },
    eonet(j) {
      const ev = j && Array.isArray(j.events) ? j.events : null;
      if (!ev) throw new Error("not an EONET list");
      const out = [];
      for (const e of ev) {
        const g = Array.isArray(e.geometry) ? e.geometry.filter(x => x && x.type === "Point" && Array.isArray(x.coordinates)) : [];
        const last = g[g.length - 1];
        if (!last) continue;
        out.push({ id: String(e.id || ""), title: String(e.title || "").slice(0, 140), cat: String(e.categories && e.categories[0] && e.categories[0].title || ""), date: String(last.date || ""),
          lon: +last.coordinates[0], lat: +last.coordinates[1], mag: Number.isFinite(+last.magnitudeValue) ? +last.magnitudeValue : null, unit: String(last.magnitudeUnit || ""),
          link: String(e.sources && e.sources[0] && e.sources[0].url || e.link || "") });
        if (out.length >= 300) break;
      }
      return { format: "omega-eonet-v1", events: out };
    },
    // SWPC has served this product both as an array of arrays with a header row and as an array of objects.
    kp(j) {
      if (!Array.isArray(j) || !j.length) throw new Error("not a Kp list");
      const rows = Array.isArray(j[0]) ? j.slice(1).map(r => ({ t: String(r[0]), kp: +r[1] })) : j.map(r => ({ t: String(r.time_tag), kp: +(r.Kp ?? r.kp_index ?? r.kp) }));
      const ok = rows.filter(r => Number.isFinite(r.kp) && r.t).slice(-56);
      if (!ok.length) throw new Error("no Kp readings");
      return { format: "omega-kp-v1", readings: ok };
    },
    ripe(j, asn) {
      const d = j && j.data, v = d && d.visibility;
      const v4 = v && v.v4, seeing = v4 ? +v4.ris_peers_seeing : NaN, total = v4 ? +v4.total_ris_peers : NaN;
      if (!(total > 0) || !Number.isFinite(seeing)) throw new Error("no visibility in RIPEstat answer");
      const name = (RIPE_ASNS.find(a => a[0] === asn) || [0, "AS" + asn])[1];
      return { format: "omega-ripe-v1", asn, name, seeing, total, share: seeing / total, prefixes: d.announced_space && d.announced_space.v4 ? +d.announced_space.v4.prefixes : null, at: String(d.last_seen && d.last_seen.time || j.time || "") };
    },
    // IODA v2 outage events: "codf" rows carry location "country/XX", the "ioda" format carries entity {code, name}.
    ioda(j) {
      const list = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
      if (!list) throw new Error("not an IODA list");
      const out = [];
      for (const e of list) {
        const loc = String(e.location || ""), code = (/^country\/([A-Z]{2})$/i.exec(loc) || [])[1] || (e.entity && e.entity.type === "country" ? String(e.entity.code || "") : "");
        if (!code) continue;
        out.push({ code: code.toUpperCase(), name: String(e.location_name || (e.entity && e.entity.name) || code).slice(0, 60), start: +(e.start ?? e.from) || null, duration: +(e.duration ?? ((e.until ?? 0) - (e.from ?? 0))) || null, score: Number.isFinite(+e.score) ? +e.score : null, source: String(e.datasource || e.format || "") });
      }
      return { format: "omega-ioda-v1", events: out.slice(0, 200) };
    },
    deribit(j) {
      const r = j && Array.isArray(j.result) ? j.result : null;
      if (!r) throw new Error("not a Deribit book summary");
      return { format: "omega-deribit-v1", options: r.filter(x => x && typeof x.instrument_name === "string").map(x => ({ instrument_name: x.instrument_name, mark_iv: x.mark_iv, open_interest: x.open_interest, underlying_price: x.underlying_price })) };
    },
    dvol(j) {
      const d = j && j.result && Array.isArray(j.result.data) ? j.result.data : null;
      if (!d) throw new Error("not Deribit DVOL candles");
      return { format: "omega-dvol-v1", rows: d.slice(-48) };
    },
    premium(j) {
      if (!j || !(+j.markPrice > 0)) throw new Error("not a premium index");
      return { symbol: String(j.symbol || ""), markPrice: j.markPrice, indexPrice: j.indexPrice, lastFundingRate: j.lastFundingRate, nextFundingTime: j.nextFundingTime, time: j.time };
    }
  };
  // Time windows rounded to 15 minutes, so proxy and snapshot caches hit for repeated asks.
  const win15 = now => Math.floor(now / 900e3) * 900;
  const urls = {
    kev: () => "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    gp: g => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=json`,
    eonet: () => "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=300",
    kp: () => "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
    ripe: asn => `https://stat.ripe.net/data/routing-status/data.json?resource=AS${asn}&sourceapp=omega-giant-core`,
    ioda: now => { const u = win15(now); return `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&from=${u - 86400}&until=${u}&format=codf&limit=200`; },
    deribit: () => "https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option",
    dvol: now => { const u = win15(now) * 1000; return `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${u - 48 * 3600e3}&end_timestamp=${u}&resolution=3600`; },
    premium: sym => `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`
  };

  return Object.freeze({ shape, urls, RIPE_ASNS, clamp, mean, variance, kalman, bocpd, lgamma, kyleLambda, iceberg, entropy, ncdf, bs, parseOption, gex, gexAt, chain, rr25, dvol, basisTrap, epochMs, gmst, kepler, groundTrack, l2Fill, csti, micro, excess, canon });
})();
