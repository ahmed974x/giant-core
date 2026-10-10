import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { morningBriefing } from "../src/lib/briefing.ts";
import { previewOffice } from "../src/lib/office.ts";

const RULES = { min_gain_pct: 15, sweep_share: 0.5, min_sweep_usd: 25, reserve: "USDT" };
const prices = (async () => Response.json([{ symbol: "BTCUSDT", price: "65000" }])) as typeof fetch;

function setup(withPositions: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), "omega-brief-"));
  const db = new DatabaseSync(path.join(dir, "director.sqlite"));
  db.exec("CREATE TABLE director_approvals (thread_id TEXT, request TEXT, status TEXT, risk TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT)");
  db.exec("CREATE TABLE director_rejections (thread_id TEXT, code TEXT, stage TEXT, reason TEXT, rejected_by TEXT, created_at TEXT)");
  db.prepare("INSERT INTO director_approvals VALUES (?,?,?,?,?,?,?)").run("a1", "remember: TASK: book berth", "pending", '{"level":"low"}', null, null, "2026-10-10T06:00:00Z");
  db.close();
  if (withPositions) writeFileSync(path.join(dir, "positions.json"), JSON.stringify({ positions: [{ symbol: "BTCUSDT", qty: 0.05, cost_usd: 2500 }] }));
  const rules = path.join(dir, "rules.json");
  writeFileSync(rules, JSON.stringify(RULES));
  return { dir, rules };
}

test("the morning briefing writes a deck to the Library and proposes the day's sweep once", async () => {
  const { dir, rules } = setup(true);
  const asked: string[][] = [];
  const now = new Date("2026-10-10T04:00:00Z");
  const r = await morningBriefing(dir, rules, { runDirector: async a => { asked.push(a); return {}; }, fetch: prices, now });
  assert.equal(r.sweep, "proposed");
  assert.equal(r.sweepUsd, 375);
  assert.equal(r.pending, 2);
  assert.match(asked[0][1], /^remember: TASK: profit sweep plan 2026-10-10/);
  assert.match(r.deck, /^inbox\/20261010-[0-9a-f]{8}-morning-briefing\.pptx$/);
  const deck = previewOffice(readFileSync(path.join(dir, r.deck)));
  assert.ok(deck.kind === "pptx" && deck.slides[2].lines.includes("remember: TASK: book berth"));
  assert.equal(r.note.url, "/ar/library");
  assert.match(r.note.body, /2 waiting for your approval · Profit sweep plan: ~\$375/);
});

test("no positions, no prices, or a sweep already waiting: no new proposal", async () => {
  const none = setup(false);
  const r1 = await morningBriefing(none.dir, none.rules, { runDirector: async () => assert.fail("must not ask"), fetch: prices });
  assert.equal(r1.sweep, "no-positions");

  const down = setup(true);
  const r2 = await morningBriefing(down.dir, down.rules, { runDirector: async () => assert.fail("must not ask"), fetch: (async () => new Response(null, { status: 503 })) as typeof fetch });
  assert.equal(r2.sweep, "no-prices");

  const waiting = setup(true), day = new Date().toISOString().slice(0, 10);
  const db = new DatabaseSync(path.join(waiting.dir, "director.sqlite"));
  db.prepare("INSERT INTO director_approvals VALUES (?,?,?,?,?,?,?)").run("s1", `remember: TASK: profit sweep plan ${day}, move ~$375`, "pending", "{}", null, null, `${day}T05:00:00Z`);
  db.close();
  const r3 = await morningBriefing(waiting.dir, waiting.rules, { runDirector: async () => assert.fail("must not ask twice"), fetch: prices });
  assert.equal(r3.sweep, "already-waiting");
});

test("only the last 14 briefing decks are kept", async () => {
  const { dir, rules } = setup(false);
  mkdirSync(path.join(dir, "inbox"), { recursive: true });
  for (let d = 1; d <= 16; d++) writeFileSync(path.join(dir, "inbox", `202609${String(d).padStart(2, "0")}-0000000${d % 10}-morning-briefing.pptx`), "old");
  writeFileSync(path.join(dir, "inbox", "20260901-aaaaaaaa-report.docx"), "keep me");
  await morningBriefing(dir, rules, { runDirector: async () => ({}) });
  const left = readdirSync(path.join(dir, "inbox"));
  assert.equal(left.filter(n => n.endsWith("morning-briefing.pptx")).length, 14);
  assert.ok(left.includes("20260901-aaaaaaaa-report.docx"));
});
