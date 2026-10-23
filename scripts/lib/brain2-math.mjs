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
//   csti(parts)             cyber and space threat index, 0-100 (seven parts since ADR-110)
//   risSummary(msgs, ...)   RIS Live BGP updates on watched prefixes: churn, origin changes, instability index
//   canon / merkle helpers  the receipt chain's canonical form (ADR-091, ADR-096)
//   nnFactory / nn          the 139 -> 8 neural flow: forward pass, backpropagation, Adam and (1+1)-ES (ADR-109)
//   shape.perp*, emsc, ...  fallbacks for the perpetual premium (OKX, Deribit) and disaster alerts (EMSC, ReliefWeb)
//   nn.ode*                 continuous-time hidden layers, dx/dt = (σ(Wx + b) − x) / τ(t), Heun steps (ADR-110)
//   shape.infocon, ...      SANS ISC InfoCON, Shodan InternetDB, adsb.lol squawks and zones (ADR-110)
//   lfi(llama)              DefiLlama stablecoin, chain and DEX liquidity flow index, -100..+100 (ADR-112)
//   cvss3 / circlSummary    CVSS 3.x base score from a vector; CIRCL Vulnerability-Lookup entries with MISP
//                           taxonomy tags and a 0-100 vulnerability pressure part for CSTI (ADR-112)
//   seaState(marine)        Open-Meteo Marine waves and currents at the five straits (ADR-112)
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
  // ADR-110 adds three:
  //   infocon SANS ISC InfoCON: green 0, yellow 33, orange 67, red 100
  //   ris     RIS Live instability index of the watched DNS anycast prefixes (risSummary), already 0-100
  //   exposed CVEs Shodan InternetDB lists on the watched resolver addresses: 25 points each
  // ADR-112 adds an eighth:
  //   circl   vulnerability pressure of CIRCL's latest published records (circlSummary), already 0-100
  function csti(x = {}) {
    const parts = [];
    if (finite(x.kp)) parts.push({ k: "space", v: clamp((x.kp - 4) / 5, 0, 1) * 100 });
    if (finite(x.kev7)) parts.push({ k: "kev", v: clamp(x.kev7 * 8 + (finite(x.ransom7) ? x.ransom7 : 0) * 10, 0, 100) });
    if (finite(x.bgpMin)) parts.push({ k: "bgp", v: clamp((0.98 - x.bgpMin) / 0.18, 0, 1) * 100 });
    if (finite(x.ioda)) parts.push({ k: "ioda", v: clamp(x.ioda * 10, 0, 100) });
    if (finite(x.infocon)) parts.push({ k: "infocon", v: clamp(x.infocon, 0, 3) / 3 * 100 });
    if (finite(x.ris)) parts.push({ k: "ris", v: clamp(x.ris, 0, 100) });
    if (finite(x.exposed)) parts.push({ k: "exposed", v: clamp(x.exposed * 25, 0, 100) });
    if (finite(x.circl)) parts.push({ k: "circl", v: clamp(x.circl, 0, 100) });
    return parts.length ? { score: mean(parts.map(p => p.v)), parts, coverage: parts.length, of: 8 } : { score: NaN, parts, coverage: 0, of: 8 };
  }

  /* ---------- RIS Live BGP watch (ADR-110) ---------- */
  // Watched prefixes: public DNS anycast blocks that exchanges, banks and cloud platforms resolve through, each
  // with the origin AS that announces it. RIS Live (ris-live.ripe.net) streams every BGP UPDATE its route
  // collectors see for them; no key, a `client` name is asked for.
  const RIS_WATCH = [
    { prefix: "1.1.1.0/24", origin: 13335, name: "Cloudflare DNS" },
    { prefix: "8.8.8.0/24", origin: 15169, name: "Google Public DNS" },
    { prefix: "9.9.9.0/24", origin: 19281, name: "Quad9" },
    { prefix: "208.67.222.0/24", origin: 36692, name: "Cisco OpenDNS" }
  ];
  const ip4 = a => { const p = String(a).split(".").map(Number); return p.length === 4 && p.every(v => Number.isInteger(v) && v >= 0 && v <= 255) ? p[0] * 16777216 + p[1] * 65536 + p[2] * 256 + p[3] : NaN; };
  const cidr = c => { const [a, l] = String(c).split("/"), n = ip4(a), len = +l; return finite(n) && Number.isInteger(len) && len >= 0 && len <= 32 ? { n, len } : null; };
  // b lies inside a (the same block or a more specific one).
  const inside = (b, a) => { if (!a || !b || b.len < a.len) return false; const size = 2 ** (32 - a.len); return Math.floor(b.n / size) === Math.floor(a.n / size); };
  // Summary of RIS Live ris_message data objects in the windowMs before `now`: per watched prefix the
  // announcements, withdrawals and origins seen, the announcements whose origin AS is not the expected one
  // (a hijack, a leak, or a change the operator made on purpose: [INFERENCE]) and the ones more specific than
  // the watched block. Instability index, a fixed heuristic, 0-100:
  //   2 × withdrawals per minute + 0.25 × announcements per minute
  //   + 30 for each prefix with a foreign origin + 15 for each prefix with a more specific announcement
  function risSummary(msgs, now, windowMs = 300e3, watch = RIS_WATCH) {
    const from = now - windowMs, W = watch.map(w => ({ ...w, c: cidr(w.prefix), ann: 0, wd: 0, origins: new Map(), foreign: [], specific: [] }));
    let used = 0;
    for (const m of msgs || []) {
      const t = (+(m && m.timestamp)) * 1000;
      if (!(t >= from && t <= now) || m.type !== "UPDATE") continue;
      used++;
      const path = Array.isArray(m.path) ? m.path : [], last = path[path.length - 1], origin = !Array.isArray(last) && Number.isInteger(+last) ? +last : NaN;
      for (const a of Array.isArray(m.announcements) ? m.announcements : []) for (const p of Array.isArray(a && a.prefixes) ? a.prefixes : []) {
        const c = cidr(p);
        for (const w of W) {
          if (!inside(c, w.c)) continue;
          w.ann++;
          if (finite(origin)) w.origins.set(origin, (w.origins.get(origin) || 0) + 1);
          if (finite(origin) && origin !== w.origin && w.foreign.length < 20) w.foreign.push({ prefix: String(p), origin, peer: String(m.peer_asn || ""), t });
          if (c.len > w.c.len && w.specific.length < 20) w.specific.push({ prefix: String(p), origin, t });
        }
      }
      for (const p of Array.isArray(m.withdrawals) ? m.withdrawals : []) { const c = cidr(p); for (const w of W) if (inside(c, w.c)) w.wd++; }
    }
    const min = windowMs / 60e3, ann = W.reduce((s, w) => s + w.ann, 0), wd = W.reduce((s, w) => s + w.wd, 0);
    const foreign = W.filter(w => w.foreign.length).length, specific = W.filter(w => w.specific.length).length;
    return { format: "omega-ris-v1", windowMin: min, messages: used, announcements: ann, withdrawals: wd, foreign, specific,
      index: clamp(2 * wd / min + 0.25 * ann / min + 30 * foreign + 15 * specific, 0, 100),
      prefixes: W.map(w => ({ prefix: w.prefix, name: w.name, origin: w.origin, ann: w.ann, wd: w.wd, origins: [...w.origins.entries()].map(([asn, n]) => ({ asn, n })), foreign: w.foreign, specific: w.specific })) };
  }
  // The messages a RIS Live client sends once connected: one UPDATE subscription per watched prefix.
  const risSubscribe = (watch = RIS_WATCH) => watch.map(w => ({ type: "ris_subscribe", data: { type: "UPDATE", prefix: w.prefix, moreSpecific: true, lessSpecific: false, socketOptions: { includeRaw: false } } }));

  /* ---------- watched hosts and air zones (ADR-110) ---------- */
  // Shodan InternetDB (internetdb.shodan.io, keyless, free for non-commercial use, updated weekly) is asked
  // about these four public resolver addresses only. It is a lookup of Shodan's existing records, not a scan.
  const INTERNETDB_HOSTS = [["1.1.1.1", "Cloudflare DNS"], ["8.8.8.8", "Google Public DNS"], ["9.9.9.9", "Quad9"], ["208.67.222.222", "Cisco OpenDNS"]];
  // adsb.lol (ODbL 1.0, keyless today) point queries: the five straits and the Taiwan Strait, radius in nautical miles.
  const AIR_ZONES = [
    { key: "hormuz", en: "Strait of Hormuz", lat: 26.57, lon: 56.25 }, { key: "bab", en: "Bab el-Mandeb", lat: 12.6, lon: 43.33 },
    { key: "suez", en: "Suez Canal", lat: 30.0, lon: 32.58 }, { key: "malacca", en: "Strait of Malacca", lat: 2.5, lon: 101.0 },
    { key: "panama", en: "Panama Canal", lat: 9.08, lon: -79.68 }, { key: "taiwan", en: "Taiwan Strait", lat: 24.0, lon: 119.5 }
  ];
  const AIR_RADIUS_NM = 150;
  // Squawk 7500 unlawful interference, 7600 radio failure, 7700 general emergency (ICAO).
  const SQUAWKS = { 7500: "unlawful interference", 7600: "radio failure", 7700: "general emergency" };


  /* ---------- DefiLlama liquidity flow (ADR-112) ---------- */
  // Liquidity flow index, -100 (liquidity leaving) to +100 (liquidity arriving), a fixed heuristic [INFERENCE]:
  //   35% stablecoin supply change over 1 day, scaled so ±0.5% is the full swing
  //   30% stablecoin supply change over 7 days, ±2% full swing
  //   20% DEX volume of the last 24 h against the 24 h before it, ±25% full swing
  //   15% peg stress: 0 while the largest USD stablecoins sit within 50 bps of $1, −1 at 200 bps or more
  // Newly minted stablecoins are cash waiting at the exchanges' door; a falling supply or a broken peg is
  // cash leaving. The index says which way the stablecoin float moved, not where the price goes next.
  // The weights of the parts that have data are renormalised, and `parts` says which ones were used.
  function lfi(set) {
    const st = set && set.stable, dx = set && set.dex, parts = [];
    if (st && finite(st.pct1)) parts.push({ k: "supply1d", w: 0.35, v: clamp(st.pct1 / 0.5, -1, 1), why: `stablecoin supply ${st.pct1 >= 0 ? "+" : ""}${st.pct1.toFixed(3)}% in 1 day` });
    if (st && finite(st.pct7)) parts.push({ k: "supply7d", w: 0.30, v: clamp(st.pct7 / 2, -1, 1), why: `${st.pct7 >= 0 ? "+" : ""}${st.pct7.toFixed(2)}% in 7 days` });
    if (dx && finite(dx.chg1d)) parts.push({ k: "dex", w: 0.20, v: clamp(dx.chg1d / 25, -1, 1), why: `DEX volume ${dx.chg1d >= 0 ? "+" : ""}${dx.chg1d.toFixed(1)}% against the day before` });
    if (st && st.depeg && finite(st.depeg.bps)) parts.push({ k: "peg", w: 0.15, v: -clamp((Math.abs(st.depeg.bps) - 50) / 150, 0, 1), why: `largest peg gap ${st.depeg.symbol} ${Math.abs(st.depeg.bps).toFixed(0)} bps` });
    if (!parts.length) return { score: NaN, parts, coverage: 0, of: 4, regime: "unknown" };
    const W = parts.reduce((a, p) => a + p.w, 0), score = 100 * parts.reduce((a, p) => a + p.w * p.v, 0) / W;
    return { score, parts, coverage: parts.length, of: 4, regime: score >= 25 ? "inflow" : score <= -25 ? "outflow" : "flat" };
  }

  /* ---------- CVSS 3.x and CIRCL Vulnerability-Lookup with MISP tags (ADR-112) ---------- */
  // Base score from a CVSS 3.0 or 3.1 vector (FIRST CVSS v3.1 specification, section 7.1, with its Roundup).
  const CV = { AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 }, UI: { N: 0.85, R: 0.62 }, CIA: { H: 0.56, L: 0.22, N: 0 } };
  const roundup = x => { const i = Math.round(x * 100000); return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10; };
  function cvss3(vector) {
    const m = {};
    for (const kv of String(vector || "").split("/")) { const [k, v] = kv.split(":"); if (k && v) m[k] = v; }
    if (!/^CVSS:3\.[01]$/.test("CVSS:" + (m.CVSS || ""))) return NaN;
    const av = CV.AV[m.AV], ac = CV.AC[m.AC], ui = CV.UI[m.UI], c = CV.CIA[m.C], i = CV.CIA[m.I], a = CV.CIA[m.A], changed = m.S === "C";
    const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
    if (![av, ac, ui, c, i, a, pr].every(finite) || !["U", "C"].includes(m.S)) return NaN;
    const iss = 1 - (1 - c) * (1 - i) * (1 - a);
    const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
    const expl = 8.22 * av * ac * pr * ui;
    if (impact <= 0) return 0;
    return changed ? roundup(Math.min(1.08 * (impact + expl), 10)) : roundup(Math.min(impact + expl, 10));
  }
  // MISP taxonomies (github.com/MISP/misp-taxonomies, CC0): machine tags namespace:predicate="value". The
  // mapping from a record to tags is a fixed rule set, labelled [INFERENCE] on screen:
  //   priority-level  from CVSS and KEV: emergency (CVSS ≥ 9 and in CISA KEV), severe (≥ 9), high (≥ 7),
  //                   medium (≥ 4), low (> 0), baseline-minor (no score published yet)
  //   vulnerability   sighting="exploited" when CISA KEV lists it; information="PoC" when a reference is
  //                   marked as an exploit; origin="software" for package advisories (OSV records)
  //   rsit            vulnerable="vulnerable-system" for every record; intrusion-attempts="exploit" when in KEV;
  //                   CWE-200 information-disclosure, CWE-326/327/328 weak-crypto, CWE-400/674/770/835 availability dos
  const CWE_RSIT = { "CWE-200": 'rsit:vulnerable="information-disclosure"', "CWE-326": 'rsit:vulnerable="weak-crypto"', "CWE-327": 'rsit:vulnerable="weak-crypto"', "CWE-328": 'rsit:vulnerable="weak-crypto"',
    "CWE-400": 'rsit:availability="dos"', "CWE-674": 'rsit:availability="dos"', "CWE-770": 'rsit:availability="dos"', "CWE-835": 'rsit:availability="dos"' };
  function priorityLevel(cvss, kev) {
    if (!finite(cvss)) return "baseline-minor";
    return cvss >= 9 && kev ? "emergency" : cvss >= 9 ? "severe" : cvss >= 7 ? "high" : cvss >= 4 ? "medium" : cvss > 0 ? "low" : "baseline-minor";
  }
  function mispTags(v, kev) {
    const t = [`priority-level:${priorityLevel(v.cvss, kev)}`, 'rsit:vulnerable="vulnerable-system"'];
    if (kev) t.push('vulnerability:sighting="exploited"', 'rsit:intrusion-attempts="exploit"');
    if (v.poc) t.push('vulnerability:information="PoC"');
    if (v.osv) t.push('vulnerability:origin="software"');
    if (CWE_RSIT[v.cwe] && !t.includes(CWE_RSIT[v.cwe])) t.push(CWE_RSIT[v.cwe]);
    return t;
  }
  // Summary of the CIRCL records with tags; `kevIds` is the set of CVE ids in the CISA KEV catalogue (may be empty).
  // Vulnerability pressure, 0-100 (ADR-113): 25 per record CISA KEV lists as exploited, plus 40 × the share of
  // critical records (CVSS ≥ 9) among those with a score, capped at 100. The feed is the latest 30 records, so a raw
  // count of critical ones measures the sample size, not the threat: half of a normal day's records are critical.
  function circlSummary(set, kevIds) {
    const kev = kevIds instanceof Set ? kevIds : new Set(Array.isArray(kevIds) ? kevIds : []);
    const items = (set && Array.isArray(set.items) ? set.items : []).map(v => {
      const inKev = [v.id, ...(v.aliases || [])].some(x => kev.has(x));
      return { ...v, kev: inKev, priority: priorityLevel(v.cvss, inKev), tags: mispTags(v, inKev) };
    });
    const critical = items.filter(v => v.cvss >= 9).length, high = items.filter(v => v.cvss >= 7 && v.cvss < 9).length, exploited = items.filter(v => v.kev).length;
    const by = {};
    for (const v of items) by[v.priority] = (by[v.priority] || 0) + 1;
    const scored = items.filter(v => finite(v.cvss)).length;
    return { n: items.length, critical, high, exploited, scored, priority: by, pressure: clamp(exploited * 25 + (scored ? 40 * critical / scored : 0), 0, 100), items };
  }

  /* ---------- sea state at the five straits (ADR-112) ---------- */
  // Open-Meteo Marine (keyless, CC BY 4.0) at a sea point inside or at the mouth of each strait; the API picks the
  // nearest sea grid cell. Currents come in km/h and are also given in knots.
  const MARINE_POINTS = [
    { key: "hormuz", en: "Strait of Hormuz", lat: 26.45, lon: 56.45 }, { key: "bab", en: "Bab el-Mandeb", lat: 12.6, lon: 43.33 },
    { key: "suez", en: "Suez Canal, Port Said approach", lat: 31.45, lon: 32.35 }, { key: "malacca", en: "Strait of Malacca", lat: 2.5, lon: 101.0 },
    { key: "panama", en: "Panama Canal, Pacific approach", lat: 8.75, lon: -79.5 }
  ];
  // Sea-state part for PWSI, 0-100: 0 with every significant wave height at 2 m or less, 100 at 6 m or more;
  // a current of 4 knots or more adds the same as 1 m of wave. Fixed rule, [INFERENCE].
  function seaState(m) {
    const pts = m && Array.isArray(m.points) ? m.points.filter(p => finite(p.hs)) : [];
    if (!pts.length) return { score: NaN, maxHs: NaN, maxKn: NaN, at: "", n: 0 };
    const top = pts.reduce((a, p) => p.hs > a.hs ? p : a), kn = pts.filter(p => finite(p.curKn)), fast = kn.length ? kn.reduce((a, p) => p.curKn > a.curKn ? p : a) : null;
    const score = clamp((top.hs - 2) / 4 + (fast && fast.curKn >= 4 ? 0.25 : 0), 0, 1) * 100;
    return { score, maxHs: top.hs, at: top.key, maxKn: fast ? fast.curKn : NaN, fastAt: fast ? fast.key : "", n: pts.length };
  }

  /* ---------- neural flow (ADR-109) ---------- */
  // A small multilayer perceptron, 139 -> 48 -> 36 -> 48 -> 24 -> 16 -> 8: linear inputs, ReLU hidden layers and
  // tanh outputs, trained online with Adam on half mean squared error, plus a (1+1) evolution strategy on the
  // output layer with the one-fifth success rule. A NaN target is skipped, so a head only learns when it has one.
  // Parameters sit in one Float64Array: for each layer its weights (row per output neuron) and then its biases.
  // nnFactory uses no outside name, so the Ops Room can also run it in a Web Worker from its source text.
  function nnFactory() {
    "use strict";
    const SIZES = [139, 48, 36, 48, 24, 16, 8];
    const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
    function layout(sizes) {
      const off = [];
      let n = 0;
      for (let l = 1; l < sizes.length; l++) { off.push({ w: n, b: n + sizes[l] * sizes[l - 1], i: sizes[l - 1], o: sizes[l] }); n += sizes[l] * sizes[l - 1] + sizes[l]; }
      return { off, n, weights: off.reduce((a, o) => a + o.i * o.o, 0) };
    }
    function rng(seed) {
      let s = (seed >>> 0) || 88172645;
      const u = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
      return { u, g: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
    }
    const lay = net => net.L || (net.L = layout(net.sizes));
    // He initialisation for the ReLU layers, Xavier for the tanh output; biases start at zero.
    function init(sizes = SIZES, seed = 1) {
      const L = layout(sizes), p = new Float64Array(L.n), r = rng(seed);
      L.off.forEach((o, k) => { const sd = k === L.off.length - 1 ? Math.sqrt(1 / o.i) : Math.sqrt(2 / o.i); for (let j = 0; j < o.o * o.i; j++) p[o.w + j] = r.g() * sd; });
      return { sizes: sizes.slice(), p, L };
    }
    // a[0] is the input (missing values become 0); z[k] and a[k] are layer k before and after its activation.
    function forward(net, x) {
      const L = lay(net), p = net.p, a = [Float64Array.from(x, v => (Number.isFinite(v) ? v : 0))], z = [null];
      for (let k = 0; k < L.off.length; k++) {
        const o = L.off[k], prev = a[k], zz = new Float64Array(o.o), aa = new Float64Array(o.o), last = k === L.off.length - 1;
        for (let j = 0; j < o.o; j++) {
          let s = p[o.b + j];
          const row = o.w + j * o.i;
          for (let i = 0; i < o.i; i++) s += p[row + i] * prev[i];
          zz[j] = s; aa[j] = last ? Math.tanh(s) : s > 0 ? s : 0;
        }
        z.push(zz); a.push(aa);
      }
      return { z, a };
    }
    function lossOf(net, X, Y, idx) {
      if (!idx.length) return NaN;
      const K = lay(net).off.length;
      let s = 0;
      for (const n of idx) { const out = forward(net, X[n]).a[K]; for (let j = 0; j < out.length; j++) { const t = Y[n][j]; if (Number.isFinite(t)) s += 0.5 * (out[j] - t) ** 2; } }
      return s / idx.length;
    }
    // Backpropagation of the batch loss into g (same layout as p), averaged over the batch.
    function grad(net, X, Y, idx, g) {
      g.fill(0);
      const L = lay(net), K = L.off.length, p = net.p;
      let loss = 0;
      for (const n of idx) {
        const f = forward(net, X[n]), out = f.a[K];
        let d = new Float64Array(out.length);
        for (let j = 0; j < out.length; j++) { const t = Y[n][j]; if (!Number.isFinite(t)) continue; const e = out[j] - t; loss += 0.5 * e * e; d[j] = e * (1 - out[j] * out[j]); }
        for (let k = K - 1; k >= 0; k--) {
          const o = L.off[k], prev = f.a[k], nd = k ? new Float64Array(o.i) : null;
          for (let j = 0; j < o.o; j++) {
            const dj = d[j];
            if (dj === 0) continue;
            g[o.b + j] += dj;
            const row = o.w + j * o.i;
            for (let i = 0; i < o.i; i++) { g[row + i] += dj * prev[i]; if (nd) nd[i] += dj * p[row + i]; }
          }
          if (nd) { const zp = f.z[k]; for (let i = 0; i < o.i; i++) if (!(zp[i] > 0)) nd[i] = 0; d = nd; }
        }
      }
      const m = Math.max(1, idx.length);
      for (let i = 0; i < g.length; i++) g[i] /= m;
      return loss / m;
    }
    // Time order is kept: the newest 20% is held out, and `gap` samples before it are dropped from training,
    // because a target that looks `gap` readings ahead would otherwise see into the held-out window.
    function train(net, X, Y, o = {}) {
      const n = Math.min(X.length, Y.length), gap = o.gap ?? 6;
      if (n < 20) return null;
      const L = lay(net), P = net.p.length, g = new Float64Array(P), m = o.m || new Float64Array(P), v = o.v || new Float64Array(P);
      const lr = o.lr ?? 0.003, b1 = 0.9, b2 = 0.999, l2 = o.l2 ?? 1e-4, epochs = o.epochs ?? 12, bs = o.batch ?? 16, r = rng(o.seed || 7);
      const cut = Math.floor(n * 0.8), tr = [], va = [];
      for (let i = 0; i < Math.max(1, cut - gap); i++) tr.push(i);
      for (let i = cut; i < n; i++) va.push(i);
      const t0 = now(), before = lossOf(net, X, Y, va);
      let t = o.t || 0, steps = 0;
      for (let e = 0; e < epochs; e++) {
        for (let i = tr.length - 1; i > 0; i--) { const j = Math.floor(r.u() * (i + 1)); const s = tr[i]; tr[i] = tr[j]; tr[j] = s; }
        for (let s = 0; s < tr.length; s += bs) {
          grad(net, X, Y, tr.slice(s, s + bs), g);
          t++; steps++;
          const c1 = 1 - b1 ** t, c2 = 1 - b2 ** t;
          for (let i = 0; i < P; i++) {
            const gi = g[i] + l2 * net.p[i];
            m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi;
            net.p[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
          }
        }
      }
      // (1+1)-ES on the output layer: keep a Gaussian step only when it lowers the training loss.
      const lo = L.off[L.off.length - 1], len = lo.o * lo.i + lo.o;
      let sigma = o.sigma || 0.02, acc = 0, best = lossOf(net, X, Y, tr);
      const esN = o.es ?? 16;
      for (let k = 0; k < esN; k++) {
        const save = net.p.slice(lo.w, lo.w + len);
        for (let i = 0; i < len; i++) net.p[lo.w + i] += sigma * r.g();
        const l = lossOf(net, X, Y, tr);
        if (l < best) { best = l; acc++; sigma *= 1.22; } else { net.p.set(save, lo.w); sigma *= 0.95; }
      }
      sigma = Math.min(0.2, Math.max(1e-4, sigma));
      // Held-out scores: loss, the loss of always answering 0, and the direction hit rate of head 1.
      let base = 0, hits = 0, calls = 0;
      for (const i of va) {
        for (let j = 0; j < Y[i].length; j++) if (Number.isFinite(Y[i][j])) base += 0.5 * Y[i][j] ** 2;
        const y0 = Y[i][0];
        if (Number.isFinite(y0) && Math.abs(y0) >= 0.1) { calls++; if (Math.sign(forward(net, X[i]).a[L.off.length][0]) === Math.sign(y0)) hits++; }
      }
      return { steps, t, m, v, sigma, esAccepted: acc, esTried: esN, trainLoss: best, valBefore: before, valLoss: lossOf(net, X, Y, va), valBase: va.length ? base / va.length : NaN, hit: calls ? hits / calls : NaN, calls, nTrain: tr.length, nVal: va.length, ms: now() - t0 };
    }
    // Continuous-time flow (ADR-110). Each hidden and output neuron is a leaky integrator driven by the layer
    // before it, as that layer is now (not as it will settle), so a change at the inputs reaches the heads with
    // a delay that grows with depth:
    //   dx_i/dt = (σ(Σ_j W_ij x_j(t) + b_i) − x_i(t)) / τ_i(t)
    // This is the textbook form −x/τ + σ(·) with the drive scaled by 1/τ, so that the resting state is the
    // trained feed-forward answer σ(z) whatever τ is; τ then only sets how fast a neuron follows its input.
    // τ_i(t) = τ_layer · spread_i / (1 + κ · E(t)), floored at τ_layer · spread_i / 8, where E is the decayed count of
    // shock events (decay 30 s) and spread_i a fixed 0.7-1.3 spread so neurons in one layer differ.
    // Integration: explicit Heun (trapezoid predictor-corrector, second order) with sub-steps of at most half
    // the smallest τ, inside the stability bound h·(1/τ) ≤ 2 of the leak term.
    const ODE = { tau: [0.6, 0.9, 1.2, 1.6, 2.0, 2.5], kappa: 4, floor: 8, decay: 30 };
    const spread = j => { const s = Math.sin((j + 1) * 12.9898) * 43758.5453; return 0.7 + 0.6 * (s - Math.floor(s)); };
    // τ of neuron j in layer k (1 = first hidden layer), in seconds, for shock level E.
    function odeTau(k, j, E = 0, o = ODE) {
      const base = o.tau[Math.min(o.tau.length, Math.max(1, k)) - 1] * spread(j + k * 97);
      return Math.max(base / o.floor, base / (1 + o.kappa * Math.max(0, E)));
    }
    // Shock level now from event times (ms) and weights: E = Σ w · exp(−age / decay).
    function odeShock(events, now, o = ODE) {
      let E = 0;
      for (const e of events || []) { const age = (now - e.t) / 1000; if (age >= 0) E += (Number.isFinite(e.w) ? e.w : 1) * Math.exp(-age / o.decay); }
      return E;
    }
    // Start at rest for input x: the feed-forward activations.
    function odeInit(net, x) { const f = forward(net, x); return { s: f.a.slice(1).map(a => Float64Array.from(a)), t: 0, steps: 0 }; }
    // ds/dt for every layer at state s, input x and the τ table.
    function odeDeriv(net, x0, s, taus, out) {
      const L = lay(net), p = net.p;
      for (let k = 0; k < L.off.length; k++) {
        const o = L.off[k], prev = k ? s[k - 1] : x0, sk = s[k], dk = out[k], tk = taus[k], last = k === L.off.length - 1;
        for (let j = 0; j < o.o; j++) {
          let z = p[o.b + j];
          const row = o.w + j * o.i;
          for (let i = 0; i < o.i; i++) z += p[row + i] * prev[i];
          dk[j] = ((last ? Math.tanh(z) : z > 0 ? z : 0) - sk[j]) / tk[j];
        }
      }
      return out;
    }
    // Advances state st by dt seconds with input x held, at shock level E. Returns the number of sub-steps.
    function odeStep(net, x, st, dt, E = 0, o = ODE) {
      if (!(dt > 0)) return 0;
      const L = lay(net), x0 = Float64Array.from(x, v => (Number.isFinite(v) ? v : 0));
      const taus = L.off.map((ly, k) => Float64Array.from({ length: ly.o }, (_, j) => odeTau(k + 1, j, E, o)));
      let tmin = Infinity;
      for (const t of taus) for (const v of t) if (v < tmin) tmin = v;
      const n = Math.min(4000, Math.max(1, Math.ceil(dt / (tmin / 2)))), h = dt / n;
      const k1 = st.s.map(a => new Float64Array(a.length)), k2 = st.s.map(a => new Float64Array(a.length)), pr = st.s.map(a => new Float64Array(a.length));
      for (let r = 0; r < n; r++) {
        odeDeriv(net, x0, st.s, taus, k1);
        for (let k = 0; k < pr.length; k++) for (let j = 0; j < pr[k].length; j++) pr[k][j] = st.s[k][j] + h * k1[k][j];
        odeDeriv(net, x0, pr, taus, k2);
        for (let k = 0; k < pr.length; k++) for (let j = 0; j < pr[k].length; j++) st.s[k][j] += h / 2 * (k1[k][j] + k2[k][j]);
      }
      st.t += dt; st.steps += n; st.lastTauMin = tmin; st.lastH = h;
      return n;
    }
    // Largest |x − σ(z)| over all neurons: how far the flow is from rest.
    function odeGap(net, x, st) {
      const f = forward(net, x);
      let g = 0;
      for (let k = 0; k < st.s.length; k++) for (let j = 0; j < st.s[k].length; j++) g = Math.max(g, Math.abs(st.s[k][j] - f.a[k + 1][j]));
      return g;
    }
    const act = (k, last, z) => (k === 0 ? z : last ? Math.tanh(z) : Math.max(0, z));
    return { SIZES, layout, init, forward, lossOf, grad, train, act, rng, ODE, odeTau, odeShock, odeInit, odeDeriv, odeStep, odeGap };
  }
  const nn = nnFactory();

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
      return { symbol: String(j.symbol || ""), markPrice: j.markPrice, indexPrice: j.indexPrice, lastFundingRate: j.lastFundingRate, nextFundingTime: j.nextFundingTime, time: j.time, venue: String(j.venue || "Binance USD-M") };
    },
    // ADR-109 fallbacks in the same premium form, for when fapi.binance.com refuses the caller (it answers
    // HTTP 451 to US cloud runners). The venue is kept so the page names where the number came from.
    // OKX quotes funding per settlement, every 8 h for BTC and ETH today; another interval is scaled to 8 h.
    perpOkx(fund, mark, index, symbol) {
      const f = fund && Array.isArray(fund.data) && fund.data[0], mk = mark && Array.isArray(mark.data) && mark.data[0], ix = index && Array.isArray(index.data) && index.data[0];
      if (!f || !mk || !ix || !(+mk.markPx > 0) || !(+ix.idxPx > 0) || !Number.isFinite(+f.fundingRate)) throw new Error("not an OKX funding, mark and index answer");
      const hours = (+f.nextFundingTime - +f.fundingTime) / 3600e3, per8 = hours > 0 && hours <= 24 ? +f.fundingRate * 8 / hours : +f.fundingRate;
      return { symbol, markPrice: String(mk.markPx), indexPrice: String(ix.idxPx), lastFundingRate: String(per8), nextFundingTime: +f.fundingTime || null, time: +mk.ts || null, venue: "OKX " + String(f.instId || "") };
    },
    // Deribit's perpetual ticker: funding_8h is the funding over the last 8 hours.
    perpDeribit(j, symbol) {
      const r = j && j.result;
      if (!r || !(+r.mark_price > 0) || !(+r.index_price > 0) || !Number.isFinite(+r.funding_8h)) throw new Error("not a Deribit perpetual ticker");
      return { symbol, markPrice: String(r.mark_price), indexPrice: String(r.index_price), lastFundingRate: String(r.funding_8h), nextFundingTime: null, time: +r.timestamp || null, venue: "Deribit " + String(r.instrument_name || "") };
    },
    // GDACS events (GeoJSON) cut to the orange and red alerts the page draws.
    gdacs(j, via = "GDACS") {
      const f = j && Array.isArray(j.features) ? j.features : null;
      if (!f) throw new Error("not a GDACS event list");
      return { format: "omega-alerts-v1", via, rule: "GDACS alert level", features: f.filter(x => x && x.geometry && x.geometry.type === "Point" && x.properties && ["Orange", "Red"].includes(x.properties.alertlevel)).slice(0, 200)
        .map(x => ({ geometry: { type: "Point", coordinates: x.geometry.coordinates.slice(0, 2) }, properties: { alertlevel: x.properties.alertlevel, eventtype: x.properties.eventtype, name: String(x.properties.name || x.properties.eventname || "").slice(0, 140), url: { report: x.properties.url && x.properties.url.report }, basis: "GDACS " + x.properties.alertlevel + " alert" } })) };
    },
    // EMSC has no alert level, so a fixed magnitude rule stands in and says so on every point:
    // M6.0 or more is drawn orange, M7.0 or more red. That is a stated rule, not a GDACS rating.
    emsc(j) {
      const f = j && Array.isArray(j.features) ? j.features : null;
      if (!f) throw new Error("not an EMSC event list");
      const out = [];
      for (const x of f) {
        const p = x && x.properties || {}, c = x && x.geometry && x.geometry.coordinates, mag = +p.mag;
        if (!Array.isArray(c) || !Number.isFinite(+c[0]) || !Number.isFinite(+c[1]) || !(mag >= 6)) continue;
        out.push({ geometry: { type: "Point", coordinates: [+c[0], +c[1]] }, properties: { alertlevel: mag >= 7 ? "Red" : "Orange", eventtype: "EQ", name: `M${mag.toFixed(1)} ${String(p.flynn_region || "").slice(0, 100)}`.trim(), url: { report: p.unid ? "https://www.seismicportal.eu/eventdetails.html?unid=" + encodeURIComponent(p.unid) : "" }, basis: "EMSC magnitude rule (M6+ orange, M7+ red), not a GDACS level", time: String(p.time || "") } });
      }
      return { format: "omega-alerts-v1", via: "EMSC", rule: "EMSC magnitude rule: M6+ orange, M7+ red", features: out.slice(0, 200) };
    },
    // ReliefWeb disasters with status "alert" (an early warning) are drawn orange at the primary country's centre.
    reliefweb(j) {
      const d = j && Array.isArray(j.data) ? j.data : null;
      if (!d) throw new Error("not a ReliefWeb list");
      const out = [];
      for (const x of d) {
        const f = x && x.fields || {}, loc = f.primary_country && f.primary_country.location;
        if (!loc || !Number.isFinite(+loc.lon) || !Number.isFinite(+loc.lat) || f.status !== "alert") continue;
        out.push({ geometry: { type: "Point", coordinates: [+loc.lon, +loc.lat] }, properties: { alertlevel: "Orange", eventtype: String(f.primary_type && f.primary_type.code || ""), name: String(f.name || "").slice(0, 140), url: { report: String(f.url || "") }, basis: "ReliefWeb status alert, placed at the country centre" } });
      }
      return { format: "omega-alerts-v1", via: "ReliefWeb", rule: "ReliefWeb status alert", features: out.slice(0, 100) };
    },
    // ADR-110. SANS Internet Storm Center InfoCON: {"status": "green"} from /api/infocon?json (also plain text).
    infocon(j) {
      const v = String(j && typeof j === "object" ? (j.status ?? j.infocon ?? "") : j || "").trim().toLowerCase();
      const level = ["green", "yellow", "orange", "red"].indexOf(v);
      if (level < 0) throw new Error("not an InfoCON answer");
      return { format: "omega-infocon-v1", status: v, level };
    },
    // Shodan InternetDB for one address. Its 404 ("No information available") means Shodan holds no record.
    internetdb(j, ip) {
      if (!j || typeof j !== "object") throw new Error("not an InternetDB answer");
      if (!Array.isArray(j.ports)) { if (/no information/i.test(String(j.detail || ""))) return { ip, ports: [], vulns: [], tags: [], hostnames: [], none: true }; throw new Error("not an InternetDB answer"); }
      const str = a => (Array.isArray(a) ? a : []).map(String).slice(0, 40);
      return { ip: String(j.ip || ip), ports: j.ports.filter(Number.isInteger).slice(0, 60), vulns: str(j.vulns), tags: str(j.tags), hostnames: str(j.hostnames).slice(0, 5) };
    },
    internetdbSet(list) {
      const hosts = list.map((j, i) => ({ ...shape.internetdb(j, INTERNETDB_HOSTS[i][0]), name: INTERNETDB_HOSTS[i][1] }));
      return { format: "omega-internetdb-v1", hosts, vulns: hosts.reduce((n, h) => n + h.vulns.length, 0) };
    },
    // adsb.lol v2 (the ADS-B Exchange v2 schema): {ac: [{hex, flight, lat, lon, alt_baro, squawk, emergency}], now}.
    adsb(j) {
      const ac = j && Array.isArray(j.ac) ? j.ac : null;
      if (!ac) throw new Error("not an adsb.lol answer");
      const emerg = [];
      for (const a of ac) {
        const sq = String(a.squawk || ""), em = String(a.emergency || "none");
        if (!(SQUAWKS[sq] || (em && em !== "none"))) continue;
        if (!Number.isFinite(+a.lat) || !Number.isFinite(+a.lon)) continue;
        emerg.push({ hex: String(a.hex || "").slice(0, 8), flight: String(a.flight || "").trim().slice(0, 10), lat: +a.lat, lon: +a.lon, alt: a.alt_baro === "ground" ? 0 : Number.isFinite(+a.alt_baro) ? +a.alt_baro : null, squawk: sq, emergency: em, meaning: SQUAWKS[sq] || em });
        if (emerg.length >= 60) break;
      }
      return { n: ac.length, emerg, at: Number.isFinite(+j.now) ? +j.now : null };
    },
    // One answer for the squawk 7700 list and the six zone queries, in AIR_ZONES order after it.
    adsbSet(list) {
      if (!Array.isArray(list) || list.length !== AIR_ZONES.length + 1) throw new Error("adsb set needs 7 answers");
      const sq = shape.adsb(list[0]), zones = AIR_ZONES.map((z, i) => { const r = shape.adsb(list[i + 1]); return { key: z.key, en: z.en, lat: z.lat, lon: z.lon, n: r.n, emerg: r.emerg.length }; });
      return { format: "omega-adsb-v1", source: "adsb.lol (ODbL 1.0)", radiusNm: AIR_RADIUS_NM, emergencies: sq.emerg, zones, at: sq.at };
    },
    // A RIS Live sample (risSummary) taken by the snapshot or the page; passed through after a sanity check.
    ris(j) {
      if (!j || j.format !== "omega-ris-v1" || !Array.isArray(j.prefixes) || !Number.isFinite(j.index)) throw new Error("not a RIS Live summary");
      return j;
    },
    // ADR-112. DefiLlama stablecoins (stablecoins.llama.fi/stablecoins): USD-pegged assets only, summed.
    llamaStable(j) {
      const a = j && Array.isArray(j.peggedAssets) ? j.peggedAssets : null;
      if (!a) throw new Error("not a DefiLlama stablecoin list");
      const usd = x => x && finite(+x.peggedUSD) ? +x.peggedUSD : NaN;
      const rows = a.filter(x => x && x.pegType === "peggedUSD").map(x => ({ symbol: String(x.symbol || "").slice(0, 12), name: String(x.name || "").slice(0, 40), mech: String(x.pegMechanism || ""),
        now: usd(x.circulating), d1: usd(x.circulatingPrevDay), d7: usd(x.circulatingPrevWeek), d30: usd(x.circulatingPrevMonth), price: finite(+x.price) && x.price !== null ? +x.price : NaN })).filter(x => finite(x.now) && x.now > 0);
      if (!rows.length) throw new Error("no USD stablecoins");
      const sum = k => rows.reduce((s, x) => s + (finite(x[k]) ? x[k] : x.now), 0), total = sum("now"), p1 = sum("d1"), p7 = sum("d7"), p30 = sum("d30");
      rows.sort((x, y) => y.now - x.now);
      // Peg gap only for the large coins (supply of $1 bn or more) with a price, so a thin market does not dominate.
      const big = rows.filter(x => x.now >= 1e9 && finite(x.price)), worst = big.length ? big.reduce((w, x) => Math.abs(x.price - 1) > Math.abs(w.price - 1) ? x : w) : null;
      return { format: "omega-llama-stable-v1", total, prevDay: p1, prevWeek: p7, prevMonth: p30, pct1: (total / p1 - 1) * 100, pct7: (total / p7 - 1) * 100, pct30: (total / p30 - 1) * 100, coins: rows.length,
        top: rows.slice(0, 8).map(x => ({ symbol: x.symbol, now: x.now, d1: x.d1, price: x.price, mech: x.mech })), depeg: worst ? { symbol: worst.symbol, price: worst.price, bps: (worst.price - 1) * 1e4 } : null };
    },
    // DefiLlama chains (api.llama.fi/v2/chains): total value locked now, largest chains first.
    llamaChains(j) {
      if (!Array.isArray(j)) throw new Error("not a DefiLlama chain list");
      const rows = j.filter(x => x && finite(+x.tvl) && +x.tvl > 0).map(x => ({ name: String(x.name || "").slice(0, 30), tvl: +x.tvl })).sort((a, b) => b.tvl - a.tvl);
      if (!rows.length) throw new Error("no chain TVL");
      const total = rows.reduce((s, x) => s + x.tvl, 0);
      return { format: "omega-llama-chains-v1", total, chains: rows.length, top: rows.slice(0, 8).map(x => ({ ...x, share: x.tvl / total })) };
    },
    // DefiLlama DEX overview (api.llama.fi/overview/dexs): volume of the last 24 h and of the 24 h before.
    llamaDex(j) {
      if (!j || !finite(+j.total24h)) throw new Error("not a DefiLlama DEX overview");
      const n = v => v == null || v === "" ? NaN : +v; // a null total is missing, not $0
      const t24 = +j.total24h, t48 = n(j.total48hto24h), t7 = n(j.total7d), t14 = n(j.total14dto7d);
      return { format: "omega-llama-dex-v1", total24h: t24, prev24h: finite(t48) ? t48 : NaN, total7d: finite(t7) ? t7 : NaN, chg1d: finite(t48) && t48 > 0 ? (t24 / t48 - 1) * 100 : NaN, chg7d: finite(t7) && finite(t14) && t14 > 0 ? (t7 / t14 - 1) * 100 : NaN,
        top: (Array.isArray(j.protocols) ? j.protocols : []).filter(p => p && finite(+p.total24h)).sort((a, b) => b.total24h - a.total24h).slice(0, 5).map(p => ({ name: String(p.displayName || p.name || "").slice(0, 30), v: +p.total24h })) };
    },
    llamaSet(list) {
      if (!Array.isArray(list) || list.length !== 3) throw new Error("DefiLlama set needs 3 answers");
      // Stablecoins carry most of the index; a failed chains or DEX answer leaves that part out (ADR-113).
      const opt = (f, j) => { try { return f(j); } catch { return null; } };
      const set = { format: "omega-llama-v1", stable: shape.llamaStable(list[0]), chains: opt(shape.llamaChains, list[1]), dex: opt(shape.llamaDex, list[2]) };
      return { ...set, lfi: lfi(set).score };
    },
    // CIRCL Vulnerability-Lookup "last" feed: a list mixing CVE JSON 5 records and OSV advisories (PYSEC, GHSA, ...).
    // Each is cut to id, aliases, dates, title, CVSS base score (published score, else computed from the vector),
    // CWE, vendor and product, and whether a reference is marked as an exploit.
    circl(j) {
      const list = Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null;
      if (!list) throw new Error("not a CIRCL list");
      const out = [];
      for (const r of list) {
        if (!r || typeof r !== "object") continue;
        const meta = r.cveMetadata || {}, cna = r.containers && r.containers.cna || {}, adp = r.containers && Array.isArray(r.containers.adp) ? r.containers.adp : [];
        const id = String(meta.cveId || r.id || "").slice(0, 40);
        if (!id) continue;
        const scores = [];
        for (const m of [cna, ...adp].flatMap(c => Array.isArray(c.metrics) ? c.metrics : [])) for (const k of ["cvssV4_0", "cvssV3_1", "cvssV3_0"]) if (m && m[k] && finite(+m[k].baseScore)) scores.push(+m[k].baseScore);
        for (const s of Array.isArray(r.severity) ? r.severity : []) { const v = cvss3(s && s.score); if (finite(v)) scores.push(v); }
        const desc = (Array.isArray(cna.descriptions) ? cna.descriptions : []).find(d => d && /^en/i.test(String(d.lang || ""))) || {};
        const cwe = (((cna.problemTypes || [])[0] || {}).descriptions || []).map(d => String(d.cweId || "")).find(Boolean) || ((Array.isArray(r.database_specific && r.database_specific.cwe_ids) ? r.database_specific.cwe_ids[0] : "") || "");
        const af = Array.isArray(r.affected) ? r.affected[0] || {} : Array.isArray(cna.affected) ? cna.affected[0] || {} : {}, pkg = af.package || {};
        const refs = [...(Array.isArray(r.references) ? r.references : []), ...(Array.isArray(cna.references) ? cna.references : [])];
        out.push({ id, aliases: (Array.isArray(r.aliases) ? r.aliases : []).map(String).filter(a => /^CVE-\d{4}-\d+$/.test(a)).slice(0, 4),
          published: String(meta.datePublished || r.published || "").slice(0, 25), title: String(cna.title || desc.value || r.summary || r.details || "").replace(/\s+/g, " ").trim().slice(0, 160),
          cvss: scores.length ? Math.max(...scores) : NaN, cwe: String(cwe).slice(0, 12), vendor: String(af.vendor || pkg.ecosystem || "").slice(0, 40), product: String(af.product || pkg.name || "").slice(0, 60),
          osv: !!pkg.ecosystem, poc: refs.some(x => x && (String(x.type || "").toUpperCase() === "EXPLOIT" || (Array.isArray(x.tags) && x.tags.some(t => /exploit/i.test(String(t)))))) });
        if (out.length >= 60) break;
      }
      if (!out.length) throw new Error("empty CIRCL list");
      return { format: "omega-circl-v1", source: "CIRCL Vulnerability-Lookup", items: out };
    },
    // Open-Meteo Marine for MARINE_POINTS (one answer per point, in order).
    marine(j) {
      const arr = Array.isArray(j) ? j : [j];
      if (arr.length !== MARINE_POINTS.length || !arr.every(x => x && x.current)) throw new Error("not a marine answer for the five straits");
      const n = v => finite(+v) && v !== null ? +v : NaN;
      return { format: "omega-marine-v1", source: "Open-Meteo Marine (CC BY 4.0)", at: String(arr[0].current.time || ""), points: arr.map((x, i) => {
        const c = x.current, cur = n(c.ocean_current_velocity);
        return { key: MARINE_POINTS[i].key, en: MARINE_POINTS[i].en, lat: n(x.latitude), lon: n(x.longitude), hs: n(c.wave_height), dir: n(c.wave_direction), period: n(c.wave_period), swell: n(c.swell_wave_height),
          cur, curKn: finite(cur) ? cur / 1.852 : NaN, curDir: n(c.ocean_current_direction), sst: n(c.sea_surface_temperature),
          hourly: x.hourly && Array.isArray(x.hourly.wave_height) ? x.hourly.wave_height.slice(0, 24).map(v => finite(+v) && v !== null ? +v : null) : [] };
      }) };
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
    premium: sym => `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`,
    // ADR-109: BTCUSDT and ETHUSDT map to the OKX USDT swaps and the Deribit perpetuals.
    okx: sym => { const b = sym.replace(/USDT$/, ""); return [`https://www.okx.com/api/v5/public/funding-rate?instId=${b}-USDT-SWAP`, `https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${b}-USDT-SWAP`, `https://www.okx.com/api/v5/market/index-tickers?instId=${b}-USDT`]; },
    deribitPerp: sym => `https://www.deribit.com/api/v2/public/ticker?instrument_name=${sym.replace(/USDT$/, "")}-PERPETUAL`,
    gdacs: () => "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP",
    gdacsSearch: now => { const d = t => new Date(t).toISOString().slice(0, 10); return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Orange;Red&fromDate=${d(now - 7 * 86400e3)}&toDate=${d(now)}`; },
    emsc: now => `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=200&minmag=6&starttime=${new Date(win15(now) * 1000 - 7 * 86400e3).toISOString().slice(0, 19)}`,
    reliefweb: () => "https://api.reliefweb.int/v2/disasters?appname=omega-giant-core&profile=list&limit=50&filter[field]=status&filter[value]=alert&fields[include][]=primary_country.location&fields[include][]=primary_type.code&fields[include][]=status&fields[include][]=url",
    infocon: () => "https://isc.sans.edu/api/infocon?json",
    internetdb: ip => `https://internetdb.shodan.io/${ip}`,
    adsbSqk: code => `https://api.adsb.lol/v2/sqk/${code}`,
    adsbZone: key => { const z = AIR_ZONES.find(x => x.key === key); return z ? `https://api.adsb.lol/v2/point/${z.lat}/${z.lon}/${AIR_RADIUS_NM}` : ""; },
    risLive: () => "wss://ris-live.ripe.net/v1/ws/?client=omega-giant-core",
    // NASA GIBS WMTS (EPSG:3857, "best"): VIIRS Black Marble night lights (2016 composite) and the MODIS
    // Terra + Aqua thermal anomalies of the latest day. Keyless; credit "NASA GIBS".
    gibs: (layer, z, x, y) => layer === "night" ? `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`
      : `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Thermal_Anomalies_All/default/default/GoogleMapsCompatible_Level9/${z}/${y}/${x}.png`,
    // ADR-112. DefiLlama (keyless): stablecoin supply, chain TVL and the DEX volume overview without its charts.
    llama: () => ["https://stablecoins.llama.fi/stablecoins?includePrices=true", "https://api.llama.fi/v2/chains", "https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true"],
    // CIRCL Vulnerability-Lookup (keyless): the most recently published records.
    circl: () => "https://vulnerability.circl.lu/api/last",
    // Open-Meteo Marine (keyless): current sea state and today's hourly wave height at the five strait points.
    marine: () => "https://marine-api.open-meteo.com/v1/marine?latitude=" + MARINE_POINTS.map(p => p.lat).join(",") + "&longitude=" + MARINE_POINTS.map(p => p.lon).join(",")
      + "&current=wave_height,wave_direction,wave_period,swell_wave_height,ocean_current_velocity,ocean_current_direction,sea_surface_temperature&hourly=wave_height&forecast_days=1&cell_selection=sea&timezone=UTC"
  };

  return Object.freeze({ shape, urls, RIPE_ASNS, RIS_WATCH, INTERNETDB_HOSTS, AIR_ZONES, AIR_RADIUS_NM, SQUAWKS, MARINE_POINTS, lfi, cvss3, priorityLevel, mispTags, circlSummary, seaState, risSummary, risSubscribe, nnFactory, nn, clamp, mean, variance, kalman, bocpd, lgamma, kyleLambda, iceberg, entropy, ncdf, bs, parseOption, gex, gexAt, chain, rr25, dvol, basisTrap, epochMs, gmst, kepler, groundTrack, l2Fill, csti, micro, excess, canon });
})();
