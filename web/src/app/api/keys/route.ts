// Data keys (ADR-041). GET (PIN): which keys are filled in web/.env.local and loaded into the app.
// POST (PIN): load them into the running app (no restart) and test each one against its service.
// Values are never returned; only set/unset, length and the test verdict.
import { makeThrottle } from "@/lib/director";
import { guard } from "@/lib/guard";
import { applyKeys, readEnvFile, testKey, type KeyName } from "@/lib/keys";

const throttle = makeThrottle();

export async function GET(req: Request) {
  const blocked = guard(req, req.headers.get("x-omega-pin"), throttle);
  if (blocked) return blocked;
  const file = await readEnvFile();
  const status = applyKeys(file, { ...process.env });   // dry view: don't touch the live env on a GET
  return Response.json({ keys: status.map(s => ({ ...s, loaded: Boolean(process.env[s.name]?.trim()) && process.env[s.name] === file[s.name]?.trim() })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { pin?: unknown } | null;
  const blocked = guard(req, body?.pin, throttle);
  if (blocked) return blocked;
  const status = applyKeys(await readEnvFile());
  const tested = await Promise.all(status.map(async s => ({ ...s, ...(await testKey(s.name as KeyName, process.env[s.name]?.trim() ?? "")) })));
  return Response.json({ keys: tested }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
