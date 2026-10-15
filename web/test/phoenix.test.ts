// Phoenix timeline summary (ADR-024).
import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize } from "../src/lib/phoenix.ts";

const ev = (ts: string, service: string, action: string, result: string, detail = "") => ({ ts, service, action, result, detail });

test("latest state per service wins and quiet checks are not incidents", () => {
  const s = summarize([
    ev("2026-10-10T01:00:00Z", "web", "detect", "ok"),
    ev("2026-10-10T02:00:00Z", "web", "detect", "down", "not answering"),
    ev("2026-10-10T02:00:05Z", "web", "restart", "ok"),
    ev("2026-10-10T02:00:06Z", "phoenix", "heartbeat", "ok"),
    ev("2026-10-10T03:00:00Z", "backup", "backup", "failed", "no repo"),
  ]);
  assert.equal(s.state.web.result, "ok");
  assert.equal(s.state.backup.result, "down");
  assert.equal(s.lastRun?.ts, "2026-10-10T02:00:06Z");
  assert.deepEqual(s.incidents.map(e => `${e.service}:${e.action}`), ["backup:backup", "web:restart", "web:detect"]);
});

test("an empty log gives an empty, valid summary", () => {
  assert.deepEqual(summarize([]), { state: {}, lastRun: null, incidents: [] });
});
