import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { approvals, counts, phoenixEvents, rejections, usingPostgres } from "../src/lib/ledger.ts";

// SQLite path (DIRECTOR_DB_URL unset). The Postgres path is exercised live and by the Director/Phoenix suites
// against a throwaway database (ADR-040).
test("SQLite ledger reads return the shared row shapes", async () => {
  delete process.env.DIRECTOR_DB_URL;
  assert.equal(usingPostgres(), false);
  const dir = mkdtempSync(path.join(tmpdir(), "omega-ledger-"));
  const d = new DatabaseSync(path.join(dir, "director.sqlite"));
  d.exec(`CREATE TABLE agent_memories (id INTEGER PRIMARY KEY, content TEXT);
    CREATE TABLE director_approvals (thread_id TEXT PRIMARY KEY, request TEXT, proposal TEXT, status TEXT, decided_by TEXT, decided_at TEXT, result TEXT, created_at TEXT, risk TEXT, confirmed_by TEXT);
    CREATE TABLE director_rejections (id INTEGER PRIMARY KEY, thread_id TEXT, code TEXT, stage TEXT, reason TEXT, rejected_by TEXT, created_at TEXT);
    INSERT INTO agent_memories (content) VALUES ('a'), ('b');
    INSERT INTO director_approvals VALUES ('t1', 'remember: x', '{"actions":[]}', 'pending', NULL, NULL, NULL, '2026-10-10T08:00:00Z', '{"level":"low"}', NULL);
    INSERT INTO director_approvals VALUES ('t2', 'remember: y', '{}', 'rejected', 'web:Ahmad', '2026-10-10T09:00:00Z', NULL, '2026-10-10T07:00:00Z', '{}', NULL);
    INSERT INTO director_rejections (thread_id, code, stage, reason, rejected_by, created_at) VALUES ('t2', 'USER-005', 'first', '', 'web:Ahmad', '2026-10-10T09:00:00Z');`);
  d.close();
  const p = new DatabaseSync(path.join(dir, "phoenix.sqlite"));
  p.exec(`CREATE TABLE phoenix_events (id INTEGER PRIMARY KEY, ts TEXT, service TEXT, action TEXT, result TEXT, detail TEXT);
    INSERT INTO phoenix_events (ts, service, action, result, detail) VALUES ('2026-10-10T10:00:00Z', 'web', 'restart', 'ok', 'restarted');`);
  p.close();

  assert.deepEqual((await approvals(dir)).map(a => [a.thread_id, a.status]), [["t1", "pending"], ["t2", "rejected"]]);
  const pending = await approvals(dir, { pendingOnly: true });
  assert.deepEqual(pending.map(a => a.thread_id), ["t1"]);
  assert.deepEqual(JSON.parse(pending[0].proposal), { actions: [] });
  assert.equal((await rejections(dir))[0].code, "USER-005");
  assert.deepEqual(await phoenixEvents(dir, 10), [{ id: 1, ts: "2026-10-10T10:00:00Z", service: "web", action: "restart", result: "ok", detail: "restarted" }]);
  assert.deepEqual(await counts(dir), { memories: 2, waiting: 1, rejections: 1, last: "2026-10-10T08:00:00Z" });
  assert.deepEqual(await approvals(path.join(dir, "missing")), [], "no ledger yet: empty, not an error");
});
