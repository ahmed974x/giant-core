#!/usr/bin/env node
// Secrets helper (ADR-042). Values are never printed.
//   node scripts/secrets.mjs encrypt          encrypt every plain value in web/.env.local (key file outside the project)
//   node scripts/secrets.mjs set NAME         add or replace one value, typed at a hidden prompt, stored encrypted
//   node scripts/secrets.mjs check            the same check the server runs at start
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const web = path.resolve(import.meta.dirname, "..");
const keys = process.env.OMEGA_ENV_KEYS ?? path.join(homedir(), ".omega", "secrets", "web.env.keys");
const dotenvx = path.join(web, "node_modules", "@dotenvx", "dotenvx", "src", "cli", "dotenvx.js");
const run = args => execFileSync(process.execPath, [dotenvx, ...args], { cwd: web, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const [cmd, name] = process.argv.slice(2);

function hidden(prompt) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.startsWith(prompt)) rl.output.write(prompt); };   // echo nothing typed
    rl.question(prompt, v => { rl.close(); process.stdout.write("\n"); resolve(v.trim()); });
  });
}

if (cmd === "encrypt") {
  mkdirSync(path.dirname(keys), { recursive: true });
  run(["encrypt", "-f", ".env.local", "-fk", keys]);
  console.log(`encrypted web/.env.local; private key: ${keys}`);
} else if (cmd === "set") {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(name ?? "")) { console.error("usage: secrets.mjs set NAME"); process.exit(2); }
  if (!existsSync(keys)) { console.error(`private key not found at ${keys}`); process.exit(1); }
  const value = await hidden(`${name}: `);
  if (!value) { console.error("nothing typed; unchanged"); process.exit(1); }
  run(["set", name, value, "-f", ".env.local", "-fk", keys, "--encrypt"]);
  console.log(`${name} stored encrypted (${value.length} characters)`);
} else if (cmd === "check") {
  // Check the file with the secrets decrypted in a child process, the way the server sees them.
  const script = "import('./src/lib/security/check-secrets.ts').then(m=>{const r=m.checkSecrets(process.cwd());for(const f of r.findings)console.log((f.ok?'ok   ':'FAIL ')+f.check+': '+f.detail);process.exit(r.ok?0:1)})";
  try {
    console.log(execFileSync(process.execPath, [dotenvx, "run", "-f", ".env.local", "-fk", keys, "--quiet", "--", process.execPath,
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "-e", script], { cwd: web, encoding: "utf8" }).trim());
  } catch (e) { console.log(String(e.stdout ?? "").trim()); process.exit(1); }
} else {
  console.error("usage: secrets.mjs <encrypt|set NAME|check>"); process.exit(2);
}
