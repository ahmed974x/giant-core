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
//   /market/coingecko/<id>  -> CoinGecko simple price in USD with 24 h change             (cached 2 min)
// Static pages (ADR-093): GET /omega-ops-room-v1/... and /site-landing/... are served from this checkout,
// so the whole project runs from http://127.0.0.1:8796/ with one command (start-omega.sh / start-omega.bat).
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

// The five maritime chokepoints. Box = [latMin, lonMin, latMax, lonMax]; names = words NGA and GDELT use.
const STRAITS = [
  { key: "hormuz", en: "Strait of Hormuz", ar: "مضيق هرمز", box: [24.0, 54.0, 27.8, 58.8], names: ["HORMUZ", "PERSIAN GULF", "GULF OF OMAN", "ARABIAN GULF"] },
  { key: "bab", en: "Bab el-Mandeb", ar: "باب المندب", box: [11.0, 41.5, 15.5, 45.5], names: ["BAB EL MANDEB", "BAB-EL-MANDEB", "BAB AL MANDAB", "SOUTHERN RED SEA", "GULF OF ADEN"] },
  { key: "suez", en: "Suez Canal", ar: "قناة السويس", box: [27.5, 31.8, 31.6, 34.0], names: ["SUEZ", "GULF OF SUEZ", "PORT SAID"] },
  { key: "malacca", en: "Strait of Malacca", ar: "مضيق ملقا", box: [-1.0, 95.0, 6.5, 104.5], names: ["MALACCA", "SINGAPORE STRAIT", "STRAIT OF SINGAPORE", "PHILLIP CHANNEL"] },
  { key: "panama", en: "Panama Canal", ar: "قناة بنما", box: [7.5, -80.6, 9.8, -78.8], names: ["PANAMA CANAL", "GATUN", "BALBOA", "CRISTOBAL"] }
];
// NGA writes positions as "26-34.00N 056-15.00E" (degrees-minutes) or "26-34N 056-15E".
const NGA_POS = /(\d{1,2})-(\d{1,2}(?:\.\d+)?)\s*([NS])\s+(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s*([EW])/g;
function ngaPositions(text) {
  const out = [];
  for (const m of String(text || "").matchAll(NGA_POS)) {
    const lat = (+m[1] + +m[2] / 60) * (m[3] === "S" ? -1 : 1), lon = (+m[4] + +m[5] / 60) * (m[6] === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push([lat, lon]);
  }
  return out;
}
const inBox = ([lat, lon], [a, b, c, d]) => lat >= a && lat <= c && lon >= b && lon <= d;
function classifyNga(buf) {
  const j = JSON.parse(buf.toString("utf8"));
  const list = Array.isArray(j) ? j : Array.isArray(j["broadcast-warn"]) ? j["broadcast-warn"] : Array.isArray(j.broadcastWarn) ? j.broadcastWarn : [];
  const straits = STRAITS.map(s => ({ key: s.key, en: s.en, ar: s.ar, warnings: [] }));
  let active = 0;
  for (const w of list) {
    if (w.status && w.status !== "A") continue;
    active++;
    const text = String(w.text || "");
    const up = text.toUpperCase(), pos = ngaPositions(text);
    STRAITS.forEach((s, i) => {
      const byPos = pos.some(p => inBox(p, s.box)), byName = s.names.some(n => up.includes(n));
      if (!byPos && !byName) return;
      straits[i].warnings.push({
        id: `NAVAREA ${w.navArea || "?"} ${w.msgNumber || "?"}/${w.msgYear || "?"}`,
        issued: String(w.issueDate || ""), authority: String(w.authority || "").slice(0, 120),
        match: byPos ? "position" : "name", text: text.replace(/\s+/g, " ").trim().slice(0, 400)
      });
    });
  }
  return Buffer.from(JSON.stringify({ source: "NGA Maritime Safety Information, broadcast warnings (msi.nga.mil)", at: new Date().toISOString(), active, straits }));
}

const ROUTES = [
  { re: /^\/sec\/tickers$/, url: () => "https://www.sec.gov/files/company_tickers.json", ttl: 24 * HOUR, type: "application/json", sec: true },
  { re: /^\/sec\/facts\/(\d{10})$/, url: m => `https://data.sec.gov/api/xbrl/companyfacts/CIK${m[1]}.json`, ttl: 12 * HOUR, type: "application/json", sec: true },
  { re: /^\/stooq\/([a-z0-9.\-^]{1,20})$/, url: m => `https://stooq.com/q/d/l/?s=${encodeURIComponent(m[1])}&i=d`, ttl: 6 * HOUR, type: "text/csv; charset=utf-8", sec: false },
  { re: /^\/osiris\/aviation$/, url: () => "https://opensky-network.org/api/states/all?lamin=10&lomin=30&lamax=32&lomax=62", ttl: HOUR / 4, type: "application/json", sec: false },
  { re: /^\/osiris\/gdacs$/, url: () => "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP", ttl: HOUR / 4, type: "application/json", sec: false },
  { re: /^\/osiris\/gdelt$/, url: () => "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent("(strait OR tanker OR pipeline OR blockade OR refinery OR sanctions) sourcelang:english") + "&mode=artlist&format=json&maxrecords=25&timespan=6h&sort=datedesc", ttl: HOUR / 4, type: "application/json", sec: false },
  { re: /^\/osiris\/ais$/, url: () => "https://meri.digitraffic.fi/api/ais/v1/locations", ttl: HOUR / 12, type: "application/json", sec: false, transform: compactAis },
  { re: /^\/osiris\/nga$/, url: () => "https://msi.nga.mil/api/publications/broadcast-warn?output=json", ttl: HOUR / 2, type: "application/json", sec: false, transform: classifyNga },
  { re: /^\/osiris\/gdelt-sea$/, url: () => "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent('("Strait of Hormuz" OR "Bab el-Mandeb" OR "Suez Canal" OR "Strait of Malacca" OR "Panama Canal") sourcelang:english') + "&mode=artlist&format=json&maxrecords=50&timespan=24h&sort=datedesc", ttl: HOUR / 4, type: "application/json", sec: false },
  { re: /^\/market\/binance\/([A-Z0-9]{5,20})$/, url: m => `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${m[1]}`, ttl: 30 * 1000, type: "application/json", sec: false },
  { re: /^\/market\/coingecko\/([a-z0-9-]{2,40})$/, url: m => `https://api.coingecko.com/api/v3/simple/price?ids=${m[1]}&vs_currencies=usd&include_24hr_change=true`, ttl: 2 * 60 * 1000, type: "application/json", sec: false },
];
const ALLOWED_UPSTREAM = new Set(["www.sec.gov", "data.sec.gov", "stooq.com", "opensky-network.org", "www.gdacs.org", "api.gdeltproject.org", "meri.digitraffic.fi", "msi.nga.mil", "data-api.binance.vision", "api.coingecko.com"]);

// Static files: only these folders of the checkout, only these types, never dotfiles.
const STATIC_DIRS = ["omega-ops-room-v1", "site-landing"];
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

// Digitraffic returns every vessel in the Baltic as GeoJSON (several MB). The page only needs position and speed.
function compactAis(buf) {
  const j = JSON.parse(buf.toString("utf8"));
  const rows = [];
  for (const f of j.features || []) {
    const c = f.geometry && f.geometry.coordinates, p = f.properties || {};
    if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) rows.push([+c[0].toFixed(4), +c[1].toFixed(4), Number.isFinite(p.sog) ? p.sog : null]);
  }
  return Buffer.from(JSON.stringify({ source: "Digitraffic / Fintraffic AIS (CC BY 4.0)", at: j.dataUpdatedTime || new Date().toISOString(), vessels: rows }));
}

// CORS only for pages on this machine: file:// (Origin "null"), 127.0.0.1 and localhost on any port.
// A page this proxy served itself (same host, for example the iPhone over --lan) is same-origin, not a third party.
const localOrigin = (o, host) => o === "null" || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o || "") ||
  (!!host && (o === `http://${host}` || o === `https://${host}`));

// SEC allows 10 requests per second; stay well under it.
let nextSecSlot = 0;
async function secSlot() {
  const now = Date.now(), wait = Math.max(0, nextSecSlot - now);
  nextSecSlot = Math.max(now, nextSecSlot) + 200;
  if (wait) await new Promise(r => setTimeout(r, wait));
}

function cachePath(url) { return join(CACHE, createHash("sha256").update(url).digest("hex").slice(0, 32)); }
function readCache(url, ttl) {
  const p = cachePath(url);
  if (!existsSync(p)) return null;
  try { return { body: readFileSync(p), fresh: Date.now() - statSync(p).mtimeMs < ttl }; } catch { return null; }
}

async function upstream(route, url) {
  if (!ALLOWED_UPSTREAM.has(new URL(url).hostname)) throw Object.assign(new Error("host not allowed"), { status: 400 });
  if (route.sec && !UA) throw Object.assign(new Error("Set OMEGA_SEC_UA to \"Your Name your@email\" before pulling from SEC."), { status: 503 });
  if (route.sec) await secSlot();
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA || "OMEGA local data proxy", "Accept-Encoding": "gzip, deflate" }, redirect: "error" });
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
  if (okOrigin) Object.assign(headers, { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Private-Network": "true" });
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
  if (cached?.fresh) return send(200, cached.body, route.type);
  try {
    const raw = await upstream(route, url);
    const body = route.transform ? route.transform(raw) : raw;
    try { writeFileSync(cachePath(url), body); } catch (e) { console.warn("cache write failed:", e.message); }
    console.log(`${new Date().toISOString()} ${path} -> ${body.length} bytes`);
    send(200, body, route.type);
  } catch (e) {
    if (cached) { console.warn(`${path}: ${e.message}; serving stale cache`); return send(200, cached.body, route.type); }
    console.warn(`${path}: ${e.message}`);
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
  { name: "Binance spot", via: "browser + proxy /market/binance", url: "https://data-api.binance.vision/api/v3/ping" },
  { name: "CoinGecko", via: "browser + proxy /market/coingecko", url: "https://api.coingecko.com/api/v3/ping" },
  { name: "mempool.space", via: "browser", url: "https://mempool.space/api/v1/fees/recommended" },
  { name: "NASA GIBS (SAT)", via: "browser", url: "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/500m/0/0/0.jpeg" },
  { name: "USGS earthquakes", via: "browser", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson" },
  { name: "Open-Meteo", via: "browser", url: "https://api.open-meteo.com/v1/forecast?latitude=29.38&longitude=47.98&current=temperature_2m" }
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
