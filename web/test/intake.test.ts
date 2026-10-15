import { test } from "node:test";
import assert from "node:assert/strict";
import { directorRequest, sniff, storedName, validate } from "../src/lib/intake.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { directorDir, runDirector } from "../src/lib/director.ts";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap(p => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));

test("directorRequest turns each kind into a remember request", () => {
  assert.equal(directorRequest("note", "  call  the\nport  "), "remember: call the port");
  assert.equal(directorRequest("task", "book berth", "", "inbox/a.pdf"), "remember: TASK: book berth [attachment: inbox/a.pdf]");
  assert.equal(directorRequest("link", "", "https://example.org/x"), "remember: LINK: https://example.org/x");
  assert.equal(directorRequest("link", "rates", "https://example.org/x"), "remember: LINK: https://example.org/x (rates)");
  assert.equal(directorRequest("note", "x".repeat(5000)).length, "remember: ".length + 1500);
});

test("validate rejects unknown kinds, short text and bad links", () => {
  assert.throws(() => validate("exec", "hello", ""));
  assert.throws(() => validate("note", "hi", ""));
  assert.throws(() => validate("link", "", "javascript:alert(1)"));
  assert.throws(() => validate("link", "", "ftp://x.org/file"));
  assert.deepEqual(validate("link", "", " https://a.org/b "), { kind: "link", text: "", url: "https://a.org/b" });
  assert.equal(validate("task", "ship it", null).kind, "task");
});

test("sniff trusts bytes, not names", () => {
  assert.equal(sniff(bytes("%PDF-1.7"))?.ext, "pdf");
  assert.equal(sniff(bytes([0x89], "PNG", [13, 10, 26, 10]))?.ext, "png");
  assert.equal(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]))?.ext, "jpg");
  assert.equal(sniff(bytes("RIFF", [0, 0, 0, 0], "WEBP"))?.ext, "webp");
  assert.equal(sniff(bytes([0, 0, 0, 24], "ftypheic"))?.ext, "heic");
  assert.equal(sniff(new TextEncoder().encode("ملاحظة نصية"))?.ext, "txt");
  assert.equal(sniff(bytes("MZ", [0x90, 0, 3, 0]) ), null, "Windows executable");
  assert.equal(sniff(bytes("PK", [3, 4, 0, 0])), null, "zip");
  assert.equal(sniff(new Uint8Array()), null);
});

test("storedName strips paths and odd characters", () => {
  const d = new Date("2026-10-10T00:00:00Z");
  assert.match(storedName("..\\..\\evil name!.exe", "png", d), /^20261010-[0-9a-f]{8}-evil-name\.png$/);
  assert.match(storedName("/etc/passwd", "txt", d), /^20261010-[0-9a-f]{8}-passwd\.txt$/);
  assert.match(storedName("فاتورة الشحن.pdf", "pdf", d), /^20261010-[0-9a-f]{8}-فاتورة-الشحن\.pdf$/);
  assert.match(storedName("....", "jpg", d), /-file\.jpg$/);
});

test("a phone note reaches Director 00 and waits for approval", async () => {
  // Work in a throwaway ledger so test runs never touch the real Director 00 data.
  process.env.DIRECTOR_DATA_DIR = mkdtempSync(path.join(tmpdir(), "omega-intake-"));
  const out = await runDirector(["ask", directorRequest("note", "intake test from node --test")], directorDir(), 60_000) as
    { thread_id: string; status: string };
  assert.match(out.thread_id, /^[0-9a-f]{12}$/);
  assert.ok(["awaiting_approval", "escalated"].includes(out.status), out.status);
  await runDirector(["reject", out.thread_id, "--code", "USER-005", "--by", "test"], directorDir(), 60_000);
});
