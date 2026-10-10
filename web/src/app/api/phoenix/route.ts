// Phoenix Protocol timeline for the Company screen (ADR-024). Read-only: the last 500 phoenix_events from the
// watchdog's SQLite log, summarised into current state per service and recent incidents.
import path from "node:path";
import { directorData } from "@/lib/director";
import { summarize, type PhoenixEvent } from "@/lib/phoenix";
import { phoenixEvents } from "@/lib/ledger";

export async function GET() {
  try {
    const rows = await phoenixEvents(directorData(), 500) as PhoenixEvent[];
    if (!rows.length) throw new Error("empty");
    return Response.json(summarize(rows), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ state: {}, lastRun: null, incidents: [], note: "Phoenix has not run yet" });
  }
}

export const dynamic = "force-dynamic";
