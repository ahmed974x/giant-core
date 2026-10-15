// Approval Inbox bridge tests (ADR-023). Run: node --test test/   (Node 24 strips the types natively)
// The last test drives the real Director 00 CLI against a throwaway data folder: ask -> approve, and a high-risk
// proposal that needs the typed confirmation. Skipped if the Director venv is missing.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cliArgs, makeThrottle, pinOk, runDirector } from "../src/lib/director.ts";

test("cliArgs builds fixed argument lists and rejects anything else", () => {
  assert.deepEqual(cliArgs({ action: "approve", thread_id: "0123456789ab" }), ["approve", "0123456789ab", "--by", "web:Ahmad"]);
  assert.deepEqual(cliArgs({ action: "confirm", thread_id: "0123456789ab", phrase: "confirm 89ab" }),
    ["confirm", "0123456789ab", "CONFIRM 89AB", "--by", "web:Ahmad"]);
  assert.deepEqual(cliArgs({ action: "reject", thread_id: "0123456789ab", code: "RISK-001", reason: "no" }),
    ["reject", "0123456789ab", "--code", "RISK-001", "--reason", "no", "--by", "web:Ahmad"]);
  for (const bad of [{ action: "approve", thread_id: "../../etc" }, { action: "reject", thread_id: "0123456789ab", code: "EXPIRED-003" },
    { action: "confirm", thread_id: "0123456789ab", phrase: "yes" }, { action: "delete", thread_id: "0123456789ab" }, null])
    assert.throws(() => cliArgs(bad));
});

test("PIN check needs a configured PIN of 6+ characters and an exact match", () => {
  assert.equal(pinOk("482913", "482913"), true);
  assert.equal(pinOk("482914", "482913"), false);
  assert.equal(pinOk("4829130", "482913"), false);
  assert.equal(pinOk("482913", undefined), false);
  assert.equal(pinOk("1234", "1234"), false);
  assert.equal(pinOk(482913, "482913"), false);
});

test("wrong-PIN throttle locks a client after 5 failures for 15 minutes", () => {
  let t = 0;
  const th = makeThrottle(5, 15 * 60_000, () => t);
  for (let i = 0; i < 5; i++) th.fail("phone");
  assert.equal(th.blocked("phone"), true);
  assert.equal(th.blocked("laptop"), false);
  t += 15 * 60_000 + 1;
  assert.equal(th.blocked("phone"), false);
});

const DIRECTOR = path.resolve(import.meta.dirname, "..", "..", "services", "director00");
const PY = path.join(DIRECTOR, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

test("real Director 00: web approve executes, high risk waits for the typed phrase", { skip: !existsSync(PY), timeout: 120_000 }, async () => {
  process.env.DIRECTOR_DATA_DIR = mkdtempSync(path.join(tmpdir(), "omega-web-"));
  const low = await runDirector(cliArgs({ action: "ask", request: "remember: tanker queue at Fujairah" }), DIRECTOR) as { thread_id: string; status: string };
  assert.equal(low.status, "awaiting_approval");
  const done = await runDirector(cliArgs({ action: "approve", thread_id: low.thread_id }), DIRECTOR) as { status: string };
  assert.equal(done.status, "executed");

  const high = await runDirector(cliArgs({ action: "ask", request: "decision: pause whale alerts" }), DIRECTOR) as { thread_id: string };
  const step = await runDirector(cliArgs({ action: "approve", thread_id: high.thread_id }), DIRECTOR) as { status: string; type_to_confirm: string };
  assert.equal(step.status, "escalated");
  const ok = await runDirector(cliArgs({ action: "confirm", thread_id: high.thread_id, phrase: step.type_to_confirm }), DIRECTOR) as { status: string };
  assert.equal(ok.status, "executed");
});
