// Paper trading (ADR-044). GET: the practice account valued at live prices. POST: a market order or a reset. Both need
// the owner PIN or a signed-in user (ADR-075); each user has their own paper account. Made-up USDT only: nothing here can reach an exchange's trading API or move money.
import { directorData, makeThrottle } from "@/lib/director";
import { access } from "@/lib/accounts";
import { currentUserKey } from "@/lib/auth";
import { fetchPrices } from "@/lib/sweeper";
import { appendEvent, assertPaper, fillOrder, loadEvents, replay, serial, snapshot, validStart, type Order } from "@/lib/paper";

const throttle = makeThrottle();

async function view(dir: string) {
  const acc = replay(await loadEvents(dir));
  let prices: Record<string, number> = {}, priceError: string | null = null;
  try { prices = await fetchPrices(acc.holdings.map(h => h.symbol)); } catch (e) { priceError = (e as Error).message; }
  const snap = snapshot(acc, prices);
  return { ...snap, fills: snap.fills.slice(-25).reverse(), fillCount: snap.fills.length, priceError };
}

export async function GET(req: Request) {
  const who = await access(req, req.headers.get("x-omega-pin"), throttle, directorData(), currentUserKey);
  if ("blocked" in who) return who.blocked;
  return Response.json(await view(who.actor.dataDir), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as ({ pin?: unknown; action?: unknown; start_usd?: unknown } & Partial<Order>) | null;
  const who = await access(req, body?.pin, throttle, directorData(), currentUserKey);
  if ("blocked" in who) return who.blocked;
  const dir = who.actor.dataDir;
  try {
    if (body?.action === "reset") {
      const start_usd = validStart(body.start_usd);
      await serial(() => appendEvent(dir, { type: "reset", at: new Date().toISOString(), start_usd }));
      return Response.json({ ok: true, account: await view(dir) });
    }
    if (body?.action !== "order") return Response.json({ error: "action must be order or reset" }, { status: 400 });
    const { pin: _pin, action: _action, ...raw } = body;
    assertPaper(raw);
    const fill = await serial(async () => {
      const acc = replay(await loadEvents(dir));
      const symbol = String(body.symbol ?? "").toUpperCase();
      const prices = await fetchPrices([symbol]).catch(() => ({} as Record<string, number>));
      const f = fillOrder(acc, { symbol, side: body.side as Order["side"], usd: body.usd, qty: body.qty, mode: "paper" }, prices[symbol]);
      await appendEvent(dir, { type: "fill", ...f });
      return f;
    });
    return Response.json({ ok: true, fill, account: await view(dir) });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}

export const dynamic = "force-dynamic";
