import { aisStatus, openShipsNear, shipsNear } from "@/lib/ais";
import { parseView } from "@/lib/geo";

// AISStream when its key works (the watched choke-points); otherwise, and alongside it, the keyless Baltic feed (ADR-045).
export async function GET(req: Request) {
  const v = parseView(req.url, 3000);
  if (!v) return Response.json({ error: "lat, lon required" }, { status: 400 });
  const s = aisStatus();
  const keyed = s.configured ? shipsNear(v.lat, v.lon, v.radiusKm) : [];
  const seen = new Set(keyed.map(x => x.mmsi));
  const open = (await openShipsNear(v.lat, v.lon, v.radiusKm)).filter(x => !seen.has(x.mmsi));
  const list = [...keyed, ...open];
  const status = s.status === "live" || open.length ? "live" : s.configured ? s.status : "live";
  const source = [s.status === "live" ? "aisstream.io" : null, "digitraffic.fi (Baltic)"].filter(Boolean).join(" + ");
  return Response.json({ configured: true, status, source, aisstream: s.configured ? s.status : "off", count: list.length, ships: list }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
