import { aisStatus, shipsNear } from "@/lib/ais";
import { parseView } from "@/lib/geo";

export async function GET(req: Request) {
  const v = parseView(req.url, 3000);
  if (!v) return Response.json({ error: "lat, lon required" }, { status: 400 });
  const s = aisStatus();
  if (!s.configured) return Response.json({ configured: false, status: "off", ships: [] });
  const list = shipsNear(v.lat, v.lon, v.radiusKm);
  return Response.json({ configured: true, status: s.status, source: "aisstream.io", count: list.length, ships: list }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
