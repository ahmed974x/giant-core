// Upcoming rocket launches (Launch Library 2, keyless free tier; ADR-053). Cached for an hour.
import { launches } from "@/lib/spaceair";

export async function GET() {
  try {
    const list = await launches();
    return Response.json({ source: "Launch Library 2 (The Space Devs)", count: list.length, launches: list }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Launch Library unreachable" }, { status: 503 }); }
}

export const dynamic = "force-dynamic";
