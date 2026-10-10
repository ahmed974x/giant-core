// Phoenix Protocol timeline for the Company screen (ADR-024). Read-only: the last 500 phoenix_events from the
// watchdog's SQLite log, summarised into current state per service and recent incidents.
import path from "node:path";
import { directorData } from "@/lib/director";
import { summarize, type PhoenixEvent } from "@/lib/phoenix";

export async function GET() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(directorData(), "phoenix.sqlite"), { readOnly: true });
    const rows = db.prepare("SELECT ts, service, action, result, detail FROM phoenix_events ORDER BY id DESC LIMIT 500").all() as PhoenixEvent[];
    db.close();
    return Response.json(summarize(rows), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ state: {}, lastRun: null, incidents: [], note: "Phoenix has not run yet" });
  }
}

export const dynamic = "force-dynamic";
