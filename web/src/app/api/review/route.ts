// Review (ADR-032): GET shows the items with their fingerprints and Ahmad's last approval; POST records an approval.
// Both need the PIN. Nothing here edits the reviewed files; changes to them still go through code review.
import path from "node:path";
import { directorDir, makeThrottle } from "@/lib/director";
import { guard } from "@/lib/guard";
import { approve, loadItems, readLog } from "@/lib/review";

const throttle = makeThrottle();
const root = () => path.resolve(directorDir(), "..", "..");
const logFile = () => path.join(directorDir(), "data", "reviews.json");

export async function GET(req: Request) {
  const blocked = guard(req, req.headers.get("x-omega-pin"), throttle);
  if (blocked) return blocked;
  return Response.json({ items: await loadItems(root(), await readLog(logFile())) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { pin?: unknown; id?: unknown; hash?: unknown } | null;
  const blocked = guard(req, body?.pin, throttle);
  if (blocked) return blocked;
  try { return Response.json({ ok: true, approval: await approve(root(), logFile(), body?.id, body?.hash, "web:Ahmad") }); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 409 }); }
}

export const dynamic = "force-dynamic";
