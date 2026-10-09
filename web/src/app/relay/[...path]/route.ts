// Server-side proxy to the OMEGA relay. The browser only ever talks to this app's origin,
// so the relay's same-origin and CSP rules hold and no relay URL leaks to the client.
const RELAY = process.env.RELAY_URL ?? "http://127.0.0.1:8088";
const GET_PATHS = /^(status|healthz|events|quant|agents|brain|brain\/jobs\/[0-9a-f]{12}|geo\/nodes(\/search|\/near)?|plugins\.json)$/;
const POST_PATHS = new Set(["brain/ask"]);

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: Request, path: string, init: RequestInit): Promise<Response> {
  const search = new URL(req.url).search;
  try {
    const r = await fetch(`${RELAY}/${path}${search}`, { ...init, cache: "no-store" });
    const headers = new Headers({ "Content-Type": r.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" });
    return new Response(r.body, { status: r.status, headers });
  } catch {
    return Response.json({ error: "relay unreachable" }, { status: 503 });
  }
}

export async function GET(req: Request, { params }: Ctx) {
  const path = (await params).path.join("/");
  if (!GET_PATHS.test(path)) return Response.json({ error: "not found" }, { status: 404 });
  const accept = path === "events" ? "text/event-stream" : "application/json";
  return forward(req, path, {
    headers: { Accept: accept, "Accept-Language": req.headers.get("accept-language") ?? "en" },
    signal: path === "events" ? req.signal : AbortSignal.timeout(8000),
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const path = (await params).path.join("/");
  if (!POST_PATHS.has(path)) return Response.json({ error: "not found" }, { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: "forbidden" }, { status: 403 });
  const body = await req.text();
  if (body.length > 16384) return Response.json({ error: "too large" }, { status: 413 });
  return forward(req, path, { method: "POST", body, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000) });
}

export const dynamic = "force-dynamic";
