// System health for the Company screen: Director 00, Caddy, the memory DB, the relay, this web app, last backup.
// Everything is read locally (files, localhost ports); nothing here changes state.
import { readdir, stat } from "node:fs/promises";
import { Socket } from "node:net";
import path from "node:path";

const ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");
const DIRECTOR = process.env.OMEGA_DIRECTOR_DIR ?? path.join(ROOT, "services", "director00", "data");
const RELAY = process.env.RELAY_URL ?? "http://127.0.0.1:8088";

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
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    const one = (sql: string) => (db.prepare(sql).get() as { n: number | string | null } | undefined)?.n ?? null;
    const memories = Number(one("SELECT count(*) AS n FROM agent_memories"));
    const waiting = Number(one("SELECT count(*) AS n FROM director_approvals WHERE status IN ('pending','escalated')"));
    const rejected = Number(one("SELECT count(*) AS n FROM director_rejections"));
    const last = one("SELECT max(created_at) AS n FROM director_approvals") as string | null;
    db.close();
    check = { state: waiting ? "idle" : "up", detail: `${memories} memories · ${waiting} awaiting approval · ${rejected} rejections`, at: last };
  } catch { /* file missing: keep 'not initialised' */ }

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
  const [d, caddy, pg, relay] = await Promise.all([
    director(),
    port("127.0.0.1", 8443),            // Caddy admin refuses fetch() (origin check), so probe the HTTPS listener
    port("127.0.0.1", 5435),
    http(`${RELAY}/healthz`),
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
  };
  return Response.json({ checkedAt: new Date().toISOString(), checks: body }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
