// Director 00's ledger and Phoenix's log, read from wherever they live (ADR-040): Postgres + pgvector when
// DIRECTOR_DB_URL is set (Docker running), otherwise the local SQLite files. Every caller gets the same row shapes:
// timestamps as ISO strings ending in Z, JSON columns as JSON text. Read-only; writes stay with Director 00.
import path from "node:path";

export type ApprovalRow = { thread_id: string; request: string; proposal: string; status: string; risk: string; decided_by: string | null; decided_at: string | null; created_at: string };
export type RejectionRow = { thread_id: string; code: string; stage: string; reason: string; rejected_by: string; created_at: string };
export type PhoenixRow = { id: number; ts: string; service: string; action: string; result: string; detail: string };
export type Counts = { memories: number; waiting: number; rejections: number; last: string | null };

const pgUrl = (env = process.env) => {
  const u = env.DIRECTOR_DB_URL?.trim();
  return u && !u.includes("${") ? u : null;
};
export const usingPostgres = () => pgUrl() !== null;

type PgPool = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
let pool: PgPool | null = null;
async function pg(): Promise<PgPool> {
  if (pool) return pool;
  const { Pool } = await import("pg");
  const url = new URL(pgUrl()!);
  url.searchParams.delete("sslmode");                // local Docker port: plain connection, as in Director 00
  pool = new Pool({ connectionString: url.toString(), max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3000 }) as unknown as PgPool;
  return pool;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().replace(/\.\d{3}Z$/, "Z") : String(v));
const text = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));

async function sqlite<T>(dir: string, file: string, sql: string): Promise<T[]> {
  const { DatabaseSync } = await import("node:sqlite");
  try {
    const db = new DatabaseSync(path.join(dir, file), { readOnly: true });
    try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
  } catch { return []; }
}

const A_COLS = "thread_id, request, proposal, status, risk, decided_by, decided_at, created_at";
const mapApproval = (r: Record<string, unknown>): ApprovalRow => ({
  thread_id: String(r.thread_id), request: String(r.request), proposal: text(r.proposal), status: String(r.status), risk: text(r.risk) || "{}",
  decided_by: (r.decided_by as string) ?? null, decided_at: iso(r.decided_at), created_at: iso(r.created_at)!,
});

export async function approvals(dataDir: string, opts: { pendingOnly?: boolean; limit?: number } = {}): Promise<ApprovalRow[]> {
  const where = opts.pendingOnly ? "WHERE status IN ('pending', 'escalated')" : "";
  const sql = `SELECT ${A_COLS} FROM director_approvals ${where} ORDER BY created_at DESC LIMIT ${Math.min(opts.limit ?? 2000, 5000)}`;
  const rows = usingPostgres() ? (await (await pg()).query(sql)).rows : await sqlite<Record<string, unknown>>(dataDir, "director.sqlite", sql);
  return rows.map(mapApproval);
}

export async function rejections(dataDir: string, limit = 2000): Promise<RejectionRow[]> {
  const sql = `SELECT thread_id, code, stage, reason, rejected_by, created_at FROM director_rejections ORDER BY created_at DESC LIMIT ${Math.min(limit, 5000)}`;
  const rows = usingPostgres() ? (await (await pg()).query(sql)).rows : await sqlite<Record<string, unknown>>(dataDir, "director.sqlite", sql);
  return rows.map(r => ({ thread_id: String(r.thread_id), code: String(r.code), stage: String(r.stage), reason: String(r.reason ?? ""), rejected_by: String(r.rejected_by), created_at: iso(r.created_at)! }));
}

export async function phoenixEvents(dataDir: string, limit = 500): Promise<PhoenixRow[]> {
  const sql = `SELECT id, ts, service, action, result, detail FROM phoenix_events ORDER BY id DESC LIMIT ${Math.min(limit, 5000)}`;
  const rows = usingPostgres() ? (await (await pg()).query(sql)).rows : await sqlite<Record<string, unknown>>(dataDir, "phoenix.sqlite", sql);
  return rows.map(r => ({ id: Number(r.id), ts: iso(r.ts)!, service: String(r.service), action: String(r.action), result: String(r.result), detail: String(r.detail ?? "") }));
}

export async function counts(dataDir: string): Promise<Counts | null> {
  const sql = "SELECT (SELECT count(*) FROM agent_memories) AS memories, (SELECT count(*) FROM director_approvals WHERE status IN ('pending','escalated')) AS waiting, "
    + "(SELECT count(*) FROM director_rejections) AS rejections, (SELECT max(created_at) FROM director_approvals) AS last";
  const rows = usingPostgres() ? (await (await pg()).query(sql)).rows : await sqlite<Record<string, unknown>>(dataDir, "director.sqlite", sql);
  const r = rows[0];
  return r ? { memories: Number(r.memories), waiting: Number(r.waiting), rejections: Number(r.rejections), last: iso(r.last) } : null;
}
