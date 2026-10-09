// Public webcams (weather, ports, beaches, city views) from the Windy Webcams API (free key in WINDY_WEBCAMS_KEY).
// Only cameras their owners publish on Windy; no private or CCTV feeds (ADR 006).
import { parseView, ttlCache } from "@/lib/geo";

export type Webcam = { id: string; title: string; lat: number; lon: number; preview: string | null; url: string | null; status: string };
const cache = ttlCache<Webcam[]>(10 * 60_000);

type WindyCam = { webcamId: number; title: string; status: string; location?: { latitude: number; longitude: number };
  images?: { current?: { preview?: string } }; urls?: { detail?: string } };

export async function GET(req: Request) {
  const key = process.env.WINDY_WEBCAMS_KEY;
  if (!key) return Response.json({ configured: false, webcams: [] });
  const v = parseView(req.url, 250);
  if (!v) return Response.json({ error: "lat, lon required" }, { status: 400 });
  try {
    const webcams = await cache(`${v.lat},${v.lon},${v.radiusKm}`, async () => {
      const q = new URLSearchParams({ nearby: `${v.lat},${v.lon},${v.radiusKm}`, include: "location,images,urls", limit: "50" });
      const r = await fetch(`https://api.windy.com/webcams/api/v3/webcams?${q}`, {
        headers: { "x-windy-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store",
      });
      if (!r.ok) throw new Error(`windy ${r.status}`);
      const { webcams: list = [] } = (await r.json()) as { webcams?: WindyCam[] };
      return list.filter(c => c.location).map(c => ({
        id: String(c.webcamId), title: c.title, lat: c.location!.latitude, lon: c.location!.longitude,
        preview: c.images?.current?.preview ?? null, url: c.urls?.detail ?? null, status: c.status,
      }));
    });
    return Response.json({ configured: true, source: "windy.com", count: webcams.length, webcams });
  } catch {
    return Response.json({ configured: true, error: "webcam feed unreachable", webcams: [] }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
