// Paper trading (ADR-044). GET: the practice account valued at live prices. POST: a market order or a reset. Both need
// the PIN. Made-up USDT only: nothing here can reach an exchange's trading API or move money.
import { directorData, makeThrottle } from "@/lib/director";
import { guard } from "@/lib/guard";
import { fetchPrices } from "@/lib/sweeper";
import { appendEvent, fillOrder, loadEvents, replay, snapshot, validStart, type Order } from "@/lib/paper";

const throttle = makeThrottle();
// One write at a time, so two quick taps can't both spend the same paper cash.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>) => { const p = queue.then(fn, fn); queue = p.catch(() => null); return p; };

async function view() {
  const acc = replay(await loadEvents(directorData()));
  let prices: Record<string, number> = {}, priceError: string | null = null;
  try { prices = await fetchPrices(acc.holdings.map(h => h.symbol)); } catch (e) { priceError = (e as Error).message; }
  const snap = snapshot(acc, prices);
  return { ...snap, fills: snap.fills.slice(-25).reverse(), fillCount: snap.fills.length, priceError };
}

export async function GET(req: Request) {
  const blocked = guard(req, req.headers.get("x-omega-pin"), throttle);
  if (blocked) return blocked;
  return Response.json(await view(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as ({ pin?: unknown; action?: unknown; start_usd?: unknown } & Partial<Order>) | null;
  const blocked = guard(req, body?.pin, throttle);
  if (blocked) return blocked;
  try {
    if (body?.action === "reset") {
      const start_usd = validStart(body.start_usd);
      await serial(() => appendEvent(directorData(), { type: "reset", at: new Date().toISOString(), start_usd }));
      return Response.json({ ok: true, account: await view() });
    }
    if (body?.action !== "order") return Response.json({ error: "action must be order or reset" }, { status: 400 });
    const fill = await serial(async () => {
      const acc = replay(await loadEvents(directorData()));
      const symbol = String(body.symbol ?? "").toUpperCase();
      const prices = await fetchPrices([symbol]).catch(() => ({} as Record<string, number>));
      const f = fillOrder(acc, { symbol, side: body.side as Order["side"], usd: body.usd, qty: body.qty }, prices[symbol]);
      await appendEvent(directorData(), { type: "fill", ...f });
      return f;
    });
    return Response.json({ ok: true, fill, account: await view() });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}

export const dynamic = "force-dynamic";
