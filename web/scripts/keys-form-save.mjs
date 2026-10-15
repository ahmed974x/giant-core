#!/usr/bin/env node
// Saver behind the Desktop "keys window" (ops/keys-window.ps1): reads the pasted keys as JSON on stdin (never as
// arguments), checks they look like keys, stores them, tests them, and prints one verdict line per key. Values are
// never printed.
// - Data keys (NASA_FIRMS_KEY, AISSTREAM_API_KEY): encrypted in web/.env.local plus the Desktop copy (ADR-043).
// - Free AI keys (GROQ_API_KEY, CEREBRAS_API_KEY, GEMINI_API_KEY; ADR-058): written to giant-core/.env, where the Cortex gateway reads
//   them, then Cortex is restarted so Oracle's fast path goes live. Both are free tiers; no paid key is accepted here.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..");
const core = path.resolve(web, "..");
process.chdir(web);   // dotenvx 1.75 wants the env file path relative to the web folder
const keysFile = process.env.OMEGA_ENV_KEYS ?? path.join(homedir(), ".omega", "secrets", "web.env.keys");
const dotenvx = createRequire(path.join(web, "package.json"))("@dotenvx/dotenvx");
const { validateKeys, writeDesktopFile } = await import("../src/lib/keys-vault.ts");
const { testKey } = await import("../src/lib/keys.ts");

// Free AI provider keys: exact shapes, so a pasted link code or sentence is refused before anything is written.
export const AI_KEYS = {
  GROQ_API_KEY: /^gsk_[A-Za-z0-9]{40,64}$/,
  CEREBRAS_API_KEY: /^csk-[A-Za-z0-9]{30,80}$/,
  GEMINI_API_KEY: /^AIza[0-9A-Za-z_-]{35}$/,
};

async function testAi(name, key) {
  try {
    const bearer = { GROQ_API_KEY: "https://api.groq.com/openai/v1/models", CEREBRAS_API_KEY: "https://api.cerebras.ai/v1/models" }[name];
    const r = bearer
      ? await fetch(bearer, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
      : await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) return { verdict: "ok", detail: "the provider accepted it" };
    if (r.status === 401 || r.status === 403 || r.status === 400) return { verdict: "invalid", detail: `the provider refused it (${r.status})` };
    return { verdict: "unreachable", detail: `the provider answered ${r.status}` };
  } catch { return { verdict: "unreachable", detail: "no answer from the provider" }; }
}

function setStackEnv(name, value) {
  const file = path.join(core, ".env");
  let text = readFileSync(file, "utf8");
  const line = `${name}=${value}`;
  text = new RegExp(`^${name}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${name}=.*$`, "m"), line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  writeFileSync(file, text);
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let input;
try { input = JSON.parse(raw.replace(/^﻿/, "")); } catch { console.log("ERROR: bad input"); process.exit(1); }

const ai = {};
for (const [name, shape] of Object.entries(AI_KEYS)) {
  const v = typeof input[name] === "string" ? input[name].trim() : "";
  if (!v) continue;
  if (!shape.test(v)) { console.log(`ERROR: ${name} doesn't look like that provider's key`); process.exit(1); }
  ai[name] = v;
}
let keys = {};
const hasData = ["NASA_FIRMS_KEY", "AISSTREAM_API_KEY"].some(k => typeof input[k] === "string" && input[k].trim());
if (hasData) {
  try { keys = validateKeys(input); } catch (e) { console.log(`ERROR: ${e.message}`); process.exit(1); }
}
if (!Object.keys(keys).length && !Object.keys(ai).length) { console.log("ERROR: nothing pasted"); process.exit(1); }

let ok = true;
if (Object.keys(keys).length) {
  dotenvx.setLogLevel?.({ quiet: true });
  for (const k of Object.keys(keys)) dotenvx.set(k, keys[k], { path: ".env.local", envKeysFile: keysFile, encrypt: true });
  await writeDesktopFile(path.join(homedir(), "Desktop", "المفاتيح.txt"), keys);
  for (const k of Object.keys(keys)) {
    const r = await testKey(k, keys[k]);
    if (r.verdict !== "ok") ok = false;
    console.log(`${k}: ${r.verdict} - ${r.detail}`);
  }
}
if (Object.keys(ai).length) {
  for (const [k, v] of Object.entries(ai)) {
    const r = await testAi(k, v);
    if (r.verdict === "invalid") { ok = false; console.log(`${k}: invalid - ${r.detail}; not saved`); continue; }
    setStackEnv(k, v);
    if (r.verdict !== "ok") ok = false;
    console.log(`${k}: ${r.verdict} - ${r.detail}`);
  }
  try {   // Cortex reads its keys at start: recreate it so the new keys take effect.
    execFileSync("docker", ["compose", "up", "-d", "cortex"], { cwd: core, stdio: "ignore", timeout: 120_000 });
  } catch { console.log("CORTEX: restart failed; run 'docker compose up -d cortex' in giant-core"); }
}
process.exit(ok ? 0 : 2);
