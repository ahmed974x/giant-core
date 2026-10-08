// Thin, read-only client for the OMEGA relay (relay/server.js).
// The relay is the only thing this server talks to, and only over loopback.

export const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
export const KINDS = ["price_shock", "volume_spike", "drawdown_1h"] as const;
export const SEVERITIES = ["watch", "high"] as const;

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type Latest = {
  symbol: string;
  ts: string;
  close: number;
  change_1h_pct: number | null;
  change_24h_pct: number | null;
  quote_volume_24h: number | null;
};

export type Anomaly = {
  id: number;
  ts: string;
  symbol: string;
  kind: (typeof KINDS)[number];
  severity: (typeof SEVERITIES)[number];
  price: number;
  value: number;
  baseline: number | null;
  zscore: number | null;
  reason: string;
  detected_at: string;
};

export type Candle = {
  symbol: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Status = Record<string, string | null>;

export class OmegaError extends Error {}

// Refuse anything that is not plain http(s) on this machine: the bundle runs with the
// user's full privileges, so it must not become a way to reach other hosts.
export function parseBaseUrl(raw: string | undefined): URL {
  const url = new URL(raw && raw.trim() ? raw.trim() : "http://127.0.0.1:8088");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OmegaError(`OMEGA_URL must be http(s), got ${url.protocol}`);
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new OmegaError(`OMEGA_URL must point at this machine (127.0.0.1 or localhost), got ${url.hostname}`);
  }
  if (url.username || url.password) throw new OmegaError("OMEGA_URL must not contain credentials");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

export class OmegaClient {
  constructor(private readonly base: URL) {}

  get baseUrl(): string {
    return this.base.origin;
  }

  private async get<T>(path: string, params?: URLSearchParams): Promise<T> {
    const url = new URL(path, this.base);
    if (params) url.search = params.toString();
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
    } catch {
      throw new OmegaError(
        `Cannot reach the OMEGA relay at ${this.base.origin}. Start the stack with "docker compose up -d" in giant-core, then retry.`,
      );
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new OmegaError("OMEGA relay response too large; narrow the time window.");
    if (res.status === 503) {
      throw new OmegaError("The relay is up but the Timescale memory core is unreachable. Check `docker compose ps`.");
    }
    if (!res.ok) throw new OmegaError(`OMEGA relay returned HTTP ${res.status} for ${url.pathname}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new OmegaError(`OMEGA relay returned non-JSON for ${url.pathname}`);
    }
  }

  latest(symbol?: string): Promise<Latest[]> {
    const p = new URLSearchParams({ order: "symbol.asc" });
    if (symbol) p.set("symbol", `eq.${symbol}`);
    return this.get("/api/latest", p);
  }

  anomalies(f: { symbol?: string; severity?: string; kind?: string; sinceHours: number; limit: number }): Promise<Anomaly[]> {
    const since = new Date(Date.now() - f.sinceHours * 3_600_000).toISOString();
    const p = new URLSearchParams({ ts: `gte.${since}`, order: "ts.desc", limit: String(f.limit) });
    if (f.symbol) p.set("symbol", `eq.${f.symbol}`);
    if (f.severity) p.set("severity", `eq.${f.severity}`);
    if (f.kind) p.set("kind", `eq.${f.kind}`);
    return this.get("/api/anomalies", p);
  }

  candles(symbol: string, hours: number): Promise<Candle[]> {
    // 5-minute buckets cover 48h; beyond that fall back to the 7-day 1-minute view.
    const view = hours <= 48 ? "/api/candles_5m" : "/api/candles";
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    const p = new URLSearchParams({
      symbol: `eq.${symbol}`,
      ts: `gte.${since}`,
      order: "ts.asc",
      select: "symbol,ts,open,high,low,close,volume",
    });
    return this.get(view, p);
  }

  status(): Promise<Status> {
    return this.get("/status");
  }
}

export type HistorySummary = {
  symbol: string;
  from: string;
  to: string;
  open: number;
  close: number;
  change_pct: number;
  high: number;
  low: number;
  max_drawdown_pct: number;
  volume: number;
  points: { ts: string; close: number }[];
};

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

// Compress a candle series into stats plus at most `maxPoints` evenly spaced closes,
// so Claude gets the shape of the move without thousands of rows in context.
export function summarise(candles: Candle[], maxPoints: number): HistorySummary | null {
  if (candles.length === 0) return null;
  const first = candles[0];
  const last = candles[candles.length - 1];
  let high = -Infinity;
  let low = Infinity;
  let peak = -Infinity;
  let maxDd = 0;
  let volume = 0;
  for (const c of candles) {
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
    peak = Math.max(peak, c.high);
    maxDd = Math.min(maxDd, (c.low - peak) / peak);
    volume += c.volume;
  }
  const step = Math.max(1, Math.ceil(candles.length / maxPoints));
  const points = candles.filter((_, i) => i % step === 0 || i === candles.length - 1).map(c => ({ ts: c.ts, close: c.close }));
  return {
    symbol: first.symbol,
    from: first.ts,
    to: last.ts,
    open: first.open,
    close: last.close,
    change_pct: round((last.close / first.open - 1) * 100, 3),
    high,
    low,
    max_drawdown_pct: round(maxDd * 100, 3),
    volume: round(volume, 4),
    points,
  };
}
