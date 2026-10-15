// Live civil aircraft from adsb.lol (community ADS-B network, open data under ODbL, no key).
// Per ADR 006, military aircraft and owners who opted out of tracking (LADD / PIA) are dropped server-side.
import { parseView, ttlCache } from "@/lib/geo";

const NM_PER_KM = 0.539957;
const HIDDEN = 1 | 4 | 8; // dbFlags: 1 military, 4 PIA, 8 LADD
const cache = ttlCache<Flight[]>(10_000);

export type Flight = {
  id: string; callsign: string | null; reg: string | null; type: string | null;
  lat: number; lon: number; track: number; altFt: number | null; speedKt: number | null; ground: boolean;
};

type Ac = { hex: string; flight?: string; r?: string; t?: string; lat?: number; lon?: number; track?: number; true_heading?: number;
  alt_baro?: number | "ground"; gs?: number; dbFlags?: number };

export async function GET(req: Request) {
  const v = parseView(req.url, 460);
  if (!v) return Response.json({ error: "lat, lon required" }, { status: 400 });
  const nm = Math.round(v.radiusKm * NM_PER_KM);
  try {
    const flights = await cache(`${v.lat},${v.lon},${nm}`, async () => {
      const r = await fetch(`https://api.adsb.lol/v2/point/${v.lat}/${v.lon}/${nm}`, {
        headers: { Accept: "application/json", "User-Agent": "omega-prime/0.1 (personal research dashboard)" },
        signal: AbortSignal.timeout(8000), cache: "no-store",
      });
      if (!r.ok) throw new Error(`adsb.lol ${r.status}`);
      const { ac = [] } = (await r.json()) as { ac?: Ac[] };
      return ac
        .filter(a => typeof a.lat === "number" && typeof a.lon === "number" && !((a.dbFlags ?? 0) & HIDDEN))
        .slice(0, 1500)
        .map(a => ({
          id: a.hex, callsign: a.flight?.trim() || null, reg: a.r ?? null, type: a.t ?? null,
          lat: a.lat!, lon: a.lon!, track: a.track ?? a.true_heading ?? 0,
          altFt: typeof a.alt_baro === "number" ? a.alt_baro : null, speedKt: a.gs ?? null, ground: a.alt_baro === "ground",
        }));
    });
    return Response.json({ source: "adsb.lol", count: flights.length, flights }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "flight feed unreachable" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
