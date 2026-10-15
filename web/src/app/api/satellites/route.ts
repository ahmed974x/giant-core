// Satellites (ADR-049). GET: live positions of every loaded satellite. GET ?id=NORAD: that satellite's details and
// its ground track for the next orbit. Keyless public data (CelesTrak), positions computed here with SGP4.
import { groundTrack, loadSats, positionOf, type SatPos } from "@/lib/satellites";

export async function GET(req: Request) {
  const sats = await loadSats();
  const now = new Date();
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (id) {
    const s = sats.find(x => x.id === id);
    if (!s) return Response.json({ error: "unknown satellite" }, { status: 404 });
    return Response.json({ ...positionOf(s, now), track: groundTrack(s, now), periodMin: Math.round((2 * Math.PI) / s.rec.no) },
      { headers: { "Cache-Control": "no-store" } });
  }
  const positions = sats.map(s => positionOf(s, now)).filter((p): p is SatPos => p != null);
  return Response.json({ source: "CelesTrak + SGP4", at: now.toISOString(), count: positions.length, satellites: positions },
    { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
