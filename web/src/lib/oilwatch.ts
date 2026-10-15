// Oil Watch (ADR-047): two analysis bots that turn open data into oil-market signals for the Market screen.
// - Tanker bot: oil and product tankers moving in the Baltic, from Finland's keyless Digitraffic AIS, with how many
//   are heading to Russia's Baltic oil ports (Primorsk, Ust-Luga, Vysotsk) - a live read on that export flow.
// - Fire bot: NASA FIRMS fire pixels near major Gulf oil sites. Refineries and fields flare gas all the time, so each
//   site is compared with its own history; only fires well above that site's normal count raise the signal.
// Signals are context for Ahmad and the paper account only. Nothing here trades or proposes a real order.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { distanceKm } from "./geo.ts";

import { OIL_SITES, type OilSite } from "./oilsites.ts";
export { OIL_SITES, type OilSite };
const SITE_KM = 10;

export type Vessel = { mmsi: number; shipType?: number; destination?: string; name?: string };
export type Position = { mmsi: number; sog: number; lat: number; lon: number };
export type FirePoint = { lat: number; lon: number; kind: string; mag: number | null };

const RU_OIL_PORT = /PRIMORSK|UST.?LUGA|RU\s?ULU|RU\s?PRI|VYSOTSK|RU\s?VYS/i;
const isTanker = (t?: number) => typeof t === "number" && t >= 80 && t <= 89;

export type TankerReading = { tankers: number; moving: number; toRussianOilPorts: number; sample: string[] };
export function tankerBot(vessels: Vessel[], positions: Position[]): TankerReading {
  const meta = new Map(vessels.map(v => [v.mmsi, v]));
  let tankers = 0, moving = 0, toRu = 0;
  const sample: string[] = [];
  for (const p of positions) {
    const v = meta.get(p.mmsi);
    if (!v || !isTanker(v.shipType)) continue;
    tankers++;
    if (p.sog >= 3) moving++;
    if (RU_OIL_PORT.test(v.destination ?? "")) { toRu++; if (sample.length < 5 && v.name) sample.push(`${v.name.trim()} → ${String(v.destination).trim()}`); }
  }
  return { tankers, moving, toRussianOilPorts: toRu, sample };
}

export type SiteFires = { id: string; name: string; nameAr: string; fires: number; frp: number };
export function fireBot(points: FirePoint[], sites = OIL_SITES): SiteFires[] {
  return sites.map(s => {
    const near = points.filter(p => p.kind === "firePixel" && distanceKm(s.lat, s.lon, p.lat, p.lon) <= SITE_KM);
    return { id: s.id, name: s.name, nameAr: s.nameAr, fires: near.length, frp: Math.round(near.reduce((a, p) => a + (p.mag ?? 0), 0)) };
  });
}

export type Snapshot = { at: string; tankers: TankerReading | null; sites: SiteFires[] | null };
export type Level = "calm" | "watch" | "alert" | "learning";
export type Reason = { code: string; value: number; normal: number | null; site?: string };
export type Signal = { level: Level; score: number; reasons: Reason[]; history: number };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const MIN_HISTORY = 6;   // readings before a baseline is trusted

/** Compare the latest reading with the history; a site or the tanker flow far from its own normal raises the score. */
export function assess(now: Snapshot, history: Snapshot[]): Signal {
  const reasons: Reason[] = [];
  let score = 0;
  const past = history.filter(h => h.at < now.at).slice(-24 * 7);
  if (now.sites) {
    for (const s of now.sites) {
      const prev = past.flatMap(h => h.sites?.filter(x => x.id === s.id).map(x => x.fires) ?? []);
      const normal = prev.length >= MIN_HISTORY ? mean(prev) : null;
      // Unusual: at least 3 more fire pixels than this site's normal and double it (gas flares set the normal).
      if (normal != null && s.fires >= normal * 2 + 3) { score += Math.min(40, 10 + (s.fires - normal) * 3); reasons.push({ code: "site-fire", value: s.fires, normal: Math.round(normal * 10) / 10, site: s.id }); }
    }
  }
  if (now.tankers) {
    const prev = past.flatMap(h => (h.tankers ? [h.tankers.toRussianOilPorts] : []));
    const normal = prev.length >= MIN_HISTORY ? mean(prev) : null;
    if (normal != null && normal > 0) {
      const change = (now.tankers.toRussianOilPorts - normal) / normal;
      if (Math.abs(change) >= 0.3) { score += Math.min(30, Math.round(Math.abs(change) * 40)); reasons.push({ code: change > 0 ? "tankers-up" : "tankers-down", value: now.tankers.toRussianOilPorts, normal: Math.round(normal * 10) / 10 }); }
    }
  }
  score = Math.min(100, score);
  const learning = past.length < MIN_HISTORY;
  return { level: learning && !reasons.length ? "learning" : score >= 50 ? "alert" : score >= 20 ? "watch" : "calm", score, reasons, history: past.length };
}

// History: one reading per hour at most, kept with Director 00's data (git-ignored, in the backup).
export const historyFile = (dataDir: string) => path.join(dataDir, "oilwatch", "history.jsonl");
export async function loadHistory(dataDir: string): Promise<Snapshot[]> {
  try {
    return (await readFile(historyFile(dataDir), "utf8")).split("\n").filter(Boolean)
      .flatMap(l => { try { return [JSON.parse(l) as Snapshot]; } catch { return []; } }).slice(-24 * 30);
  } catch { return []; }
}
export async function record(dataDir: string, snap: Snapshot, history: Snapshot[]): Promise<boolean> {
  const last = history.at(-1);
  if (last && Date.parse(snap.at) - Date.parse(last.at) < 55 * 60_000) return false;
  await mkdir(path.dirname(historyFile(dataDir)), { recursive: true });
  await appendFile(historyFile(dataDir), JSON.stringify(snap) + "\n");
  return true;
}

const DT = { headers: { "Digitraffic-User": "OMEGA-PRIME/1.0", "Accept-Encoding": "gzip" }, signal: undefined as AbortSignal | undefined };
export async function readTankers(f: typeof fetch = fetch): Promise<TankerReading | null> {
  try {
    const opt = { ...DT, signal: AbortSignal.timeout(15_000) };
    const [v, l] = await Promise.all([
      f("https://meri.digitraffic.fi/api/ais/v1/vessels", opt).then(r => (r.ok ? r.json() : null)),
      f("https://meri.digitraffic.fi/api/ais/v1/locations", opt).then(r => (r.ok ? r.json() : null)),
    ]);
    if (!Array.isArray(v) || !Array.isArray(l?.features)) return null;
    const positions: Position[] = (l.features as { mmsi: number; geometry: { coordinates: number[] }; properties: { sog?: number } }[])
      .map(x => ({ mmsi: x.mmsi, sog: x.properties?.sog ?? 0, lon: x.geometry.coordinates[0], lat: x.geometry.coordinates[1] }));
    return tankerBot(v as Vessel[], positions);
  } catch { return null; }
}
