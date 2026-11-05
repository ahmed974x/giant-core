// Database adapters for jarvis/server (ADR-134). One interface over two engines:
//   sqlite   Node's built-in node:sqlite, a file under jarvis/server/.data (zero setup, the default)
//   postgres the repo's local PostgreSQL 16 through pg@8.23.0 (the version web/ already pins)
// Queries are written once with $1..$n placeholders; JSON columns go in as JSON text and come back
// as objects; *_at columns come back as epoch milliseconds.
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const JSON_COLS = new Set(["tools", "skills", "limits", "input", "log", "output", "payload", "data", "graph", "theme", "blocks", "findings", "depends_on", "criteria", "state", "planner", "events", "tags", "outcome", "files", "scan"]);

export function mapRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (JSON_COLS.has(k) && typeof v === "string") { try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; } }
    else if ((k.endsWith("_at") || k === "at") && v != null) out[k] = v instanceof Date ? v.getTime() : Date.parse(v);
    else if (typeof v === "bigint") out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

// Turn engine errors into one shape: { code: "constraint" | "unique" | "append_only", name }.
export function classify(err) {
  const msg = String(err && err.message || "");
  const pgName = err && err.constraint;
  if (err && err.code === "23505") return { code: "unique", name: pgName || "" };
  if (err && err.code === "23514") return { code: "constraint", name: pgName || "" };
  if (/append-only/.test(msg)) return { code: "append_only", name: "events" };
  let m = /UNIQUE constraint failed: ([\w.,\s]+)/.exec(msg);
  if (m) return { code: "unique", name: m[1].includes("runs.agent_id") ? "runs_one_active_per_agent" : m[1] };
  m = /CHECK constraint failed: (\w+)/.exec(msg);
  if (m) return { code: "constraint", name: m[1] };
  return null;
}

export async function openSqlite(file) {
  const { DatabaseSync } = await import("node:sqlite");
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(readFileSync(join(here, "schema-sqlite.sql"), "utf8"));
  const conv = sql => sql.replace(/\$(\d+)/g, "?$1");
  const prep = new Map();
  const stmt = sql => { let s = prep.get(sql); if (!s) { s = db.prepare(conv(sql)); prep.set(sql, s); } return s; };
  return {
    kind: "sqlite",
    where: file,
    async all(sql, params = []) { return stmt(sql).all(...params).map(mapRow); },
    async one(sql, params = []) { return mapRow(stmt(sql).get(...params)); },
    async run(sql, params = []) { const r = stmt(sql).run(...params); return { changes: Number(r.changes) }; },
    async tx(fn) {
      db.exec("begin");
      try { const v = await fn(this); db.exec("commit"); return v; } catch (e) { db.exec("rollback"); throw e; }
    },
    async close() { db.close(); },
  };
}

export async function openPostgres(url) {
  let pg;
  try { pg = (await import("pg")).default; }
  catch (e) { throw new Error("Postgres mode needs pg@8.23.0: run `npm ci --ignore-scripts` in jarvis/server first."); }
  // Local only: a loopback host, or a Unix socket (empty host, or ?host=/path).
  let host;
  try { const u = new URL(url); host = u.hostname || (u.searchParams.get("host") || ""); } catch (e) { throw new Error("DATABASE_URL is not a valid postgres:// URL."); }
  const local = ["127.0.0.1", "localhost", "[::1]", "::1", ""].includes(host) || host.startsWith("/");
  if (!local) throw new Error("Postgres must be local (127.0.0.1, ::1 or a Unix socket); got host " + host + ".");
  // search_path as a startup option, so it is set before the first query on every connection.
  const pool = new pg.Pool({ connectionString: url, max: 5, options: "-c search_path=jarvis,public" });
  const exists = await pool.query("select to_regclass('jarvis.agents') as t");
  if (!exists.rows[0].t) await pool.query(readFileSync(join(here, "..", "..", "replica", "schema.sql"), "utf8"));
  const q = async (client, sql, params) => (await client.query({ text: sql, values: params })).rows.map(mapRow);
  return {
    kind: "postgres",
    where: host && !host.startsWith("/") ? host : "unix socket",
    async all(sql, params = []) { return q(pool, sql, params); },
    async one(sql, params = []) { return (await q(pool, sql, params))[0]; },
    async run(sql, params = []) { const r = await pool.query({ text: sql, values: params }); return { changes: r.rowCount }; },
    async tx(fn) {
      const client = await pool.connect();
      const scoped = {
        kind: "postgres",
        all: (s, p = []) => q(client, s, p),
        one: async (s, p = []) => (await q(client, s, p))[0],
        run: async (s, p = []) => ({ changes: (await client.query({ text: s, values: p })).rowCount }),
      };
      try { await client.query("begin"); const v = await fn(scoped); await client.query("commit"); return v; }
      catch (e) { await client.query("rollback").catch(() => {}); throw e; }
      finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}
