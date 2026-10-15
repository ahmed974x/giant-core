import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installLogRedaction, redact, REDACTED, secretValues } from "../src/lib/logger.ts";
import { checkSecrets, envFileLines } from "../src/lib/security/check-secrets.ts";

const ENV = {
  DIRECTOR_WEB_PIN: "731905", NASA_FIRMS_KEY: "0123456789abcdef0123456789abcdef", AISSTREAM_API_KEY: "aaaabbbbccccdddd1111",
  DIRECTOR_DB_URL: "postgresql://omega_director:s3cr3tPassw0rdXYZ@127.0.0.1:5435/omega_memory?sslmode=disable",
  DOTENV_PUBLIC_KEY_LOCAL: "02f92dd72ae774d54fcbbd349d", NODE_ENV: "production", PORT: "3100",
};

test("every secret value and secret shape is redacted", () => {
  const s = secretValues(ENV);
  assert.ok(s.includes("731905") && s.includes("s3cr3tPassw0rdXYZ"), "values and the password inside the DB URL");
  assert.ok(!s.includes("02f92dd72ae774d54fcbbd349d") && !s.includes("production"), "public key and plain settings are not secrets");
  const line = `firms fetch https://firms.modaps.eosdis.nasa.gov/api/area/csv/${ENV.NASA_FIRMS_KEY}/VIIRS failed; pin=731905; db ${ENV.DIRECTOR_DB_URL}`;
  const out = redact(line, s);
  for (const v of [ENV.NASA_FIRMS_KEY, "731905", "s3cr3tPassw0rdXYZ"]) assert.ok(!out.includes(v), v);
  assert.ok(out.includes(REDACTED) && out.includes("firms.modaps.eosdis.nasa.gov"), out);
  // Shapes, even with values we've never seen
  for (const [input, gone] of [
    ["Authorization: Bearer abcdefghijklmnop12345", "abcdefghijklmnop12345"],
    ['{"x-api-key":"zzzzyyyyxxxx9999"}', "zzzzyyyyxxxx9999"],
    ["redis://admin:hunter2hunter@cache:6379", "hunter2hunter"],
    ["key fc-0123456789abcdefABCDEF found", "fc-0123456789abcdefABCDEF"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N", "dozjgNryP4J3jVmNHl0w5N"],
  ]) assert.ok(!redact(input, []).includes(gone), input);
});

test("console calls go through redaction (strings, objects, errors)", () => {
  const seen: unknown[][] = [];
  const fake = { log: (...a: unknown[]) => seen.push(a), info: () => {}, warn: () => {}, error: (...a: unknown[]) => seen.push(a), debug: () => {} } as unknown as Console;
  const old = process.env.DIRECTOR_WEB_PIN;
  process.env.DIRECTOR_WEB_PIN = "559911";
  installLogRedaction(fake);
  fake.log("pin is 559911", { pin: "559911", ok: true });
  fake.error(new Error("bad pin 559911"));
  process.env.DIRECTOR_WEB_PIN = old;
  const text = JSON.stringify(seen.map(a => a.map(x => (x instanceof Error ? x.message : x))));
  assert.ok(!text.includes("559911"), text);
  assert.ok(text.includes(REDACTED));
});

function project(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "omega-sec-"));
  const web = path.join(root, "web");
  mkdirSync(web);
  for (const [f, body] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); writeFileSync(path.join(root, f), body); }
  return { root, web };
}
const cleanGit = { git: (args: string[]) => (args.includes("check-ignore") ? { code: 0, out: "" } : args.includes("grep") ? { code: 1, out: "" } : { code: 0, out: "" }) };

test("startup check passes only for an encrypted, decrypted, untracked setup with the key outside", () => {
  const keyDir = mkdtempSync(path.join(tmpdir(), "omega-key-"));
  writeFileSync(path.join(keyDir, "web.env.keys"), "DOTENV_PRIVATE_KEY_LOCAL=x");
  const { web } = project({ "web/.env.local": 'DOTENV_PUBLIC_KEY_LOCAL="02ab"\nDIRECTOR_WEB_PIN="encrypted:BAAA111"\nNASA_FIRMS_KEY=""\n' });
  const env = { DIRECTOR_WEB_PIN: "731905", NASA_FIRMS_KEY: "", OMEGA_ENV_KEYS: path.join(keyDir, "web.env.keys") };
  const good = checkSecrets(web, env, cleanGit);
  assert.equal(good.ok, true, JSON.stringify(good.findings));

  const notDecrypted = checkSecrets(web, { ...env, DIRECTOR_WEB_PIN: "encrypted:BAAA111" }, cleanGit);
  assert.match(notDecrypted.findings.find(f => f.check === "loaded")!.detail, /not decrypted: DIRECTOR_WEB_PIN/);

  const plain = project({ "web/.env.local": "DIRECTOR_WEB_PIN=731905\n" });
  assert.match(checkSecrets(plain.web, env, cleanGit).findings.find(f => f.check === "encrypted")!.detail, /plain text values: DIRECTOR_WEB_PIN/);

  const keyInside = project({ "web/.env.local": 'X="encrypted:B1"\n', "web/.env.keys": "k" });
  const r = checkSecrets(keyInside.web, { X: "v", OMEGA_ENV_KEYS: path.join(keyInside.web, ".env.keys") }, cleanGit);
  assert.ok(r.findings.some(f => f.check === "key-location" && !f.ok));

  const leaky = { git: (args: string[]) => (args.includes("ls-files") ? { code: 0, out: "web/.env.local\n" } : args.includes("grep") ? { code: 0, out: "notes.md\n" } : { code: 1, out: "" }) };
  const bad = checkSecrets(web, env, leaky);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.findings.filter(f => !f.ok).map(f => f.check).sort(), ["git-content", "git-ignored", "git-tracked"]);
  assert.ok(!JSON.stringify(bad).includes("731905"), "the report never contains a value");
});

test("env file parsing", () => {
  assert.deepEqual(envFileLines('#c\nA="encrypted:x"\nB = 1 \nnot a line\n'), [["A", "encrypted:x"], ["B", "1"]]);
});

test("tooling variables whose names only look secret are not treated as secrets", () => {
  const s = secretValues({ npm_package_scripts_secrets_check: "node scripts/secrets.mjs check", __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3100", DIRECTOR_WEB_PIN: "731905" });
  assert.deepEqual(s, ["731905"]);
});
