// Military aircraft broadcasting publicly (adsb.lol /v2/mil, keyless; ADR-053). Worldwide, cached 20 s.
import { military } from "@/lib/spaceair";

export async function GET() {
  try {
    const list = await military();
    return Response.json({ source: "adsb.lol", count: list.length, military: list }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "adsb.lol unreachable" }, { status: 503 }); }
}

export const dynamic = "force-dynamic";
