// Profit Sweeper (ADR-033). GET: the plan for Ahmad's positions under his rules. POST: send the plan to Director 00 as
// a proposal. Both need the PIN. Nothing here trades or moves money.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { directorData, directorDir, makeThrottle, runDirector } from "@/lib/director";
import { guard } from "@/lib/guard";
import { fetchPrices, planSweep, sweepRequest, validPositions, validRules, type Plan } from "@/lib/sweeper";

const throttle = makeThrottle();
const rulesFile = () => path.resolve(directorDir(), "..", "sweeper", "rules.json");
const positionsFile = () => path.join(directorData(), "positions.json");

async function build(): Promise<{ state: string; plan?: Plan; error?: string }> {
  const rules = validRules(JSON.parse(await readFile(rulesFile(), "utf8")));
  let raw: string;
  try { raw = await readFile(positionsFile(), "utf8"); } catch { return { state: "no-positions" }; }
  const positions = validPositions(JSON.parse(raw));
  try { return { state: "ok", plan: planSweep(positions, await fetchPrices(positions.map(p => p.symbol)), rules) }; }
  catch (e) { return { state: "no-prices", error: (e as Error).message }; }
}

export async function GET(req: Request) {
  const blocked = guard(req, req.headers.get("x-omega-pin"), throttle);
  if (blocked) return blocked;
  try { return Response.json(await build(), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return Response.json({ state: "error", error: (e as Error).message }); }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { pin?: unknown } | null;
  const blocked = guard(req, body?.pin, throttle);
  if (blocked) return blocked;
  try {
    const out = await build();
    const request = out.plan ? sweepRequest(out.plan) : null;
    if (!request) return Response.json({ error: "nothing to sweep under the current rules" }, { status: 409 });
    const r = await runDirector(["ask", request]) as { thread_id: string; status: string };
    return Response.json({ ok: true, thread_id: r.thread_id, status: r.status });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
}

export const dynamic = "force-dynamic";
