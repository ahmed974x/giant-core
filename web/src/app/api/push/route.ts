// Phone alerts (ADR-035). GET: the VAPID public key the phone needs to subscribe (public by design).
// POST (PIN): subscribe, unsubscribe, or send a test notification.
import path from "node:path";
import { directorData, makeThrottle } from "@/lib/director";
import { guard } from "@/lib/guard";
import { broadcast, loadStore, saveSubs } from "@/lib/alerts";
import { validSubscription } from "@/lib/webpush";

const throttle = makeThrottle();
const dir = () => path.join(directorData(), "push");

export async function GET() {
  const store = await loadStore(dir());
  return Response.json({ publicKey: store.vapid.publicKey, subscribed: store.subs.length }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { pin?: unknown; action?: string; subscription?: unknown; endpoint?: unknown } | null;
  const blocked = guard(req, body?.pin, throttle);
  if (blocked) return blocked;
  const store = await loadStore(dir());
  try {
    if (body?.action === "subscribe") {
      const sub = validSubscription(body.subscription);
      await saveSubs(dir(), [...store.subs.filter(s => s.endpoint !== sub.endpoint), sub]);
      return Response.json({ ok: true });
    }
    if (body?.action === "unsubscribe") {
      await saveSubs(dir(), store.subs.filter(s => s.endpoint !== body.endpoint));
      return Response.json({ ok: true });
    }
    if (body?.action === "test") {
      if (!store.subs.length) return Response.json({ error: "no phone is subscribed yet" }, { status: 409 });
      const r = await broadcast(dir(), store, { title: "OMEGA PRIME", body: "Alerts are on. You'll hear about approvals and Phoenix incidents here.", url: "/ar", tag: "test" });
      return Response.json({ ok: r.sent > 0, ...r });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}

export const dynamic = "force-dynamic";
