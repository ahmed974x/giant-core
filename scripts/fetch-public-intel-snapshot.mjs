// Public intel snapshot (ADR-104): fetches the keyless OSIRIS sources once and writes
// data/public-intel-snapshot.json, the third tier of the Ops Room's data cascade
// (local proxy → direct browser fetch → this packaged snapshot). The Pages workflow runs it every hour
// before the build, so the public site has dated NGA strait warnings and GDACS alerts even though those
// hosts send no browser CORS headers. Every source carries its own name, URL, fetch time and status;
// a source that fails is written as {ok:false, error} and the page shows it as unverified, never filled in.
//
//   node scripts/fetch-public-intel-snapshot.mjs [out-file]
//
// Free and keyless only. No key, cookie or personal data is sent or stored. Exit code is 0 when at least
// one source answered, 1 when none did (the deploy then publishes the site without a snapshot).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNga, compactAis } from "./lib/osiris-sources.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[2] || join(REPO, "data", "public-intel-snapshot.json"));
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
  }
};

async function fetchOne(key, s, tries = 3) {
  let last = "";
  for (let k = 0; k < tries; k++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(s.url, { signal: ctl.signal, headers: { "User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip" }, redirect: "follow" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const data = s.pick(s.raw ? buf : JSON.parse(buf.toString("utf8")));
      return { ok: true, name: s.name, url: s.url, at: new Date().toISOString(), n: s.count(data), data };
    } catch (e) {
      last = e.name === "AbortError" ? "timed out after 30 s" : String(e.message || e).slice(0, 120);
      if (k < tries - 1) await new Promise(res => setTimeout(res, 2000 * 2 ** k));
    } finally { clearTimeout(t); }
  }
  return { ok: false, name: s.name, url: s.url, at: new Date().toISOString(), error: last };
}

const entries = await Promise.all(Object.entries(SOURCES).map(async ([k, s]) => [k, await fetchOne(k, s)]));
const sources = Object.fromEntries(entries);
const snap = { format: "omega-public-intel-v1", generated: new Date().toISOString(), note: "Public, keyless sources fetched by the Pages workflow. Each source has its own fetch time; the Ops Room ignores a source older than 6 hours.", sources };
mkdirSync(dirname(OUT), { recursive: true });
// Upstream text (NGA warnings, GDACS names) can carry a contact address; the public build refuses any
// e-mail address, so addresses are replaced before the file is written.
writeFileSync(OUT, JSON.stringify(snap).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[address removed]"));
for (const [k, s] of entries) console.log(`${s.ok ? "LIVE" : "DOWN"}  ${k.padEnd(8)} ${s.ok ? s.n + " items" : s.error}`);
const live = entries.filter(([, s]) => s.ok).length;
console.log(`${live} of ${entries.length} sources in ${OUT}`);
process.exit(live ? 0 : 1);
