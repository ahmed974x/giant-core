// OHLCV candles from Binance's public market-data mirror (data-api.binance.vision): keyless, read-only.
// Only allow-listed symbols and intervals reach upstream; responses are cached 30 s.
import { ttlCache } from "@/lib/geo";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "PAXGUSDT"] as const; // PAXG tracks one troy ounce of gold
const INTERVALS = new Set(["15m", "1h", "4h", "1d"]);
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const cache = ttlCache<Candle[]>(30_000, 32);

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const symbol = q.get("symbol") ?? "BTCUSDT", interval = q.get("interval") ?? "1h";
  if (!(SYMBOLS as readonly string[]).includes(symbol) || !INTERVALS.has(interval)) return Response.json({ error: "unsupported symbol or interval" }, { status: 400 });
  try {
    const candles = await cache(`${symbol}:${interval}`, async () => {
      const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=300`, {
        signal: AbortSignal.timeout(8000), cache: "no-store", headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`binance ${r.status}`);
      const rows = (await r.json()) as [number, string, string, string, string, string][];
      return rows.map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    });
    return Response.json({ symbol, interval, source: "Binance public market data", candles }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "market data unreachable" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
