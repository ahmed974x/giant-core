// Profile of the signed-in user (ADR-075). GET reads it, POST saves it. Signed-in users only: the owner PIN has no
// profile, and a request without a session is refused.
import { directorData } from "@/lib/director";
import { authEnabled, loadProfile, saveProfile, userDir, validProfile } from "@/lib/accounts";
import { currentUserKey } from "@/lib/auth";

async function who(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { if (origin && new URL(origin).host !== host) return null; } catch { return null; }
  if (!authEnabled()) return null;
  const key = await currentUserKey().catch(() => null);
  return key ? userDir(directorData(), key) : null;
}

export async function GET(req: Request) {
  const dir = await who(req);
  if (!dir) return Response.json({ error: "sign in first" }, { status: 401 });
  return Response.json({ profile: await loadProfile(dir) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const dir = await who(req);
  if (!dir) return Response.json({ error: "sign in first" }, { status: 401 });
  try {
    const profile = validProfile(await req.json().catch(() => null));
    await saveProfile(dir, profile);
    return Response.json({ ok: true, profile });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}

export const dynamic = "force-dynamic";
