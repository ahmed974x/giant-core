// OMEGA local data proxy (ADR-089). Free public data only, no keys, bound to 127.0.0.1.
// SEC EDGAR and Stooq send no CORS headers, so a page opened from disk cannot read them directly.
// This proxy fetches a fixed allowlist of upstream URLs, caches them on disk and adds CORS for local pages only.
//
//   OMEGA_SEC_UA="Your Name your@email" node scripts/omega-data-proxy.mjs
//
// SEC asks every client to send a User-Agent with a contact (https://www.sec.gov/os/accessing-edgar-data).
// The full API document is docs/api/omega-data-proxy.openapi.json (OpenAPI 3.1) and its Markdown copy
// docs/api/OMEGA-DATA-PROXY-API.md, both checked against the route table below by scripts/build-api-docs.mjs (ADR-116).
// Routes (GET only, except the local model bridge below):
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
//   /market/klines/<SYM>/<1h|4h|1d> -> Binance spot candles, last 300, for the TRADE LAB market lens (ADR-116, cached 60 s)
// Cyber storm and air radar (ADR-110), keyless:
//   /cyber/infocon          -> SANS Internet Storm Center InfoCON level                       (cached 15 min)
//   /cyber/internetdb/<ip>  -> Shodan InternetDB record of one of four public resolvers (1.1.1.1, 8.8.8.8,
//                              9.9.9.9, 208.67.222.222): a lookup of Shodan's weekly data, not a scan (cached 6 h)
//   /osiris/adsb/sqk/<7500|7600|7700> -> adsb.lol aircraft squawking an emergency code, worldwide (cached 2 min)
//   /osiris/adsb/zone/<key> -> adsb.lol aircraft within 150 nm of a strait or the Taiwan Strait   (cached 5 min)
// RIS Live is a WebSocket the page opens itself (wss://ris-live.ripe.net); the hourly snapshot keeps a sample.
// Liquidity, vulnerabilities and sea state (ADR-112), keyless:
//   /market/llama           -> DefiLlama stablecoin supply, chain TVL and DEX volume in one omega-llama-v1 set,
//                              with the liquidity flow index (cached 15 min)
//   /cyber/circl            -> CIRCL Vulnerability-Lookup, latest published records cut to id, CVSS, CWE (cached 30 min)
//   /osiris/marine          -> Open-Meteo Marine waves and currents at the five strait points    (cached 30 min)
// Deep research agent (ADR-114), keyless scholarly and news APIs, one fixed API path per source:
//   /research/<source>?url=<upstream>  where source is wikipedia, openalex, crossref, europepmc, arxiv,
//                              semanticscholar, gdelt, wayback, and from ADR-115 doaj, dblp, wikidata or nvd, and
//                              the upstream address must be that source's own
//                              https host and API path (OMEGA_RESEARCH.allowed). arXiv sends no browser CORS, so the
//                              ORACLE page reads it only through here; the rest use this as a shared cache (6 h,
//                              GDELT 30 min, Wayback 24 h). arXiv gets one call every 3 s, as its API terms ask.
//                              NVD (CVE API 2.0, no browser CORS) gets one call every 6.5 s, inside its keyless limit
//                              of 5 requests per 30 s, and is cached 1 h.
// Local model bridge (ADR-112), optional, this machine only (connections from 127.0.0.1 or ::1):
//   GET  /llm/ollama/status  -> whether Ollama answers on 127.0.0.1:11434 and which local models it has
//   POST /llm/ollama/explain -> {facts: [strings], question?} (at most 16 KB) to the chosen local model with a fixed
//                              instruction: explain the readings in Arabic, paper trading only, no order advice.
//                              Models whose name ends in :cloud or -cloud are refused, because Ollama runs those on
//                              its own servers. OMEGA_OLLAMA_MODEL picks one; otherwise the first local "glm" model.
//   POST /llm/ollama/research -> {question, sources: [{n, text}]} (at most 24 KB) to the same local model with a fixed
//                              instruction: an Arabic brief from the numbered sources only, each sentence ending in
//                              its [n]; the ORACLE page then checks every mark (ADR-114).
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
//      OMEGA_BIND=lan (same as --lan), OMEGA_OLLAMA_MODEL (optional, a local Ollama model name). OMEGA_SEC_UA falls back to the first line of ~/.omega/sec-ua.txt,
//      so the contact never has to sit in git.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, extname, sep, dirname } from "node:path";
import { homedir, networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { classifyNga, compactAis } from "./lib/osiris-sources.mjs";
import { OMEGA_MATH } from "./lib/brain2-math.mjs";
import { OMEGA_RESEARCH } from "./lib/deep-research.mjs";

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
  { re: /^\/cyber\/infocon$/, url: () => U.infocon(), ttl: HOUR / 4, type: "application/json", sec: false, transform: buf => { const t = buf.toString("utf8"); let j; try { j = JSON.parse(t); } catch { j = t; } return Buffer.from(JSON.stringify(S.infocon(j))); } },
  { re: /^\/cyber\/internetdb\/(1\.1\.1\.1|8\.8\.8\.8|9\.9\.9\.9|208\.67\.222\.222)$/, url: m => U.internetdb(m[1]), ttl: 6 * HOUR, type: "application/json", sec: false, transform: (buf, m) => Buffer.from(JSON.stringify(S.internetdb(JSON.parse(buf.toString("utf8")), m[1]))) },
  { re: /^\/osiris\/adsb\/sqk\/(7500|7600|7700)$/, url: m => U.adsbSqk(m[1]), ttl: 2 * 60 * 1000, type: "application/json", sec: false, transform: json(j => S.adsb(j)) },
  { re: /^\/osiris\/adsb\/zone\/(hormuz|bab|suez|malacca|panama|taiwan)$/, url: m => U.adsbZone(m[1]), ttl: 5 * 60 * 1000, type: "application/json", sec: false, transform: json(j => S.adsb(j)) },
  { re: /^\/market\/depth\/([A-Z0-9]{5,20})$/, url: m => `https://data-api.binance.vision/api/v3/depth?symbol=${m[1]}&limit=100`, ttl: 5000, type: "application/json", sec: false },
  { re: /^\/market\/trades\/([A-Z0-9]{5,20})$/, url: m => `https://data-api.binance.vision/api/v3/aggTrades?symbol=${m[1]}&limit=300`, ttl: 5000, type: "application/json", sec: false },
  // ADR-116: public candles for the TRADE LAB market lens (RSI, MACD, averages, Bollinger, ATR), three intervals only.
  { re: /^\/market\/klines\/([A-Z0-9]{5,20})\/(1h|4h|1d)$/, url: m => `https://data-api.binance.vision/api/v3/klines?symbol=${m[1]}&interval=${m[2]}&limit=300`, ttl: 60 * 1000, type: "application/json", sec: false },
  // ADR-112: three DefiLlama answers in one set, fetched in order (one host gap apart).
  { re: /^\/market\/llama$/, url: () => U.llama()[0], ttl: HOUR / 4, type: "application/json", sec: false, chain: () => [
    async r => { const list = []; for (const u of U.llama()) list.push(await upJson(r, u)); return S.llamaSet(list); }
  ] },
  { re: /^\/cyber\/circl$/, url: () => U.circl(), ttl: HOUR / 2, type: "application/json", sec: false, transform: json(j => S.circl(j)) },
  { re: /^\/osiris\/marine$/, url: () => U.marine(), ttl: HOUR / 2, type: "application/json", sec: false, transform: json(j => S.marine(j)) },
  { re: /^\/market\/coingecko\/([a-z0-9-]{2,40})$/, url: m => `https://api.coingecko.com/api/v3/simple/price?ids=${m[1]}&vs_currencies=usd&include_24hr_change=true`, ttl: 2 * 60 * 1000, type: "application/json", sec: false },
];
const ALLOWED_UPSTREAM = new Set(["www.sec.gov", "data.sec.gov", "stooq.com", "opensky-network.org", "www.gdacs.org", "api.gdeltproject.org", "meri.digitraffic.fi", "msi.nga.mil", "data-api.binance.vision", "fapi.binance.com", "api.coingecko.com",
  "celestrak.org", "eonet.gsfc.nasa.gov", "services.swpc.noaa.gov", "www.cisa.gov", "stat.ripe.net", "api.ioda.inetintel.cc.gatech.edu", "www.deribit.com",
  "www.okx.com", "www.seismicportal.eu", "api.reliefweb.int",
  "isc.sans.edu", "internetdb.shodan.io", "api.adsb.lol",
  "stablecoins.llama.fi", "api.llama.fi", "vulnerability.circl.lu", "marine-api.open-meteo.com",
  ...OMEGA_RESEARCH.HOSTS]);
// ADR-114: cache life of each research source; the request shape itself is checked by OMEGA_RESEARCH.allowed.
const RESEARCH_TTL = { wikipedia: 6 * HOUR, openalex: 6 * HOUR, crossref: 6 * HOUR, europepmc: 6 * HOUR, arxiv: 6 * HOUR, semanticscholar: 6 * HOUR, gdelt: HOUR / 2, wayback: 24 * HOUR,
  doaj: 6 * HOUR, dblp: 6 * HOUR, wikidata: 6 * HOUR, nvd: HOUR };

// Static files: only these folders of the checkout, only these types, never dotfiles.
const STATIC_DIRS = ["omega-ops-room-v1", "site-landing"];
// One file outside those folders: the public intel snapshot (ADR-104), never the rest of data/ (private notes, photos).
const SNAPSHOT = "/data/public-intel-snapshot.json";
const SHORT = {
  "/omega-ops-room.html": "/omega-ops-room-v1/omega-ops-room.html",
  "/the-chain.html": "/omega-ops-room-v1/the-chain.html",
  "/omega-oracle.html": "/omega-ops-room-v1/omega-oracle.html",
  "/omega-trade-lab.html": "/omega-ops-room-v1/omega-trade-lab.html",
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

// Host names this proxy answers to (ADR-113). A DNS-rebinding page arrives with its own name in Host, so any other
// name is refused before routing. --lan adds this machine's own interface addresses and, for Tailscale Serve,
// names under .ts.net; OMEGA_ALLOWED_HOSTS adds more, comma separated.
const ALLOWED_HOSTS = (() => {
  const set = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (LAN) for (const list of Object.values(networkInterfaces())) for (const a of list || []) set.add(a.family === "IPv6" || a.family === 6 ? `[${a.address}]` : a.address);
  for (const h of String(process.env.OMEGA_ALLOWED_HOSTS || "").split(",")) if (h.trim()) set.add(h.trim().toLowerCase());
  return set;
})();
const hostAllowed = host => {
  if (!host) return true;
  const m = /^(\[[0-9a-f:.]+\]|[^:]+)(?::(\d+))?$/i.exec(String(host).toLowerCase());
  if (!m) return false;
  return ALLOWED_HOSTS.has(m[1]) || (LAN && /\.ts\.net$/.test(m[1]));
};
// Origins allowed to call the local model: pages served from this machine's loopback address, never "null".
const llmOrigin = o => !o || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(o);

// CORS only for pages on this machine: file:// (Origin "null"), 127.0.0.1 and localhost on any port.
// A page this proxy served itself (same host, for example the iPhone over --lan) is same-origin, not a third party.
const localOrigin = (o, host) => o === "null" || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o || "") ||
  (!!host && (o === `http://${host}` || o === `https://${host}`));

// Minimum gap between calls to one host. SEC allows 10 requests per second; GDELT asks for one every 5 s;
// anonymous OpenSky refreshes every 10 s. Other hosts get 250 ms.
// CelesTrak blocks clients that ask for the same group more than its update cycle; RIPEstat and IODA get 1 s.
// SANS asks for light use of its API, adsb.lol for about one request a second (ADR-110).
const GAP = { "www.sec.gov": 200, "data.sec.gov": 200, "api.gdeltproject.org": 5000, "opensky-network.org": 10000, "celestrak.org": 2000, "stat.ripe.net": 1000, "api.ioda.inetintel.cc.gatech.edu": 1000,
  "isc.sans.edu": 2000, "internetdb.shodan.io": 1000, "api.adsb.lol": 3000, "vulnerability.circl.lu": 2000, "api.llama.fi": 1000,
  "export.arxiv.org": 3100, "api.semanticscholar.org": 1100, "archive.org": 500, "en.wikipedia.org": 100, "ar.wikipedia.org": 100,
  "services.nvd.nist.gov": 6500, "dblp.org": 1000, "doaj.org": 300, "www.wikidata.org": 100 };
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

// Local model bridge (ADR-112). Ollama listens on this machine only; the address may be changed with OMEGA_OLLAMA_URL
// but must stay a loopback address. Nothing here reaches the internet: models tagged :cloud run on Ollama's servers
// and are refused, so a prompt never leaves the laptop through this route.
const OLLAMA = (() => {
  const u = (process.env.OMEGA_OLLAMA_URL || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
  return /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(u) ? u : "http://127.0.0.1:11434";
})();
const isCloudModel = name => /(:|-)cloud$/i.test(String(name || ""));
// `outer` aborts the call early, for example when the page that asked has closed the connection.
async function ollamaFetch(path, body, ms, outer) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms), stop = () => ctl.abort();
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener("abort", stop, { once: true }); }
  let r;
  try {
    r = await fetch(OLLAMA + path, { signal: ctl.signal, method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, redirect: "error" });
    if (!r.ok) throw Object.assign(new Error(`Ollama answered HTTP ${r.status}`), { status: 502 });
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw Object.assign(new Error("Ollama answered something that is not JSON; update Ollama and try again"), { status: 502 }); }
  } catch (e) {
    if (e.status) throw e;
    if (e.name === "AbortError") throw Object.assign(new Error(outer && outer.aborted ? "the page closed the request" : `Ollama gave no answer in ${ms / 1000} s`), { status: 504 });
    throw Object.assign(new Error("Ollama is not running on " + OLLAMA + " (install it from https://ollama.com, then: ollama pull glm4)"), { status: 503 });
  } finally { clearTimeout(t); if (outer) outer.removeEventListener("abort", stop); }
}
// Local models only, by name.
async function ollamaModels() {
  const j = await ollamaFetch("/api/tags", null, 2500);
  return (Array.isArray(j.models) ? j.models : []).map(m => String(m.name || m.model || "")).filter(n => n && !isCloudModel(n));
}
async function ollamaPick() {
  const names = await ollamaModels(), want = (process.env.OMEGA_OLLAMA_MODEL || "").trim();
  if (want) {
    if (isCloudModel(want)) throw Object.assign(new Error(`${want} runs on Ollama's servers, not this machine; pick a local model`), { status: 400 });
    // Ollama lists "glm4" as "glm4:latest", so a name without a tag matches its :latest copy.
    const hit = names.find(n => n === want || n === want + ":latest");
    if (hit) return { model: hit, names };
    throw Object.assign(new Error(`${want} is not pulled yet: run  ollama pull ${want}`), { status: 503 });
  }
  const glm = names.find(n => /^glm/i.test(n));
  if (!glm && !names.length) throw Object.assign(new Error("Ollama has no local model yet: run  ollama pull glm4  (9B, about 5.5 GB)"), { status: 503 });
  return { model: glm || names[0], names };
}
const LLM_SYSTEM = "You explain readings from OMEGA, a paper-trading research page. Answer in Arabic (Gulf Arabic is fine) in at most 8 short lines. " +
  "Use only the facts you are given and name the source of each number you use. If a fact is missing, say تعذر التحقق منها. " +
  "Everything on this page is paper trading and a decision aid: never tell the reader to place a real order, move real money, sign anything or connect an exchange account. " +
  "End with the label [INFERENCE - local LLM].";
// ADR-114: the research brief instruction. Sources arrive numbered; the page verifies every [n] afterwards.
const LLM_RESEARCH = "You write a short research brief in Arabic for the question you are given, using only the numbered sources below. " +
  "End every sentence with the number of the source it rests on, written like [2] or [1, 3]. Do not add any fact, number, name, date or link that is not in the sources. " +
  "If the sources do not answer part of the question, write تعذر التحقق منها for that part. Quote numbers exactly. Mention disagreement or limits when a source states them. " +
  "At most 12 sentences. This is research help only: no medical, financial or legal advice, and never tell the reader to trade or move money. " +
  "End with the label [INFERENCE - local LLM].";
// Reads a request body of at most `max` bytes within `ms`; a client that stalls is cut off.
function readBody(req, max, ms = 10000) {
  return new Promise((done, fail) => {
    const chunks = [];
    let n = 0, over = false;
    const t = setTimeout(() => { over = true; fail(Object.assign(new Error(`body not received within ${ms / 1000} s`), { status: 408 })); }, ms);
    req.on("data", c => {
      if (over) return;
      n += c.length;
      if (n > max) { over = true; clearTimeout(t); fail(Object.assign(new Error(`body larger than ${max} bytes`), { status: 413 })); req.resume(); return; }
      chunks.push(c);
    });
    req.on("end", () => { if (!over) { clearTimeout(t); done(Buffer.concat(chunks).toString("utf8")); } });
    req.on("error", e => { if (!over) { over = true; clearTimeout(t); fail(Object.assign(e, { status: 400 })); } });
  });
}
// One generation at a time: a second request gets 429 instead of queueing another long run on the laptop.
const llmBusy = { on: false };
async function llmRoute(req, path) {
  if (path === "/llm/ollama/status" && req.method === "GET") {
    try { const p = await ollamaPick(); return { ok: true, url: OLLAMA, model: p.model, models: p.names }; }
    catch (e) { return { ok: false, url: OLLAMA, error: e.message }; }
  }
  if (path === "/llm/ollama/explain" && req.method === "POST") {
    // application/json forces a CORS preflight, so no page can fire this as a "simple" cross-site request.
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) throw Object.assign(new Error("send Content-Type: application/json"), { status: 415 });
    if (llmBusy.on) throw Object.assign(new Error("the local model is already answering; try again when it finishes"), { status: 429 });
    llmBusy.on = true;
    try { return await explain(req); } finally { llmBusy.on = false; }
  }
  if (path === "/llm/ollama/research" && req.method === "POST") {
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) throw Object.assign(new Error("send Content-Type: application/json"), { status: 415 });
    if (llmBusy.on) throw Object.assign(new Error("the local model is already answering; try again when it finishes"), { status: 429 });
    llmBusy.on = true;
    try { return await researchBrief(req); } finally { llmBusy.on = false; }
  }
  return null;
}
async function researchBrief(req) {
  let q;
  try { q = JSON.parse(await readBody(req, 24576)); } catch (e) { throw Object.assign(new Error(e.status ? e.message : "send JSON: {\"question\": \"...\", \"sources\": [{\"n\": 1, \"text\": \"...\"}]}"), { status: e.status || 400 }); }
  const sources = (Array.isArray(q && q.sources) ? q.sources : []).filter(x => x && Number.isInteger(x.n) && x.n > 0 && x.n < 1000)
    .map(x => `[${x.n}] ` + String(x.text || "").replace(/^\[\d+\]\s*/, "").replace(/\s+/g, " ").slice(0, 900)).slice(0, 40);
  if (!sources.length) throw Object.assign(new Error("no numbered sources to write from"), { status: 400 });
  const question = String(q.question || "").replace(/\s+/g, " ").slice(0, 200) || "Summarise what the sources say.";
  const { model } = await ollamaPick(), t0 = Date.now(), gone = new AbortController();
  req.socket.once("close", () => gone.abort());
  const j = await ollamaFetch("/api/generate", { model, system: LLM_RESEARCH, prompt: "Question: " + question + "\n\nSources:\n" + sources.join("\n"), stream: false, options: { temperature: 0.1, num_predict: 900 } }, 180000, gone.signal);
  return { ok: true, model, ms: Date.now() - t0, answer: String(j.response || "").slice(0, 6000), label: "[INFERENCE - local LLM]", sources: sources.length };
}
async function explain(req) {
    let q;
    try { q = JSON.parse(await readBody(req, 16384)); } catch (e) { throw Object.assign(new Error(e.status ? e.message : "send JSON: {\"facts\": [\"...\"], \"question\": \"...\"}"), { status: e.status || 400 }); }
    const facts = (Array.isArray(q && q.facts) ? q.facts : []).map(f => String(f).replace(/\s+/g, " ").slice(0, 300)).filter(Boolean).slice(0, 40);
    if (!facts.length) throw Object.assign(new Error("no facts to explain"), { status: 400 });
    const question = String(q.question || "Explain what these readings say together and what the paper desk should watch next.").slice(0, 300);
    const { model } = await ollamaPick(), t0 = Date.now(), gone = new AbortController();
    req.socket.once("close", () => gone.abort());
    const j = await ollamaFetch("/api/generate", { model, system: LLM_SYSTEM, prompt: "Facts:\n- " + facts.join("\n- ") + "\n\nQuestion: " + question, stream: false, options: { temperature: 0.2, num_predict: 500 } }, 120000, gone.signal);
    return { ok: true, model, ms: Date.now() - t0, answer: String(j.response || "").slice(0, 4000), label: "[INFERENCE - local LLM]", facts: facts.length };
}
const loopback = a => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(a || ""));

const server = createServer(async (req, res) => {
  const origin = req.headers.origin, host = String(req.headers.host || "");
  const headers = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!hostAllowed(host)) { res.writeHead(421, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ error: "unknown host name; open the page at http://127.0.0.1:" + PORT })); }
  const okOrigin = localOrigin(origin, host);
  if (okOrigin) Object.assign(headers, { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Private-Network": "true", "Access-Control-Expose-Headers": "X-Omega-Cache, Retry-After" });
  const send = (status, body, type = "application/json") => { res.writeHead(status, { ...headers, "Content-Type": type }); res.end(body); };
  if (req.method === "OPTIONS") { res.writeHead(204, { ...headers, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" }); return res.end(); }
  if (origin && !okOrigin) return send(403, JSON.stringify({ error: "local pages only" }));
  let path;
  try { path = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname); } catch { return send(400, JSON.stringify({ error: "bad path" })); }
  // ADR-112: the local model bridge answers this machine only, even when --lan is on.
  if (path.startsWith("/llm/")) {
    if (!loopback(req.socket.remoteAddress)) return send(403, JSON.stringify({ error: "the local model bridge answers this machine only" }));
    if (!llmOrigin(origin)) return send(403, JSON.stringify({ error: "the local model answers pages opened from http://127.0.0.1:" + PORT + " only (not file:// or other sites)" }));
    try { const r = await llmRoute(req, path); return r ? send(200, JSON.stringify(r)) : send(404, JSON.stringify({ error: "unknown route" })); }
    catch (e) { return send(e.status || 502, JSON.stringify({ ok: false, error: e.message })); }
  }
  if (req.method !== "GET") return send(405, JSON.stringify({ error: "GET only" }));
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
  // ADR-114: research sources, one fixed host and API path each.
  const rs = /^\/research\/([a-z]{3,16})$/.exec(path);
  if (!route && rs) {
    const target = new URL(req.url, "http://x").searchParams.get("url") || "";
    if (!OMEGA_RESEARCH.allowed(rs[1], target)) return send(400, JSON.stringify({ error: "not an allowed request for this research source" }));
    route = { url: () => target, ttl: RESEARCH_TTL[rs[1]], type: rs[1] === "arxiv" ? "application/atom+xml; charset=utf-8" : "application/json", sec: false };
  }
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
  { name: "Deribit public", via: "browser + proxy /market/deribit", url: "https://www.deribit.com/api/v2/public/test" },
  { name: "SANS ISC InfoCON", via: "proxy /cyber/infocon", url: OMEGA_MATH.urls.infocon() },
  { name: "Shodan InternetDB", via: "proxy /cyber/internetdb", url: OMEGA_MATH.urls.internetdb("1.1.1.1") },
  { name: "adsb.lol (ODbL)", via: "proxy /osiris/adsb", url: OMEGA_MATH.urls.adsbSqk(7700) },
  { name: "RIS Live (WebSocket host)", via: "browser wss", url: "https://ris-live.ripe.net/manual/" },
  { name: "NASA GIBS night lights", via: "browser tiles", url: OMEGA_MATH.urls.gibs("night", 0, 0, 0) },
  { name: "NASA GIBS thermal anomalies", via: "browser tiles", url: OMEGA_MATH.urls.gibs("heat", 0, 0, 0) },
  { name: "DefiLlama stablecoins", via: "browser + proxy /market/llama", url: OMEGA_MATH.urls.llama()[0] },
  { name: "DefiLlama chains and DEX", via: "browser + proxy /market/llama", url: OMEGA_MATH.urls.llama()[1] },
  { name: "CIRCL Vulnerability-Lookup", via: "proxy /cyber/circl", url: OMEGA_MATH.urls.circl() },
  { name: "Open-Meteo Marine", via: "browser + proxy /osiris/marine", url: OMEGA_MATH.urls.marine() },
  // ADR-114: deep research sources (ORACLE)
  { name: "OpenAlex", via: "proxy /research/openalex", url: "https://api.openalex.org/works?search=coral&per-page=1&select=id" },
  { name: "Crossref", via: "proxy /research/crossref", url: "https://api.crossref.org/works?query=coral&rows=1&select=DOI" },
  { name: "Europe PMC", via: "proxy /research/europepmc", url: "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=coral&format=json&pageSize=1" },
  { name: "arXiv API", via: "proxy /research/arxiv", url: "https://export.arxiv.org/api/query?search_query=all:coral&max_results=1" },
  { name: "Semantic Scholar", via: "proxy /research/semanticscholar", url: "https://api.semanticscholar.org/graph/v1/paper/search?query=coral&limit=1&fields=title" },
  { name: "Wikipedia (ar)", via: "proxy /research/wikipedia", url: "https://ar.wikipedia.org/w/api.php?action=query&list=search&srsearch=%D9%85%D8%B1%D8%AC%D8%A7%D9%86&srlimit=1&format=json" },
  { name: "Wayback availability", via: "proxy /research/wayback", url: "https://archive.org/wayback/available?url=example.com" },
  // ADR-115
  { name: "DOAJ articles", via: "browser + proxy /research/doaj", url: "https://doaj.org/api/search/articles/coral?pageSize=1" },
  { name: "dblp", via: "browser + proxy /research/dblp", url: "https://dblp.org/search/publ/api?q=coral&format=json&h=1" },
  { name: "Wikidata", via: "browser + proxy /research/wikidata", url: "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=coral&language=en&type=item&limit=1&format=json" },
  { name: "NVD CVE API 2.0", via: "proxy /research/nvd", url: "https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1" },
  { name: "Ollama (optional, this machine)", via: "proxy /llm/ollama", url: OLLAMA + "/api/tags", local: true }
];
const tty = process.stdout.isTTY;
const paint = (code, t) => tty ? `\x1b[${code}m${t}\x1b[0m` : t;
async function probe(p) {
  if (p.sec && !UA) return { ...p, ok: null, note: "set OMEGA_SEC_UA to enable" };
  if (p.local) { const m = await ollamaModels().catch(() => null); return { ...p, ok: m ? true : null, note: m ? `${m.length} local model${m.length === 1 ? "" : "s"}${m.length ? ": " + m.slice(0, 3).join(", ") : ""}` : "not running (optional)" }; }
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
