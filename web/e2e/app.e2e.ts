// End-to-end (ADR-034): starts a separate production server on :3199 with a throwaway Director 00 ledger and a test
// PIN, then drives every screen and flow the phone uses: pages in both languages, guards, phone intake (note, Word,
// refused file), approvals, Library previews, Word/Excel/PowerPoint exports, Review sign-off, Profit Sweeper,
// nervous system and atlas, and a headless-Chrome check that the main screens render without console errors.
// Needs a build first: npm run build && npm run e2e. Never touches the real ledger, inbox or PIN.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { previewOffice } from "../src/lib/office.ts";
import { validate, type LiveNode, type Registry } from "../src/lib/network.ts";

const WEB = path.resolve(import.meta.dirname, "..");
const PORT = 3199, BASE = `http://127.0.0.1:${PORT}`, PIN = "e2e-424242";
const DATA = mkdtempSync(path.join(tmpdir(), "omega-e2e-"));
const ROOT = mkdtempSync(path.join(tmpdir(), "omega-e2e-root-"));
const CHROME = process.env.CHROME_PATH ?? ["C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/opt/pw-browsers/chromium"].find(existsSync);
let server: ChildProcess;

const get = (p: string, headers: Record<string, string> = {}) => fetch(BASE + p, { headers, cache: "no-store" });
const json = async (p: string, headers: Record<string, string> = {}) => (await get(p, headers)).json();
const post = (p: string, body: unknown) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });
const pin = { "x-omega-pin": PIN };
async function intake(fields: Record<string, string>, file?: { name: string; bytes: Uint8Array }) {
  const f = new FormData();
  f.set("pin", PIN);
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (file) f.set("file", new Blob([new Uint8Array(file.bytes)]), file.name);
  const r = await fetch(`${BASE}/api/intake`, { method: "POST", body: f, headers: { Origin: BASE } });
  return { status: r.status, body: await r.json() };
}

before(async () => {
  assert.ok(existsSync(path.join(WEB, ".next", "BUILD_ID")), "run `npm run build` first");
  mkdirSync(path.join(DATA, "inbox"), { recursive: true });
  // Copies of the reviewed files, so Review edits and approvals never touch the real ones.
  for (const rel of ["services/truth/sources.json", "services/causal/assumptions.json", "services/sweeper/rules.json"]) {
    mkdirSync(path.join(ROOT, path.dirname(rel)), { recursive: true });
    copyFileSync(path.join(WEB, "..", rel), path.join(ROOT, rel));
  }
  // Positions with a tiny cost so the sweeper always has something to propose, whatever the live price.
  writeFileSync(path.join(DATA, "positions.json"), JSON.stringify({ positions: [{ symbol: "BTCUSDT", qty: 0.01, cost_usd: 1 }] }));
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", ".", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: WEB, stdio: "ignore", windowsHide: true,
    env: { ...process.env, DIRECTOR_DATA_DIR: DATA, OMEGA_ROOT: ROOT, DIRECTOR_DB_URL: "", OMEGA_SECRETS_CHECK: "report", DIRECTOR_WEB_PIN: PIN, IMMICH_URL: "", IMMICH_API_KEY: "", FIRECRAWL_API_KEY: "", NODE_ENV: "production" },
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await get("/api/health")).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("test server did not start");
});
after(() => { server?.kill(); });

test("every screen renders in Arabic and English", async () => {
  for (const locale of ["ar", "en"]) for (const route of ["", "/company", "/market", "/research", "/earth", "/atlas", "/send", "/network", "/library", "/review"]) {
    const r = await get(`/${locale}${route}`);
    assert.equal(r.status, 200, `/${locale}${route}`);
    const html = await r.text();
    assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`), `/${locale}${route} lang`);
  }
  assert.equal((await get("/manifest.webmanifest")).status, 200);
  assert.equal((await get("/sw.js")).status, 200);
});

test("private routes refuse a missing PIN, a wrong PIN and another origin", async () => {
  assert.equal((await get("/api/documents")).status, 401);
  assert.equal((await get("/api/documents", { "x-omega-pin": "000000" })).status, 401);
  const cross = await fetch(`${BASE}/api/director`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ action: "ask", request: "hello there", pin: PIN }) });
  assert.equal(cross.status, 403);
});

test("a note from the phone waits for approval, then approval executes it", async () => {
  const sent = await intake({ kind: "note", text: "e2e: tanker queue at Fujairah" });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, "awaiting_approval");
  const inbox = await json("/api/director");
  assert.ok(inbox.pending.some((p: { thread_id: string }) => p.thread_id === sent.body.thread_id));
  const ok = await (await post("/api/director", { action: "approve", thread_id: sent.body.thread_id, pin: PIN })).json();
  assert.equal(ok.status, "executed");
  assert.ok(!(await json("/api/director")).pending.some((p: { thread_id: string }) => p.thread_id === sent.body.thread_id));
});

test("Word files from the phone open in the Library; executables are refused", async () => {
  const docx = readFileSync(path.join(WEB, "test/fixtures/office-word.docx"));
  const sent = await intake({ kind: "note", text: "e2e: port report" }, { name: "report.docx", bytes: docx });
  assert.equal(sent.status, 200);
  assert.match(sent.body.attachment, /^inbox\/\d{8}-[0-9a-f]{8}-report\.docx$/);
  const list = await json("/api/documents", pin);
  const item = list.items.find((d: { name: string }) => sent.body.attachment.endsWith(d.name));
  const p = await json(`/api/documents?file=${encodeURIComponent(item.name)}`, pin);
  assert.equal(p.kind, "docx");
  assert.equal(p.blocks[0].text, "Port report");
  const exe = await intake({ kind: "note", text: "e2e: bad file" }, { name: "photo.png", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0]) });
  assert.equal(exe.status, 415);
  assert.equal((await get("/api/documents?file=..%2Fdirector.sqlite", pin)).status, 400);
});

test("the ledger exports open as Excel, Word and PowerPoint", async () => {
  const kinds = { xlsx: "xlsx", docx: "docx", pptx: "pptx" } as const;
  for (const fmt of Object.keys(kinds) as (keyof typeof kinds)[]) {
    const r = await get(`/api/documents?export=${fmt}`, pin);
    assert.equal(r.status, 200, fmt);
    assert.equal(previewOffice(Buffer.from(await r.arrayBuffer())).kind, kinds[fmt]);
  }
});

test("Review sign-off is recorded against the current content", async () => {
  const { items } = await json("/api/review", pin);
  assert.deepEqual(items.map((i: { id: string }) => i.id), ["sources", "butterfly", "sweeper", "restic"]);
  const src = items[0];
  const r = await (await post("/api/review", { pin: PIN, id: "sources", hash: src.hash })).json();
  assert.equal(r.ok, true);
  assert.equal((await json("/api/review", pin)).items[0].current, true);
  assert.equal((await post("/api/review", { pin: PIN, id: "sources", hash: "000000000000" })).status, 409);
});

test("Profit Sweeper proposes a plan into the approval inbox and never trades", async () => {
  const plan = await json("/api/sweeper", pin);
  if (plan.state === "no-prices") return; // offline: the sweeper says so instead of guessing
  assert.equal(plan.state, "ok");
  assert.equal(plan.plan.lines[0].reason, "sweep");
  const sent = await (await post("/api/sweeper", { pin: PIN })).json();
  assert.equal(sent.ok, true);
  const waiting = (await json("/api/director")).pending.find((p: { thread_id: string }) => p.thread_id === sent.thread_id);
  assert.match(waiting.request, /profit sweep plan .*OMEGA does not trade/);
  const rejected = await (await post("/api/director", { action: "reject", thread_id: sent.thread_id, code: "USER-005", pin: PIN })).json();
  assert.equal(rejected.status, "rejected");
});

test("the nervous system is one valid network with live states, and the atlas searches", async () => {
  const net = await json("/api/network") as { nodes: LiveNode[]; edges: Registry["edges"] };
  assert.deepEqual(validate(net), []);
  for (const id of ["director", "truth", "butterfly", "phoenix", "sweeper", "screen-review", "immich", "e2e", "alerts", "briefing", "drill"]) assert.ok(net.nodes.some(n => n.id === id), id);
  assert.equal(net.nodes.find(n => n.id === "immich")!.state, "needs-key");
  const atlas = await json("/api/atlas?q=security&limit=5");
  assert.ok(atlas.results.length > 0);
});

test("the main screens render in a real browser without console errors", { skip: !CHROME && "no Chrome found (set CHROME_PATH)" }, async () => {
  for (const route of ["/ar", "/ar/network", "/en/library", "/ar/market"]) {
    const errors = await browse(route);
    assert.deepEqual(errors, [], route);
  }
});

/** Load a page in headless Chrome over the DevTools protocol and return console errors and uncaught exceptions. */
async function browse(route: string): Promise<string[]> {
  const port = 9600 + Math.floor(Math.random() * 300), profile = mkdtempSync(path.join(tmpdir(), "omega-e2e-chrome-"));
  const chrome = spawn(CHROME!, ["--headless=new", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 40 && !target; i++) {
      await new Promise(r => setTimeout(r, 250));
      try { target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find(t => t.type === "page"); } catch { /* starting */ }
    }
    const ws = new WebSocket(target!.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener("open", r, { once: true }));
    const errors: string[] = [];
    let id = 0;
    ws.addEventListener("message", e => {
      const m = JSON.parse(String(e.data));
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" "));
    });
    const send = (method: string, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
    send("Runtime.enable"); send("Page.enable"); send("Page.navigate", { url: BASE + route });
    await new Promise(r => setTimeout(r, 6000));
    ws.close();
    // The relay (Docker) is off on the laptop, so its fetch failures are expected noise, not page errors.
    return errors.filter(e => !/relay|ERR_CONNECTION_REFUSED|Failed to load resource|WebGL|GPU stall/i.test(e));
  } finally { chrome.kill(); }
}

test("phone alerts: public key served, foreign push hosts refused, nothing sent without a phone", async () => {
  const { publicKey, subscribed } = await json("/api/push");
  assert.equal(Buffer.from(publicKey, "base64url").length, 65);
  assert.equal(subscribed, 0);
  const keys = { p256dh: publicKey, auth: Buffer.alloc(16).toString("base64url") };
  assert.equal((await post("/api/push", { pin: PIN, action: "subscribe", subscription: { endpoint: "https://evil.example/push", keys } })).status, 400);
  assert.equal((await post("/api/push", { pin: PIN, action: "test" })).status, 409);
  assert.equal((await post("/api/push", { pin: "000000", action: "test" })).status, 401);
});

test("Profit Sweeper rules are edited on the Review screen and then need approval", async () => {
  const edit = await post("/api/review", { pin: PIN, id: "sweeper", action: "edit", values: { min_gain_pct: 20, sweep_share: 0.5, min_sweep_usd: 25, reserve: "USDT" } });
  assert.equal(edit.status, 200);
  const sweeper = (await json("/api/review", pin)).items.find((i: { id: string }) => i.id === "sweeper");
  assert.equal(sweeper.content.min_gain_pct, 20);
  assert.equal((await post("/api/review", { pin: PIN, id: "sweeper", action: "edit", values: { min_gain_pct: 20, sweep_share: 5, min_sweep_usd: 25, reserve: "USDT" } })).status, 400);
  assert.equal((await post("/api/review", { pin: PIN, id: "sources", action: "edit", values: {} })).status, 400);
});
