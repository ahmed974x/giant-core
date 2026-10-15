// Oracle (ADR-057, ADR-058). POST {pin, question, lang}: web search + OMEGA's live context + free models via Cortex.
// Answers as a server-sent event stream so the screen shows each step as it happens: "searching", the sources as soon
// as they are found, "thinking", then the answer. Needs the PIN, is throttled, and answers one question at a time.
import { makeThrottle } from "@/lib/director";
import { guard } from "@/lib/guard";
import { answerWith, webSearch } from "@/lib/oracle";
import { GET as pulseGET } from "../worldpulse/route";
import { GET as oilGET } from "../oilwatch/route";

const throttle = makeThrottle();
let busy = 0;

async function context(): Promise<string> {
  const json = (p: Promise<Response>) => p.then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [pulse, oil] = await Promise.all([json(pulseGET()), json(oilGET())]);
  const lean = ((pulse?.lean ?? []) as { asset: string; net: number }[]).filter(l => l.net).map(l => `${l.asset} ${l.net > 0 ? "+" : ""}${l.net}`).join(", ");
  const top = ((pulse?.drivers ?? []) as { kind: string; title: string; region: string }[]).slice(0, 5).map(d => `${d.kind}: ${d.title} (${d.region})`).join("; ");
  return [`World Pulse lean: ${lean || "none"}`, `Top events: ${top || "none"}`, `Oil Watch: ${oil?.signal?.level ?? "unknown"}`].join("\n");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { pin?: unknown; question?: unknown; lang?: unknown } | null;
  const blocked = guard(req, body?.pin, throttle);
  if (blocked) return blocked;
  const q = typeof body?.question === "string" ? body.question.trim() : "";
  if (q.length < 2 || q.length > 500) return Response.json({ error: "ask a question of 2 to 500 characters" }, { status: 400 });
  if (busy >= 1) return Response.json({ error: "Oracle is answering another question; try again in a moment" }, { status: 429 });
  const lang = body?.lang === "en" ? "en" : "ar";
  busy++;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        send("stage", { stage: "searching" });
        const [sources, ctx] = await Promise.all([webSearch(q, 4), context()]);
        send("sources", sources);
        send("stage", { stage: "thinking" });
        send("answer", await answerWith(q, sources, ctx, lang));
      } catch (e) { send("error", { error: (e as Error).message.slice(0, 160) }); }
      finally { busy--; ctrl.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

export const dynamic = "force-dynamic";
