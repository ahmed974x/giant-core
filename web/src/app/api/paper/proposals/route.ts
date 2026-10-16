// Paper proposal queue (ADR-073). GET: pending and recent proposals. POST: scan (build proposals from today's strategy
// signals), approve (fill one on paper) or reject. Everything needs the PIN, and approve is the only path that writes a
// fill: it runs once per tap, for one proposal. Made-up USDT only; nothing here can reach an exchange or move money.
import { directorData, makeThrottle } from "@/lib/director";
import { guard } from "@/lib/guard";
import { fetchPrices } from "@/lib/sweeper";
import { appendEvent, loadEvents, replay, serial } from "@/lib/paper";
import { appendProposalEvent, approve, loadProposalEvents, proposalsFromSignals, reject, replayProposals, validId } from "@/lib/paper-proposals";
import type { Result } from "@/lib/strategies";
import { GET as strategiesGET } from "../../strategies/route";

const throttle = makeThrottle();
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "PAXGUSDT"];
const INTERVAL = "1d";
const BY = "web:Ahmad";

async function rows() {
  const all = replayProposals(await loadProposalEvents(directorData()));
  return { pending: all.filter(r => r.status === "pending"), recent: all.filter(r => r.status !== "pending").slice(0, 20) };
}

export async function GET(req: Request) {
  const blocked = guard(req, req.headers.get("x-omega-pin"), throttle);
  if (blocked) return blocked;
  return Response.json(await rows(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { pin?: unknown; action?: unknown; id?: unknown; reason?: unknown } | null;
  const blocked = guard(req, body?.pin, throttle);
  if (blocked) return blocked;
  const dir = directorData();
  try {
    if (body?.action === "scan") {
      const added = await serial(async () => {
        const account = replay(await loadEvents(dir));
        let pending = replayProposals(await loadProposalEvents(dir));
        let n = 0;
        for (const symbol of SYMBOLS) {
          const r = await strategiesGET(new Request(`http://local/api/strategies?symbol=${symbol}&interval=${INTERVAL}`));
          if (!r.ok) continue;
          const j = await r.json() as { price?: number; results?: Result[] };
          if (!(Number(j.price) > 0) || !j.results) continue;
          for (const p of proposalsFromSignals({ symbol, interval: INTERVAL, price: Number(j.price), results: j.results, account, pending })) {
            await appendProposalEvent(dir, { type: "proposed", ...p });
            n++;
          }
          pending = replayProposals(await loadProposalEvents(dir));
        }
        return n;
      });
      return Response.json({ ok: true, added, ...(await rows()) });
    }
    if (body?.action === "approve") {
      const id = validId(body.id);
      const fill = await serial(async () => {
        const row = replayProposals(await loadProposalEvents(dir)).find(r => r.id === id);
        const prices = row ? await fetchPrices([row.symbol]).catch(() => ({} as Record<string, number>)) : {};
        const { fill, event } = approve(row, replay(await loadEvents(dir)), row ? prices[row.symbol] : NaN, BY);
        await appendEvent(dir, { type: "fill", ...fill });
        await appendProposalEvent(dir, event);
        return fill;
      });
      return Response.json({ ok: true, fill, ...(await rows()) });
    }
    if (body?.action === "reject") {
      const id = validId(body.id);
      await serial(async () => {
        const row = replayProposals(await loadProposalEvents(dir)).find(r => r.id === id);
        await appendProposalEvent(dir, reject(row, BY, body.reason));
      });
      return Response.json({ ok: true, ...(await rows()) });
    }
    return Response.json({ error: "action must be scan, approve or reject" }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}

export const dynamic = "force-dynamic";
