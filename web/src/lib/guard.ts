// Shared guard for private routes: same origin, wrong-PIN throttle, and the DIRECTOR_WEB_PIN from web/.env.local.
import { makeThrottle, pinOk } from "./director.ts";

export type Throttle = ReturnType<typeof makeThrottle>;

/** null when the request may proceed; otherwise the response to send. */
export function guard(req: Request, pin: unknown, throttle: Throttle, env = process.env): Response | null {
  const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { if (origin && new URL(origin).host !== host) return Response.json({ error: "forbidden" }, { status: 403 }); }
  catch { return Response.json({ error: "forbidden" }, { status: 403 }); }
  const id = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (throttle.blocked(id)) return Response.json({ error: "too many wrong PINs; try again in 15 minutes" }, { status: 429 });
  if (!env.DIRECTOR_WEB_PIN) return Response.json({ error: "locked: set DIRECTOR_WEB_PIN in web/.env.local" }, { status: 403 });
  if (!pinOk(pin, env.DIRECTOR_WEB_PIN)) { throttle.fail(id); return Response.json({ error: "wrong PIN" }, { status: 401 }); }
  return null;
}
