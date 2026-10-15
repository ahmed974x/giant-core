// Public webcams on the globe. Keyless open-data cameras from transport agencies (Fintraffic, TfL, Caltrans, Iceland;
// ADR-046, ADR-050) always, plus Windy's published webcams when WINDY_WEBCAMS_KEY is set. Each camera carries what is
// happening near it. Only cameras their owners publish; no private feeds and no image analysis (ADR 006).
import { parseView, ttlCache } from "@/lib/geo";
import { nearbyFor, openCamsNear, type Happening, type Webcam } from "@/lib/opencams";
import { gulfViews } from "@/lib/gulfviews";
import { distanceKm } from "@/lib/geo";
import { GET as hazardsGET } from "../hazards/route";
import { GET as pulseGET } from "../worldpulse/route";

// Camera news bots (ADR-050): what is happening around the cameras, from the hazards feed (USGS, NASA EONET and FIRMS)
// and World Pulse (GDACS alerts, USGS M6+, GDELT conflict). Both are cached upstream, so this adds no extra load.
async function happenings(): Promise<Happening[]> {
  const json = (p: Promise<Response>) => p.then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [hz, pulse] = await Promise.all([json(hazardsGET()), json(pulseGET())]);
  const a = ((hz?.hazards ?? []) as { kind: string; title: string; lat: number; lon: number; source: string; at: string; url: string | null; mag: number | null }[])
    .map(h => ({ kind: h.kind, title: h.title, lat: h.lat, lon: h.lon, source: h.source, at: h.at, url: h.url, mag: h.mag }));
  const b = ((pulse?.drivers ?? []) as { kind: string; title: string; lat: number; lon: number; source: string; at: string; url: string | null }[])
    .filter(d => d.source !== "USGS")   // already in the hazards feed
    .map(d => ({ kind: d.kind, title: d.title, lat: d.lat, lon: d.lon, source: d.source, at: d.at, url: d.url }));
  return [...a, ...b];
}

const cache = ttlCache<Webcam[]>(10 * 60_000);

type WindyCam = { webcamId: number; title: string; status: string; location?: { latitude: number; longitude: number };
  images?: { current?: { preview?: string } }; urls?: { detail?: string } };

async function windy(key: string, lat: number, lon: number, radiusKm: number): Promise<Webcam[]> {
  return cache(`${lat},${lon},${radiusKm}`, async () => {
    const q = new URLSearchParams({ nearby: `${lat},${lon},${radiusKm}`, include: "location,images,urls", limit: "50" });
    const r = await fetch(`https://api.windy.com/webcams/api/v3/webcams?${q}`, {
      headers: { "x-windy-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!r.ok) throw new Error(`windy ${r.status}`);
    const { webcams: list = [] } = (await r.json()) as { webcams?: WindyCam[] };
    return list.filter(c => c.location).map(c => ({
      id: String(c.webcamId), title: c.title, lat: c.location!.latitude, lon: c.location!.longitude,
      preview: c.images?.current?.preview ?? null, url: c.urls?.detail ?? null, status: c.status, source: "windy",
    }));
  });
}

export async function GET(req: Request) {
  const v = parseView(req.url, 250);
  if (!v) return Response.json({ error: "lat, lon required" }, { status: 400 });
  const key = process.env.WINDY_WEBCAMS_KEY;
  const [open, keyed] = await Promise.all([
    openCamsNear(v.lat, v.lon, v.radiusKm).catch(() => [] as Webcam[]),
    key ? windy(key, v.lat, v.lon, v.radiusKm).catch(() => [] as Webcam[]) : Promise.resolve([] as Webcam[]),
  ]);
  const all = await happenings();
  const gulf = gulfViews().filter(g => distanceKm(v.lat, v.lon, g.lat, g.lon) <= v.radiusKm);
  const webcams = [...gulf, ...keyed, ...open].map(w => ({ ...w, nearby: nearbyFor(w, all) }));
  const sources = [...new Set(webcams.map(w => w.source))];
  return Response.json({ configured: true, windy: !!key, sources, count: webcams.length, withNews: webcams.filter(w => w.nearby.length).length, webcams }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
