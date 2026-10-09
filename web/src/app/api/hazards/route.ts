// Live natural hazards from two keyless public feeds:
//  - USGS earthquakes (magnitude 2.5+, last 24 h)
//  - NASA EONET open events: storms, wildfires, volcanoes, floods, dust, landslides (latest fix per event)
// Cached 5 minutes so the globe never hammers either service.
import { ttlCache } from "@/lib/geo";

export type Hazard = { id: string; kind: string; title: string; lat: number; lon: number; mag: number | null; at: string; url: string | null; source: "USGS" | "NASA EONET" };

const cache = ttlCache<Hazard[]>(5 * 60_000, 2);
const SKIP = new Set(["seaLakeIce", "snow", "waterColor", "manmade"]);

type UsgsFeature = { id: string; geometry: { coordinates: [number, number, number] }; properties: { mag: number; place: string; time: number; url: string } };
type EonetFeature = { geometry: { type: string; coordinates: number[] | number[][] };
  properties: { id: string; title: string; date: string; link: string; magnitudeValue: number | null; categories: { id: string }[]; sources?: { url: string }[] } };

async function load(): Promise<Hazard[]> {
  const opts = { signal: AbortSignal.timeout(12_000), cache: "no-store" as const, headers: { Accept: "application/json", "User-Agent": "omega-prime/0.1" } };
  const [usgs, eonet] = await Promise.allSettled([
    fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", opts).then(r => r.json()),
    fetch("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30", opts).then(r => r.json()),
  ]);
  const out: Hazard[] = [];
  if (usgs.status === "fulfilled") {
    for (const f of (usgs.value.features ?? []) as UsgsFeature[]) {
      const [lon, lat] = f.geometry.coordinates;
      out.push({ id: `usgs-${f.id}`, kind: "earthquake", title: f.properties.place, lat, lon, mag: f.properties.mag, at: new Date(f.properties.time).toISOString(), url: f.properties.url, source: "USGS" });
    }
  }
  if (eonet.status === "fulfilled") {
    const latest = new Map<string, Hazard>();
    for (const f of (eonet.value.features ?? []) as EonetFeature[]) {
      const p = f.properties, kind = p.categories?.[0]?.id ?? "other";
      if (SKIP.has(kind)) continue;
      const c = f.geometry.type === "Point" ? (f.geometry.coordinates as number[]) : (f.geometry.coordinates as number[][])[0];
      if (!c || typeof c[0] !== "number") continue;
      const prev = latest.get(p.id);
      if (prev && prev.at >= p.date) continue; // storms come as a track of fixes; keep the newest
      latest.set(p.id, { id: p.id, kind, title: p.title, lat: c[1], lon: c[0], mag: p.magnitudeValue, at: p.date, url: p.sources?.[0]?.url ?? null, source: "NASA EONET" });
    }
    out.push(...latest.values());
  }
  if (!out.length) throw new Error("both hazard feeds unreachable");
  return out;
}

export async function GET() {
  try {
    const hazards = await cache("all", load);
    return Response.json({ count: hazards.length, hazards }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "hazard feeds unreachable" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
