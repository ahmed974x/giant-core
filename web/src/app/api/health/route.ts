// System health for the Company screen: Director 00, Caddy, the memory DB, the relay, this web app, last backup.
// Everything is read locally (files, localhost ports); nothing here changes state.
import { readdir, stat } from "node:fs/promises";
import { Socket } from "node:net";
import path from "node:path";
import { ping as immichPing } from "@/lib/immich";
import { counts as ledgerCounts, usingPostgres } from "@/lib/ledger";

const ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");
const DIRECTOR = process.env.DIRECTOR_DATA_DIR ?? process.env.OMEGA_DIRECTOR_DIR ?? path.join(ROOT, "services", "director00", "data");
const RELAY = process.env.RELAY_URL ?? "http://127.0.0.1:8088";
const N8N = process.env.N8N_URL ?? "http://127.0.0.1:5678";

/** n8n and its instance-level MCP endpoint. Unauthenticated, /mcp-server/http answers 401 when MCP access is enabled
 *  and 404 when it is not, so the tile can say which step is missing without holding any token. */
async function n8n(): Promise<Check> {
  try {
    const up = await fetch(`${N8N}/healthz`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!up.ok) return { state: "down", detail: "n8n not healthy" };
    const mcp = await fetch(`${N8N}/mcp-server/http`, { method: "POST", signal: AbortSignal.timeout(1500), cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" });
    if (mcp.status === 404) return { state: "idle", detail: "n8n up · enable Settings > Instance-level MCP" };
    return { state: "up", detail: "n8n up · MCP endpoint ready for Claude (n8n-mcp)" };
  } catch {
    return { state: "down", detail: "n8n not running (docker compose up -d n8n)" };
  }
}

type Check = { state: "up" | "down" | "idle" | "unknown"; detail: string; at?: string | null };

function port(host: string, p: number, ms = 800): Promise<boolean> {
  return new Promise(resolve => {
    const s = new Socket();
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(ms);
    s.once("connect", () => done(true)).once("timeout", () => done(false)).once("error", () => done(false));
    s.connect(p, host);
  });
}

async function http(url: string, ms = 1500): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(ms), cache: "no-store" })).ok; } catch { return false; }
}

async function director(): Promise<{ check: Check; backup: Check }> {
  const file = path.join(DIRECTOR, "director.sqlite");
  let check: Check = { state: "unknown", detail: "not initialised yet (run cli.py ask …)" };
  try {
    const c = await ledgerCounts(path.dirname(file));
    if (c) check = { state: c.waiting ? "idle" : "up", detail: `${c.memories} memories · ${c.waiting} awaiting approval · ${c.rejections} rejections${usingPostgres() ? " · Postgres" : ""}`, at: c.last };
  } catch { check = { state: "down", detail: usingPostgres() ? "Postgres not answering on :5435" : "ledger unreadable" }; }

  let backup: Check = { state: "unknown", detail: "no backup yet (cli.py backup)" };
  try {
    const dir = path.join(DIRECTOR, "backups");
    const names = (await readdir(dir)).sort();
    const latest = names[names.length - 1];
    if (latest) {
      const s = await stat(path.join(dir, latest));
      const ageH = (Date.now() - s.mtimeMs) / 3_600_000;
      backup = { state: ageH < 26 ? "up" : "down", detail: ageH < 26 ? "within the last day" : `${Math.round(ageH)} h old`, at: s.mtime.toISOString() };
    }
  } catch { /* no backups dir */ }
  return { check, backup };
}

export async function GET() {
  const pgUrl = process.env.DIRECTOR_DB_URL ?? "";
  const [d, caddy, pg, relay, automations, photos] = await Promise.all([
    director(),
    port("127.0.0.1", 8443),            // Caddy admin refuses fetch() (origin check), so probe the HTTPS listener
    port("127.0.0.1", 5435),
    http(`${RELAY}/healthz`),
    n8n(),
    immichPing(),
  ]);
  const mem = process.memoryUsage();
  const body: Record<string, Check> = {
    director: d.check,
    caddy: caddy ? { state: "up", detail: "HTTPS on :8443 for the phone" } : { state: "down", detail: "not running (ops/caddy/start-https.ps1)" },
    database: pg ? { state: "up", detail: "Postgres + pgvector on :5435" }
      : { state: pgUrl ? "down" : "idle", detail: pgUrl ? "DIRECTOR_DB_URL set but :5435 is closed" : "SQLite fallback (Docker off)" },
    relay: relay ? { state: "up", detail: RELAY } : { state: "down", detail: "relay offline (docker compose up)" },
    web: { state: "up", detail: `up ${Math.round(process.uptime() / 60)} min · ${Math.round(mem.rss / 1048576)} MB RAM` },
    backup: d.backup,
    n8n: automations,
    immich: photos ? { state: "up", detail: process.env.IMMICH_URL ?? "" }
      : { state: process.env.IMMICH_URL ? "down" : "idle", detail: process.env.IMMICH_URL ? "Immich not answering (docker compose --profile photos up -d)" : "waiting for Docker (compose profile photos)" },
  };
  return Response.json({ checkedAt: new Date().toISOString(), checks: body }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
