// OMEGA Sentinel: read-only MCP server over the local OMEGA relay.
// Runs as a stdio server inside Claude Desktop (packaged as an .mcpb bundle).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { KINDS, OmegaClient, OmegaError, SEVERITIES, SYMBOL_RE, parseBaseUrl, summarise } from "./omega.js";

const VERSION = "0.1.0";
const client = new OmegaClient(parseBaseUrl(process.env.OMEGA_URL));
const server = new McpServer({ name: "omega-sentinel", version: VERSION });

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const symbol = z
  .string()
  .transform(s => s.trim().toUpperCase())
  .pipe(z.string().regex(SYMBOL_RE, "Binance pair like BTCUSDT"))
  .describe("Trading pair as stored by the Sentinel, e.g. BTCUSDT, ETHUSDT, SOLUSDT");

type Result = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

// Every tool returns compact JSON text plus the same object as structuredContent,
// and turns relay failures into an actionable message instead of a crash.
async function run(fn: () => Promise<Record<string, unknown>>): Promise<Result> {
  try {
    const data = await fn();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }], structuredContent: data };
  } catch (err) {
    const msg = err instanceof OmegaError ? err.message : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

server.registerTool(
  "sentinel_market_snapshot",
  {
    title: "Market snapshot",
    description:
      "Latest price per tracked pair with 1h and 24h % change and 24h quote volume (USDT). " +
      "Use first to see what the Sentinel tracks and where the market stands now.",
    inputSchema: { symbol: symbol.optional() },
    annotations: READ_ONLY,
  },
  ({ symbol }) =>
    run(async () => {
      const rows = await client.latest(symbol);
      if (rows.length === 0) {
        throw new OmegaError(
          symbol
            ? `No recent candles for ${symbol}. Call sentinel_market_snapshot without a symbol to list tracked pairs.`
            : "The Sentinel has no candles from the last 2 days yet. Check that the n8n market-sentinel workflow is active.",
        );
      }
      return { as_of: rows.reduce((m, r) => (r.ts > m ? r.ts : m), rows[0].ts), pairs: rows };
    }),
);

server.registerTool(
  "sentinel_list_alerts",
  {
    title: "List alerts",
    description:
      "Anomalies the Sentinel detected (price_shock, volume_spike, drawdown_1h), newest first, from the last 30 days at most. " +
      "Filter by pair, severity or kind. Each alert carries price, observed value, baseline, z-score and a plain-language reason.",
    inputSchema: {
      symbol: symbol.optional(),
      severity: z.enum(SEVERITIES).optional().describe("'high' for the serious ones only"),
      kind: z.enum(KINDS).optional(),
      since_hours: z.number().int().min(1).max(720).default(24).describe("Look-back window in hours (max 720 = 30 days)"),
      limit: z.number().int().min(1).max(200).default(25),
    },
    annotations: READ_ONLY,
  },
  ({ symbol, severity, kind, since_hours, limit }) =>
    run(async () => {
      const alerts = await client.anomalies({ symbol, severity, kind, sinceHours: since_hours, limit });
      const bySeverity = { high: 0, watch: 0 };
      for (const a of alerts) bySeverity[a.severity]++;
      return {
        window_hours: since_hours,
        count: alerts.length,
        truncated: alerts.length === limit,
        by_severity: bySeverity,
        alerts,
      };
    }),
);

server.registerTool(
  "sentinel_price_history",
  {
    title: "Price history",
    description:
      "Summarised price history for one pair: open, close, % change, high, low, max drawdown, volume, " +
      "and up to `max_points` evenly spaced closes. Windows up to 48h use 5-minute candles; up to 168h use 1-minute candles.",
    inputSchema: {
      symbol,
      hours: z.number().int().min(1).max(168).default(24),
      max_points: z.number().int().min(10).max(300).default(60).describe("How many closes to return for the curve"),
    },
    annotations: READ_ONLY,
  },
  ({ symbol, hours, max_points }) =>
    run(async () => {
      const summary = summarise(await client.candles(symbol, hours), max_points);
      if (!summary) throw new OmegaError(`No candles for ${symbol} in the last ${hours}h.`);
      return { window_hours: hours, ...summary };
    }),
);

server.registerTool(
  "sentinel_system_status",
  {
    title: "System status",
    description: "Health of every OMEGA node as the relay last saw it: relay, n8n, postgrest, timescale ('ok', 'degraded', 'down', 'unknown').",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  () => run(async () => ({ relay_url: client.baseUrl, ...(await client.status()) })),
);

server.registerPrompt(
  "market_brief",
  {
    title: "Market brief",
    description: "A short briefing on the tracked pairs and the alerts that matter.",
    argsSchema: { hours: z.string().optional().describe("Look-back window in hours, default 24") },
  },
  ({ hours }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Using the OMEGA Sentinel tools, brief me on the last ${hours || "24"} hours. ` +
            "Start with sentinel_system_status; if anything is down, say so first. Then sentinel_market_snapshot, " +
            "then sentinel_list_alerts with severity 'high'. For any pair with a high alert, pull sentinel_price_history. " +
            "Lead with what needs my attention, then one line per pair. No investment advice.",
        },
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
