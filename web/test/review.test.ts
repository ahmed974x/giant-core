import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { approve, editSweeperRules, fingerprint, loadItems, readLog } from "../src/lib/review.ts";

function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), "omega-review-"));
  mkdirSync(path.join(root, "services/truth"), { recursive: true });
  mkdirSync(path.join(root, "services/causal"), { recursive: true });
  mkdirSync(path.join(root, "services/sweeper"), { recursive: true });
  writeFileSync(path.join(root, "services/sweeper/rules.json"), JSON.stringify({ min_gain_pct: 15 }));
  writeFileSync(path.join(root, "services/truth/sources.json"), JSON.stringify({ tiers: { wire: { score: 0.9 } }, domains: {} }));
  writeFileSync(path.join(root, "services/causal/assumptions.json"), JSON.stringify({ root_prior: 0.2, likelihood: {}, runs: 20000 }));
  return { root, log: path.join(root, "reviews.json") };
}

test("an approval is tied to the exact content reviewed", async () => {
  const { root, log } = sandbox();
  let items = await loadItems(root, await readLog(log));
  assert.deepEqual(items.map(i => [i.id, i.current]), [["sources", false], ["butterfly", false], ["sweeper", false], ["restic", false]]);
  const s = items.find(i => i.id === "sources")!;
  await approve(root, log, "sources", s.hash, "web:Ahmad", new Date("2026-10-10T10:00:00Z"));
  items = await loadItems(root, await readLog(log));
  assert.equal(items.find(i => i.id === "sources")!.current, true);

  // Someone edits the tiers afterwards: the approval no longer counts.
  writeFileSync(path.join(root, "services/truth/sources.json"), JSON.stringify({ tiers: { wire: { score: 0.5 } }, domains: {} }));
  items = await loadItems(root, await readLog(log));
  const changed = items.find(i => i.id === "sources")!;
  assert.equal(changed.current, false);
  assert.equal(changed.approval?.by, "web:Ahmad");
});

test("approving a stale or unknown item is refused", async () => {
  const { root, log } = sandbox();
  await assert.rejects(approve(root, log, "sources", "000000000000", "x"), /changed since/);
  await assert.rejects(approve(root, log, "../etc", "x", "x"), /unknown/);
  await approve(root, log, "restic", "manual", "web:Ahmad");
  assert.equal((await readLog(log)).restic.hash, "manual");
});

test("fingerprints ignore Windows line endings", () => {
  assert.equal(fingerprint("a\r\nb"), fingerprint("a\nb"));
  assert.equal(fingerprint("a").length, 12);
});

test("Profit Sweeper rules can be edited, are range-checked, and need a fresh approval", async () => {
  const { root, log } = sandbox();
  writeFileSync(path.join(root, "services/sweeper/rules.json"), JSON.stringify({ _about: "note", min_gain_pct: 15, sweep_share: 0.5, min_sweep_usd: 25, reserve: "USDT" }));
  const editLog = path.join(root, "rule-edits.jsonl");
  let items = await loadItems(root, await readLog(log));
  await approve(root, log, "sweeper", items.find(i => i.id === "sweeper")!.hash, "web:Ahmad");
  const out = await editSweeperRules(root, editLog, { min_gain_pct: 20, sweep_share: 0.4, min_sweep_usd: 25, reserve: "usdc" }, "web:Ahmad");
  assert.deepEqual(out, { _about: "note", min_gain_pct: 20, sweep_share: 0.4, min_sweep_usd: 25, reserve: "USDC" });
  items = await loadItems(root, await readLog(log));
  assert.equal(items.find(i => i.id === "sweeper")!.current, false, "edit invalidates the old approval");
  const entry = JSON.parse(readFileSync(editLog, "utf8").trim());
  assert.deepEqual([entry.before.min_gain_pct, entry.after.min_gain_pct, entry.by], [15, 20, "web:Ahmad"]);
  for (const bad of [{ min_gain_pct: -5, sweep_share: 0.5, min_sweep_usd: 25, reserve: "USDT" }, { min_gain_pct: 15, sweep_share: 2, min_sweep_usd: 25, reserve: "USDT" }, { min_gain_pct: 15, sweep_share: 0.5, min_sweep_usd: 25, reserve: "U$D" }, null])
    await assert.rejects(editSweeperRules(root, editLog, bad, "x"));
});
