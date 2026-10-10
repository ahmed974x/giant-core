// Director 00 approval inbox for the web (ADR-023).
// GET  : pending / escalated proposals and recent rejections, read straight from the SQLite ledger.
// POST : ask / approve / confirm / reject, only with the DIRECTOR_WEB_PIN (web/.env.local), same-origin, throttled.
//        Every change runs through Director 00's own CLI, so the two-level gate and risk policy still decide.
import path from "node:path";
import { cliArgs, directorDir, makeThrottle, pinOk, runDirector } from "@/lib/director";

const throttle = makeThrottle();

function client(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export async function GET() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(directorDir(), "data", "director.sqlite"), { readOnly: true });
    const pending = db.prepare("SELECT thread_id, request, proposal, status, risk, created_at FROM director_approvals " +
      "WHERE status IN ('pending','escalated') ORDER BY created_at DESC LIMIT 50").all() as Record<string, string>[];
    const rejections = db.prepare("SELECT thread_id, code, stage, reason, rejected_by, created_at FROM director_rejections " +
      "ORDER BY id DESC LIMIT 20").all();
    db.close();
    return Response.json({
      writable: Boolean(process.env.DIRECTOR_WEB_PIN),
      pending: pending.map(p => ({ ...p, proposal: JSON.parse(p.proposal), risk: JSON.parse(p.risk || "{}"),
        type_to_confirm: p.status === "escalated" ? `CONFIRM ${p.thread_id.slice(-4).toUpperCase()}` : null })),
      rejections,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ writable: Boolean(process.env.DIRECTOR_WEB_PIN), pending: [], rejections: [], note: "Director 00 has no ledger yet" });
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { if (origin && new URL(origin).host !== host) return Response.json({ error: "forbidden" }, { status: 403 }); }
  catch { return Response.json({ error: "forbidden" }, { status: 403 }); }

  const id = client(req);
  if (throttle.blocked(id)) return Response.json({ error: "too many wrong PINs; try again in 15 minutes" }, { status: 429 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!process.env.DIRECTOR_WEB_PIN) return Response.json({ error: "web approvals are off: set DIRECTOR_WEB_PIN in web/.env.local" }, { status: 403 });
  if (!pinOk(body?.pin, process.env.DIRECTOR_WEB_PIN)) {
    throttle.fail(id);
    return Response.json({ error: "wrong PIN" }, { status: 401 });
  }
  let args: string[];
  try { args = cliArgs(body); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  try {
    return Response.json(await runDirector(args));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}

export const dynamic = "force-dynamic";
