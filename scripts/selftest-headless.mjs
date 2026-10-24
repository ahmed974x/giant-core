// Headless run of the Ops Room 24-check self-test (ADR-120).
// Serves the repository on 127.0.0.1, opens omega-ops-room-v1/omega-ops-room.html?selftest=1 in Chromium and prints
// each check with its reason. Outside requests are blocked, so a check that needs live data fails honestly, as it
// does on a laptop without internet.
//
// --mock answers Binance public REST (spot depth, klines, aggTrades, 24 h tickers, futures premium index) with a
// fixed synthetic market so the desk, the court, PRIME and the neural flow can be exercised in a sandbox without
// internet. The synthetic market exists only inside this test run: it is never written to a file, the page or the
// published site, and the run says MOCK on every line. Live data is checked on the laptop (start-omega).
//
// Usage: node scripts/selftest-headless.mjs [--mock] [--min N] [--width 1440] [--shot file.png]
// Needs playwright-core (or playwright) and Chromium; in the cloud container Chromium is at /opt/pw-browsers.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MOCK = flag("--mock"), MIN = Number(opt("--min", "0")), WIDTH = Number(opt("--width", "1440")), SHOT = opt("--shot", "");

let chromium;
try { ({ chromium } = await import("playwright-core")); }
catch { try { ({ chromium } = await import("playwright")); } catch { console.error("playwright-core is not installed: npm i playwright-core@1.56.1"); process.exit(2); } }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(ok => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- synthetic market (MOCK only): a deterministic random walk, no clock, no randomness between runs ----
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const BASES = { BTCUSDT: 60000, ETHUSDT: 3000, SOLUSDT: 150, BNBUSDT: 600, XRPUSDT: 0.6, DOGEUSDT: 0.15, ADAUSDT: 0.45, AVAXUSDT: 30, LINKUSDT: 15, DOTUSDT: 6, TRXUSDT: 0.12, TONUSDT: 5, PAXGUSDT: 2400 };
const baseOf = s => BASES[s] || 100;
const T0 = Date.UTC(2026, 0, 1);
let tick = 0;
function klines(sym, interval, limit) {
  const step = { "1m": 6e4, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[interval] || 6e4, r = rng(sym.length * 7919 + step % 9973);
  let p = baseOf(sym); const out = [];
  for (let i = 0; i < Math.min(limit, 1000); i++) {
    const o = p, c = p * (1 + (r() - 0.5) * 0.02), hi = Math.max(o, c) * (1 + r() * 0.004), lo = Math.min(o, c) * (1 - r() * 0.004), v = 50 + r() * 200, t = T0 + i * step;
    out.push([t, o.toFixed(8), hi.toFixed(8), lo.toFixed(8), c.toFixed(8), v.toFixed(8), t + step - 1, (v * c).toFixed(8), 100 + Math.floor(r() * 900), (v / 2).toFixed(8), (v * c / 2).toFixed(8), "0"]);
    p = c;
  }
  return out;
}
function mid(sym) { tick++; return baseOf(sym) * (1 + 0.0004 * Math.sin(tick / 3)); }
function depth(sym, limit) {
  const m = mid(sym), r = rng(tick + 17), n = Math.min(limit, 1000), bids = [], asks = [];
  for (let i = 0; i < n; i++) {
    const wall = i === 7 || i === 23 ? 40 : 1;
    bids.push([(m * (1 - 0.00005 * (i + 1))).toFixed(2), (wall * (0.2 + r() * 2)).toFixed(5)]);
    asks.push([(m * (1 + 0.00005 * (i + 1))).toFixed(2), (wall * (0.2 + r() * 2)).toFixed(5)]);
  }
  return { lastUpdateId: 1e9 + tick, bids, asks };
}
function aggTrades(sym, limit) {
  const r = rng(tick + 101), m = mid(sym), now = Date.now(), out = [];
  let t = now - limit * 400;
  for (let i = 0; i < Math.min(limit, 1000); i++) { t += 50 + Math.floor(r() * 700); out.push({ a: i, p: (m * (1 + (r() - 0.5) * 2e-4)).toFixed(2), q: (0.001 + r() * 0.3).toFixed(5), f: i, l: i, T: t, m: r() < 0.5, M: true }); }
  return out;
}
function ticker24(symbols) {
  return symbols.map((s, i) => { const b = baseOf(s), pct = ((i * 37) % 17) - 8; return { symbol: s, lastPrice: String(b), priceChangePercent: pct.toFixed(2), highPrice: String(b * 1.03), lowPrice: String(b * 0.96), quoteVolume: String(1e6 * (i + 1)), volume: String(1e4) }; });
}
function mockBinance(u) {
  const q = u.searchParams, sym = q.get("symbol") || "BTCUSDT", lim = Number(q.get("limit") || 500);
  if (/\/fapi\/v1\/premiumIndex$/.test(u.pathname)) return { symbol: sym, markPrice: String(mid(sym)), indexPrice: String(mid(sym)), lastFundingRate: "0.00010000", nextFundingTime: Date.now() + 36e5, time: Date.now() };
  if (/\/api\/v3\/depth$/.test(u.pathname)) return depth(sym, lim);
  if (/\/api\/v3\/klines$/.test(u.pathname)) return klines(sym, q.get("interval") || "1m", lim);
  if (/\/api\/v3\/aggTrades$/.test(u.pathname)) return aggTrades(sym, lim);
  if (/\/api\/v3\/ticker\/24hr$/.test(u.pathname)) return ticker24(JSON.parse(q.get("symbols") || "[]"));
  if (/\/api\/v3\/ticker\/price$/.test(u.pathname)) return { symbol: sym, price: String(mid(sym)) };
  return null;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 }, isMobile: WIDTH < 600, hasTouch: WIDTH < 600 });
let mocked = 0;
await ctx.route(u => !u.href.startsWith(base), async route => {
  const u = new URL(route.request().url());
  const body = MOCK && /(^|\.)binance\.(vision|com)$/.test(u.hostname) ? mockBinance(u) : null;
  if (body) { mocked++; return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) }); }
  return route.abort("internetdisconnected");
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(`${base}/omega-ops-room-v1/omega-ops-room.html?selftest=1`, { waitUntil: "load" });
const last = await page.waitForFunction(() => window.OMEGA_SELFTEST && window.OMEGA_SELFTEST.last(), null, { timeout: 600000, polling: 1000 }).then(h => h.jsonValue());
if (SHOT) await page.screenshot({ path: SHOT });
await browser.close();
server.close();

const tag = MOCK ? "MOCK " : "";
for (const r of last.results) console.log(`${tag}${r.ok ? "PASS" : "FAIL"} ${r.name} — ${r.why}`);
for (const e of errors) console.log(`${tag}pageerror ${e}`);
console.log(`${tag}${last.passed}/${last.total} checks passed${MOCK ? ` (${mocked} Binance requests answered by the synthetic market; other sources offline)` : " (outside sources blocked)"}`);
process.exit(errors.length || last.passed < MIN ? 1 : 0);
