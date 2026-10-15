// Deep Research (ADR-061). POST { question, depth: "quick" | "deep" } streams NDJSON events (one JSON per line) so
// the Search screen can draw the agent graph live: stage starts/ends, the plan, the numbered sources, then the
// checked answer. Same-origin only, two runs at a time, read-only (it only reads public sources and models).
import { research, type Event } from "@/lib/deep-research/pipeline";

let running = 0;
const MAX_RUNS = 2;

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { if (origin && new URL(origin).host !== host) return Response.json({ error: "forbidden" }, { status: 403 }); }
  catch { return Response.json({ error: "forbidden" }, { status: 403 }); }

  const body = (await req.json().catch(() => ({}))) as { question?: unknown; depth?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 3 || question.length > 600) return Response.json({ error: "question must be 3-600 characters" }, { status: 400 });
  const depth = body.depth === "deep" ? "deep" : "quick";
  if (running >= MAX_RUNS) return Response.json({ error: "busy: two research runs are already going" }, { status: 429 });

  running++;
  const enc = new TextEncoder();
  const ctrl = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (e: Event | { type: "done"; ms: number }) => { try { c.enqueue(enc.encode(`${JSON.stringify(e)}\n`)); } catch { /* client left */ } };
      const t0 = Date.now();
      try {
        await research(question, send, { depth, signal: ctrl.signal });
      } catch (e) {
        send({ type: "error", message: (e as Error).message.slice(0, 200) });
      } finally {
        send({ type: "done", ms: Date.now() - t0 });
        running--;
        try { c.close(); } catch { /* already closed */ }
      }
    },
    cancel() { ctrl.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

export const dynamic = "force-dynamic";
export const maxDuration = 600;
