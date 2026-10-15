// Satellites (ADR-049): orbital elements from CelesTrak (keyless public GP data) propagated with SGP4 (satellite.js,
// MIT) to live positions, the same approach as God's Eye View. A few hundred well-known objects: space stations, the
// brightest visible satellites, weather satellites and the GPS constellation. Elements refresh every 6 hours.
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate, type SatRec } from "satellite.js";

export type Group = "stations" | "visual" | "weather" | "gps-ops";
export const GROUPS: Group[] = ["stations", "visual", "weather", "gps-ops"];
export type Omm = { OBJECT_NAME: string; OBJECT_ID: string; NORAD_CAT_ID: number } & Record<string, unknown>;
export type Sat = { id: number; name: string; group: Group; intl: string; rec: SatRec };
export type SatPos = { id: number; name: string; group: Group; intl: string; lat: number; lon: number; altKm: number; speedKms: number };

export function toSats(list: Omm[], group: Group): Sat[] {
  const out: Sat[] = [];
  for (const o of list) {
    try {
      const rec = json2satrec(o as never);
      if (rec.error) continue;
      out.push({ id: Number(o.NORAD_CAT_ID), name: String(o.OBJECT_NAME).trim(), group, intl: String(o.OBJECT_ID), rec });
    } catch { /* malformed element set */ }
  }
  return out;
}

/** Position of one satellite at `at`, or null when SGP4 can't propagate it (decayed or bad elements). */
export function positionOf(s: Sat, at: Date): SatPos | null {
  const pv = propagate(s.rec, at);
  if (!pv || typeof pv.position !== "object" || typeof pv.velocity !== "object") return null;
  const geo = eciToGeodetic(pv.position, gstime(at));
  const v = pv.velocity;
  const lat = degreesLat(geo.latitude), lon = degreesLong(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(geo.height)) return null;
  return { id: s.id, name: s.name, group: s.group, intl: s.intl, lat: round(lat, 3), lon: round(lon, 3), altKm: Math.round(geo.height),
    speedKms: round(Math.hypot(v.x, v.y, v.z), 2) };
}

/** Ground track for the next `minutes`, one point a minute, split where it crosses the date line. */
export function groundTrack(s: Sat, from: Date, minutes = 95): [number, number][][] {
  const segs: [number, number][][] = [[]];
  let prev: number | null = null;
  for (let m = 0; m <= minutes; m++) {
    const p = positionOf(s, new Date(from.getTime() + m * 60_000));
    if (!p) continue;
    if (prev != null && Math.abs(p.lon - prev) > 180) segs.push([]);
    segs[segs.length - 1].push([p.lon, p.lat]);
    prev = p.lon;
  }
  return segs.filter(s => s.length > 1);
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

let cache: { at: number; sats: Sat[] } = { at: 0, sats: [] };
let loading: Promise<void> | null = null;
const TTL = 6 * 3600_000;

export async function loadSats(f: typeof fetch = fetch): Promise<Sat[]> {
  if (Date.now() - cache.at < TTL && cache.sats.length) return cache.sats;
  loading ??= (async () => {
    const lists = await Promise.all(GROUPS.map(g => f(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=json`, { signal: AbortSignal.timeout(20_000) })
      .then(r => (r.ok ? r.json() : [])).then(j => toSats(Array.isArray(j) ? j : [], g)).catch(() => [] as Sat[])));
    const seen = new Set<number>(), sats: Sat[] = [];
    for (const s of lists.flat()) if (!seen.has(s.id)) { seen.add(s.id); sats.push(s); }   // first group wins (stations before visual)
    cache = { at: Date.now(), sats: sats.length ? sats : cache.sats };
  })().finally(() => { loading = null; });
  await loading;
  return cache.sats;
}
