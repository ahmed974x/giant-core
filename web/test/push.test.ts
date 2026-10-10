import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { b64u, encrypt, newVapid, unb64u, validSubscription, vapidHeader, vapidMatches } from "../src/lib/webpush.ts";
import { broadcast, loadStore, pendingAlerts, saveSubs } from "../src/lib/alerts.ts";

// RFC 8291 section 5: the published example must come out byte for byte.
test("aes128gcm encryption matches the RFC 8291 test vector", () => {
  const sub = { endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" } };
  const out = encrypt(Buffer.from("When I grow up, I want to be a watermelon"), sub, { salt: unb64u("DGv6ra1nlYgDCS1FRnbzlw"), senderPrivate: unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") });
  assert.equal(b64u(out), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("a phone can decrypt what we send (fresh keys, Arabic payload)", () => {
  const ua = createECDH("prime256v1"); ua.generateKeys();
  const auth = Buffer.alloc(16, 7), sub = { endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };
  const msg = JSON.stringify({ title: "Director 00", body: "اقتراح ينتظر موافقتك" });
  const out = encrypt(Buffer.from(msg), sub);
  const salt = out.subarray(0, 16), idlen = out[20], asPub = out.subarray(21, 21 + idlen), body = out.subarray(21 + idlen);
  const ikm = Buffer.from(hkdfSync("sha256", ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]), 32));
  const cek = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const d = createDecipheriv("aes-128-gcm", Buffer.from(cek), Buffer.from(nonce));
  d.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  assert.equal(plain.subarray(0, -1).toString(), msg);
});

test("VAPID header is a valid ES256 JWT for the push service origin", () => {
  const v = newVapid();
  assert.ok(vapidMatches(v));
  assert.equal(vapidMatches({ ...v, publicKey: newVapid().publicKey }), false);
  const h = vapidHeader("https://fcm.googleapis.com/fcm/send/abc", v, "https://omega-prime.local/alerts", Date.UTC(2026, 9, 10));
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assert.equal(k, v.publicKey);
  const [hdr, claims, sig] = jwt.split(".");
  const c = JSON.parse(unb64u(claims).toString());
  assert.equal(c.aud, "https://fcm.googleapis.com");
  assert.equal(c.exp, Date.UTC(2026, 9, 10) / 1000 + 12 * 3600);
  const pub = unb64u(v.publicKey), key = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
  assert.ok(verify("sha256", Buffer.from(`${hdr}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, unb64u(sig)));
});

test("only the browser vendors' push services are accepted", () => {
  const keys = { p256dh: b64u(Buffer.alloc(65, 4)), auth: b64u(Buffer.alloc(16)) };
  for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/x", "https://wns2-by3p.notify.windows.com/w/?token=x"])
    assert.doesNotThrow(() => validSubscription({ endpoint: ok, keys }), ok);
  for (const bad of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://evil.com/fcm.googleapis.com", "https://push.apple.com.evil.com/x"])
    assert.throws(() => validSubscription({ endpoint: bad, keys }), bad);
  assert.throws(() => validSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: keys.auth } }));
});

test("new proposals and Phoenix incidents become alerts once; first run only bookmarks Phoenix", () => {
  const proposals = [
    { thread_id: "a", request: "remember: TASK: profit sweep plan", status: "pending", created_at: "2026-10-10T10:00:00Z" },
    { thread_id: "b", request: "decision: pause alerts", status: "escalated", created_at: "2026-10-10T10:05:00Z" },
    { thread_id: "c", request: "old", status: "pending", created_at: "2026-10-10T08:00:00Z" },
  ];
  const phoenix = [
    { id: 5, ts: "", service: "web", action: "restart", result: "ok", detail: "web restarted" },
    { id: 4, ts: "", service: "phoenix", action: "heartbeat", result: "ok", detail: "" },
  ];
  const first = pendingAlerts(proposals, phoenix, { proposalAt: "2026-10-10T09:00:00Z", phoenixId: -1 });
  assert.deepEqual(first.notes.map(n => n.tag), ["proposal-a", "proposal-b"]);
  assert.match(first.notes[1].title, /high risk/);
  assert.deepEqual(first.state, { proposalAt: "2026-10-10T10:05:00Z", phoenixId: 5 });
  const next = pendingAlerts(proposals, [{ id: 6, ts: "", service: "caddy", action: "check", result: "down", detail: "port 8443 closed" }, ...phoenix], first.state);
  assert.deepEqual(next.notes.map(n => n.tag), ["phoenix-6"]);
  assert.match(next.notes[0].title, /caddy check \(down\)/);
});

test("broadcast drops subscriptions the push service says are gone", async () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "omega-push-")), "push");
  const ua = createECDH("prime256v1"); ua.generateKeys();
  const keys = { p256dh: b64u(ua.getPublicKey()), auth: b64u(Buffer.alloc(16, 1)) };
  await saveSubs(dir, [{ endpoint: "https://fcm.googleapis.com/live", keys }, { endpoint: "https://fcm.googleapis.com/gone", keys }]);
  const store = await loadStore(dir);
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (u: string | URL, init?: RequestInit) => {
    calls.push({ url: String(u), headers: init?.headers as Record<string, string> });
    return new Response(null, { status: String(u).endsWith("gone") ? 410 : 201 });
  }) as typeof fetch;
  const r = await broadcast(dir, store, { title: "t", body: "b", url: "/ar" }, f);
  assert.deepEqual(r, { sent: 1, removed: 1 });
  assert.deepEqual((await loadStore(dir)).subs.map(s => s.endpoint), ["https://fcm.googleapis.com/live"]);
  assert.equal(calls[0].headers["Content-Encoding"], "aes128gcm");
  assert.match(calls[0].headers.Authorization, /^vapid t=.+, k=/);
});
