// Shared parsers for the OSIRIS sources (ADR-104), used by the local data proxy (scripts/omega-data-proxy.mjs)
// and the hourly public snapshot (scripts/fetch-public-intel-snapshot.mjs), so both sort NGA warnings into
// the five straits and compact Digitraffic AIS the same way. Pure functions, no network, no file access.
import { Buffer } from "node:buffer";

// The five maritime chokepoints. Box = [latMin, lonMin, latMax, lonMax]; names = words NGA and GDELT use.
export const STRAITS = [
  { key: "hormuz", en: "Strait of Hormuz", ar: "مضيق هرمز", box: [24.0, 54.0, 27.8, 58.8], names: ["HORMUZ", "PERSIAN GULF", "GULF OF OMAN", "ARABIAN GULF"] },
  { key: "bab", en: "Bab el-Mandeb", ar: "باب المندب", box: [11.0, 41.5, 15.5, 45.5], names: ["BAB EL MANDEB", "BAB-EL-MANDEB", "BAB AL MANDAB", "SOUTHERN RED SEA", "GULF OF ADEN"] },
  { key: "suez", en: "Suez Canal", ar: "قناة السويس", box: [27.5, 31.8, 31.6, 34.0], names: ["SUEZ", "GULF OF SUEZ", "PORT SAID"] },
  { key: "malacca", en: "Strait of Malacca", ar: "مضيق ملقا", box: [-1.0, 95.0, 6.5, 104.5], names: ["MALACCA", "SINGAPORE STRAIT", "STRAIT OF SINGAPORE", "PHILLIP CHANNEL"] },
  { key: "panama", en: "Panama Canal", ar: "قناة بنما", box: [7.5, -80.6, 9.8, -78.8], names: ["PANAMA CANAL", "GATUN", "BALBOA", "CRISTOBAL"] }
];
// NGA writes positions as "26-34.00N 056-15.00E" (degrees-minutes) or "26-34N 056-15E".
const NGA_POS = /(\d{1,2})-(\d{1,2}(?:\.\d+)?)\s*([NS])\s+(\d{1,3})-(\d{1,2}(?:\.\d+)?)\s*([EW])/g;
export function ngaPositions(text) {
  const out = [];
  for (const m of String(text || "").matchAll(NGA_POS)) {
    const lat = (+m[1] + +m[2] / 60) * (m[3] === "S" ? -1 : 1), lon = (+m[4] + +m[5] / 60) * (m[6] === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push([lat, lon]);
  }
  return out;
}
const inBox = ([lat, lon], [a, b, c, d]) => lat >= a && lat <= c && lon >= b && lon <= d;
export function classifyNga(buf) {
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

// Digitraffic returns every vessel in the Baltic as GeoJSON (several MB). The page only needs position and speed.
export function compactAis(buf) {
  const j = JSON.parse(buf.toString("utf8"));
  const rows = [];
  for (const f of j.features || []) {
    const c = f.geometry && f.geometry.coordinates, p = f.properties || {};
    if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) rows.push([+c[0].toFixed(4), +c[1].toFixed(4), Number.isFinite(p.sog) ? p.sog : null]);
  }
  return Buffer.from(JSON.stringify({ source: "Digitraffic / Fintraffic AIS (CC BY 4.0)", at: j.dataUpdatedTime || new Date().toISOString(), vessels: rows }));
}

