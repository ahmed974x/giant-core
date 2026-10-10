// Live natural hazards from two keyless public feeds:
//  - USGS earthquakes (magnitude 2.5+, last 24 h)
//  - NASA EONET open events: storms, wildfires, volcanoes, floods, dust, landslides (latest fix per event)
// Cached 5 minutes so the globe never hammers either service.
import { ttlCache } from "@/lib/geo";

export type Hazard = { id: string; kind: string; title: string; lat: number; lon: number; mag: number | null; at: string; url: string | null; source: "USGS" | "NASA EONET" | "NASA FIRMS" };

const cache = ttlCache<Hazard[]>(5 * 60_000, 2);
// FIRMS state for the UI: no key -> "not_configured" (shown as a hint), never an error that breaks the layer.
let firms: "not_configured" | "ok" | "error" = "not_configured";
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
  // Optional: NASA FIRMS VIIRS active-fire pixels (free MAP_KEY), high confidence only, over the Middle East and
  // its sea lanes so the response stays small. Widen FIRMS_AREA (west,south,east,north) in .env.local if needed.
  const firmsKey = process.env.NASA_FIRMS_KEY?.trim();
  firms = firmsKey ? "error" : "not_configured";
  if (firmsKey) {
    try {
      const area = process.env.FIRMS_AREA ?? "25,5,65,40";
      const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(firmsKey)}/VIIRS_NOAA20_NRT/${area}/1`, opts);
      if (r.ok) {
        firms = "ok";
        const [head, ...rows] = (await r.text()).trim().split("\n");
        const col = Object.fromEntries(head.split(",").map((h, i) => [h, i]));
        for (const row of rows.slice(0, 5000)) {
          const c = row.split(",");
          if (c[col.confidence] !== "h") continue;
          out.push({ id: `firms-${c[col.latitude]}-${c[col.longitude]}-${c[col.acq_time]}`, kind: "firePixel", title: `VIIRS fire ${c[col.frp]} MW`,
            lat: Number(c[col.latitude]), lon: Number(c[col.longitude]), mag: Number(c[col.frp]) || null,
            at: `${c[col.acq_date]}T${String(c[col.acq_time]).padStart(4, "0").replace(/(\d\d)(\d\d)/, "$1:$2")}:00Z`, url: null, source: "NASA FIRMS" });
        }
      }
    } catch { /* FIRMS is optional; the other feeds still render */ }
  }
  if (!out.length) throw new Error("all hazard feeds unreachable");
  return out;
}

export async function GET() {
  try {
    const hazards = await cache("all", load);
    return Response.json({ count: hazards.length, firms, hazards }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "hazard feeds unreachable" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
