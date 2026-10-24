#!/usr/bin/env node
// omega-local-mcp: a zero-dependency MCP server over stdio for Claude Desktop (ADR-108).
//   node scripts/omega-mcp-bridge.mjs              serve MCP on stdin/stdout (Claude Desktop starts it)
//   node scripts/omega-mcp-bridge.mjs --selftest   run the bridge checks once, print them and exit (0 = all passed)
//   node scripts/omega-mcp-bridge.mjs --list       print the tool names and exit
//
// It reads the same free, keyless public data as the Ops Room, through the same three tiers: the local data proxy
// on 127.0.0.1:8796 (start-omega), then the upstream directly, then the hourly public snapshot (local
// data/public-intel-snapshot.json, else the copy on GitHub Pages), ignored after 6 hours. Every answer names
// the tier and the fetch time of each source. The maths is scripts/lib/brain2-math.mjs, the file the page
// inlines, so the bridge and the page compute the same numbers.
//
// Read only and paper only. No tool here signs or sends an order, holds a key, moves money or writes a file.
// lock_base_and_sweep only computes the paper sweep; the sweep itself is the S key in the Ops Room.
// verify_sha256_receipt_chain reads one local .json file the user names. Logs go to stderr, never stdout.
// ADR-112: query_osiris_intel adds the layers liquidity (DefiLlama flow index), vulns (CIRCL records with MISP
// tags) and sea (Open-Meteo Marine at the five straits); explain_with_local_model hands a list of readings to a
// local Ollama model through the data proxy (which refuses :cloud models) and returns its explanation, labelled.
// ADR-114: deep_research runs the ORACLE agent (scripts/lib/deep-research.mjs) over the keyless research APIs (twelve
// since ADR-115, which also adds mode "intel": passive OSINT with GDELT coverage and tone and NVD CVEs),
// through the proxy's /research cache when it runs and directly otherwise, and returns the brief with numbered references.
import { readFileSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { OMEGA_MATH as M } from "./lib/brain2-math.mjs";
import { classifyNga, STRAITS } from "./lib/osiris-sources.mjs";
import { OMEGA_RESEARCH as RS } from "./lib/deep-research.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "1.0.0";
const PROXY = `http://127.0.0.1:${process.env.OMEGA_PROXY_PORT || 8796}`;
const SNAPSHOT_URL = "https://ahmed974x.github.io/giant-core/data/public-intel-snapshot.json";
const SNAPSHOT_FILE = join(REPO, "data", "public-intel-snapshot.json");
const SNAP_MAX_AGE = 6 * 3600e3;
const UA = "omega-local-mcp/1.0 (+https://github.com/ahmed974x/giant-core)";
const PAPER = "Decision aid for paper trading only. Nothing here places an order or moves money.";
const log = (...a) => process.stderr.write("[omega-local-mcp] " + a.join(" ") + "\n");
const iso = t => (Number.isFinite(t) ? new Date(t).toISOString() : null);
const r = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

/* ---------------- fetching ---------------- */
async function get(url, ms = 15000, text = false) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(ms), redirect: "follow" });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return text ? Buffer.from(await res.arrayBuffer()) : res.json();
}
let proxyMemo = null;
function proxyUp() {
  if (!proxyMemo || Date.now() - proxyMemo.t > 60000) proxyMemo = { t: Date.now(), job: get(PROXY + "/health", 1500).then(j => !!(j && j.ok)).catch(() => false) };
  return proxyMemo.job;
}
let snapMemo = null;
function snapshot() {
  if (!snapMemo || Date.now() - snapMemo.t > 600000) {
    snapMemo = { t: Date.now(), job: (async () => {
      try { if (existsSync(SNAPSHOT_FILE)) { const j = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")); if (j && j.format === "omega-public-intel-v1") return { j, where: "local file" }; } } catch { /* fall through to the published copy */ }
      try { const j = await get(SNAPSHOT_URL, 15000); if (j && j.format === "omega-public-intel-v1") return { j, where: "GitHub Pages" }; } catch { /* no snapshot */ }
      return null;
    })() };
  }
  return snapMemo.job;
}
async function fromSnapshot(key) {
  const s = await snapshot(), x = s && s.j.sources && s.j.sources[key];
  if (!x || x.ok !== true) throw new Error("not in the snapshot");
  const at = Date.parse(x.at);
  if (!(Date.now() - at < SNAP_MAX_AGE)) throw new Error("snapshot older than 6 hours");
  return { data: x.data, at, tier: "snapshot (" + s.where + ")" };
}
// Tries each tier in order and returns the first that answers: {data, tier, at} or {error, tried}.
async function cascade(steps) {
  const tried = [];
  for (const [tier, job] of steps) {
    if (!job) continue;
    try { const out = await job(); return { tier: out.tier || tier, at: out.at || Date.now(), data: out.data }; }
    catch (e) { tried.push(`${tier}: ${String(e.message || e).slice(0, 120)}`); }
  }
  return { error: "تعذر التحقق منها (could not be verified): no tier answered", tried };
}
const viaProxy = path => async () => { if (!(await proxyUp())) throw new Error("proxy is not running"); return { data: await get(PROXY + path, 30000) }; };
const direct = (url, shape, raw) => async () => ({ data: shape(raw ? await get(url, 20000, true) : await get(url, 20000)) });
const snap = key => async () => fromSnapshot(key);
const asShape = (fmt, f) => j => (j && j.format === fmt ? j : f(j));

const SRC = {
  kev: () => cascade([["proxy", viaProxy("/cyber/kev")], ["direct", direct(M.urls.kev(), j => M.shape.kev(j, Date.now()))], ["snapshot", snap("kev")]]),
  kp: () => cascade([["proxy", viaProxy("/osiris/kp")], ["direct", direct(M.urls.kp(), M.shape.kp)], ["snapshot", snap("kp")]]),
  ioda: () => cascade([["proxy", viaProxy("/cyber/ioda")], ["direct", direct(M.urls.ioda(Date.now()), M.shape.ioda)], ["snapshot", snap("ioda")]]),
  ripe: () => cascade([
    ["proxy", async () => { if (!(await proxyUp())) throw new Error("proxy is not running"); return { data: { asns: await Promise.all(M.RIPE_ASNS.map(([a]) => get(PROXY + "/cyber/ripe/AS" + a, 15000))) } }; }],
    ["direct", async () => ({ data: { asns: await Promise.all(M.RIPE_ASNS.map(([a]) => get(M.urls.ripe(a), 15000).then(j => M.shape.ripe(j, a)))) } })],
    ["snapshot", snap("ripe")]]),
  eonet: () => cascade([["proxy", viaProxy("/osiris/eonet")], ["direct", direct(M.urls.eonet(), M.shape.eonet)], ["snapshot", snap("eonet")]]),
  stations: () => cascade([["proxy", viaProxy("/osiris/celestrak/stations")], ["direct", direct(M.urls.gp("stations"), M.shape.gp)], ["snapshot", snap("celestrak_stations")]]),
  usgs: () => cascade([["direct", direct("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", j => j)], ["snapshot", snap("usgs")]]),
  gdacs: () => cascade([["proxy", viaProxy("/osiris/gdacs")], ["direct", direct("https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP", j => j)], ["snapshot", snap("gdacs")]]),
  nga: () => cascade([["proxy", viaProxy("/osiris/nga")], ["direct", direct("https://msi.nga.mil/api/publications/broadcast-warn?output=json", buf => JSON.parse(classifyNga(buf).toString("utf8")), true)], ["snapshot", snap("nga")]]),
  deribit: () => cascade([["proxy", viaProxy("/market/deribit/options/BTC")], ["direct", direct(M.urls.deribit(), M.shape.deribit)], ["snapshot", snap("deribit")]]),
  dvol: () => cascade([["proxy", viaProxy("/market/deribit/dvol/BTC")], ["direct", direct(M.urls.dvol(Date.now()), M.shape.dvol)], ["snapshot", snap("dvol")]]),
  premium: sym => cascade([["proxy", viaProxy("/market/fapi/premium/" + sym)], ["direct", direct(M.urls.premium(sym), M.shape.premium)],
    ["snapshot", async () => { const s = await fromSnapshot("premium"); const p = (s.data.items || []).find(x => x.symbol === sym); if (!p) throw new Error(sym + " not in the snapshot"); return { ...s, data: p }; }]]),
  depth: sym => cascade([["proxy", viaProxy("/market/depth/" + sym)], ["direct", direct(`https://data-api.binance.vision/api/v3/depth?symbol=${sym}&limit=100`, j => j)]]),
  trades: sym => cascade([["proxy", viaProxy("/market/trades/" + sym)], ["direct", direct(`https://data-api.binance.vision/api/v3/aggTrades?symbol=${sym}&limit=300`, j => j)]]),
  llama: () => cascade([["proxy", viaProxy("/market/llama")], ["direct", async () => { const l = []; for (const u of M.urls.llama()) l.push(await get(u, 30000)); return { data: M.shape.llamaSet(l) }; }], ["snapshot", snap("llama")]]),
  circl: () => cascade([["proxy", viaProxy("/cyber/circl")], ["direct", direct(M.urls.circl(), M.shape.circl)], ["snapshot", snap("circl")]]),
  marine: () => cascade([["proxy", viaProxy("/osiris/marine")], ["direct", direct(M.urls.marine(), M.shape.marine)], ["snapshot", snap("marine")]]),
  klines: sym => cascade([["direct", direct(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1m&limit=240`, j => j)]])
};
const meta = (x, name) => ({ source: name, tier: x.error ? "offline" : x.tier, fetched: x.error ? null : iso(x.at), ...(x.error ? { error: x.error, tried: x.tried } : {}) });
const SYMBOL = /^[A-Z0-9]{5,20}$/;
const sym = a => { const s = String((a && a.symbol) || "BTCUSDT").toUpperCase(); if (!SYMBOL.test(s)) throw new Error("symbol must be 5 to 20 letters or digits, for example BTCUSDT"); return s; };

/* ---------------- readings, the same formulas as the Ops Room ---------------- */
async function cyberSpace() {
  const [kev, kp, ripe, ioda, circl] = await Promise.all([SRC.kev(), SRC.kp(), SRC.ripe(), SRC.ioda(), SRC.circl()]);
  const K = kev.error ? null : asShape("omega-kev-v1", j => M.shape.kev(j, Date.now()))(kev.data);
  const KP = kp.error ? null : asShape("omega-kp-v1", M.shape.kp)(kp.data).readings;
  const RI = ripe.error ? [] : (ripe.data.asns || []).filter(x => x && x.format === "omega-ripe-v1");
  const IO = ioda.error ? null : asShape("omega-ioda-v1", M.shape.ioda)(ioda.data).events;
  const cut = Date.now() - 7 * 86400e3, wk = K ? K.recent.filter(x => Date.parse(x.added + "T00:00:00Z") >= cut) : null;
  const kpNow = KP && KP.length ? KP[KP.length - 1].kp : NaN, bgp = RI.length ? Math.min(...RI.map(x => x.share)) : NaN;
  // CIRCL pressure is CSTI's eighth part (ADR-112, calibrated in ADR-113), the same as on the Ops Room page.
  let CI = null;
  try { CI = circl.error ? null : M.circlSummary(asShape("omega-circl-v1", M.shape.circl)(circl.data), new Set(K ? K.recent.map(x => x.cve) : [])); } catch { CI = null; }
  const c = M.csti({ kp: kpNow, kev7: wk ? wk.length : NaN, ransom7: wk ? wk.filter(x => x.ransomware).length : NaN, bgpMin: bgp, ioda: IO ? IO.length : NaN, circl: CI ? CI.pressure : NaN });
  return {
    csti: { score: r(c.score, 1), coverage: `${c.coverage} of ${c.of} possible parts (InfoCON, RIS Live and InternetDB are read on the page only)`, parts: c.parts.map(p => ({ part: p.k, value: r(p.v, 1) })), label: "[INFERENCE]" },
    space: { kp_now: r(kpNow, 2), kp_time: KP && KP.length ? KP[KP.length - 1].t : null, ...meta(kp, "NOAA SWPC planetary K index") },
    kev: K ? { catalogue: K.count, added_7d: wk.length, ransomware_7d: wk.filter(x => x.ransomware).length, latest: K.recent.slice(0, 5), ...meta(kev, "CISA Known Exploited Vulnerabilities") } : meta(kev, "CISA KEV"),
    bgp: { backbones: RI.map(x => ({ asn: x.asn, name: x.name, seen_by: `${x.seeing} of ${x.total} RIS peers`, share: r(x.share, 4) })), ...meta(ripe, "RIPEstat routing status") },
    outages: IO ? { count_24h: IO.length, events: IO.slice(0, 10), ...meta(ioda, "IODA (Georgia Tech)") } : meta(ioda, "IODA")
  };
}
async function pwsi() {
  const [usgs, gdacs, nga, cs] = await Promise.all([SRC.usgs(), SRC.gdacs(), SRC.nga(), cyberSpace()]);
  const parts = [];
  if (!usgs.error) {
    const q = (usgs.data.features || []).map(f => f.properties).filter(p => p && Number.isFinite(p.mag)).sort((a, b) => b.mag - a.mag), top = q[0], m5 = q.filter(x => x.mag >= 5).length;
    parts.push({ part: "Seismic", value: r(M.clamp(Math.max(top ? (top.mag - 4) / 3 : 0, m5 / 10), 0, 1) * 100, 1), why: top ? `max M${top.mag} ${top.place || ""} · ${m5} at M5+` : "no M2.5+ in 24 h", ...meta(usgs, "USGS") });
  }
  if (!gdacs.error) {
    const g = (gdacs.data.features || []).filter(f => f.properties && ["Orange", "Red"].includes(f.properties.alertlevel)), red = g.filter(f => f.properties.alertlevel === "Red").length;
    parts.push({ part: "Disaster alerts", value: M.clamp(red * 34 + (g.length - red) * 12, 0, 100), why: `${red} red · ${g.length - red} orange`, ...meta(gdacs, "GDACS") });
  }
  if (!nga.error) {
    const st = nga.data.straits || [], n = st.reduce((a, x) => a + (x.warnings || []).length, 0), hot = st.filter(x => (x.warnings || []).length).length;
    parts.push({ part: "Strait warnings", value: M.clamp(n * 8 + hot * 6, 0, 100), why: `${n} active NGA warnings in ${hot} of ${STRAITS.length} straits`, ...meta(nga, "NGA MSI") });
  }
  if (Number.isFinite(cs.csti.score)) parts.push({ part: "Cyber & space (CSTI)", value: cs.csti.score, why: `CSTI from ${cs.csti.coverage}` });
  const score = parts.length ? parts.reduce((a, p) => a + p.value, 0) / parts.length : NaN;
  return {
    pwsi: r(score, 1), coverage: `${parts.length} of 5 components`, label: "[INFERENCE]",
    note: "The weather-at-hubs component is computed in the Ops Room only, so the bridge's PWSI can differ from the page by that part. With no component, the answer is تعذر التحقق منها.",
    parts, csti: cs.csti, kill_switch: { limit: 70, tripped: (Number.isFinite(score) && score >= 70) || (Number.isFinite(cs.csti.score) && cs.csti.score >= 70) }
  };
}
function bookStats(book, tape) {
  const bids = (book.bids || []).slice(0, 25).map(([p, q]) => [+p, +q]), asks = (book.asks || []).slice(0, 25).map(([p, q]) => [+p, +q]);
  if (!bids.length || !asks.length) throw new Error("empty book");
  const [bp, bq] = bids[0], [ap, aq] = asks[0], mid = (bp + ap) / 2, micro = (bp * aq + ap * bq) / (bq + aq);
  const sb = bids.reduce((a, x) => a + x[1], 0), sa = asks.reduce((a, x) => a + x[1], 0);
  const walls = (side, list) => list.map(([p, q]) => ({ side, price: p, qty: r(q, 6), distance_bps: r(Math.abs(p / mid - 1) * 1e4, 2), x_median: 0 }));
  const med = l => { const s = l.map(x => x[1]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 1; };
  const top = (side, list) => walls(side, list).map(w => ({ ...w, x_median: r(w.qty / med(list), 1) })).sort((a, b) => b.qty - a.qty).slice(0, 3);
  const T = (tape || []).map(x => ({ p: +x.p, q: +x.q, T: +x.T, m: !!x.m }));
  return {
    mid: r(mid, 2), microprice: r(micro, 2), microprice_gap_bps: r((micro / mid - 1) * 1e4, 3), spread_bps: r((ap / bp - 1) * 1e4, 3),
    imbalance_top25: r((sb - sa) / (sb + sa), 4), entropy_top25: (e => ({ bid: r(e.bid, 3), ask: r(e.ask, 3) }))(M.entropy(book, 25)),
    whale_walls: { bids: top("bid", bids), asks: top("ask", asks), label: "[INFERENCE]" },
    iceberg_candidates: T.length ? M.iceberg(T, book).slice(0, 5).map(x => ({ ...x, ratio: r(x.ratio, 2) })) : [],
    kyle_lambda: T.length ? (k => k && { bps_per_unit: r(k.bpsPerUnit, 4), r2: r(k.r2, 3), buckets: k.buckets })(M.kyleLambda(T)) : null
  };
}
async function sonar(a) {
  const s = sym(a), [d, t] = await Promise.all([SRC.depth(s), SRC.trades(s)]);
  if (d.error) return { symbol: s, ...meta(d, "Binance public depth"), note: "No book, so no sonar reading. Start the local proxy (start-omega) or check the internet." };
  return { symbol: s, ...bookStats(d.data, t.error ? [] : t.data), book: meta(d, "Binance public depth, top 25 per side"), tape: meta(t, "Binance public aggTrades, last 300"), note: "Walls are the three largest of the top 25 levels per side. Iceberg candidates are levels where traded size is at least 2x the size still shown. " + PAPER };
}
async function quant(a) {
  const s = sym(a), base = s.replace(/USDT$/, "");
  const [k, d, t, dv, opt, prem] = await Promise.all([SRC.klines(s), SRC.depth(s), SRC.trades(s), SRC.dvol(), SRC.deribit(), SRC.premium(s)]);
  const closes = k.error ? [] : k.data.map(x => +x[4]);
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]) * 1e4);
  const kal = M.kalman(closes), bo = M.bocpd(rets);
  const g = !opt.error && base === "BTC" ? M.gex(asShape("omega-deribit-v1", M.shape.deribit)(opt.data).options, Date.now()) : null;
  const v = dv.error ? null : M.dvol(asShape("omega-dvol-v1", M.shape.dvol)(dv.data).rows);
  const bt = prem.error ? null : M.basisTrap(prem.data);
  let book = null; try { if (!d.error) book = bookStats(d.data, t.error ? [] : t.data); } catch { book = null; }
  return {
    symbol: s, label: "[INFERENCE - Quant Model]",
    kalman: kal ? { latent_price: r(kal.latent, 2), last: r(kal.last, 2), gap_bps: r(kal.gapBps, 2), q: kal.q, r: kal.r, n: kal.n, input: "1-minute closes, last 240" } : null,
    bocpd: bo ? { p_change_last_10: r(bo.pRecent, 4), map_run_length: bo.map, hazard: bo.hazard, n: bo.n, input: "1-minute log returns in bps" } : null,
    book,
    options_gamma: g ? { regime: g.regime, total_usd_per_1pct: r(g.total, 0), flip: r(g.flip, 0), call_wall: g.callWall, put_wall: g.putWall, spot: r(g.spot, 2), atm_iv: g.atmIv && r(g.atmIv.iv * 100, 2), rr25_vol_pts: g.rr && r(g.rr.rr * 100, 2), assumption: "dealers long calls and short puts (public convention, not observed)" } : base === "BTC" ? null : "Deribit gamma is read for BTC only",
    dvol: v ? { value: r(v.value, 2), change_48h: r(v.change, 2), at: iso(v.at) } : null,
    funding_basis: bt ? { basis_bps: r(bt.basisBps, 2), funding_8h: bt.funding, apr_pct: r(bt.apr * 100, 2), crowd: bt.crowd, trap_score: r(bt.score, 3) } : null,
    sources: { klines: meta(k, "Binance public 1m klines"), depth: meta(d, "Binance public depth"), options: meta(opt, "Deribit BTC option summary"), dvol: meta(dv, "Deribit DVOL"), premium: meta(prem, "Binance USD-M premium index") },
    note: PAPER
  };
}
// The six voices, rule based and stated in full so every vote can be checked against the numbers above.
async function court(a) {
  const [q, p] = await Promise.all([quant(a), pwsi()]);
  const b = q.book, c = q.kalman, votes = [];
  const bullWhy = [], bearWhy = [];
  if (c && c.gap_bps > 0) bullWhy.push(`last trade ${c.gap_bps} bps above the Kalman latent price`); if (c && c.gap_bps < 0) bearWhy.push(`last trade ${-c.gap_bps} bps below the Kalman latent price`);
  if (b && b.microprice_gap_bps > 0.5) bullWhy.push(`microprice ${b.microprice_gap_bps} bps above mid`); if (b && b.microprice_gap_bps < -0.5) bearWhy.push(`microprice ${-b.microprice_gap_bps} bps below mid`);
  if (b && b.imbalance_top25 > 0.1) bullWhy.push(`top-25 imbalance ${b.imbalance_top25} to the bid`); if (b && b.imbalance_top25 < -0.1) bearWhy.push(`top-25 imbalance ${b.imbalance_top25} to the ask`);
  const og = q.options_gamma && typeof q.options_gamma === "object" ? q.options_gamma : null;
  if (og && og.regime === "positive") bullWhy.push("dealer gamma positive (moves damped)"); if (og && og.regime === "negative") bearWhy.push("dealer gamma negative (moves amplified)");
  if (q.funding_basis && q.funding_basis.crowd === "longs") bearWhy.push(`crowded longs: funding ${q.funding_basis.funding_8h} per 8 h, basis ${q.funding_basis.basis_bps} bps`);
  if (q.funding_basis && q.funding_basis.crowd === "shorts") bullWhy.push(`crowded shorts: funding ${q.funding_basis.funding_8h} per 8 h`);
  votes.push({ agent: "Bull", score: bullWhy.length, why: bullWhy.length ? bullWhy : ["no bullish reading"] });
  votes.push({ agent: "Bear", score: bearWhy.length, why: bearWhy.length ? bearWhy : ["no bearish reading"] });
  const shift = !!(q.bocpd && q.bocpd.p_change_last_10 > 0.5);
  votes.push({ agent: "Researcher", flag: shift, why: [q.bocpd ? `BOCPD puts ${q.bocpd.p_change_last_10} on a regime change in the last 10 minutes` : "BOCPD has no input"] });
  const stretched = !!(c && Math.abs(c.gap_bps) > 15);
  votes.push({ agent: "Modeler", flag: stretched, why: [c ? `Kalman gap ${c.gap_bps} bps (stretched above 15)` : "Kalman has no input"] });
  const live = Object.values(q.sources).filter(x => x.tier !== "offline").length, total = Object.keys(q.sources).length;
  const audited = live >= Math.ceil(total / 2) && !!b;
  votes.push({ agent: "Auditor", flag: !audited, why: [`${live} of ${total} market sources answered${b ? "" : "; no order book"}`] });
  const kill = p.kill_switch.tripped;
  let verdict = "HOLD", reason = "bull and bear are within one reading of each other";
  if (kill) reason = `kill switch: PWSI ${p.pwsi} or CSTI ${p.csti.score} at or above ${p.kill_switch.limit}`;
  else if (!audited) reason = "auditor: too few live sources to judge";
  else if (shift) reason = "researcher: a regime change is likely, wait for it to settle";
  else if (votes[0].score >= votes[1].score + 2) { verdict = "BUY"; reason = "bull leads by two or more readings"; }
  else if (votes[1].score >= votes[0].score + 2) { verdict = "SELL"; reason = "bear leads by two or more readings"; }
  votes.push({ agent: "Judge", verdict, why: [reason] });
  return { symbol: q.symbol, verdict, label: "[INFERENCE]", votes, pwsi: p.pwsi, csti: p.csti.score, opens_trade: false, note: "Rule-based summary of the numbers in query_quant_spiderweb and get_live_pwsi. It opens nothing; in the Ops Room the person opens every paper trade. " + PAPER };
}
function sweep(a) {
  const equity = Number(a && a.net_equity), base = Number(a && a.locked_base !== undefined ? a.locked_base : 20);
  if (!Number.isFinite(equity) || equity < 0) throw new Error("net_equity must be a number of USDT, 0 or more");
  if (!Number.isFinite(base) || base < 0) throw new Error("locked_base must be a number of USDT, 0 or more");
  const s = M.micro(M.excess(equity, base));
  return {
    net_equity: M.micro(equity), locked_base: M.micro(base), sweepable_usdt: s, formula: "max(0, NetEquity - LockedBase), rounded to 1e-6 USDT",
    how: s > 0 ? "Press S (or 'Sweep profit now') in the Ops Room to move this amount into the paper safe. It issues a SWEEP receipt." : "Nothing to sweep: equity is at or below the locked base.",
    note: "This tool computes only. It cannot reach the browser's paper wallet, and a sweep of real funds stays a proposal in the Director 00 approval inbox. The base itself can still lose in trading; only swept profit is protected."
  };
}

/* ---------------- receipt chain, the canonical form of DESIGN.md §7 ---------------- */
const GENESIS = "0".repeat(64);
const sha = s => createHash("sha256").update(s, "utf8").digest("hex");
const hashOf = o => sha(JSON.stringify(M.canon(o)));
function merkleRoot(hashes) { let l = hashes.slice(); if (!l.length) return GENESIS; while (l.length > 1) { const n = []; for (let i = 0; i < l.length; i += 2) n.push(sha(l[i] + (l[i + 1] ?? l[i]))); l = n; } return l[0]; }
function verifyChain(doc) {
  if (!doc || doc.format !== "omega-receipt-chain-v1" || !Array.isArray(doc.receipts)) return { ok: false, why: "not an omega-receipt-chain-v1 file" };
  const cps = Array.isArray(doc.checkpoints) ? doc.checkpoints : [];
  let prev = GENESIS, prevCp = GENESIS, seq = 0;
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (!c || c.format !== "omega-merkle-checkpoint-v1") return { ok: false, why: `checkpoint ${i + 1} is malformed` };
    if (c.first_prev_hash !== prev || c.prev_checkpoint !== prevCp || c.from_seq !== seq + 1 || c.count !== c.to_seq - c.from_seq + 1) return { ok: false, why: `checkpoint ${i + 1} does not follow the one before it` };
    if (hashOf(c) !== c.hash) return { ok: false, why: `checkpoint ${i + 1} was changed after it was made` };
    prev = c.last_hash; prevCp = c.hash; seq = c.to_seq;
  }
  for (let i = 0; i < doc.receipts.length; i++) {
    const x = doc.receipts[i];
    if (!x || typeof x.hash !== "string") return { ok: false, at: i + 1, why: `receipt ${i + 1} is malformed` };
    if (x.prev_hash !== prev) return { ok: false, at: i + 1, why: `receipt ${i + 1} (seq ${x.seq}): prev_hash does not match the receipt before it` };
    if (hashOf(x) !== x.hash) return { ok: false, at: i + 1, why: `receipt ${i + 1} (seq ${x.seq}): content was changed after it was issued` };
    prev = x.hash;
  }
  return { ok: true, receipts: doc.receipts.length, checkpoints: cps.length, folded: cps.reduce((a, c) => a + c.count, 0), tip: prev };
}
function verifyTool(a) {
  let doc;
  if (a && typeof a.json === "string") { if (a.json.length > 20e6) throw new Error("json is larger than 20 MB"); doc = JSON.parse(a.json); }
  else if (a && typeof a.path === "string") {
    const p = resolve(a.path.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || "~"));
    if (extname(p).toLowerCase() !== ".json") throw new Error("path must be a .json receipt export");
    if (statSync(p).size > 20e6) throw new Error("file is larger than 20 MB");
    // The parse error is replaced so a wrong file's contents never reach the model (ADR-113).
    try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { throw new Error("that file is not valid JSON; give the .json file the Ops Room exported"); }
  } else throw new Error("give path (an exported .json file) or json (the file's text)");
  return { ...verifyChain(doc), method: "SHA-256 of JSON with keys sorted, numbers rounded to 8 decimals, hash keys dropped; first prev_hash is 64 zeros; checkpoints are Merkle roots of the folded hashes" };
}

/* ---------------- self-test ---------------- */
async function selftest() {
  const out = [];
  const check = async (name, f) => { try { const why = await f(); out.push({ name, ok: true, why }); } catch (e) { out.push({ name, ok: false, why: String(e.message || e) }); } };
  await check("Math library: Kalman and BOCPD", () => {
    const p = Array.from({ length: 120 }, (_, i) => 100 + i * 0.01 + (i % 7) * 0.003), k = M.kalman(p);
    const xs = [...Array(60).fill(0).map((_, i) => Math.sin(i) * 0.5), ...Array(30).fill(0).map((_, i) => 8 + Math.sin(i) * 0.5)], b = M.bocpd(xs);
    if (!k || !(Math.abs(k.gapBps) < 50)) throw new Error("Kalman gave no latent price");
    if (!b || !(b.map < 40)) throw new Error("BOCPD missed a planted mean shift");
    return `latent gap ${r(k.gapBps, 2)} bps · BOCPD run length ${b.map} after a planted shift`;
  });
  await check("Math library: 25-level L2 fill", () => {
    const book = { asks: [["100", "1"], ["101", "1"], ["102", "1"]], bids: [["99", "1"]] }, f = M.l2Fill(book, "buy", 201, { levels: 25, takerFee: 0.001 });
    if (!f || Math.abs(f.vwap - 100.5) > 1e-9 || f.levelsUsed !== 2) throw new Error("expected VWAP 100.5 over 2 levels");
    return `VWAP ${r(f.vwap, 4)} over ${f.levelsUsed} levels · slippage ${r(f.slipBps, 2)} bps`;
  });
  await check("Receipt chain canonical form", () => {
    const a = { invoice: "T-1", seq: 1, ts: "2026-10-22T00:00:00.000Z", mode: "paper", symbol: "BTCUSDT", type: "LOCK", amount: 20, before: { total: 20 }, after: { total: 20 }, reason: "test", prev_hash: GENESIS };
    a.hash = hashOf(a);
    const b = { ...a, seq: 2, invoice: "T-2", prev_hash: a.hash }; b.hash = hashOf(b);
    if (!verifyChain({ format: "omega-receipt-chain-v1", receipts: [a, b] }).ok) throw new Error("a fresh chain did not verify");
    if (verifyChain({ format: "omega-receipt-chain-v1", receipts: [a, { ...b, amount: 21 }] }).ok) throw new Error("a changed receipt passed");
    const m = merkleRoot([a.hash, b.hash]);
    return `2-receipt chain verifies, a changed amount is caught · Merkle root ${m.slice(0, 12)}…`;
  });
  await check("Research engine: merge, rank and cite (ADR-114)", async () => {
    const W = (id, t, y, c, doi) => ({ id: "https://openalex.org/" + id, doi: "https://doi.org/" + doi, display_name: t, publication_year: y, cited_by_count: c, abstract_inverted_index: { Heat: [0], drives: [1], coral: [2], bleaching: [3], across: [4], tropical: [5], reefs: [6], "worldwide.": [7] }, referenced_works: [] });
    const fake = { clock: () => 0, get: async (s) => { if (s !== "openalex") throw new Error("offline"); return { data: { results: [W("W1", "Coral bleaching under heat", 2024, 30, "10.1/a"), W("W2", "Coral bleaching under heat", 2024, 31, "10.1/A")] }, tier: "test" }; } };
    const o = await RS.run("coral bleaching", { now: Date.parse("2026-10-24T00:00:00Z"), depth: 1, wayback: false }, fake);
    if (o.records.length !== 1 || o.records[0].cites !== 31) throw new Error("one DOI in two answers should merge into one record");
    if (!o.report.gaps.some(g => /failed/.test(g.en))) throw new Error("offline sources must be listed as gaps");
    return `merged ${o.runs.filter(x => x.ok).length} answers into ${o.records.length} record · ${o.report.gaps.length} gaps stated`;
  });
  await check("Local data proxy 127.0.0.1:8796", async () => { if (!(await proxyUp())) throw new Error("not running; start it with start-omega or OMEGA-PRIME.bat (the bridge falls back to direct and snapshot)"); return "running"; });
  await check("Public snapshot", async () => { const s = await snapshot(); if (!s) throw new Error("no local or published snapshot reachable"); return `${s.where}, generated ${s.j.generated}`; });
  await check("Cyber & space feeds", async () => { const c = await cyberSpace(); if (!Number.isFinite(c.csti.score)) throw new Error("no CSTI part answered"); return `CSTI ${c.csti.score} from ${c.csti.coverage}`; });
  await check("Binance public book", async () => { const s = await sonar({ symbol: "BTCUSDT" }); if (!Number.isFinite(s.mid)) throw new Error(s.error || "no book"); return `mid ${s.mid} · ${s.book.tier}`; });
  const passed = out.filter(x => x.ok).length;
  return { passed, total: out.length, results: out, browser_selftest: `${PROXY}/omega-ops-room.html?selftest=1`, note: "The Ops Room's own 24 checks need the browser: open browser_selftest, or press the shield button. Checks that need live data fail honestly when a source is offline." };
}

/* ---------------- MCP plumbing ---------------- */
const SYM_ARG = { symbol: { type: "string", description: "Binance spot symbol, for example BTCUSDT (default)", pattern: "^[A-Za-z0-9]{5,20}$" } };
const TOOLS = [
  { name: "get_live_pwsi", description: "Planetary War & Stress Index (0-100) with each component, its source, tier and fetch time, the cyber & space threat index (CSTI) and whether the risk judge's kill switch (70) is tripped. [INFERENCE]", inputSchema: { type: "object", properties: {}, additionalProperties: false }, run: pwsi },
  { name: "get_whale_sonar_state", description: "Whale sonar for one symbol from Binance public depth: mid, microprice and its gap, spread, top-25 imbalance, book entropy, the three largest walls per side, iceberg candidates and Kyle's lambda. Read only.", inputSchema: { type: "object", properties: SYM_ARG, additionalProperties: false }, run: sonar },
  { name: "query_osiris_intel", description: "OSIRIS public intel by layer: space (Kp, ISS position from CelesTrak), cyber (CISA KEV, RIPEstat backbones, IODA outages), events (NASA EONET), straits (NGA warnings per chokepoint), quakes (USGS), liquidity (DefiLlama stablecoin flow index), vulns (CIRCL records with MISP tags), sea (waves and currents at the five straits). Each with source, tier and fetch time.", inputSchema: { type: "object", properties: { layer: { type: "string", enum: ["space", "cyber", "events", "straits", "quakes", "liquidity", "vulns", "sea", "all"], description: "which layer (default all)" } }, additionalProperties: false }, run: osiris },
  { name: "query_quant_spiderweb", description: "Brain 2 quant readings for one symbol: Kalman latent price, BOCPD regime-change probability, order-book stats, Deribit dealer gamma, DVOL and 25-delta risk reversal (BTC), perpetual funding and basis with the crowded-trade flag. [INFERENCE - Quant Model]", inputSchema: { type: "object", properties: SYM_ARG, additionalProperties: false }, run: quant },
  { name: "run_6_agent_court", description: "Six rule-based voices (Bull, Bear, Researcher, Modeler, Auditor, Judge) over the quant readings and PWSI, each with its reasons, and the judge's BUY / SELL / HOLD. A paper decision aid that opens nothing. [INFERENCE]", inputSchema: { type: "object", properties: SYM_ARG, additionalProperties: false }, run: court },
  { name: "lock_base_and_sweep", description: "Computes the paper profit sweep max(0, NetEquity - LockedBase). It cannot touch the browser wallet; the sweep itself is the S key in the Ops Room.", inputSchema: { type: "object", properties: { net_equity: { type: "number", minimum: 0, description: "paper net equity in USDT" }, locked_base: { type: "number", minimum: 0, description: "locked base in USDT (default 20)" } }, required: ["net_equity"], additionalProperties: false }, run: sweep },
  { name: "verify_sha256_receipt_chain", description: "Verifies an exported omega-receipt-chain-v1 file (receipts and Merkle checkpoints) with the same canonical SHA-256 form as the Ops Room and NABD verifiers. Give a path to the .json export or its text.", inputSchema: { type: "object", properties: { path: { type: "string", description: "path to the exported .json file" }, json: { type: "string", description: "the file's text, instead of a path" } }, additionalProperties: false }, run: verifyTool },
  { name: "explain_with_local_model", description: "Sends a list of readings (each with its source) to a local Ollama model through the data proxy and returns its Arabic explanation labelled [INFERENCE - local LLM]. Local models only (a :cloud model is refused); nothing is traded or sent elsewhere.", inputSchema: { type: "object", properties: { facts: { type: "array", items: { type: "string", maxLength: 300 }, minItems: 1, maxItems: 40, description: "readings with their sources, for example \"LFI +32 (DefiLlama)\"" }, question: { type: "string", maxLength: 300 } }, required: ["facts"], additionalProperties: false }, run: explainLocal },
  { name: "deep_research", description: "ORACLE deep research agent (ADR-114, ADR-115): plans sub-questions, reads OpenAlex, Crossref, Europe PMC, arXiv, Semantic Scholar, DOAJ, dblp, Wikipedia (ar/en), Wikidata, GDELT, NVD and the Wayback availability API (all free and keyless), merges by DOI, ranks by BM25 relevance, citations, recency and corroboration, chases citations, and returns a brief whose every quoted sentence carries its numbered reference, plus the gaps it could not verify. [INFERENCE]", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 200, description: "the research question, Arabic or English" }, depth: { type: "integer", enum: [1, 2], description: "1 quick, 2 with citation chasing (default)" }, mode: { type: "string", enum: ["scholar", "intel"], description: "scholar (default): the literature; intel: passive OSINT, entity, news in Arabic and English, GDELT coverage and tone over 3 months, NVD CVEs of the last 120 days with the CISA KEV flag" }, off: { type: "array", items: { type: "string", enum: ["wikipedia", "wikidata", "openalex", "crossref", "europepmc", "arxiv", "semanticscholar", "doaj", "dblp", "gdelt", "nvd"] }, description: "sources to skip" }, markdown: { type: "boolean", description: "include the Markdown brief (default true)" } }, required: ["query"], additionalProperties: false }, run: deepResearch },
  { name: "run_selftest", description: "Runs the bridge's own checks (maths, receipt chain, proxy, snapshot, feeds) and returns the link to the Ops Room's 24-check browser self-test.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, run: selftest }
];
async function osiris(a) {
  const layer = (a && a.layer) || "all", want = k => layer === "all" || layer === k, out = { layer };
  const jobs = [];
  if (want("space")) jobs.push((async () => {
    const [kp, st] = await Promise.all([SRC.kp(), SRC.stations()]);
    const sats = st.error ? [] : asShape("omega-gp-v1", M.shape.gp)(st.data).sats, iss = sats.find(x => /ISS \(ZARYA\)/.test(x.OBJECT_NAME)), k = iss ? M.kepler(iss, Date.now()) : null;
    const rd = kp.error ? [] : asShape("omega-kp-v1", M.shape.kp)(kp.data).readings;
    out.space = { kp: rd.slice(-4), kp_source: meta(kp, "NOAA SWPC"), iss: k ? { lat: r(k.lat, 2), lon: r(k.lon, 2), alt_km: r(k.alt, 0), model: "two-body + J2 drift, not SGP4" } : null, stations: sats.length, orbit_source: meta(st, "CelesTrak GP elements") };
  })());
  if (want("cyber")) jobs.push(cyberSpace().then(c => { out.cyber = c; }));
  if (want("events")) jobs.push(SRC.eonet().then(e => { out.events = e.error ? meta(e, "NASA EONET") : { open: asShape("omega-eonet-v1", M.shape.eonet)(e.data).events.slice(0, 20), ...meta(e, "NASA EONET") }; }));
  if (want("straits")) jobs.push(SRC.nga().then(n => { out.straits = n.error ? meta(n, "NGA MSI") : { straits: (n.data.straits || []).map(s => ({ strait: s.en, warnings: (s.warnings || []).map(w => ({ id: w.id, issued: w.issued, text: String(w.text || "").slice(0, 240) })) })), ...meta(n, "NGA Maritime Safety Information") }; }));
  if (want("quakes")) jobs.push(SRC.usgs().then(q => { out.quakes = q.error ? meta(q, "USGS") : { top: (q.data.features || []).map(f => f.properties).filter(p => p && Number.isFinite(p.mag)).sort((x, y) => y.mag - x.mag).slice(0, 10).map(p => ({ mag: p.mag, place: p.place, time: iso(p.time), url: p.url })), ...meta(q, "USGS M2.5+ past day") }; }));
  // ADR-112
  if (want("liquidity")) jobs.push(SRC.llama().then(x => {
    if (x.error) { out.liquidity = meta(x, "DefiLlama"); return; }
    const d = x.data, L = M.lfi(d);
    out.liquidity = { lfi: r(L.score, 1), regime: L.regime, coverage: `${L.coverage} of ${L.of} parts`, parts: L.parts.map(p => ({ part: p.k, weight: p.w, value: r(p.v, 3), why: p.why })), stablecoins_usd: r(d.stable.total, 0), change_1d_pct: r(d.stable.pct1, 3), change_7d_pct: r(d.stable.pct7, 2),
      largest_peg_gap: d.stable.depeg, dex_24h_usd: r(d.dex.total24h, 0), dex_change_1d_pct: r(d.dex.chg1d, 1), chains_tvl_usd: r(d.chains.total, 0), top_chains: d.chains.top.slice(0, 5), label: "[INFERENCE] fixed heuristic, not a forecast", ...meta(x, "DefiLlama stablecoins, chains and DEX overview") };
  }));
  if (want("vulns")) jobs.push(Promise.all([SRC.circl(), SRC.kev()]).then(([c, k]) => {
    if (c.error) { out.vulns = meta(c, "CIRCL Vulnerability-Lookup"); return; }
    const K = k.error ? null : asShape("omega-kev-v1", j => M.shape.kev(j, Date.now()))(k.data), s = M.circlSummary(asShape("omega-circl-v1", M.shape.circl)(c.data), new Set(K ? K.recent.map(x => x.cve) : []));
    out.vulns = { records: s.n, critical: s.critical, high: s.high, in_kev_30d: s.exploited, pressure: s.pressure, priority: s.priority, kev_checked: !!K,
      latest: s.items.slice(0, 10).map(v => ({ id: v.id, cvss: r(v.cvss, 1), title: v.title, published: v.published, misp: v.tags })), label: "MISP tags by fixed rules [INFERENCE]", ...meta(c, "CIRCL Vulnerability-Lookup") };
  }));
  if (want("sea")) jobs.push(SRC.marine().then(x => {
    if (x.error) { out.sea = meta(x, "Open-Meteo Marine"); return; }
    const m = asShape("omega-marine-v1", M.shape.marine)(x.data), s = M.seaState(m);
    out.sea = { score: r(s.score, 0), highest_wave_m: r(s.maxHs, 2), at: s.at, fastest_current_kn: r(s.maxKn, 2), points: m.points.map(p => ({ strait: p.en, wave_m: r(p.hs, 2), period_s: r(p.period, 1), swell_m: r(p.swell, 2), current_kn: r(p.curKn, 2), current_dir: r(p.curDir, 0), sst_c: r(p.sst, 1) })), label: "[INFERENCE] sea-state rule", ...meta(x, "Open-Meteo Marine (CC BY 4.0)") };
  }));
  await Promise.all(jobs);
  return out;
}
// ADR-112: the proxy holds the Ollama rules (local models only, fixed instruction); the bridge only forwards.
async function explainLocal(a) {
  const facts = (Array.isArray(a && a.facts) ? a.facts : []).map(String).filter(Boolean).slice(0, 40);
  if (!facts.length) throw new Error("give at least one reading in facts");
  if (!(await proxyUp())) throw new Error("the data proxy is not running; start it with start-omega.bat, then start Ollama");
  const res = await fetch(PROXY + "/llm/ollama/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts, question: a.question ? String(a.question).slice(0, 300) : undefined }), signal: AbortSignal.timeout(130000) });
  const j = await res.json().catch(() => ({ error: "no JSON from the proxy" }));
  if (!res.ok || !j.ok) throw new Error(j.error || "local model failed");
  return { model: j.model, ms: j.ms, answer: j.answer, label: j.label, note: PAPER };
}

// ADR-114: the ORACLE deep research agent. Proxy tier first (shared cache, arXiv pacing), then the API directly.
const researchGap = new Map();
async function researchGet(source, url, type) {
  const errs = [];
  if (await proxyUp() && RS.allowed(source, url)) {
    try { const res = await get(`${PROXY}/research/${source}?url=${encodeURIComponent(url)}`, 30000, type === "text"); return { data: type === "text" ? res.toString("utf8") : res, tier: "proxy" }; }
    catch (e) { errs.push("proxy: " + e.message); }
  }
  if (!RS.allowed(source, url)) throw new Error("not an allowed request for " + source);
  const host = new URL(url).hostname, wait = { "api.gdeltproject.org": 5500, "export.arxiv.org": 3100, "api.semanticscholar.org": 1100, "services.nvd.nist.gov": 6500, "dblp.org": 1000 }[host] || 0;
  const at = Math.max(Date.now(), researchGap.get(host) || 0);
  researchGap.set(host, at + wait);
  if (at > Date.now()) await new Promise(ok => setTimeout(ok, at - Date.now()));
  try { const res = await get(url, 25000, type === "text"); return { data: type === "text" ? res.toString("utf8") : res, tier: "direct" }; }
  catch (e) { errs.push("direct: " + e.message); throw new Error(errs.join("; ")); }
}
async function deepResearch(a) {
  const q = RS.cleanQuery(a && a.query);
  if (!q) throw new Error("give a question in query");
  const out = await RS.run(q, { now: Date.now(), depth: a.depth === 1 ? 1 : 2, mode: a.mode === "intel" ? "intel" : "scholar", off: Array.isArray(a.off) ? a.off.map(String) : [] }, { clock: () => Date.now(), get: researchGet });
  const rep = out.report;
  return { question: rep.query, mode: rep.mode, bridge_term: rep.bridge, generated: rep.generatedAt, kpi: rep.kpi, gaps: rep.gaps.map(g => g.en + " / " + g.ar),
    entity: rep.sections.entity || undefined, coverage_trend: rep.sections.trend ? { ...rep.sections.trend, series: undefined, toneSeries: undefined } : undefined,
    sources: out.runs.map(x => ({ step: x.step, source: RS.SOURCES[x.source] ? RS.SOURCES[x.source].name : x.source, ok: x.ok, results: x.n, tier: x.tier, error: x.error || undefined })),
    references: rep.references.map(r => ({ n: r.n, grade: r.grade, kind: r.kind, title: r.title, year: r.year, venue: r.venue, doi: r.doi, url: r.url, open_access: r.oa, cites: r.cites, indexes: r.via, archived: r.archive && r.archive.archived ? r.archive.url : undefined, cve: r.cve || undefined })),
    markdown: a.markdown === false ? undefined : out.markdown, label: rep.label,
    page: "omega-ops-room-v1/omega-oracle.html?q=" + encodeURIComponent(q) + (rep.mode === "intel" ? "&mode=intel" : ""), note: "Research help only. Quoted sentences are verbatim from the cited abstracts; nothing here is advice or places an order." };
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
async function handle(m) {
  const reply = result => m.id !== undefined && send({ jsonrpc: "2.0", id: m.id, result });
  const fail = (code, message) => m.id !== undefined && send({ jsonrpc: "2.0", id: m.id, error: { code, message } });
  switch (m.method) {
    case "initialize": {
      const want = m.params && m.params.protocolVersion;
      return reply({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "omega-local-mcp", version: VERSION },
        instructions: "OMEGA local bridge: read-only public intel and quant readings, paper only. Every number names its source, tier and fetch time; offline sources say تعذر التحقق منها. Nothing here can place an order or move money." });
    }
    case "notifications/initialized": case "notifications/cancelled": return;
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const t = TOOLS.find(x => x.name === (m.params && m.params.name));
      if (!t) return fail(-32602, "unknown tool");
      try {
        const res = await t.run((m.params && m.params.arguments) || {});
        return reply({ content: [{ type: "text", text: JSON.stringify(res, null, 2) }], structuredContent: res, isError: false });
      } catch (e) { return reply({ content: [{ type: "text", text: "Failed: " + String(e.message || e) }], isError: true }); }
    }
    default: if (m.id !== undefined) return fail(-32601, "method not found");
  }
}

if (process.argv.includes("--list")) { for (const t of TOOLS) console.log(t.name); process.exit(0); }
if (process.argv.includes("--selftest")) {
  const s = await selftest();
  for (const x of s.results) console.log(`${x.ok ? "PASS" : "FAIL"} ${x.name}: ${x.why}`);
  console.log(`${s.passed}/${s.total} · browser self-test: ${s.browser_selftest}`);
  process.exit(s.passed === s.total ? 0 : 1);
}
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); continue; }
    for (const one of Array.isArray(m) ? m : [m]) handle(one).catch(e => log("handler failed:", e.message));
  }
});
process.stdin.on("end", () => process.exit(0));
log(`ready, ${TOOLS.length} tools, proxy ${PROXY}`);
