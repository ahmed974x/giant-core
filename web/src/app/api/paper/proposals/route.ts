// Paper proposal queue (ADR-073). GET: pending and recent proposals. POST: scan (build proposals from today's strategy
// signals), approve (fill one on paper) or reject. Everything needs the owner PIN or a signed-in user (ADR-075), and approve is the only path that writes a
// fill (approveAndRecord): it runs once per tap, for one proposal. Made-up USDT only; nothing here can reach an exchange or move money.
import { directorData, makeThrottle } from "@/lib/director";
import { access } from "@/lib/accounts";
import { currentUserKey } from "@/lib/auth";
import { fetchPrices } from "@/lib/sweeper";
import { serial } from "@/lib/paper";
import { appendProposalEvent, approveAndRecord, loadProposalEvents, reject, replayProposals, scan, validId } from "@/lib/paper-proposals";
import { GET as strategiesGET } from "../../strategies/route";

const throttle = makeThrottle();

async function rows(dir: string) {
  const all = replayProposals(await loadProposalEvents(dir));
  return { pending: all.filter(r => r.status === "pending"), recent: all.filter(r => r.status !== "pending").slice(0, 20) };
}

export async function GET(req: Request) {
  const who = await access(req, req.headers.get("x-omega-pin"), throttle, directorData(), currentUserKey);
  if ("blocked" in who) return who.blocked;
  return Response.json(await rows(who.actor.dataDir), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { pin?: unknown; action?: unknown; id?: unknown; reason?: unknown } | null;
  const who = await access(req, body?.pin, throttle, directorData(), currentUserKey);
  if ("blocked" in who) return who.blocked;
  const dir = who.actor.dataDir, BY = who.actor.by;
  try {
    if (body?.action === "scan") {
      const added = await scan(dir, async (symbol, interval) => {
        const r = await strategiesGET(new Request(`http://local/api/strategies?symbol=${symbol}&interval=${interval}`));
        return r.ok ? r.json() : null;
      });
      return Response.json({ ok: true, added: added.length, ...(await rows(dir)) });
    }
    if (body?.action === "approve") {
      const fill = await approveAndRecord(dir, validId(body.id), async s => (await fetchPrices([s]))[s], BY);
      return Response.json({ ok: true, fill, ...(await rows(dir)) });
    }
    if (body?.action === "reject") {
      const id = validId(body.id);
      await serial(async () => {
        const row = replayProposals(await loadProposalEvents(dir)).find(r => r.id === id);
        await appendProposalEvent(dir, reject(row, BY, body.reason));
      });
      return Response.json({ ok: true, ...(await rows(dir)) });
    }
    return Response.json({ error: "action must be scan, approve or reject" }, { status: 400 });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}

export const dynamic = "force-dynamic";
