import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { access, authEnabled, configuredProviders, loadProfile, saveProfile, userDir, userKey, validProfile } from "../src/lib/accounts.ts";
import { makeThrottle } from "../src/lib/director.ts";
import { briefingEmail, sendEmail } from "../src/lib/mailer.ts";

const base = "/data";
const on = { NEXTAUTH_SECRET: "x".repeat(32), AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "s", DIRECTOR_WEB_PIN: "123456" };
const req = (h: Record<string, string> = {}) => new Request("http://localhost/api/paper", { headers: { host: "localhost", ...h } });
const key = userKey("github", "42", on.NEXTAUTH_SECRET);

test("accounts stay off until a secret and a provider are both configured", () => {
  assert.equal(authEnabled({}), false);
  assert.equal(authEnabled({ NEXTAUTH_SECRET: "short", AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "s" }), false);
  assert.equal(authEnabled({ NEXTAUTH_SECRET: "x".repeat(32) }), false, "a secret alone is not enough");
  assert.equal(authEnabled({ NEXTAUTH_SECRET: "x".repeat(32), AUTH_GOOGLE_ID: "id" }), false, "an id without its secret is not a provider");
  assert.equal(authEnabled(on), true);
  assert.deepEqual(configuredProviders(on), ["github"]);
  assert.deepEqual(configuredProviders({ ...on, AUTH_GOOGLE_ID: "g", AUTH_GOOGLE_SECRET: "gs" }), ["google", "github"], "Google is listed first");
  assert.equal(authEnabled({ NEXTAUTH_SECRET: "x".repeat(32), AUTH_GOOGLE_ID: "g", AUTH_GOOGLE_SECRET: "gs" }), true, "Google alone is enough");
});

test("unauthenticated requests to the paper engine are refused", async () => {
  for (const env of [on, {}, { DIRECTOR_WEB_PIN: "123456" }]) {
    const r = await access(req(), undefined, makeThrottle(), base, async () => null, env);
    assert.ok("blocked" in r && r.blocked.status === 401, JSON.stringify(env));
  }
  // Accounts off: even a session key is ignored, so nobody gets in without the PIN.
  const off = await access(req(), undefined, makeThrottle(), base, async () => key, {});
  assert.ok("blocked" in off && off.blocked.status === 401);
  // A wrong PIN is refused, and an empty PIN is not treated as a login.
  const wrong = await access(req(), "999999", makeThrottle(), base, async () => key, on);
  assert.ok("blocked" in wrong && wrong.blocked.status === 401);
  const empty = await access(req(), "", makeThrottle(), base, async () => null, on);
  assert.ok("blocked" in empty && empty.blocked.status === 401);
  // A cross-site request is refused before anything else.
  const cross = await access(req({ origin: "https://evil.example" }), "123456", makeThrottle(), base, async () => key, on);
  assert.ok("blocked" in cross && cross.blocked.status === 403);
  // A malformed key from a session never maps to a folder.
  const bad = await access(req(), undefined, makeThrottle(), base, async () => "../../etc", on);
  assert.ok("blocked" in bad && bad.blocked.status === 401);
});

test("the owner PIN keeps the existing data; each signed-in user gets their own folder", async () => {
  const owner = await access(req(), "123456", makeThrottle(), base, async () => null, on);
  assert.ok("actor" in owner);
  assert.deepEqual(owner.actor, { kind: "owner", dataDir: base, by: "web:Ahmad" });
  const user = await access(req(), undefined, makeThrottle(), base, async () => key, on);
  assert.ok("actor" in user);
  assert.equal(user.actor.dataDir, path.join(base, "users", key));
  assert.notEqual(userKey("github", "43", on.NEXTAUTH_SECRET), key, "different accounts, different folders");
  assert.notEqual(userKey("google", "42", on.NEXTAUTH_SECRET), key, "same id on another provider is another person");
  assert.throws(() => userDir(base, "../x"), /bad user key/);
  assert.match(key, /^[0-9a-f]{24}$/);
});

test("a profile holds only what the person types in, validated", async () => {
  const at = new Date("2026-10-16T00:00:00Z");
  const p = validProfile({ display_name: "  Test <b>User</b> ", country: "br", language: "en", email: "x@y.z" }, at);
  assert.deepEqual(p, { display_name: "Test bUser/b", country: "BR", language: "en", updated_at: at.toISOString() });
  assert.throws(() => validProfile({ display_name: "A", country: "KW", language: "ar" }), /2 to 40/);
  assert.throws(() => validProfile({ display_name: "Ahmad", country: "Kuwait", language: "ar" }), /two-letter/);
  assert.throws(() => validProfile({ display_name: "Ahmad", country: "KW", language: "fr" }), /ar or en/);
  const dir = mkdtempSync(path.join(tmpdir(), "omega-profile-"));
  assert.equal(await loadProfile(dir), null);
  await saveProfile(dir, p);
  assert.deepEqual(await loadProfile(dir), p);
});

test("every paper and profile handler checks who is asking", () => {
  for (const [f, check] of [["src/app/api/paper/route.ts", /const who = await access\(/g], ["src/app/api/paper/proposals/route.ts", /const who = await access\(/g],
    ["src/app/api/profile/route.ts", /const dir = await who\(req\);\s*if \(!dir\) return Response\.json\(\{ error: "sign in first" \}, \{ status: 401 \}\)/g]] as const) {
    const src = readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8");
    assert.equal([...src.matchAll(/export async function (GET|POST)/g)].length, [...src.matchAll(check)].length, `${f}: every handler checks access`);
    assert.ok(!/directorData\(\)\)\)|loadEvents\(directorData|appendEvent\(directorData/.test(src), `${f}: data goes through the actor's folder`);
  }
});

test("the briefing email is a placeholder: nothing is sent without an address, a sender and an approved test", async () => {
  assert.equal(briefingEmail("x", {}).send, false);
  assert.match((briefingEmail("x", { BRIEFING_EMAIL_TO: "ops@example.org" }) as { reason: string }).reason, /no mail sender/);
  const ready = { BRIEFING_EMAIL_TO: "ops@example.org", BRIEFING_EMAIL_FROM: "omega@example.org", BRIEFING_SMTP_URL: "smtp://example.org" };
  assert.match((briefingEmail("x", ready) as { reason: string }).reason, /approve a test send/);
  const plan = briefingEmail("body", { ...ready, BRIEFING_EMAIL_APPROVED: "yes" }, new Date("2026-10-16T06:00:00Z"));
  assert.ok(plan.send && plan.message.subject === "OMEGA paper briefing 2026-10-16");
  await assert.rejects(sendEmail(plan), /not built yet/);
  assert.equal(briefingEmail("x", { ...ready, BRIEFING_EMAIL_TO: "not an address", BRIEFING_EMAIL_APPROVED: "yes" }).send, false);
});
