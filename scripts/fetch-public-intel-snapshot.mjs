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
const UA = "OMEGA public intel snapshot (github.com/ahmed974x/giant-core)";

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
  gdacs: {
    name: "GDACS disaster alerts", url: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP",
    pick: j => ({ features: (j.features || []).filter(f => f.geometry && f.geometry.type === "Point" && f.properties && ["Orange", "Red"].includes(f.properties.alertlevel)).slice(0, 200)
      .map(f => ({ geometry: { type: "Point", coordinates: f.geometry.coordinates.slice(0, 2) }, properties: { alertlevel: f.properties.alertlevel, eventtype: f.properties.eventtype, name: f.properties.name || f.properties.eventname || "", url: { report: f.properties.url && f.properties.url.report } } })) }),
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
  premium: { name: "Binance USD-M premium index, BTC and ETH", urls: [U.premium("BTCUSDT"), U.premium("ETHUSDT")], pick: list => ({ format: "omega-premium-set-v1", items: list.map(j => SH.premium(j)) }), count: d => d.items.length }
};

async function getBuf(url, signal) {
  const r = await fetch(url, { signal, headers: { "User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip" }, redirect: "follow" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function fetchOne(key, s, tries = 3) {
  let last = "";
  const url = s.url || s.urls.join(" ");
  for (let k = 0; k < tries; k++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    try {
      let data;
      if (s.urls) { const list = []; for (const u of s.urls) list.push(JSON.parse((await getBuf(u, ctl.signal)).toString("utf8"))); data = s.pick(list); }
      else { const buf = await getBuf(s.url, ctl.signal); data = s.pick(s.raw ? buf : JSON.parse(buf.toString("utf8"))); }
      return { ok: true, name: s.name, url, at: new Date().toISOString(), n: s.count(data), data };
    } catch (e) {
      last = e.name === "AbortError" ? "timed out after 30 s" : String(e.message || e).slice(0, 120);
      if (k < tries - 1) await new Promise(res => setTimeout(res, 2000 * 2 ** k));
    } finally { clearTimeout(t); }
  }
  return { ok: false, name: s.name, url, at: new Date().toISOString(), error: last };
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
for (const [k, s] of entries) console.log(`${s.ok ? (s.carried ? "KEPT" : "LIVE") : "DOWN"}  ${k.padEnd(18)} ${s.ok ? s.n + " items" + (s.carried ? ", carried over from " + s.at : "") : s.error}`);
const live = entries.filter(([, s]) => s.ok).length;
console.log(`${live} of ${entries.length} sources in ${OUT}`);
process.exit(live ? 0 : 1);
