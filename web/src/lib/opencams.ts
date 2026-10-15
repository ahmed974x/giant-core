// Keyless public cameras (ADR-046, ADR-050): still images that transport agencies publish as open data for anyone to view.
// - Finland, Fintraffic road-weather cameras (Digitraffic, CC BY 4.0): ~800 stations, snow/ice/visibility on roads.
// - London, Transport for London JamCams (TfL open data): ~900 road cameras, refreshed every few minutes.
// - California, Caltrans highway camera stills (all 12 districts, public data): ~3,000 cameras.
// - Iceland, Vegagerðin road cameras (Icelandic Road Administration open data): ~500 cameras.
// Only the agencies' own published stills; no private feeds and no image analysis (ADR 006).
import { distanceKm } from "./geo.ts";

export type Nearby = { kind: string; title: string; km: number; source: string; at: string | null; url: string | null };
export type Webcam = { id: string; title: string; lat: number; lon: number; preview: string | null; url: string | null; status: string; source: string; nearby?: Nearby[] };

const TTL_MS = 10 * 60_000;
const SOURCES = {
  fintraffic: "https://tie.digitraffic.fi/api/weathercam/v1/stations",
  tfl: "https://api.tfl.gov.uk/Place/Type/JamCam",
  iceland: "https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1",
} as const;
const CALTRANS = Array.from({ length: 12 }, (_, i) => `https://cwwp2.dot.ca.gov/data/d${i + 1}/cctv/cctvStatusD${String(i + 1).padStart(2, "0")}.json`);

type FiFeature = { id?: string; geometry?: { coordinates?: number[] }; properties?: { name?: string; collectionStatus?: string; presets?: { id: string; inCollection?: boolean }[] } };
type TflPlace = { id?: string; commonName?: string; lat?: number; lon?: number; additionalProperties?: { key: string; value: string }[] };
type CaltransRec = { cctv?: { index?: string; inService?: string; location?: { district?: string; locationName?: string; nearbyPlace?: string; latitude?: string; longitude?: string };
  imageData?: { static?: { currentImageURL?: string } } } };
type IsCam = { Maelist_nr?: number; Myndavel?: string; Skyring?: string; Slod?: string; Breidd?: number; Lengd?: number };

export function parseFintraffic(j: unknown): Webcam[] {
  const out: Webcam[] = [];
  for (const f of (j as { features?: FiFeature[] })?.features ?? []) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const preset = f.properties?.presets?.find(p => p.inCollection !== false);
    if (typeof lat !== "number" || typeof lon !== "number" || !preset || f.properties?.collectionStatus !== "GATHERING") continue;
    const name = String(f.properties?.name ?? f.id ?? "").replace(/_/g, " ").trim();
    out.push({ id: `fi-${preset.id}`, title: `${name} (Fintraffic)`, lat, lon, preview: `https://weathercam.digitraffic.fi/${preset.id}.jpg`,
      url: "https://liikennetilanne.fintraffic.fi/", status: "active", source: "fintraffic" });
  }
  return out;
}

export function parseTfl(j: unknown): Webcam[] {
  const out: Webcam[] = [];
  for (const c of Array.isArray(j) ? (j as TflPlace[]) : []) {
    const prop = (k: string) => c.additionalProperties?.find(p => p.key === k)?.value;
    const image = prop("imageUrl");
    if (typeof c.lat !== "number" || typeof c.lon !== "number" || prop("available") !== "true" || !image?.startsWith("https://")) continue;
    out.push({ id: `tfl-${c.id}`, title: `${c.commonName ?? "JamCam"} (TfL)`, lat: c.lat, lon: c.lon, preview: image,
      url: "https://tfl.gov.uk/traffic/status/", status: "active", source: "tfl" });
  }
  return out;
}

export function parseCaltrans(j: unknown): Webcam[] {
  const out: Webcam[] = [];
  for (const r of (j as { data?: CaltransRec[] })?.data ?? []) {
    const c = r.cctv, loc = c?.location, img = c?.imageData?.static?.currentImageURL;
    const lat = Number(loc?.latitude), lon = Number(loc?.longitude);
    if (!c || c.inService !== "true" || !img?.startsWith("https://") || !Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;   // 0 means "no position" in this feed
    const name = String(loc?.locationName ?? "").replace(/^\S+ -- /, "");
    out.push({ id: `ca-${loc?.district}-${c.index}`, title: `${name}${loc?.nearbyPlace ? ` (${loc.nearbyPlace})` : ""} (Caltrans)`,
      lat, lon, preview: img, url: "https://quickmap.dot.ca.gov/", status: "active", source: "caltrans" });
  }
  return out;
}

export function parseIceland(j: unknown): Webcam[] {
  const out: Webcam[] = [];
  for (const c of Array.isArray(j) ? (j as IsCam[]) : []) {
    if (typeof c.Breidd !== "number" || typeof c.Lengd !== "number" || !c.Slod?.startsWith("https://")) continue;
    out.push({ id: `is-${c.Maelist_nr}-${c.Slod.split("/").pop()}`, title: `${c.Skyring || c.Myndavel} (Vegagerðin)`, lat: c.Breidd, lon: c.Lengd,
      preview: c.Slod, url: "https://umferdin.is/", status: "active", source: "iceland" });
  }
  return out;
}

let cache: { at: number; cams: Webcam[] } = { at: 0, cams: [] };
let loading: Promise<void> | null = null;

async function load(f: typeof fetch) {
  const get = (u: string) => f(u, { headers: { "Digitraffic-User": "OMEGA-PRIME/1.0", "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(15_000) })
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [fi, tfl, is, ...ca] = await Promise.all([get(SOURCES.fintraffic), get(SOURCES.tfl), get(SOURCES.iceland), ...CALTRANS.map(get)]);
  const cams = [...parseFintraffic(fi), ...parseTfl(tfl), ...parseIceland(is), ...ca.flatMap(parseCaltrans)];
  cache = { at: Date.now(), cams: cams.length ? cams : cache.cams };   // keep the last good list if all fail
}

/** Open cameras within the view, nearest first, at most `limit`. */
export async function openCamsNear(lat: number, lon: number, radiusKm: number, limit = 60, f: typeof fetch = fetch): Promise<Webcam[]> {
  if (Date.now() - cache.at > TTL_MS) { loading ??= load(f).finally(() => { loading = null; }); await loading; }
  return cache.cams.map(c => ({ c, d: distanceKm(lat, lon, c.lat, c.lon) })).filter(x => x.d <= radiusKm)
    .sort((a, b) => a.d - b.d).slice(0, limit).map(x => x.c);
}

// Camera news bots (ADR-050): each camera gets the live events around it, so opening a camera shows what is happening
// near it. Earthquakes and disasters reach far, fires and news stay local. Matching is by place and time only.
export type Happening = { kind: string; title: string; lat: number; lon: number; source: string; at: string | null; url: string | null; mag?: number | null };
const REACH_KM: Record<string, number> = { earthquake: 300, cyclone: 500, flood: 200, volcano: 200, drought: 400, firePixel: 25, wildfires: 60, conflict: 50, protest: 50, tension: 50 };
export function nearbyFor(cam: { lat: number; lon: number }, all: Happening[], max = 3): Nearby[] {
  return all.map(h => ({ h, km: distanceKm(cam.lat, cam.lon, h.lat, h.lon) }))
    .filter(x => x.km <= (x.h.kind === "earthquake" && (x.h.mag ?? 6) < 5 ? 40 : REACH_KM[x.h.kind] ?? 100))   // small quakes are only felt close by
    .sort((a, b) => a.km - b.km).slice(0, max)
    .map(({ h, km }) => ({ kind: h.kind, title: h.title, km: Math.round(km), source: h.source, at: h.at, url: h.url }));
}
