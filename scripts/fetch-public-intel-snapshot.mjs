// Public intel snapshot (ADR-104): fetches the keyless OSIRIS sources once and writes
// data/public-intel-snapshot.json, the third tier of the Ops Room's data cascade
// (local proxy → direct browser fetch → this packaged snapshot). The Pages workflow runs it every hour
// before the build, so the public site has dated NGA strait warnings and GDACS alerts even though those
// hosts send no browser CORS headers. Every source carries its own name, URL, fetch time and status;
// a source that fails is written as {ok:false, error} and the page shows it as unverified, never filled in.
//
//   node scripts/fetch-public-intel-snapshot.mjs [out-file] [--prev <url-or-file of the last published snapshot>]
//
// ADR-108 adds CelesTrak GP elements, NASA EONET, NOAA SWPC Kp, CISA KEV, RIPEstat backbone visibility, IODA
// outages, the Deribit BTC option summary and DVOL, and the Binance BTC and ETH perpetual premium index, each in
// the compact form of scripts/lib/brain2-math.mjs. CelesTrak updates its elements about every two hours and
// blocks clients that fetch the same group more often, so on odd UTC hours the CelesTrak entries are carried
// over from the previous snapshot (with their own fetch time) instead of being fetched again.
//
// ADR-109 gives the perpetual premium (Binance, else OKX, else Deribit) and the disaster alerts (GDACS, else EMSC
// with ReliefWeb) a fallback chain; the entry's `via` names the one that answered.
//
// ADR-110 adds the SANS ISC InfoCON level, Shodan InternetDB records of four public resolvers, adsb.lol
// emergency squawks and aircraft counts around the five straits and the Taiwan Strait, and a 25-second sample
// of RIS Live BGP updates for the watched DNS anycast prefixes (Node's built-in WebSocket, Node 22 or newer).
//
// Free and keyless only. No key, cookie or personal data is sent or stored. Exit code is 0 when at least
// one source answered, 1 when none did (the deploy then publishes the site without a snapshot).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNga, compactAis } from "./lib/osiris-sources.mjs";
import { OMEGA_MATH } from "./lib/brain2-math.mjs";
import { readFileSync } from "node:fs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), pi = args.indexOf("--prev"), PREV = pi >= 0 ? args[pi + 1] : "";
if (pi >= 0) args.splice(pi, 2);
const OUT = resolve(args[0] || join(REPO, "data", "public-intel-snapshot.json"));
const SH = OMEGA_MATH.shape, U = OMEGA_MATH.urls, NOW = Date.now();
const UA = "Mozilla/5.0 (compatible; OMEGA-public-intel-snapshot/1.1; +https://github.com/ahmed974x/giant-core)";

// The nine hubs the Ops Room weather layer reads, in the page's order (the five straits, then four ports).
const HUBS = [
  [26.57, 56.25], [12.6, 43.33], [30.0, 32.58], [2.5, 101.0], [9.08, -79.68],
  [29.38, 47.98], [51.95, 4.14], [29.75, -95.3], [1.26, 103.82]
];
const AIS_MAX = 6000;

const SOURCES = {
  usgs: {
    name: "USGS earthquakes, M2.5+ past day", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
    pick: j => ({ features: (j.features || []).filter(f => f && f.properties && Number.isFinite(f.properties.mag) && f.geometry).map(f => ({ properties: { mag: f.properties.mag, place: f.properties.place || "", time: f.properties.time, url: f.properties.url }, geometry: { coordinates: f.geometry.coordinates.slice(0, 3) } })) }),
    count: d => d.features.length
  },
  meteo: {
    name: "Open-Meteo, nine hubs", url: "https://api.open-meteo.com/v1/forecast?latitude=" + HUBS.map(h => h[0]).join(",") + "&longitude=" + HUBS.map(h => h[1]).join(",") + "&current=temperature_2m,wind_speed_10m,wind_gusts_10m&hourly=wind_gusts_10m&forecast_hours=24&wind_speed_unit=kmh&timezone=UTC",
    pick: j => (Array.isArray(j) ? j : [j]).map(x => ({ current: x.current, hourly: x.hourly ? { time: x.hourly.time, wind_gusts_10m: x.hourly.wind_gusts_10m } : null })),
    count: d => d.length
  },
  binance: {
    name: "Binance spot 24 h tickers", url: "https://data-api.binance.vision/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"])),
    pick: j => j.map(x => ({ symbol: x.symbol, lastPrice: x.lastPrice, priceChangePercent: x.priceChangePercent })),
    count: d => d.length
  },
  nga: {
    name: "NGA Maritime Safety Information, broadcast warnings", url: "https://msi.nga.mil/api/publications/broadcast-warn?output=json",
    raw: true, pick: buf => JSON.parse(classifyNga(buf).toString("utf8")),
    count: d => d.straits.reduce((n, s) => n + s.warnings.length, 0)
  },
  // ADR-109: GDACS first (its event list, then its search endpoint), then EMSC earthquakes of M6 or more with
  // ReliefWeb alerts when ReliefWeb answers. The entry says which one answered in `via`.
  gdacs: {
    name: "Disaster alerts: GDACS, else EMSC + ReliefWeb",
    tries: [
      { via: "GDACS", url: U.gdacs(), pick: j => SH.gdacs(j, "GDACS") },
      { via: "GDACS search", url: U.gdacsSearch(NOW), pick: j => SH.gdacs(j, "GDACS search") },
      { via: "EMSC + ReliefWeb", url: U.emsc(NOW) + " " + U.reliefweb(), get: async signal => {
        const q = SH.emsc(JSON.parse((await getBuf(U.emsc(NOW), signal)).toString("utf8")));
        let rw = null;
        try { rw = SH.reliefweb(JSON.parse((await getBuf(U.reliefweb(), signal)).toString("utf8"))); } catch { /* EMSC alone still answers */ }
        return rw ? { ...q, via: "EMSC + ReliefWeb", rule: q.rule + "; " + rw.rule, features: q.features.concat(rw.features) } : q;
      } }
    ],
    count: d => d.features.length
  },
  ais: {
    name: "Digitraffic / Fintraffic AIS, Baltic (CC BY 4.0)", url: "https://meri.digitraffic.fi/api/ais/v1/locations",
    raw: true, pick: buf => {
      const j = JSON.parse(compactAis(buf).toString("utf8")), v = j.vessels;
      return { ...j, total: v.length, vessels: v.length > AIS_MAX ? v.filter((_, i) => i % Math.ceil(v.length / AIS_MAX) === 0) : v };
    },
    count: d => d.total
  },
  celestrak_stations: { name: "CelesTrak GP elements, space stations", url: U.gp("stations"), pick: j => SH.gp(j), count: d => d.sats.length, celestrak: true },
  celestrak_visual: { name: "CelesTrak GP elements, 100 brightest", url: U.gp("visual"), pick: j => SH.gp(j), count: d => d.sats.length, celestrak: true },
  eonet: { name: "NASA EONET open natural events", url: U.eonet(), pick: j => SH.eonet(j), count: d => d.events.length },
  kp: { name: "NOAA SWPC planetary K index", url: U.kp(), pick: j => SH.kp(j), count: d => d.readings.length },
  kev: { name: "CISA Known Exploited Vulnerabilities", url: U.kev(), pick: j => SH.kev(j, NOW), count: d => d.recent.length },
  ripe: { name: "RIPEstat routing status, five tier-1 backbones", urls: OMEGA_MATH.RIPE_ASNS.map(([a]) => U.ripe(a)), pick: list => ({ format: "omega-ripe-set-v1", asns: list.map((j, i) => SH.ripe(j, OMEGA_MATH.RIPE_ASNS[i][0])) }), count: d => d.asns.length },
  ioda: { name: "IODA country outage events, 24 h", url: U.ioda(NOW), pick: j => SH.ioda(j), count: d => d.events.length },
  deribit: { name: "Deribit BTC option book summary", url: U.deribit(), pick: j => SH.deribit(j), count: d => d.options.length },
  dvol: { name: "Deribit DVOL (BTC), hourly", url: U.dvol(NOW), pick: j => SH.dvol(j), count: d => d.rows.length },
  // ADR-109: Binance answers HTTP 451 to US cloud runners, so the perpetual premium falls back to OKX, then Deribit.
  premium: {
    name: "Perpetual premium and funding, BTC and ETH: Binance USD-M, else OKX, else Deribit",
    tries: [
      { via: "Binance USD-M", urls: [U.premium("BTCUSDT"), U.premium("ETHUSDT")], pick: list => ({ format: "omega-premium-set-v1", via: "Binance USD-M", items: list.map(j => SH.premium(j)) }) },
      { via: "OKX", urls: [...U.okx("BTCUSDT"), ...U.okx("ETHUSDT")], pick: l => ({ format: "omega-premium-set-v1", via: "OKX", items: [SH.perpOkx(l[0], l[1], l[2], "BTCUSDT"), SH.perpOkx(l[3], l[4], l[5], "ETHUSDT")] }) },
      { via: "Deribit", urls: [U.deribitPerp("BTCUSDT"), U.deribitPerp("ETHUSDT")], pick: l => ({ format: "omega-premium-set-v1", via: "Deribit", items: [SH.perpDeribit(l[0], "BTCUSDT"), SH.perpDeribit(l[1], "ETHUSDT")] }) }
    ],
    count: d => d.items.length
  },
  infocon: { name: "SANS Internet Storm Center InfoCON", url: U.infocon(), pick: j => SH.infocon(j), count: () => 1 },
  internetdb: { name: "Shodan InternetDB, four public resolvers (weekly data, non-commercial use)", urls: OMEGA_MATH.INTERNETDB_HOSTS.map(([ip]) => U.internetdb(ip)), pick: list => SH.internetdbSet(list), count: d => d.hosts.length },
  adsb: { name: "adsb.lol (ODbL 1.0): squawk 7700 worldwide, aircraft near the five straits and Taiwan", urls: [U.adsbSqk(7700), ...OMEGA_MATH.AIR_ZONES.map(z => U.adsbZone(z.key))], gapMs: 3000, pick: list => SH.adsbSet(list), count: d => d.zones.reduce((n, z) => n + z.n, 0) },
  rislive: { name: "RIS Live BGP updates, watched DNS anycast prefixes, 25 s sample", url: U.risLive(), get: () => risSample(25000), count: d => d.messages }
};

// RIS Live: open the stream, subscribe to the watched prefixes, keep every UPDATE for `ms`, then summarise.
// A quiet half minute is a valid answer (index 0); only a socket that never opens is a failure.
function risSample(ms) {
  if (typeof WebSocket !== "function") return Promise.reject(new Error("this Node has no WebSocket (needs 22 or newer)"));
  return new Promise((res, rej) => {
    const msgs = [], ws = new WebSocket(U.risLive());
    let open = false;
    const stop = setTimeout(() => { try { ws.close(); } catch { /* already closed */ } if (open) res({ ...OMEGA_MATH.risSummary(msgs, Date.now(), ms), sampleMs: ms }); else rej(new Error("RIS Live did not open in time")); }, ms);
    ws.addEventListener("open", () => { open = true; for (const m of OMEGA_MATH.risSubscribe()) ws.send(JSON.stringify(m)); });
    ws.addEventListener("message", e => { try { const m = JSON.parse(String(e.data)); if (m.type === "ris_message" && m.data && msgs.length < 20000) msgs.push(m.data); } catch { /* not JSON: ignored */ } });
    ws.addEventListener("error", () => { if (!open) { clearTimeout(stop); rej(new Error("RIS Live socket error")); } });
  });
}

// A plain, honest User-Agent in the common "Mozilla/5.0 (compatible; ...)" form: it names this project and
// pretends to be no browser. Some hosts (GDACS among them) refuse requests with no recognisable agent.
async function getBuf(url, signal) {
  const r = await fetch(url, { signal, headers: { "User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip" }, redirect: "follow" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function attempt(s, signal) {
  if (s.get) return s.get(signal);
  // `gapMs` spaces the calls of one source (ADR-111: adsb.lol answered HTTP 429 to seven calls in a row).
  if (s.urls) { const list = []; for (const [i, u] of s.urls.entries()) { if (i && s.gapMs) await new Promise(res => setTimeout(res, s.gapMs)); list.push(JSON.parse((await getBuf(u, signal)).toString("utf8"))); } return s.pick(list); }
  const buf = await getBuf(s.url, signal);
  return s.pick(s.raw ? buf : JSON.parse(buf.toString("utf8")));
}
async function fetchTry(s, tries) {
  let last = "";
  for (let k = 0; k < tries; k++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    try { return { data: await attempt(s, ctl.signal) }; }
    catch (e) {
      last = e.name === "AbortError" ? "timed out after 30 s" : String(e.message || e).slice(0, 120);
      if (k < tries - 1) await new Promise(res => setTimeout(res, 2000 * 2 ** k));
    } finally { clearTimeout(t); }
  }
  return { error: last };
}
// A source with `tries` walks them in order and records which one answered (`via`) and why the ones before
// it failed (`fellBack`), so a fallback is never presented as the first source.
async function fetchOne(key, s, tries = 3) {
  const list = s.tries || [s], fell = [];
  for (const t of list) {
    const r = await fetchTry(t, s.tries ? 2 : tries), url = t.url || t.urls.join(" ");
    if (!("error" in r)) return { ok: true, name: s.name, url, at: new Date().toISOString(), n: s.count(r.data), data: r.data, ...(s.tries ? { via: (r.data && r.data.via) || t.via, fellBack: fell } : {}) };
    fell.push(`${t.via || key}: ${r.error}`);
  }
  return { ok: false, name: s.name, url: list.map(t => t.url || t.urls.join(" ")).join(" | "), at: new Date().toISOString(), error: fell.join("; ").slice(0, 400) };
}

// The previous published snapshot, for CelesTrak on odd hours. A missing or unreadable one only means
// CelesTrak is fetched this hour after all.
async function previous() {
  if (!PREV) return null;
  try {
    if (/^https:\/\//.test(PREV)) { const c = new AbortController(), t = setTimeout(() => c.abort(), 20000); try { return JSON.parse((await getBuf(PREV, c.signal)).toString("utf8")); } finally { clearTimeout(t); } }
    return JSON.parse(readFileSync(PREV, "utf8"));
  } catch { return null; }
}
const prev = await previous();
const oddHour = new Date(NOW).getUTCHours() % 2 === 1;
const carried = (k, s) => {
  const p = prev && prev.format === "omega-public-intel-v1" && prev.sources && prev.sources[k];
  return s.celestrak && oddHour && p && p.ok === true && NOW - Date.parse(p.at) < 3 * 3600e3 ? { ...p, carried: true } : null;
};
const entries = await Promise.all(Object.entries(SOURCES).map(async ([k, s]) => [k, carried(k, s) || await fetchOne(k, s)]));
const sources = Object.fromEntries(entries);
const snap = { format: "omega-public-intel-v1", generated: new Date().toISOString(), note: "Public, keyless sources fetched by the Pages workflow. Each source has its own fetch time; the Ops Room ignores a source older than 6 hours.", sources };
mkdirSync(dirname(OUT), { recursive: true });
// Upstream text (NGA warnings, GDACS names) can carry a contact address; the public build refuses any
// e-mail address, so addresses are replaced before the file is written.
writeFileSync(OUT, JSON.stringify(snap).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[address removed]"));
for (const [k, s] of entries) console.log(`${s.ok ? (s.carried ? "KEPT" : "LIVE") : "DOWN"}  ${k.padEnd(18)} ${s.ok ? s.n + " items" + (s.via ? " via " + s.via + (s.fellBack.length ? " (fell back: " + s.fellBack.join("; ") + ")" : "") : "") + (s.carried ? ", carried over from " + s.at : "") : s.error}`);
const live = entries.filter(([, s]) => s.ok).length;
console.log(`${live} of ${entries.length} sources in ${OUT}`);
process.exit(live ? 0 : 1);
