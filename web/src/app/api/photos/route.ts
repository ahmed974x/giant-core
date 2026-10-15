// Photos (ADR-030): recent Immich photos and their thumbnails, behind the PIN. The API key never reaches the browser.
import { makeThrottle } from "@/lib/director";
import { guard } from "@/lib/guard";
import { immichConfig, ping, recentPhotos, thumbnail } from "@/lib/immich";

const throttle = makeThrottle();

export async function GET(req: Request) {
  const blocked = guard(req, req.headers.get("x-omega-pin"), throttle);
  if (blocked) return blocked;
  let configured = false;
  try { configured = Boolean(immichConfig()); } catch (e) { return Response.json({ state: "misconfigured", error: (e as Error).message }); }
  if (!configured) return Response.json({ state: "not-configured", photos: [] });
  if (!(await ping())) return Response.json({ state: "offline", photos: [] });

  const id = new URL(req.url).searchParams.get("thumb");
  if (id) {
    try {
      const r = await thumbnail(id);
      if (!r.ok) return new Response(null, { status: r.status });
      return new Response(r.body, { headers: { "Content-Type": r.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=3600" } });
    } catch { return new Response(null, { status: 400 }); }
  }
  try { return Response.json({ state: "up", photos: await recentPhotos(90) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return Response.json({ state: "error", error: (e as Error).message, photos: [] }); }
}

export const dynamic = "force-dynamic";
