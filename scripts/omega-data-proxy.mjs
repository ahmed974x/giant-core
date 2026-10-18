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
// Env: OMEGA_PROXY_PORT (default 8796), OMEGA_CACHE_DIR (default ~/.omega/cache/data-proxy).
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const PORT = Number(process.env.OMEGA_PROXY_PORT || 8796);
const HOST = "127.0.0.1";
const UA = (process.env.OMEGA_SEC_UA || "").trim();
const CACHE = process.env.OMEGA_CACHE_DIR || join(homedir(), ".omega", "cache", "data-proxy");
const HOUR = 3600 * 1000;
mkdirSync(CACHE, { recursive: true });

const ROUTES = [
  { re: /^\/sec\/tickers$/, url: () => "https://www.sec.gov/files/company_tickers.json", ttl: 24 * HOUR, type: "application/json", sec: true },
  { re: /^\/sec\/facts\/(\d{10})$/, url: m => `https://data.sec.gov/api/xbrl/companyfacts/CIK${m[1]}.json`, ttl: 12 * HOUR, type: "application/json", sec: true },
  { re: /^\/stooq\/([a-z0-9.\-^]{1,20})$/, url: m => `https://stooq.com/q/d/l/?s=${encodeURIComponent(m[1])}&i=d`, ttl: 6 * HOUR, type: "text/csv; charset=utf-8", sec: false },
];
const ALLOWED_UPSTREAM = new Set(["www.sec.gov", "data.sec.gov", "stooq.com"]);

// CORS only for pages on this machine: file:// (Origin "null"), 127.0.0.1 and localhost on any port.
const localOrigin = o => o === "null" || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o || "");

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
  const origin = req.headers.origin;
  const headers = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (localOrigin(origin)) Object.assign(headers, { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Private-Network": "true" });
  const send = (status, body, type = "application/json") => { res.writeHead(status, { ...headers, "Content-Type": type }); res.end(body); };
  if (req.method === "OPTIONS") { res.writeHead(204, { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "600" }); return res.end(); }
  if (req.method !== "GET") return send(405, JSON.stringify({ error: "GET only" }));
  if (origin && !localOrigin(origin)) return send(403, JSON.stringify({ error: "local pages only" }));
  let path;
  try { path = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname); } catch { return send(400, JSON.stringify({ error: "bad path" })); }
  if (path === "/health") return send(200, JSON.stringify({ ok: true, secUserAgent: !!UA }));
  let route, m;
  for (const r of ROUTES) { m = r.re.exec(path); if (m) { route = r; break; } }
  if (!route) return send(404, JSON.stringify({ error: "unknown route" }));
  const url = route.url(m);
  const cached = readCache(url, route.ttl);
  if (cached?.fresh) return send(200, cached.body, route.type);
  try {
    const body = await upstream(route, url);
    try { writeFileSync(cachePath(url), body); } catch (e) { console.warn("cache write failed:", e.message); }
    console.log(`${new Date().toISOString()} ${path} -> ${body.length} bytes`);
    send(200, body, route.type);
  } catch (e) {
    if (cached) { console.warn(`${path}: ${e.message}; serving stale cache`); return send(200, cached.body, route.type); }
    console.warn(`${path}: ${e.message}`);
    send(e.status || 502, JSON.stringify({ error: e.message }));
  }
});
server.listen(PORT, HOST, () => {
  console.log(`OMEGA data proxy on http://${HOST}:${PORT}  cache ${CACHE}`);
  if (!UA) console.log('SEC routes are off until you set OMEGA_SEC_UA="Your Name your@email". Stooq works now.');
});
