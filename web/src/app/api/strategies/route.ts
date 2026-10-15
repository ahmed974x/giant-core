// Trading strategies (ADR-052): backtests and today's signal for five strategy types on Binance public candles
// (keyless). Read-only; orders go through the paper account only.
import { ttlCache } from "@/lib/geo";
import { runAll, type Candle } from "@/lib/strategies";
import { GET as pulseGET } from "../worldpulse/route";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "PAXGUSDT"];
const INTERVALS = new Set(["1h", "4h", "1d"]);
const cache = ttlCache<Candle[]>(5 * 60_000, 16);

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const symbol = q.get("symbol") ?? "BTCUSDT", interval = q.get("interval") ?? "1d";
  if (!SYMBOLS.includes(symbol) || !INTERVALS.has(interval)) return Response.json({ error: "unsupported symbol or interval" }, { status: 400 });
  try {
    const candles = await cache(`${symbol}:${interval}`, async () => {
      const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
      if (!r.ok) throw new Error(`binance ${r.status}`);
      return ((await r.json()) as [number, string, string, string, string, string][])
        .map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    });
    const pulse = await pulseGET().then(r => r.json()).catch(() => null) as { lean?: { asset: string; net: number }[] } | null;
    const results = runAll(symbol, candles, pulse?.lean ?? []);
    return Response.json({ symbol, interval, from: candles[0]?.time, to: candles[candles.length - 1]?.time, bars: candles.length,
      price: candles[candles.length - 1]?.close, results }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "market data unreachable" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
