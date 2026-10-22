// OMEGA local data proxy (ADR-089). Free public data only, no keys, bound to 127.0.0.1.
// SEC EDGAR and Stooq send no CORS headers, so a page opened from disk cannot read them directly.
// This proxy fetches a fixed allowlist of upstream URLs, caches them on disk and adds CORS for local pages only.
//
//   OMEGA_SEC_UA="Your Name your@email" node scripts/omega-data-proxy.mjs
//
// SEC asks every client to send a User-Agent with a contact (https://www.sec.gov/os/accessing-edgar-data).
// Routes (GET only):
//   /health                 -> {"ok":true}
//   /sec/tickers            -> https://www.sec.gov/files/company_tickers.json        (cached 24 h)
//   /sec/facts/<10-digit>   -> https://data.sec.gov/api/xbrl/companyfacts/CIK<cik>.json (cached 12 h)
//   /stooq/<symbol>         -> https://stooq.com/q/d/l/?s=<symbol>&i=d  daily CSV        (cached 6 h)
// OSIRIS layers (ADR-092), upstreams without browser CORS or with tight anonymous quotas:
//   /osiris/aviation        -> OpenSky states over the Gulf and Red Sea box              (cached 15 min)
//   /osiris/gdacs           -> GDACS current disaster events (GeoJSON)                    (cached 15 min)
//   /osiris/gdelt           -> GDELT DOC 2.0 headlines on shipping and energy risk (6 h)  (cached 15 min)
//   /osiris/ais             -> Digitraffic AIS positions, compacted to [lon, lat, sog]    (cached 5 min)
// Maritime intelligence (ADR-093), keyless government and open sources:
//   /osiris/nga             -> NGA Maritime Safety Information broadcast warnings, sorted into the five
//                              straits (Hormuz, Bab el-Mandeb, Suez, Malacca, Panama) by position or name (cached 30 min)
//   /osiris/gdelt-sea       -> GDELT DOC 2.0 headlines that name one of the five straits, last 24 h  (cached 15 min)
// Market pass-through for pages that cannot reach the upstream directly (ADR-093):
//   /market/binance/<SYM>   -> Binance spot 24 h ticker for one symbol                    (cached 30 s)
//   /market/fapi/<kind>/<SYM> -> Binance USD-M futures public data (premium, funding, open interest,
//                              long/short and taker ratios) so the desk shares one cached copy (cached 60 s, ADR-095)
//   /market/coingecko/<id>  -> CoinGecko simple price in USD with 24 h change             (cached 2 min)
// ADR-109 fallback chains (first answer wins, `via` / `venue` names it):
//   /osiris/gdacs           GDACS event list -> GDACS search -> EMSC M6+ earthquakes (+ ReliefWeb alerts)
//   /market/fapi/premium/<BTCUSDT|ETHUSDT>  Binance USD-M -> OKX swap funding, mark and index -> Deribit perpetual
// Brain 2 and the orbital and cyber radar (ADR-108), keyless public sources, each in its compact form:
//   /osiris/celestrak/<group> -> CelesTrak GP mean elements, GROUP stations or visual      (cached 2 h, CelesTrak's update cycle)
//   /osiris/eonet           -> NASA EONET open natural events, last 30 days                 (cached 30 min)
//   /osiris/kp              -> NOAA SWPC planetary K index                                  (cached 15 min)
//   /cyber/kev              -> CISA Known Exploited Vulnerabilities, count and last 30 days  (cached 1 h)
//   /cyber/ripe/AS<n>       -> RIPEstat routing status of a tier-1 backbone (5 allowed ASNs) (cached 15 min)
//   /cyber/ioda             -> IODA (Georgia Tech) country outage events, last 24 h          (cached 15 min)
//   /market/deribit/options/BTC -> Deribit BTC option book summary (IV, open interest)       (cached 2 min)
//   /market/deribit/dvol/BTC    -> Deribit DVOL hourly candles, last 48 h                    (cached 15 min)
//   /market/depth/<SYM>, /market/trades/<SYM> -> Binance spot book (100 levels) and the last 300
//                              trades, for the local MCP bridge (cached 5 s)
// Rate-limit shield (ADR-095): every route answers from a memory cache, then the disk cache, within its TTL;
// identical requests in flight share one upstream call; each host keeps a minimum gap between calls
// (SEC 200 ms, GDELT 5 s, OpenSky 10 s); an upstream 429, 403 or 418 pauses that host for its Retry-After
// (60 s to 15 min) and the stale copy is served meanwhile. The X-Omega-Cache header says HIT, MISS or STALE.
// Static pages (ADR-093): GET /omega-ops-room-v1/... and /site-landing/... are served from this checkout,
// so the whole project runs from http://127.0.0.1:8796/ with one command (start-omega.sh / start-omega.bat).
// It also serves data/public-intel-snapshot.json (ADR-104) when scripts/fetch-public-intel-snapshot.mjs has written it.
// Short addresses (ADR-094): /omega-ops-room.html, /the-chain.html, /index.html and /en.html redirect to the
// folder copies, so relative links, the manifest and the service worker keep one scope per folder.
//   node scripts/omega-data-proxy.mjs --check   test every source once, print the status table and exit
//   node scripts/omega-data-proxy.mjs --lan     also listen on the home network (0.0.0.0), opt-in only (ADR-094)
// Env: OMEGA_PROXY_PORT (default 8796), OMEGA_CACHE_DIR (default ~/.omega/cache/data-proxy),
//      OMEGA_BIND=lan (same as --lan). OMEGA_SEC_UA falls back to the first line of ~/.omega/sec-ua.txt,
//      so the contact never has to sit in git.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, extname, sep, dirname } from "node:path";
import { homedir, networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { classifyNga, compactAis } from "./lib/osiris-sources.mjs";
import { OMEGA_MATH } from "./lib/brain2-math.mjs";

const PORT = Number(process.env.OMEGA_PROXY_PORT || 8796);
// 127.0.0.1 by default (AGENTS.md §4). --lan is the owner's opt-in for the iPhone on the same Wi-Fi.
const LAN = process.argv.includes("--lan") || process.env.OMEGA_BIND === "lan";
const HOST = LAN ? "0.0.0.0" : "127.0.0.1";
function secUa() {
  const env = (process.env.OMEGA_SEC_UA || "").trim();
  if (env) return env;
  try { return readFileSync(join(homedir(), ".omega", "sec-ua.txt"), "utf8").split(/\r?\n/)[0].trim().slice(0, 200); } catch { return ""; }
}
const UA = secUa();
const CACHE = process.env.OMEGA_CACHE_DIR || join(homedir(), ".omega", "cache", "data-proxy");
const HOUR = 3600 * 1000;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");
mkdirSync(CACHE, { recursive: true });

const S = OMEGA_MATH.shape, U = OMEGA_MATH.urls;
const json = fn => buf => Buffer.from(JSON.stringify(fn(JSON.parse(buf.toString("utf8")))));
const FAPI = {
  premium: s => `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`,
  funding: s => `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${s}&limit=200`,
  oi: s => `https://fapi.binance.com/futures/data/openInterestHist?symbol=${s}&period=1h&limit=72`,
  top: s => `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${s}&period=1h&limit=48`,
  global: s => `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=1h&limit=48`,
  taker: s => `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${s}&period=1h&limit=48`
};

const ROUTES = [
  { re: /^\/sec\/tickers$/, url: () => "https://www.sec.gov/files/company_tickers.json", ttl: 24 * HOUR, type: "application/json", sec: true },
  { re: /^\/sec\/facts\/(\d{10})$/, url: m => `https://data.sec.gov/api/xbrl/companyfacts/CIK${m[1]}.json`, ttl: 12 * HOUR, type: "application/json", sec: true },
  { re: /^\/stooq\/([a-z0-9.\-^]{1,20})$/, url: m => `https://stooq.com/q/d/l/?s=${encodeURIComponent(m[1])}&i=d`, ttl: 6 * HOUR, type: "text/csv; charset=utf-8", sec: false },
  { re: /^\/osiris\/aviation$/, url: () => "https://opensky-network.org/api/states/all?lamin=10&lomin=30&lamax=32&lomax=62", ttl: HOUR / 4, type: "application/json", sec: false },
  // ADR-109: GDACS, then its search endpoint, then EMSC M6+ earthquakes (with ReliefWeb alerts when it answers),
  // all in the omega-alerts-v1 form whose `via` names the source that answered.
  { re: /^\/osiris\/gdacs$/, url: () => U.gdacs(), ttl: HOUR / 4, type: "application/json", sec: false, chain: () => [
    async r => S.gdacs(await upJson(r, U.gdacs()), "GDACS"),
    async r => S.gdacs(await upJson(r, U.gdacsSearch(Date.now())), "GDACS search"),
    async r => {
      const q = S.emsc(await upJson(r, U.emsc(Date.now())));
      let rw = null;
      try { rw = S.reliefweb(await upJson(r, U.reliefweb())); } catch { /* EMSC alone still answers */ }
      return rw ? { ...q, via: "EMSC + ReliefWeb", rule: q.rule + "; " + rw.rule, features: q.features.concat(rw.features) } : q;
    }
  ] },
  { re: /^\/osiris\/gdelt$/, url: () => "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent("(strait OR tanker OR pipeline OR blockade OR refinery OR sanctions) sourcelang:english") + "&mode=artlist&format=json&maxrecords=25&timespan=6h&sort=datedesc", ttl: HOUR / 4, type: "application/json", sec: false },
  { re: /^\/osiris\/ais$/, url: () => "https://meri.digitraffic.fi/api/ais/v1/locations", ttl: HOUR / 12, type: "application/json", sec: false, transform: compactAis },
  { re: /^\/osiris\/nga$/, url: () => "https://msi.nga.mil/api/publications/broadcast-warn?output=json", ttl: HOUR / 2, type: "application/json", sec: false, transform: classifyNga },
  { re: /^\/osiris\/gdelt-sea$/, url: () => "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent('("Strait of Hormuz" OR "Bab el-Mandeb" OR "Suez Canal" OR "Strait of Malacca" OR "Panama Canal") sourcelang:english') + "&mode=artlist&format=json&maxrecords=50&timespan=24h&sort=datedesc", ttl: HOUR / 4, type: "application/json", sec: false },
  { re: /^\/market\/binance\/([A-Z0-9]{5,20})$/, url: m => `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${m[1]}`, ttl: 30 * 1000, type: "application/json", sec: false },
  // ADR-109: the premium index falls back to OKX, then Deribit, in the same form with a `venue` field, when
  // fapi.binance.com refuses this network (HTTP 451 or 403 in some regions). Binance stays first.
  { re: /^\/market\/fapi\/premium\/(BTCUSDT|ETHUSDT)$/, url: m => FAPI.premium(m[1]), ttl: 60 * 1000, type: "application/json", sec: false, chain: m => [
    async r => S.premium(await upJson(r, FAPI.premium(m[1]))),
    async r => { const [a, b, c] = U.okx(m[1]); return S.perpOkx(await upJson(r, a), await upJson(r, b), await upJson(r, c), m[1]); },
    async r => S.perpDeribit(await upJson(r, U.deribitPerp(m[1])), m[1])
  ] },
  { re: /^\/market\/fapi\/(premium|funding|oi|top|global|taker)\/([A-Z0-9]{5,20})$/, url: m => FAPI[m[1]](m[2]), ttl: 60 * 1000, type: "application/json", sec: false },
  { re: /^\/osiris\/celestrak\/(stations|visual)$/, url: m => U.gp(m[1]), ttl: 2 * HOUR, type: "application/json", sec: false, transform: json(j => S.gp(j)) },
  { re: /^\/osiris\/eonet$/, url: () => U.eonet(), ttl: HOUR / 2, type: "application/json", sec: false, transform: json(j => S.eonet(j)) },
  { re: /^\/osiris\/kp$/, url: () => U.kp(), ttl: HOUR / 4, type: "application/json", sec: false, transform: json(j => S.kp(j)) },
  { re: /^\/cyber\/kev$/, url: () => U.kev(), ttl: HOUR, type: "application/json", sec: false, transform: json(j => S.kev(j, Date.now())) },
  { re: /^\/cyber\/ripe\/AS(3356|1299|174|2914|6453)$/, url: m => U.ripe(+m[1]), ttl: HOUR / 4, type: "application/json", sec: false, transform: (buf, m) => Buffer.from(JSON.stringify(S.ripe(JSON.parse(buf.toString("utf8")), +m[1]))) },
  { re: /^\/cyber\/ioda$/, url: () => U.ioda(Date.now()), ttl: HOUR / 4, type: "application/json", sec: false, transform: json(j => S.ioda(j)) },
  { re: /^\/market\/deribit\/options\/BTC$/, url: () => U.deribit(), ttl: 2 * 60 * 1000, type: "application/json", sec: false, transform: json(j => S.deribit(j)) },
  { re: /^\/market\/deribit\/dvol\/BTC$/, url: () => U.dvol(Date.now()), ttl: HOUR / 4, type: "application/json", sec: false, transform: json(j => S.dvol(j)) },
  { re: /^\/market\/depth\/([A-Z0-9]{5,20})$/, url: m => `https://data-api.binance.vision/api/v3/depth?symbol=${m[1]}&limit=100`, ttl: 5000, type: "application/json", sec: false },
  { re: /^\/market\/trades\/([A-Z0-9]{5,20})$/, url: m => `https://data-api.binance.vision/api/v3/aggTrades?symbol=${m[1]}&limit=300`, ttl: 5000, type: "application/json", sec: false },
  { re: /^\/market\/coingecko\/([a-z0-9-]{2,40})$/, url: m => `https://api.coingecko.com/api/v3/simple/price?ids=${m[1]}&vs_currencies=usd&include_24hr_change=true`, ttl: 2 * 60 * 1000, type: "application/json", sec: false },
];
const ALLOWED_UPSTREAM = new Set(["www.sec.gov", "data.sec.gov", "stooq.com", "opensky-network.org", "www.gdacs.org", "api.gdeltproject.org", "meri.digitraffic.fi", "msi.nga.mil", "data-api.binance.vision", "fapi.binance.com", "api.coingecko.com",
  "celestrak.org", "eonet.gsfc.nasa.gov", "services.swpc.noaa.gov", "www.cisa.gov", "stat.ripe.net", "api.ioda.inetintel.cc.gatech.edu", "www.deribit.com",
  "www.okx.com", "www.seismicportal.eu", "api.reliefweb.int"]);

// Static files: only these folders of the checkout, only these types, never dotfiles.
const STATIC_DIRS = ["omega-ops-room-v1", "site-landing"];
// One file outside those folders: the public intel snapshot (ADR-104), never the rest of data/ (private notes, photos).
const SNAPSHOT = "/data/public-intel-snapshot.json";
const SHORT = {
  "/omega-ops-room.html": "/omega-ops-room-v1/omega-ops-room.html",
  "/the-chain.html": "/omega-ops-room-v1/the-chain.html",
  "/index.html": "/site-landing/index.html",
  "/en.html": "/site-landing/en.html",
  "/site-landing": "/site-landing/index.html",
  "/omega-ops-room-v1": "/omega-ops-room-v1/omega-ops-room.html"
};
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };
function staticFile(path) {
  if (path === SNAPSHOT) { const file = join(REPO, "data", "public-intel-snapshot.json"); try { return statSync(file).isFile() ? { file, type: MIME[".json"] } : null; } catch { return null; } }
  const parts = path.split("/").filter(Boolean);
  if (!parts.length || !STATIC_DIRS.includes(parts[0]) || parts.some(p => p.startsWith(".") || p.includes("\\"))) return null;
  if (path.endsWith("/")) parts.push("index.html");
  const file = resolve(REPO, ...parts);
  if (!file.startsWith(join(REPO, parts[0]) + sep)) return null;
  const type = MIME[extname(file).toLowerCase()];
  if (!type) return null;
  try { if (!statSync(file).isFile()) return null; } catch { return null; }
  return { file, type };
}

// CORS only for pages on this machine: file:// (Origin "null"), 127.0.0.1 and localhost on any port.
// A page this proxy served itself (same host, for example the iPhone over --lan) is same-origin, not a third party.
const localOrigin = (o, host) => o === "null" || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o || "") ||
  (!!host && (o === `http://${host}` || o === `https://${host}`));

// Minimum gap between calls to one host. SEC allows 10 requests per second; GDELT asks for one every 5 s;
// anonymous OpenSky refreshes every 10 s. Other hosts get 250 ms.
// CelesTrak blocks clients that ask for the same group more than its update cycle; RIPEstat and IODA get 1 s.
const GAP = { "www.sec.gov": 200, "data.sec.gov": 200, "api.gdeltproject.org": 5000, "opensky-network.org": 10000, "celestrak.org": 2000, "stat.ripe.net": 1000, "api.ioda.inetintel.cc.gatech.edu": 1000 };
const nextSlot = new Map();
async function hostSlot(host) {
  const now = Date.now(), at = Math.max(now, nextSlot.get(host) || 0);
  nextSlot.set(host, at + (GAP[host] ?? 250));
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}
// Host pauses after 429 (too many requests), 418 (Binance IP ban warning) or 403 (blocked).
const pausedUntil = new Map();
function pauseHost(host, status, retryAfter) {
  const sec = Number(retryAfter), base = status === 418 ? 300 : 60;
  const ms = Math.min(15 * 60, Math.max(60, Number.isFinite(sec) && sec > 0 ? sec : base)) * 1000;
  pausedUntil.set(host, Date.now() + ms);
  console.warn(`${host} answered HTTP ${status}; pausing it for ${Math.round(ms / 1000)} s`);
}
// Memory layer in front of the disk cache, bounded to 200 entries (oldest out first).
const mem = new Map();
function memGet(url, ttl) { const e = mem.get(url); return e ? { body: e.body, fresh: Date.now() - e.at < ttl } : null; }
function memPut(url, body) { mem.delete(url); mem.set(url, { body, at: Date.now() }); if (mem.size > 200) mem.delete(mem.keys().next().value); }
const inflight = new Map();

function cachePath(url) { return join(CACHE, createHash("sha256").update(url).digest("hex").slice(0, 32)); }
function readCache(url, ttl) {
  const m = memGet(url, ttl);
  if (m) return m;
  const p = cachePath(url);
  if (!existsSync(p)) return null;
  try {
    const st = statSync(p), body = readFileSync(p);
    mem.set(url, { body, at: st.mtimeMs });
    return { body, fresh: Date.now() - st.mtimeMs < ttl };
  } catch { return null; }
}
// One upstream call per URL at a time; concurrent page requests wait for the same result.
function fetchShared(route, url, m) {
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    let body;
    if (route.chain) {
      // Fallback chain (ADR-109): the first step that answers wins; the errors before it are logged, not hidden.
      const errs = [];
      for (const step of route.chain(m)) {
        try { body = Buffer.from(JSON.stringify(await step(route))); break; } catch (e) { errs.push(e.message); }
      }
      if (!body) throw Object.assign(new Error("every source failed: " + errs.join("; ").slice(0, 300)), { status: 502 });
      if (errs.length) console.warn(`${url}: fell back after ${errs.join("; ").slice(0, 300)}`);
    } else {
      const raw = await upstream(route, url);
      body = route.transform ? route.transform(raw, m) : raw;
    }
    memPut(url, body);
    try { writeFileSync(cachePath(url), body); } catch (e) { console.warn("cache write failed:", e.message); }
    return body;
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

const upJson = async (route, url) => JSON.parse((await upstream(route, url)).toString("utf8"));
async function upstream(route, url) {
  const host = new URL(url).hostname;
  if (!ALLOWED_UPSTREAM.has(host)) throw Object.assign(new Error("host not allowed"), { status: 400 });
  if (route.sec && !UA) throw Object.assign(new Error("Set OMEGA_SEC_UA to \"Your Name your@email\" before pulling from SEC."), { status: 503 });
  const until = pausedUntil.get(host) || 0;
  if (until > Date.now()) throw Object.assign(new Error(`${host} is paused for ${Math.ceil((until - Date.now()) / 1000)} s after a rate limit`), { status: 503, retry: Math.ceil((until - Date.now()) / 1000) });
  await hostSlot(host);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA || "OMEGA local data proxy", "Accept-Encoding": "gzip, deflate" }, redirect: "error" });
    if (r.status === 429 || r.status === 418 || r.status === 403) pauseHost(host, r.status, r.headers.get("retry-after"));
    if (!r.ok) throw Object.assign(new Error(`upstream HTTP ${r.status}`), { status: r.status === 404 ? 404 : 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 64 * 1024 * 1024) throw Object.assign(new Error("upstream response too large"), { status: 502 });
    if (!route.sec && /^No data/i.test(buf.toString("utf8", 0, 40))) throw Object.assign(new Error("no data for this symbol"), { status: 404 });
    return buf;
  } finally { clearTimeout(t); }
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin, host = String(req.headers.host || "");
  const headers = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const okOrigin = localOrigin(origin, host);
  if (okOrigin) Object.assign(headers, { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Private-Network": "true", "Access-Control-Expose-Headers": "X-Omega-Cache, Retry-After" });
  const send = (status, body, type = "application/json") => { res.writeHead(status, { ...headers, "Content-Type": type }); res.end(body); };
  if (req.method === "OPTIONS") { res.writeHead(204, { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "600" }); return res.end(); }
  if (req.method !== "GET") return send(405, JSON.stringify({ error: "GET only" }));
  if (origin && !okOrigin) return send(403, JSON.stringify({ error: "local pages only" }));
  let path;
  try { path = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname); } catch { return send(400, JSON.stringify({ error: "bad path" })); }
  if (path === "/health") return send(200, JSON.stringify({ ok: true, secUserAgent: !!UA }));
  if (path === "/") { res.writeHead(302, { ...headers, Location: "/omega-ops-room-v1/omega-ops-room.html" }); return res.end(); }
  if (SHORT[path]) { const q = new URL(req.url, "http://x").search; res.writeHead(302, { ...headers, Location: SHORT[path] + q }); return res.end(); }
  const st = staticFile(path);
  if (st) {
    try { res.writeHead(200, { ...headers, "Content-Type": st.type, "Cache-Control": "no-cache", "X-Frame-Options": "DENY" }); return res.end(readFileSync(st.file)); }
    catch { return send(500, JSON.stringify({ error: "read failed" })); }
  }
  let route, m;
  for (const r of ROUTES) { m = r.re.exec(path); if (m) { route = r; break; } }
  if (!route) return send(404, JSON.stringify({ error: "unknown route" }));
  const url = route.url(m);
  const cached = readCache(url, route.ttl);
  if (cached?.fresh) { headers["X-Omega-Cache"] = "HIT"; return send(200, cached.body, route.type); }
  try {
    const body = await fetchShared(route, url, m);
    console.log(`${new Date().toISOString()} ${path} -> ${body.length} bytes`);
    headers["X-Omega-Cache"] = "MISS";
    send(200, body, route.type);
  } catch (e) {
    if (cached) { console.warn(`${path}: ${e.message}; serving stale cache`); headers["X-Omega-Cache"] = "STALE"; return send(200, cached.body, route.type); }
    console.warn(`${path}: ${e.message}`);
    if (e.retry) headers["Retry-After"] = String(e.retry);
    send(e.status || 502, JSON.stringify({ error: e.message }));
  }
});
// Live check of every source the pages use, printed as one table (ADR-093). Never prints a secret.
const PROBES = [
  { name: "SEC EDGAR", via: "proxy /sec/tickers", url: "https://www.sec.gov/files/company_tickers.json", sec: true },
  { name: "GDELT DOC 2.0", via: "proxy /osiris/gdelt-sea", url: "https://api.gdeltproject.org/api/v2/doc/doc?query=suez&mode=artlist&format=json&maxrecords=1&timespan=24h" },
  { name: "OpenSky Network", via: "proxy /osiris/aviation", url: "https://opensky-network.org/api/states/all?lamin=24&lomin=54&lamax=27&lomax=58" },
  { name: "NGA Maritime (MSI)", via: "proxy /osiris/nga", url: "https://msi.nga.mil/api/publications/broadcast-warn?output=json" },
  { name: "Digitraffic AIS", via: "proxy /osiris/ais", url: "https://meri.digitraffic.fi/api/ais/v1/locations" },
  { name: "GDACS", via: "proxy /osiris/gdacs", url: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP" },
  { name: "EMSC (GDACS fallback)", via: "proxy /osiris/gdacs", url: "https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=1" },
  { name: "ReliefWeb (GDACS fallback)", via: "proxy /osiris/gdacs", url: OMEGA_MATH.urls.reliefweb() },
  { name: "Binance spot", via: "browser + proxy /market/binance", url: "https://data-api.binance.vision/api/v3/ping" },
  { name: "Binance futures", via: "browser + proxy /market/fapi", url: "https://fapi.binance.com/fapi/v1/ping" },
  { name: "OKX public (funding fallback)", via: "proxy /market/fapi/premium", url: "https://www.okx.com/api/v5/public/time" },
  { name: "CoinGecko", via: "browser + proxy /market/coingecko", url: "https://api.coingecko.com/api/v3/ping" },
  { name: "mempool.space", via: "browser", url: "https://mempool.space/api/v1/fees/recommended" },
  { name: "NASA GIBS (SAT)", via: "browser", url: "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/500m/0/0/0.jpeg" },
  { name: "USGS earthquakes", via: "browser", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson" },
  { name: "Open-Meteo", via: "browser", url: "https://api.open-meteo.com/v1/forecast?latitude=29.38&longitude=47.98&current=temperature_2m" },
  { name: "CelesTrak GP", via: "browser + proxy /osiris/celestrak", url: "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json" },
  { name: "NASA EONET", via: "browser + proxy /osiris/eonet", url: "https://eonet.gsfc.nasa.gov/api/v3/events?limit=1" },
  { name: "NOAA SWPC Kp", via: "browser + proxy /osiris/kp", url: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json" },
  { name: "CISA KEV", via: "proxy /cyber/kev", url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json" },
  { name: "RIPEstat", via: "browser + proxy /cyber/ripe", url: "https://stat.ripe.net/data/routing-status/data.json?resource=AS3356&sourceapp=omega-giant-core" },
  { name: "IODA outages", via: "proxy /cyber/ioda", url: OMEGA_MATH.urls.ioda(Date.now()) },
  { name: "Deribit public", via: "browser + proxy /market/deribit", url: "https://www.deribit.com/api/v2/public/test" }
];
const tty = process.stdout.isTTY;
const paint = (code, t) => tty ? `\x1b[${code}m${t}\x1b[0m` : t;
async function probe(p) {
  if (p.sec && !UA) return { ...p, ok: null, note: "set OMEGA_SEC_UA to enable" };
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000), t0 = Date.now();
  try {
    const r = await fetch(p.url, { signal: ctl.signal, headers: { "User-Agent": UA || "OMEGA local data proxy" }, redirect: "error" });
    await r.arrayBuffer();
    return { ...p, ok: r.ok, note: `HTTP ${r.status} · ${Date.now() - t0} ms` };
  } catch (e) {
    return { ...p, ok: false, note: e.name === "AbortError" ? "timed out after 12 s" : e.message.slice(0, 60) };
  } finally { clearTimeout(t); }
}
async function statusTable() {
  const rows = await Promise.all(PROBES.map(probe));
  const w = Math.max(...rows.map(r => r.name.length)), v = Math.max(...rows.map(r => r.via.length));
  console.log("\n  " + "Source".padEnd(w) + "  " + "Route".padEnd(v) + "  Status");
  console.log("  " + "-".repeat(w + v + 30));
  for (const r of rows) {
    const mark = r.ok === null ? paint("33", "SKIP") : r.ok ? paint("32", "LIVE") : paint("31", "DOWN");
    console.log(`  ${r.name.padEnd(w)}  ${r.via.padEnd(v)}  ${mark}  ${r.note}`);
  }
  const live = rows.filter(r => r.ok).length;
  console.log(`\n  ${live} of ${rows.length} sources live. A DOWN source shows as "offline" on the page; nothing is filled in.\n`);
  return rows;
}

if (CHECK_ONLY) {
  const rows = await statusTable();
  process.exit(rows.some(r => r.ok) ? 0 : 1);
}
server.on("error", e => {
  console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is already in use. OMEGA may already be running: open http://127.0.0.1:${PORT}/ or close the other window.` : `Server error: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const L = "127.0.0.1";
  console.log(`OMEGA data proxy on http://${L}:${PORT}  cache ${CACHE}`);
  console.log(`Ops Room   http://${L}:${PORT}/omega-ops-room.html`);
  console.log(`THE CHAIN  http://${L}:${PORT}/the-chain.html`);
  console.log(`NABD       http://${L}:${PORT}/index.html`);
  if (LAN) {
    const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address);
    console.log(`Home network (--lan) is ON. Anyone on this Wi-Fi can open these pages and use the read-only data routes:`);
    for (const ip of ips) console.log(`           http://${ip}:${PORT}/omega-ops-room.html`);
    console.log("           Plain http on the LAN is not a secure context, so WebCrypto is off there. Use Tailscale HTTPS for the vault and capsule.");
  }
  if (!UA) console.log('SEC routes are off until you set OMEGA_SEC_UA="Your Name your@email". Stooq works now.');
  statusTable().catch(e => console.warn("status check failed:", e.message));
});
