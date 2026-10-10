// Web Push to Ahmad's phone (ADR-035), with no dependency: message encryption per RFC 8291 (aes128gcm) and
// sender identification per RFC 8292 (VAPID, ES256), on Node's built-in crypto. Push services only ever see
// ciphertext; subscriptions are accepted only for the browser vendors' own push services.
import { createECDH, createPrivateKey, createCipheriv, hkdfSync, randomBytes, sign, type KeyObject } from "node:crypto";

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Vapid = { publicKey: string; privateKey: string }; // base64url: 65-byte uncompressed point, 32-byte scalar

export const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
export const unb64u = (s: string) => Buffer.from(s, "base64url");

// The push services of Chrome/Android (FCM), Firefox, Safari/iOS and Edge. Anything else is refused, so a crafted
// subscription can't make the laptop send requests to arbitrary hosts.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];

export function validSubscription(x: unknown): Subscription {
  const s = x as Partial<Subscription>;
  if (!s || typeof s.endpoint !== "string" || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") throw new Error("bad subscription");
  const u = new URL(s.endpoint);
  if (u.protocol !== "https:" || !PUSH_HOSTS.some(h => h.test(u.hostname))) throw new Error("unknown push service");
  if (unb64u(s.keys.p256dh).length !== 65 || unb64u(s.keys.auth).length !== 16) throw new Error("bad subscription keys");
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

export function newVapid(): Vapid {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function privateKeyObject(v: Vapid): KeyObject {
  const pub = unb64u(v.publicKey);
  return createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: v.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
}

/** RFC 8291 §3-4: encrypt one record for a subscription. Salt and sender key are injectable for the RFC test vector. */
export function encrypt(payload: Buffer, sub: Subscription, opts: { salt?: Buffer; senderPrivate?: Buffer } = {}): Buffer {
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const ecdh = createECDH("prime256v1");
  if (opts.senderPrivate) ecdh.setPrivateKey(opts.senderPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const salt = opts.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  if (payload.length > 3800) throw new Error("push payload too large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** RFC 8292: the VAPID Authorization header for one push service origin. */
export function vapidHeader(endpoint: string, v: Vapid, subject: string, now = Date.now()): string {
  const enc = (o: unknown) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const sig = sign("sha256", Buffer.from(unsigned), { key: privateKeyObject(v), dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${v.publicKey}`;
}

/** Check a VAPID public key really matches its private key (guards against a hand-edited key file). */
export function vapidMatches(v: Vapid): boolean {
  try { const e = createECDH("prime256v1"); e.setPrivateKey(unb64u(v.privateKey)); return b64u(e.getPublicKey()) === v.publicKey; }
  catch { return false; }
}

export type Note = { title: string; body: string; url: string; tag?: string };

/** Send one notification. Returns the push service's status; 404/410 mean the subscription is gone. */
export async function sendPush(sub: Subscription, note: Note, v: Vapid, subject: string, f: typeof fetch = fetch): Promise<number> {
  const s = validSubscription(sub);
  const r = await f(s.endpoint, {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high",
      Authorization: vapidHeader(s.endpoint, v, subject) },
    body: new Uint8Array(encrypt(Buffer.from(JSON.stringify(note)), s)),
  });
  return r.status;
}
