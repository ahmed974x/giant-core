import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { colIndex, escapeXml, officeKind, previewOffice, writeDocx, writeXlsx } from "../src/lib/office.ts";
import { readZip, writeZip } from "../src/lib/zip.ts";
import { sniff } from "../src/lib/intake.ts";
import { isSafeName, ledgerFile } from "../src/lib/documents.ts";
import { immichConfig, recentPhotos, thumbnail, uploadPhoto } from "../src/lib/immich.ts";

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));

test("files saved by real Word, Excel and PowerPoint preview correctly", () => {
  const w = previewOffice(fixture("office-word.docx"));
  assert.deepEqual(w, { kind: "docx", blocks: [
    { text: "Port report", heading: true }, { text: "Jeddah berth 4 is congested.", heading: false }, { text: "تأخير متوقع يومين.", heading: false }] });
  const x = previewOffice(fixture("office-excel.xlsx"));
  assert.equal(x.kind, "xlsx");
  if (x.kind === "xlsx") {
    assert.equal(x.sheets[0].name, "Rates");
    assert.deepEqual(x.sheets[0].rows.slice(0, 3), [["Route", "USD"], ["Jeddah-Rotterdam", 2150], ["جدة-شنغهاي", 1890.75, 3781.5]]);
    assert.equal(x.sheets[0].rows[3][4], "far", "sparse cells land in the right column");
  }
  assert.deepEqual(previewOffice(fixture("office-slides.pptx")), { kind: "pptx", slides: [
    { n: 1, lines: ["OMEGA briefing", "Q4 logistics"] }, { n: 2, lines: ["Risks", "Suez delays", "البحر الأحمر"] }] });
});

test("written Excel and Word files read back intact (and opened in real Office during development)", () => {
  const x = previewOffice(writeXlsx([{ name: "A/B:[c]", rows: [["Name", "Qty", "Ok"], ["<جدة> & co", 12.5, true], [null, "x\u0001y"]] }]));
  assert.deepEqual(x, { kind: "xlsx", sheets: [{ name: "A B  c", rows: [["Name", "Qty", "Ok"], ["<جدة> & co", 12.5, true], [null, "xy"]], truncated: false }] });
  const d = previewOffice(writeDocx([{ text: "Title", style: "title" }, { text: "سطر\nثاني" }]));
  assert.deepEqual(d, { kind: "docx", blocks: [{ text: "Title", heading: false }, { text: "سطر\nثاني", heading: false }] });
});

test("zip reader refuses archives that expand too much", () => {
  // A deflated entry claiming 50 MB: the size check stops it before inflating.
  const big = Buffer.alloc(1024), z = writeZip([["a.xml", big]]);
  const dir = z.indexOf(Buffer.from([0x50, 0x4b, 1, 2]));
  z.writeUInt32LE(50 * 1024 * 1024, dir + 24);
  assert.throws(() => readZip(z), /expands too much/);
  assert.throws(() => readZip(Buffer.from("not a zip at all, definitely")), /not a zip/);
  assert.ok(deflateRawSync(big).length < big.length);
});

test("intake accepts Office files by content and refuses macros and plain zips", () => {
  assert.equal(sniff(new Uint8Array(fixture("office-word.docx")))?.ext, "docx");
  assert.equal(sniff(new Uint8Array(fixture("office-excel.xlsx")))?.ext, "xlsx");
  assert.equal(sniff(new Uint8Array(fixture("office-slides.pptx")))?.ext, "pptx");
  assert.equal(sniff(new Uint8Array(writeZip([["readme.txt", "hi"]]))), null, "plain zip");
  const macro = writeZip([["[Content_Types].xml", "<Types/>"], ["word/document.xml", "<w:document/>"], ["word/vbaProject.bin", Buffer.from([1, 2, 3])]]);
  assert.equal(sniff(new Uint8Array(macro)), null, "macro-enabled");
});

test("helpers", () => {
  assert.equal(colIndex("A1"), 0); assert.equal(colIndex("Z9"), 25); assert.equal(colIndex("AA10"), 26); assert.equal(colIndex("BC12"), 54);
  assert.equal(escapeXml('a<b>&"c"\u0002'), "a&lt;b&gt;&amp;&quot;c&quot;");
  assert.equal(officeKind(["[Content_Types].xml", "xl/workbook.xml"]), "xlsx");
  assert.equal(officeKind(["xl/workbook.xml"]), null);
  assert.ok(isSafeName("20261010-0a1b2c3d-photo.png"));
  for (const bad of ["../director.sqlite", "20261010-0a1b2c3d-x.exe", "x.docx", "20261010-0a1b2c3d-a/b.docx", "20261010-0a1b2c3d-..docx"]) assert.ok(!isSafeName(bad), bad);
});

test("ledger exports carry the approvals and rejections", () => {
  const approvals = [{ thread_id: "abc123abc123", request: "remember: TASK: book berth", status: "pending", risk: '{"level":"low"}', decided_by: null, decided_at: null, created_at: "2026-10-10 09:00:00" }];
  const rejections = [{ thread_id: "def456def456", code: "RISK-001", stage: "approval", reason: "too risky", rejected_by: "web:Ahmad", created_at: "2026-10-10 09:05:00" }];
  const x = previewOffice(ledgerFile("xlsx", approvals, rejections));
  assert.ok(x.kind === "xlsx" && x.sheets.length === 2 && x.sheets[0].rows[1][3] === "low" && x.sheets[1].rows[1][1] === "RISK-001");
  const d = previewOffice(ledgerFile("docx", approvals, rejections));
  assert.ok(d.kind === "docx" && d.blocks.some(b => b.text.includes("book berth")) && d.blocks.some(b => b.text.includes("RISK-001")));
});

test("Immich client: loopback only, v3 search, thumbnails by UUID, uploads as multipart", async () => {
  assert.equal(immichConfig({}), null);
  assert.throws(() => immichConfig({ IMMICH_URL: "http://evil.example", IMMICH_API_KEY: "k" }), /this laptop/);
  const env = { IMMICH_URL: "http://127.0.0.1:2283/", IMMICH_API_KEY: "k" };
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/search/metadata")) return Response.json({ assets: { items: [{ id: "1b4e28ba-2fa1-4d2a-883f-0016d3cca427", originalFileName: "a.jpg", type: "IMAGE", localDateTime: "2026-10-10T08:00:00Z", width: 4, height: 3 }] } });
    if (String(url).endsWith("/api/assets")) return Response.json({ id: "9b2f…", status: "created" }, { status: 201 });
    return new Response("img");
  }) as typeof fetch;
  const photos = await recentPhotos(10, env, f);
  assert.deepEqual(photos[0], { id: "1b4e28ba-2fa1-4d2a-883f-0016d3cca427", name: "a.jpg", type: "IMAGE", takenAt: "2026-10-10T08:00:00Z", width: 4, height: 3 });
  assert.equal(calls[0].url, "http://127.0.0.1:2283/api/search/metadata");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-api-key"], "k");
  await assert.rejects(thumbnail("../../etc", env, f), /bad id/);
  await thumbnail(photos[0].id, env, f);
  assert.match(calls[1].url, /\/api\/assets\/1b4e28ba-[^/]+\/thumbnail\?size=thumbnail$/);
  const id = await uploadPhoto(new Uint8Array([0xff, 0xd8, 0xff]), "p.jpg", "image/jpeg", env, f);
  assert.equal(id, "9b2f…");
  const form = calls[2].init?.body as FormData;
  assert.ok(form.get("assetData") instanceof Blob && form.get("fileCreatedAt") && form.get("fileModifiedAt"));
  assert.equal(await uploadPhoto(new Uint8Array([1]), "p.jpg", "image/jpeg", {}, f), null, "not configured: no upload");
});
