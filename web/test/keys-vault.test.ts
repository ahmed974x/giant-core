import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { audit, burnSession, checkSession, createSession, desktopFileText, LINK_TTL_MS, validateKeys, writeDesktopFile } from "../src/lib/keys-vault.ts";

test("a vault link works once, for 10 minutes, and only the token's hash is stored", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "omega-vault-"));
  const now = Date.UTC(2026, 9, 10, 12);
  const { token, expires } = await createSession(dir, now);
  assert.equal(expires - now, LINK_TTL_MS);
  assert.ok(!readFileSync(path.join(dir, "keys-vault-session.json"), "utf8").includes(token), "token itself is not on disk");
  assert.equal(await checkSession(dir, token, now + 1000), "ok");
  assert.equal(await checkSession(dir, token + "x", now + 1000), "wrong");
  assert.equal(await checkSession(dir, "", now), "wrong");
  assert.equal(await checkSession(dir, token, now + LINK_TTL_MS + 1), "expired");
  await burnSession(dir);
  assert.equal(await checkSession(dir, token, now + 1000), "used");
  assert.equal(await checkSession(mkdtempSync(path.join(tmpdir(), "omega-vault-")), token), "missing");
});

test("only the two vault keys are accepted, and they must look like keys", () => {
  assert.deepEqual(validateKeys({ NASA_FIRMS_KEY: "  abcdef0123456789  ", AISSTREAM_API_KEY: "", DIRECTOR_WEB_PIN: "999999" }), { NASA_FIRMS_KEY: "abcdef0123456789" });
  assert.throws(() => validateKeys({}), /at least one/);
  assert.throws(() => validateKeys({ NASA_FIRMS_KEY: "abc" }), /look like a key/);
  assert.throws(() => validateKeys({ AISSTREAM_API_KEY: "has spaces in it 123" }), /look like a key/);
  assert.throws(() => validateKeys({ AISSTREAM_API_KEY: "x\nINJECTED=1aaaaaa" }), /look like a key/);
});

test("the Desktop copy has the agreed layout and keeps a key that wasn't re-sent", async () => {
  const now = new Date("2026-10-10T15:00:00Z");
  const text = desktopFileText("", { NASA_FIRMS_KEY: "firms12345678" }, now);
  assert.deepEqual(text.split("\r\n"), [
    "# OMEGA PRIME - مفاتيح البيانات", "# التاريخ: 2026-10-10", "",
    "NASA_FIRMS_KEY=firms12345678", "AISSTREAM_API_KEY=", "",
    "# ملاحظة: هذا ملف شخصي - لا تشاركه", "# النسخة المشفرة في: web/.env.local (dotenvx)", ""]);
  const dir = mkdtempSync(path.join(tmpdir(), "omega-desk-")), f = path.join(dir, "المفاتيح.txt");
  writeFileSync(f, "NASA_FIRMS_KEY=old\nMY_NOTE=keep me\n");
  await writeDesktopFile(f, { AISSTREAM_API_KEY: "ais0987654321" }, now);
  const saved = readFileSync(f, "utf8");
  assert.ok(saved.startsWith("﻿# OMEGA PRIME"), "UTF-8 BOM so Notepad shows Arabic");
  assert.match(saved, /NASA_FIRMS_KEY=old\r\nAISSTREAM_API_KEY=ais0987654321\r\nMY_NOTE=keep me/);
});

test("the audit log records names and verdicts, never values", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "omega-audit-"));
  await audit(dir, { at: "2026-10-10T15:00:00Z", from: "192.168.8.20", keys: ["NASA_FIRMS_KEY"], verdicts: { NASA_FIRMS_KEY: "ok" }, result: "saved" });
  const line = JSON.parse(readFileSync(path.join(dir, "keys-vault-audit.jsonl"), "utf8").trim());
  assert.deepEqual(Object.keys(line), ["at", "from", "keys", "verdicts", "result"]);
});
