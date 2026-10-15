import { test } from "node:test";
import assert from "node:assert/strict";
import { applyKeys, parseEnv, testAis, testFirms, testWindy } from "../src/lib/keys.ts";

test("parseEnv reads KEY=value lines, trims quotes, ignores comments", () => {
  assert.deepEqual(parseEnv('# note\nNASA_FIRMS_KEY= abc123 \nAISSTREAM_API_KEY="q-1"\nBROKEN LINE\nEMPTY=\n'),
    { NASA_FIRMS_KEY: "abc123", AISSTREAM_API_KEY: "q-1", EMPTY: "" });
});

test("applyKeys loads only the four data keys and never exposes values", () => {
  const env: Record<string, string | undefined> = { DIRECTOR_WEB_PIN: "keep" };
  const s = applyKeys({ NASA_FIRMS_KEY: "abcdef", DIRECTOR_WEB_PIN: "evil", AISSTREAM_API_KEY: "" }, env);
  assert.equal(env.NASA_FIRMS_KEY, "abcdef");
  assert.equal(env.DIRECTOR_WEB_PIN, "keep", "other variables are never touched");
  const firms = s.find(k => k.name === "NASA_FIRMS_KEY")!;
  assert.deepEqual([firms.set, firms.length, firms.loaded], [true, 6, true]);
  assert.equal(s.find(k => k.name === "AISSTREAM_API_KEY")!.set, false);
  assert.ok(!JSON.stringify(s).includes("abcdef"), "status carries no key value");
});

test("FIRMS and Windy verdicts", async () => {
  const firmsOk = (async () => new Response("latitude,longitude,bright_ti4\n29.1,48.0,330\n")) as typeof fetch;
  assert.deepEqual(await testFirms("k", firmsOk), { verdict: "ok", detail: "1 fire pixels in a test box" });
  const firmsBad = (async () => new Response("Invalid MAP_KEY.", { status: 400 })) as typeof fetch;
  assert.equal((await testFirms("k", firmsBad)).verdict, "invalid");
  const down = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.equal((await testFirms("k", down)).verdict, "unreachable");
  assert.equal((await testWindy("k", (async () => new Response("", { status: 401 })) as typeof fetch)).verdict, "invalid");
  assert.equal((await testWindy("k", (async () => Response.json({ webcams: [] })) as typeof fetch)).verdict, "ok");
});

test("AIS verdicts: dropped after the key = rejected, never connected = unreachable, a ship = working", async () => {
  type H = { onopen?: () => void; onmessage?: (e: { data: string }) => void; onerror?: () => void; onclose?: (e: { code: number }) => void };
  const fake = (script: (ws: H) => void) => class { onopen?: () => void; onmessage?: (e: { data: string }) => void; onerror?: () => void; onclose?: (e: { code: number }) => void;
    constructor() { setTimeout(() => script(this), 5); } send() {} close() {} } as unknown as typeof WebSocket;
  assert.equal((await testAis("k", 1000, fake(ws => { ws.onopen!(); ws.onerror!(); }))).verdict, "invalid");
  assert.equal((await testAis("k", 1000, fake(ws => { ws.onerror!(); }))).verdict, "unreachable");
  assert.equal((await testAis("k", 1000, fake(ws => { ws.onopen!(); ws.onmessage!({ data: JSON.stringify({ MessageType: "PositionReport" }) }); }))).verdict, "ok");
  assert.equal((await testAis("k", 50, fake(ws => { ws.onopen!(); }))).verdict, "unreachable", "quiet box: can't confirm");
});
