// Tests for the Brain 2 maths (scripts/lib/brain2-math.mjs, ADR-108), the neural flow and the source fallbacks
// (ADR-109), the continuous-time flow and the cyber and air sources (ADR-110), the DefiLlama liquidity index, CIRCL
// records with MISP tags and the strait sea state (ADR-112) and the Ops Room's inline copy.
//   node scripts/test-brain2.mjs        exits 0 when every test passes
// No network, no dependencies. CI runs it in the skillspector workflow.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OMEGA_MATH as M } from "./lib/brain2-math.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function test(name, f) {
  try { f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, tol, what) => ok(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} ± ${tol}`);
let seed = 7;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

test("Kalman tracks a noisy level and fits positive noise", () => {
  const p = Array.from({ length: 300 }, () => 100 * (1 + 0.0005 * gauss()));
  const k = M.kalman(p);
  ok(k && k.q >= 0 && k.r > 0, "no fit");
  near(k.latent, 100, 0.1, "latent price");
  ok(M.kalman([1, 2, 3]) === null, "too little data must give null");
});
test("BOCPD finds a planted mean shift and stays quiet without one", () => {
  const xs = [...Array.from({ length: 80 }, () => gauss()), ...Array.from({ length: 25 }, () => 6 + gauss())];
  const b = M.bocpd(xs);
  ok(b && b.map <= 30, `run length ${b && b.map} after a shift 25 readings ago`);
  const flat = M.bocpd(Array.from({ length: 105 }, () => gauss()));
  ok(flat.map > 30, `run length ${flat.map} on a flat series`);
});
test("Kyle's lambda recovers a planted price impact", () => {
  const t = [], t0 = 1e12; let p = 100;
  for (let i = 0; i < 400; i++) { const buy = rnd() < 0.5, q = 0.1 + rnd(); p += (buy ? 1 : -1) * q * 0.02 + 0.001 * gauss(); t.push({ T: t0 + i * 1000, p, q, m: !buy }); }
  const k = M.kyleLambda(t);
  ok(k && k.buckets >= 20, "no buckets");
  near(k.lambda, 0.02, 0.006, "lambda");
  ok(k.r2 > 0.5, `R² ${k.r2}`);
});
test("Iceberg flags a level that traded far more than it shows", () => {
  const book = { bids: [["99.9", "1"], ["99.8", "1"]], asks: [["100.1", "0.5"], ["100.2", "1"]] };
  const tape = Array.from({ length: 10 }, (_, i) => ({ T: 1e12 + i * 1000, p: 100.1, q: 0.4, m: false }));
  const ice = M.iceberg(tape, book);
  ok(ice.length === 1 && ice[0].side === "ask" && ice[0].price === 100.1, JSON.stringify(ice));
  near(ice[0].ratio, 8, 1e-9, "ratio");
});
test("Book entropy is 1 for a flat book and low for a wall", () => {
  const flat = Array.from({ length: 25 }, (_, i) => [String(100 + i), "1"]);
  const wall = flat.map((l, i) => [l[0], i === 3 ? "500" : "0.01"]);
  near(M.entropy({ bids: flat, asks: flat }).mean, 1, 1e-12, "flat");
  ok(M.entropy({ bids: wall, asks: wall }).mean < 0.1, "wall should be near 0");
});
test("L2 fill walks levels, prices VWAP and refuses what 25 levels cannot fill", () => {
  const book = { asks: [["100", "1"], ["101", "1"], ["102", "1"]], bids: [["99", "2"], ["98", "1"]] };
  const b = M.l2Fill(book, "buy", 201);
  near(b.vwap, 100.5, 1e-9, "buy VWAP"); ok(b.levelsUsed === 2, "levels");
  near(b.slipBps, 50, 1e-9, "slippage"); near(b.fee, 0.201, 1e-12, "taker fee");
  const s = M.l2Fill(book, "sell", 2.5);
  near(s.vwap, (99 * 2 + 98 * 0.5) / 2.5, 1e-9, "sell VWAP");
  ok(M.l2Fill(book, "buy", 1e6) === null, "an unfillable order must give null");
});
test("Black-Scholes gamma matches a known value and GEX finds the walls", () => {
  const g = M.bs(100, 100, 1, 0.2);
  near(g.gamma, 0.019839, 1e-5, "ATM gamma");
  const now = Date.parse("2026-10-22T00:00:00Z"), exp = "27NOV26", S = 100000;
  const summary = [];
  for (let k = 80000; k <= 120000; k += 5000) {
    summary.push({ instrument_name: `BTC-${exp}-${k}-C`, mark_iv: 50, open_interest: k > S ? 900 : 100, underlying_price: S });
    summary.push({ instrument_name: `BTC-${exp}-${k}-P`, mark_iv: 50, open_interest: k < S ? 900 : 100, underlying_price: S });
  }
  const x = M.gex(summary, now);
  ok(x && Number.isFinite(x.total) && ["positive", "negative"].includes(x.regime), "no GEX");
  ok(x.callWall >= S && x.putWall <= S, `walls ${x.putWall} / ${x.callWall}`);
});
test("Funding trap flags crowded longs and shorts", () => {
  ok(M.basisTrap({ markPrice: "100.1", indexPrice: "100", lastFundingRate: "0.0004" }).crowd === "longs", "longs");
  ok(M.basisTrap({ markPrice: "99.9", indexPrice: "100", lastFundingRate: "-0.0003" }).crowd === "shorts", "shorts");
  ok(M.basisTrap({ markPrice: "100.01", indexPrice: "100", lastFundingRate: "0.0001" }).crowd === "none", "none");
});
test("Kepler with J2 keeps the ISS near 400 km and inside its inclination", () => {
  const iss = { EPOCH: "2026-10-22T00:00:00.000000", MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.64, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 50, MEAN_ANOMALY: 10 };
  for (let h = 0; h < 6; h++) {
    const k = M.kepler(iss, Date.parse("2026-10-22T00:00:00Z") + h * 3600e3);
    ok(k && k.alt > 380 && k.alt < 460, `altitude ${k && k.alt}`);
    ok(Math.abs(k.lat) <= 51.7, `latitude ${k.lat}`);
  }
});
test("CSTI averages only the parts it has", () => {
  ok(Number.isNaN(M.csti({}).score), "no parts must give NaN");
  const c = M.csti({ kp: 9, kev7: 0, bgpMin: 0.98, ioda: 0 });
  near(c.score, 25, 1e-9, "score"); ok(c.coverage === 4, "coverage");
  ok(M.csti({ kp: 6.5 }).coverage === 1, "one part");
});
test("Source shapes accept both Kp forms and reject foreign input", () => {
  ok(M.shape.kp([["time_tag", "Kp"], ["2026-10-22 00:00:00", "3.33"]]).readings[0].kp === 3.33, "array form");
  ok(M.shape.kp([{ time_tag: "2026-10-22T00:00:00", Kp: 2 }]).readings[0].kp === 2, "object form");
  let threw = false; try { M.shape.kev({ nope: 1 }, Date.now()); } catch { threw = true; }
  ok(threw, "a foreign KEV answer must throw");
  const r = M.shape.ripe({ data: { visibility: { v4: { ris_peers_seeing: 300, total_ris_peers: 336 } } } }, 174);
  near(r.share, 300 / 336, 1e-12, "RIPE share"); ok(r.name === "Cogent", "ASN name");
});
test("Canonical receipt form drops hash keys at every level and rounds to 8 decimals", () => {
  const c = M.canon({ b: 1.123456789, a: { hash: "x", z: [0.1 + 0.2] }, hash: "y" });
  ok(JSON.stringify(c) === '{"a":{"z":[0.3]},"b":1.12345679}', JSON.stringify(c));
  const h = createHash("sha256").update(JSON.stringify(c)).digest("hex");
  ok(/^[0-9a-f]{64}$/.test(h), "hash");
  near(M.excess(23.5, 20), 3.5, 0, "sweep"); ok(M.excess(19, 20) === 0, "no negative sweep");
});
// ---- ADR-109 ----
test("Neural flow has 139 -> 48 -> 36 -> 48 -> 24 -> 16 -> 8 and 11,792 weights", () => {
  const n = M.nn.init();
  ok(n.sizes.join() === "139,48,36,48,24,16,8", n.sizes.join());
  ok(n.L.weights === 11792 && n.p.length === 11972, `${n.L.weights} weights, ${n.p.length} parameters`);
  const f = M.nn.forward(n, Array.from({ length: 139 }, (_, i) => Math.cos(i)));
  ok(f.a.slice(1, 6).every(l => l.every(v => v >= 0)), "ReLU layers must be non-negative");
  ok(f.a[6].every(v => v > -1 && v < 1), "tanh outputs must sit in (-1, 1)");
  const g = M.nn.forward(n, new Array(139).fill(NaN));
  ok(g.a[0].every(v => v === 0), "a missing input must enter as 0");
});
test("Backpropagation matches central differences, NaN targets skipped", () => {
  const n = M.nn.init([6, 5, 4, 3], 11), X = [[0.2, -0.1, 0.4, 0.3, -0.5, 0.1], [-0.3, 0.6, 0.2, -0.2, 0.1, 0.5], [0.1, 0.1, -0.7, 0.4, 0.2, -0.3]];
  const Y = [[0.3, NaN, -0.2], [NaN, 0.5, 0.1], [-0.4, 0.2, NaN]], idx = [0, 1, 2], g = new Float64Array(n.p.length);
  M.nn.grad(n, X, Y, idx, g);
  let worst = 0;
  for (let i = 0; i < n.p.length; i++) {
    const k = n.p[i]; n.p[i] = k + 1e-6; const up = M.nn.lossOf(n, X, Y, idx); n.p[i] = k - 1e-6; const dn = M.nn.lossOf(n, X, Y, idx); n.p[i] = k;
    const num = (up - dn) / 2e-6; worst = Math.max(worst, Math.abs(num - g[i]) / Math.max(1e-6, Math.abs(num) + Math.abs(g[i])));
  }
  ok(worst < 1e-5, `worst relative error ${worst}`);
});
test("Adam + ES lowers the held-out loss on a learnable signal and keeps time order", () => {
  const n = M.nn.init([8, 12, 2], 5), X = [], Y = [];
  for (let i = 0; i < 300; i++) { const x = Array.from({ length: 8 }, () => rnd() * 2 - 1); X.push(x); Y.push([Math.tanh(1.5 * x[0] - x[3]), NaN]); }
  const r = M.nn.train(n, X, Y, { epochs: 40, seed: 3, gap: 6 });
  ok(r && r.nVal === 60 && r.nTrain === 234, `split ${r && r.nTrain}/${r && r.nVal}`);
  ok(r.valLoss < r.valBefore * 0.5 && r.valLoss < r.valBase, `held-out loss ${r.valLoss} vs before ${r.valBefore}, baseline ${r.valBase}`);
  ok(r.hit > 0.8, `direction hit rate ${r.hit}`);
  ok(M.nn.train(n, X.slice(0, 10), Y.slice(0, 10)) === null, "fewer than 20 samples must give null");
});
test("Perpetual premium fallbacks: OKX scales funding to 8 h, Deribit keeps its venue", () => {
  const now = 1.79e12;
  const o = M.shape.perpOkx({ data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.0001", fundingTime: String(now), nextFundingTime: String(now + 4 * 3600e3) }] }, { data: [{ markPx: "100100", ts: String(now) }] }, { data: [{ idxPx: "100000" }] }, "BTCUSDT");
  near(+o.lastFundingRate, 0.0002, 1e-15, "4-hour funding scaled to 8 h"); ok(o.venue === "OKX BTC-USDT-SWAP", o.venue);
  near(M.basisTrap(o).basisBps, 10, 1e-9, "basis from OKX mark and index");
  const d = M.shape.perpDeribit({ result: { instrument_name: "ETH-PERPETUAL", mark_price: 4001, index_price: 4000, funding_8h: 0.00005, timestamp: now } }, "ETHUSDT");
  ok(d.symbol === "ETHUSDT" && d.venue === "Deribit ETH-PERPETUAL" && +d.lastFundingRate === 0.00005, JSON.stringify(d));
  let threw = false; try { M.shape.perpOkx({ data: [] }, {}, {}, "BTCUSDT"); } catch { threw = true; }
  ok(threw, "an empty OKX answer must throw");
});
test("Disaster alert fallbacks say which rule set the level", () => {
  const g = M.shape.gdacs({ features: [{ geometry: { type: "Point", coordinates: [1, 2] }, properties: { alertlevel: "Red", eventtype: "TC", name: "X" } }, { geometry: { type: "Point", coordinates: [3, 4] }, properties: { alertlevel: "Green" } }] });
  ok(g.features.length === 1 && g.via === "GDACS", JSON.stringify(g));
  const e = M.shape.emsc({ features: [{ geometry: { coordinates: [142, 38, -10] }, properties: { mag: 7.2, flynn_region: "JAPAN", unid: "a b" } }, { geometry: { coordinates: [0, 0, 0] }, properties: { mag: 6.1 } }, { geometry: { coordinates: [0, 0, 0] }, properties: { mag: 5.9 } }] });
  ok(e.features.length === 2 && e.features[0].properties.alertlevel === "Red" && e.features[1].properties.alertlevel === "Orange", JSON.stringify(e.features.map(f => f.properties.alertlevel)));
  ok(/not a GDACS level/.test(e.features[0].properties.basis) && e.features[0].properties.url.report.endsWith("unid=a%20b"), "EMSC basis and link");
  const rw = M.shape.reliefweb({ data: [{ fields: { name: "Flood", status: "alert", primary_country: { location: { lat: 10, lon: 20 } } } }, { fields: { name: "Old", status: "past", primary_country: { location: { lat: 1, lon: 2 } } } }] });
  ok(rw.features.length === 1 && rw.features[0].geometry.coordinates.join() === "20,10", JSON.stringify(rw));
});
// ---- ADR-110: continuous-time flow, cyber and air sources ----
test("Neural ODE settles on the feed-forward answer from any start", () => {
  const n = M.nn.init(M.nn.SIZES, 9), x = Array.from({ length: 139 }, (_, i) => Math.cos(i * 0.21));
  const st = M.nn.odeInit(n, new Array(139).fill(0));
  ok(M.nn.odeGap(n, x, st) > 0.01, "a new input must move the flow away from rest");
  for (let i = 0; i < 60; i++) M.nn.odeStep(n, x, st, 1, 0);
  ok(M.nn.odeGap(n, x, st) < 1e-6, `gap after 60 s ${M.nn.odeGap(n, x, st)}`);
  ok(st.s.every(l => l.every(Number.isFinite)), "every state finite");
});
test("Heun step is second order on dx/dt = (c − x) / τ", () => {
  // One linear output with weight 0 and bias atanh(0.6): the exact path is x(t) = 0.6 (1 − e^{−t/τ}).
  const n = M.nn.init([1, 1], 1); n.p[0] = 0; n.p[1] = Math.atanh(0.6);
  // τ of 4 s or more keeps each outer step inside one sub-step, so the step size is the one under test.
  const o = { ...M.nn.ODE, tau: [4] }, tau = M.nn.odeTau(1, 0, 0, o), err = steps => {
    const st = { s: [new Float64Array([0])], t: 0, steps: 0 };
    for (let i = 0; i < steps; i++) M.nn.odeStep(n, [0], st, 1 / steps, 0, o);
    return Math.abs(st.s[0][0] - 0.6 * (1 - Math.exp(-1 / tau)));
  };
  const e1 = err(4), e2 = err(8), ratio = e1 / e2;
  ok(ratio > 3.5 && ratio < 4.6, `error ratio ${ratio} for halved steps (second order is 4)`);
});
test("Shocks shorten τ, with a floor, and fade over 30 s", () => {
  const calm = M.nn.odeTau(3, 5, 0), hot = M.nn.odeTau(3, 5, M.nn.odeShock([{ t: 1e12, w: 3 }], 1e12)), later = M.nn.odeShock([{ t: 1e12, w: 3 }], 1e12 + 90e3);
  ok(hot < calm / 4 && hot >= calm / M.nn.ODE.floor - 1e-12, `τ calm ${calm}, after a shock ${hot}`);
  near(later, 3 * Math.exp(-3), 1e-12, "shock after 90 s");
  ok(M.nn.odeTau(6, 0, 0) > M.nn.odeTau(1, 0, 0) * 2, "deeper layers are slower");
});
test("CSTI takes the three ADR-110 parts and reports eight possible", () => {
  const c = M.csti({ kp: 9, infocon: 3, ris: 40, exposed: 1 });
  ok(c.coverage === 4 && c.of === 8, JSON.stringify(c));
  near(c.score, (100 + 100 + 40 + 25) / 4, 1e-9, "mean of the parts");
  ok(M.shape.infocon("Orange\n").level === 2 && M.shape.infocon({ status: "green" }).level === 0, "InfoCON levels");
  let threw = false; try { M.shape.infocon({ status: "purple" }); } catch { threw = true; }
  ok(threw, "an unknown InfoCON colour must throw");
});
test("RIS Live summary flags a foreign origin and a more specific route", () => {
  const t = 1.79e9, msgs = [
    { type: "UPDATE", timestamp: t - 10, peer_asn: "3333", path: [3333, 1299, 13335], announcements: [{ next_hop: "x", prefixes: ["1.1.1.0/24"] }] },
    { type: "UPDATE", timestamp: t - 20, peer_asn: "6939", path: [6939, 64512], announcements: [{ next_hop: "x", prefixes: ["8.8.8.0/25"] }] },
    { type: "UPDATE", timestamp: t - 30, peer_asn: "174", path: [174], withdrawals: ["9.9.9.0/24", "10.0.0.0/8"] },
    { type: "UPDATE", timestamp: t - 900, peer_asn: "1", path: [1, 999], announcements: [{ prefixes: ["1.1.1.0/24"] }] },
    { type: "KEEPALIVE", timestamp: t - 5 }
  ];
  const r = M.risSummary(msgs, t * 1000, 300e3);
  ok(r.messages === 3 && r.announcements === 2 && r.withdrawals === 1, JSON.stringify([r.messages, r.announcements, r.withdrawals]));
  ok(r.foreign === 1 && r.specific === 1 && r.prefixes[1].foreign[0].origin === 64512 && r.prefixes[0].foreign.length === 0, "foreign origin on 8.8.8.0/25 only");
  near(r.index, 2 * 1 / 5 + 0.25 * 2 / 5 + 30 + 15, 1e-9, "instability index");
  ok(M.risSubscribe().length === M.RIS_WATCH.length && M.risSubscribe()[0].data.moreSpecific === true, "one subscription per watched prefix");
  ok(M.shape.ris(r) === r, "summary passes its own check");
});
test("InternetDB and adsb.lol shapes", () => {
  const set = M.shape.internetdbSet([{ ip: "1.1.1.1", ports: [53, 443], vulns: [], tags: ["cdn"] }, { ip: "8.8.8.8", ports: [53], vulns: ["CVE-2026-0001"] }, { detail: "No information available" }, { ip: "208.67.222.222", ports: [53] }]);
  ok(set.hosts.length === 4 && set.vulns === 1 && set.hosts[2].none === true && set.hosts[0].name === "Cloudflare DNS", JSON.stringify(set));
  const a = { ac: [{ hex: "abc", flight: "UAE1 ", lat: 25, lon: 55, alt_baro: 30000, squawk: "7700", emergency: "general" }, { hex: "d", lat: 1, lon: 2, squawk: "1200" }], now: 1.79e12 };
  const zone = { ac: [{ hex: "e", lat: 26, lon: 56, squawk: "2000" }, { hex: "f", lat: 26, lon: 56, squawk: "7600" }] };
  const s = M.shape.adsbSet([a, zone, zone, zone, zone, zone, zone]);
  ok(s.emergencies.length === 1 && s.emergencies[0].meaning === "general emergency" && s.emergencies[0].flight === "UAE1", JSON.stringify(s.emergencies));
  ok(s.zones.length === 6 && s.zones[0].n === 2 && s.zones[0].emerg === 1 && s.zones[5].key === "taiwan", JSON.stringify(s.zones[0]));
  ok(/\/v2\/point\/26\.57\/56\.25\/150$/.test(M.urls.adsbZone("hormuz")) && M.urls.adsbZone("nowhere") === "", "zone URLs");
});
// ---- ADR-112: DefiLlama liquidity flow, CIRCL with MISP tags, sea state ----
const llamaFix = () => [
  { peggedAssets: [
    { symbol: "USDT", name: "Tether", pegType: "peggedUSD", pegMechanism: "fiat-backed", circulating: { peggedUSD: 101e9 }, circulatingPrevDay: { peggedUSD: 100e9 }, circulatingPrevWeek: { peggedUSD: 98e9 }, circulatingPrevMonth: { peggedUSD: 95e9 }, price: 1.0002 },
    { symbol: "USDC", name: "USD Coin", pegType: "peggedUSD", pegMechanism: "fiat-backed", circulating: { peggedUSD: 50e9 }, circulatingPrevDay: { peggedUSD: 50e9 }, circulatingPrevWeek: { peggedUSD: 50e9 }, circulatingPrevMonth: { peggedUSD: 49e9 }, price: 0.97 },
    { symbol: "EURC", name: "Euro Coin", pegType: "peggedEUR", circulating: { peggedEUR: 1e8 }, price: 1.08 },
    { symbol: "TINY", name: "Tiny", pegType: "peggedUSD", circulating: { peggedUSD: 5e6 }, circulatingPrevDay: { peggedUSD: 5e6 }, circulatingPrevWeek: { peggedUSD: 5e6 }, circulatingPrevMonth: { peggedUSD: 5e6 }, price: 0.5 }] },
  [{ name: "Ethereum", tvl: 60e9 }, { name: "Solana", tvl: 10e9 }, { name: "Dead", tvl: 0 }, { name: "Tron", tvl: 30e9 }],
  { total24h: 12e9, total48hto24h: 10e9, total7d: 70e9, total14dto7d: 56e9, protocols: [{ name: "a", displayName: "Uniswap", total24h: 3e9 }, { name: "b", total24h: 4e9 }] }
];
test("DefiLlama shapes and the liquidity flow index", () => {
  const set = M.shape.llamaSet(llamaFix());
  ok(set.format === "omega-llama-v1" && set.stable.coins === 3 && set.stable.total === 151e9 + 5e6, JSON.stringify(set.stable));
  near(set.stable.pct1, (151.005 / 150.005 - 1) * 100, 1e-9, "1-day supply change");
  ok(set.stable.depeg.symbol === "USDC" && Math.abs(set.stable.depeg.bps + 300) < 1e-6, "largest peg gap among $1 bn coins (TINY is ignored)");
  ok(set.chains.chains === 3 && set.chains.top[0].name === "Ethereum" && Math.abs(set.chains.top[0].share - 0.6) < 1e-12, "chains sorted, zero TVL dropped");
  ok(Math.abs(set.dex.chg1d - 20) < 1e-9 && Math.abs(set.dex.chg7d - 25) < 1e-9 && set.dex.top[0].name === "b", "DEX change and leaders");
  const L = M.lfi(set), a = Math.min(1, set.stable.pct1 / 0.5), b = Math.min(1, set.stable.pct7 / 2);
  near(L.score, 100 * (0.35 * a + 0.30 * b + 0.20 * 0.8 + 0.15 * -1), 1e-9, "weighted index");
  ok(L.coverage === 4 && L.of === 4 && Math.abs(set.lfi - L.score) < 1e-12, "coverage and set value");
  const only = M.lfi({ dex: { chg1d: -50 } });
  ok(only.coverage === 1 && only.score === -100 && only.regime === "outflow", "renormalised over the parts it has");
  ok(Number.isNaN(M.lfi({}).score), "no data, no index");
  let threw = false; try { M.shape.llamaStable({ foo: 1 }); } catch { threw = true; }
  ok(threw, "foreign input must throw");
  // ADR-113: a failed chains or DEX answer leaves that part out; null totals are missing, not $0.
  const part = M.shape.llamaSet([llamaFix()[0], { error: "internal" }, { error: "internal" }]);
  ok(part.chains === null && part.dex === null && M.lfi(part).coverage === 3 && Number.isFinite(part.lfi), "stablecoins alone still give the index");
  const nd = M.shape.llamaDex({ total24h: 5e9, total48hto24h: null, total7d: null });
  ok(Number.isNaN(nd.prev24h) && Number.isNaN(nd.total7d) && Number.isNaN(nd.chg1d), "null totals stay missing");
});
test("CVSS 3.x base scores match the FIRST reference vectors", () => {
  ok(M.cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H") === 9.8, "critical RCE");
  ok(M.cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H") === 10, "scope changed");
  ok(M.cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N") === 6.1, "reflected XSS");
  ok(M.cvss3("CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N") === 5.5, "local read");
  ok(M.cvss3("CVSS:3.1/AV:N/AC:H/PR:H/UI:R/S:U/C:N/I:N/A:N") === 0, "no impact");
  ok(Number.isNaN(M.cvss3("CVSS:4.0/AV:N")) && Number.isNaN(M.cvss3("nonsense")), "other strings give NaN");
});
test("CIRCL records get MISP taxonomy tags and a pressure score", () => {
  const raw = [
    { id: "PYSEC-2026-1", published: "2026-10-20T10:00:00Z", aliases: ["CVE-2026-1111", "GHSA-xxxx"], details: "Path traversal", affected: [{ package: { ecosystem: "PyPI", name: "pkg" } }], severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }], references: [{ type: "EXPLOIT", url: "https://example.org" }] },
    { cveMetadata: { cveId: "CVE-2026-2222", datePublished: "2026-10-21T00:00:00Z" }, containers: { cna: { title: "Info leak", descriptions: [{ lang: "en", value: "x" }], problemTypes: [{ descriptions: [{ cweId: "CWE-200" }] }], affected: [{ vendor: "Acme", product: "Router" }], metrics: [{ cvssV3_1: { baseScore: 7.5 } }] }, adp: [{ metrics: [{ cvssV3_1: { baseScore: 7.1 } }] }] } },
    { cveMetadata: { cveId: "CVE-2026-3333" }, containers: { cna: { title: "No score yet" } } }
  ];
  const set = M.shape.circl(raw);
  ok(set.items.length === 3 && set.items[0].id === "PYSEC-2026-1" && set.items[0].cvss === 9.8 && set.items[0].osv && set.items[0].poc, JSON.stringify(set.items[0]));
  ok(set.items[1].cvss === 7.5 && set.items[1].cwe === "CWE-200" && set.items[1].vendor === "Acme", JSON.stringify(set.items[1]));
  const s = M.circlSummary(set, new Set(["CVE-2026-1111"]));
  const t0 = s.items[0].tags, t1 = s.items[1].tags, t2 = s.items[2].tags;
  ok(t0.includes("priority-level:emergency") && t0.includes('vulnerability:sighting="exploited"') && t0.includes('rsit:intrusion-attempts="exploit"') && t0.includes('vulnerability:information="PoC"') && t0.includes('vulnerability:origin="software"'), t0.join(" "));
  ok(t1.includes("priority-level:high") && t1.includes('rsit:vulnerable="information-disclosure"') && !t1.includes('vulnerability:sighting="exploited"'), t1.join(" "));
  ok(t2[0] === "priority-level:baseline-minor" && t2.includes('rsit:vulnerable="vulnerable-system"'), t2.join(" "));
  ok(s.critical === 1 && s.high === 1 && s.exploited === 1 && s.pressure === 25 + 40 * 1 / 2 && s.scored === 2, JSON.stringify({ ...s, items: 0 }));
  const c = M.csti({ circl: s.pressure });
  ok(c.coverage === 1 && c.of === 8 && c.parts[0].k === "circl" && c.score === 45, "CSTI eighth part");
});
test("Marine shape and sea state at the five straits", () => {
  const pt = (hs, cur) => ({ latitude: 1, longitude: 2, current: { time: "2026-10-23T11:00", wave_height: hs, wave_direction: 90, wave_period: 6, swell_wave_height: 0.4, ocean_current_velocity: cur, ocean_current_direction: 45, sea_surface_temperature: 29 }, hourly: { wave_height: [hs, null, hs] } });
  const m = M.shape.marine([pt(1, 1.852), pt(4, 9.26), pt(null, null), pt(0.5, 2), pt(1.2, 3)]);
  ok(m.points.length === 5 && m.points[1].key === "bab" && Math.abs(m.points[1].curKn - 5) < 1e-12 && Number.isNaN(m.points[2].hs) && m.points[0].hourly[1] === null, JSON.stringify(m.points[1]));
  const s = M.seaState(m);
  ok(s.at === "bab" && s.maxHs === 4 && s.fastAt === "bab" && s.n === 4, JSON.stringify(s));
  near(s.score, (0.5 + 0.25) * 100, 1e-9, "wave plus current");
  ok(/marine-api\.open-meteo\.com\/v1\/marine\?latitude=26\.45,12\.6,31\.45,2\.5,8\.75&longitude=56\.45,43\.33,32\.35,101,-79\.5&/.test(M.urls.marine()) && /cell_selection=sea/.test(M.urls.marine()), "marine URL");
  let threw = false; try { M.shape.marine([pt(1, 1)]); } catch { threw = true; }
  ok(threw, "an answer for fewer than five points must throw");
});
test("Ops Room inline copy matches the library", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-brain2-inline.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stdout + r.stderr).trim() || "parity check failed");
});
test("MCP bridge loads and lists its tools", () => {
  const r = spawnSync(process.execPath, [join(HERE, "omega-mcp-bridge.mjs"), "--list"], { encoding: "utf8" });
  ok(r.status === 0 && r.stdout.trim().split("\n").length === 10 && r.stdout.includes("deep_research"), (r.stdout + r.stderr).trim());
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
