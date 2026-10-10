#!/usr/bin/env node
// Secrets helper (ADR-042). Values are never printed and never passed as process arguments.
//   node scripts/secrets.mjs encrypt          encrypt every plain value in web/.env.local (key file outside the project)
//   node scripts/secrets.mjs set NAME         add or replace one value, typed at a hidden prompt, stored encrypted
//   node scripts/secrets.mjs test             load the data keys into the running site and test each one
//   node scripts/secrets.mjs backup           put the private key on the clipboard for 60 s (for Bitwarden), then clear it
//   node scripts/secrets.mjs check            the same check the server runs at start
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const web = path.resolve(import.meta.dirname, "..");
const keys = process.env.OMEGA_ENV_KEYS ?? path.join(homedir(), ".omega", "secrets", "web.env.keys");
const dotenvxCli = path.join(web, "node_modules", "@dotenvx", "dotenvx", "src", "cli", "dotenvx.js");
const dotenvx = createRequire(path.join(web, "package.json"))("@dotenvx/dotenvx");
const [cmd, name] = process.argv.slice(2);
process.chdir(web);   // dotenvx 1.75 wants the env file path relative to the web folder

function hidden(prompt) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.startsWith(prompt)) rl.output.write(prompt); };   // echo nothing typed
    rl.question(prompt, v => { rl.close(); process.stdout.write("\n"); resolve(v.trim()); });
  });
}
const decrypted = () => { const out = {}; dotenvx.config({ path: ".env.local", envKeysFile: keys, processEnv: out, quiet: true }); return out; };
const needKey = () => { if (!existsSync(keys)) { console.error(`private key not found at ${keys}. Restore it from Bitwarden.`); process.exit(1); } };

if (cmd === "encrypt") {
  mkdirSync(path.dirname(keys), { recursive: true });
  execFileSync(process.execPath, [dotenvxCli, "encrypt", "-f", ".env.local", "-fk", keys], { stdio: "ignore" });
  console.log(`encrypted web/.env.local; private key: ${keys}`);
} else if (cmd === "set") {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name ?? "")) { console.error("usage: secrets.mjs set NAME"); process.exit(2); }
  needKey();
  const value = await hidden(`${name}: `);
  if (!value) { console.error("nothing typed; unchanged"); process.exit(1); }
  dotenvx.setLogLevel?.({ quiet: true });
  dotenvx.set(name, value, { path: ".env.local", envKeysFile: keys, encrypt: true });
  const ok = decrypted()[name] === value;
  console.log(ok ? `${name} stored encrypted (${value.length} characters)` : `${name}: could not verify the stored value`);
  process.exit(ok ? 0 : 1);
} else if (cmd === "test") {
  needKey();
  const pin = decrypted().DIRECTOR_WEB_PIN;
  const r = await fetch("http://127.0.0.1:3100/api/keys", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3100" },
    body: JSON.stringify({ pin }) }).catch(() => null);
  if (!r?.ok) { console.error(`the site didn't answer (${r?.status ?? "offline"}); is it running?`); process.exit(1); }
  const label = { ok: "WORKING", invalid: "REJECTED", unreachable: "COULDN'T CONFIRM", "not-set": "empty" };
  for (const k of (await r.json()).keys) console.log(`${label[k.verdict] ?? k.verdict}`.padEnd(18) + `${k.feed}${k.detail ? `  (${k.detail})` : ""}`);
} else if (cmd === "backup") {
  needKey();
  const line = readFileSync(keys, "utf8").split(/\r?\n/).find(l => l.startsWith("DOTENV_PRIVATE_KEY_LOCAL="));
  if (!line) { console.error("no DOTENV_PRIVATE_KEY_LOCAL line in the key file"); process.exit(1); }
  spawnSync("clip", { input: line, windowsHide: true });
  console.log("The private key is on the clipboard for 60 seconds. Paste it into a Bitwarden secure note named");
  console.log('"OMEGA web private key" now. Opening Bitwarden...');
  spawnSync("cmd", ["/c", "start", "", "https://vault.bitwarden.com/#/vault"], { windowsHide: true });
  for (let s = 60; s > 0; s -= 10) { process.stdout.write(`  clearing in ${s} s\r`); await new Promise(r => setTimeout(r, 10_000)); }
  spawnSync("cmd", ["/c", "echo off | clip"], { windowsHide: true });
  console.log("\nClipboard cleared.");
} else if (cmd === "check") {
  // Check the file with the secrets decrypted in a child process, the way the server sees them.
  const script = "import('./src/lib/security/check-secrets.ts').then(m=>{const r=m.checkSecrets(process.cwd());for(const f of r.findings)console.log((f.ok?'ok   ':'FAIL ')+f.check+': '+f.detail);process.exit(r.ok?0:1)})";
  try {
    console.log(execFileSync(process.execPath, [dotenvxCli, "run", "-f", ".env.local", "-fk", keys, "--quiet", "--", process.execPath,
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "-e", script], { cwd: web, encoding: "utf8" }).trim());
  } catch (e) { console.log(String(e.stdout ?? "").trim()); process.exit(1); }
} else {
  console.error("usage: secrets.mjs <encrypt | set NAME | test | backup | check>"); process.exit(2);
}
