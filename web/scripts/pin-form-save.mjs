#!/usr/bin/env node
// Saver behind the Desktop PIN window (ops/pin-window.ps1): reads {"pin": "..."} as JSON on stdin (never as an
// argument), accepts 6-12 digits (Arabic digits become 0-9) and stores it encrypted as DIRECTOR_WEB_PIN. Prints
// OK or ERROR: <reason>; never the PIN.
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..");
process.chdir(web);   // dotenvx 1.75 wants the env file path relative to the web folder
const keysFile = process.env.OMEGA_ENV_KEYS ?? path.join(homedir(), ".omega", "secrets", "web.env.keys");
const dotenvx = createRequire(path.join(web, "package.json"))("@dotenvx/dotenvx");

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let pin;
try { pin = String(JSON.parse(raw.replace(/^﻿/, "")).pin ?? ""); } catch { console.log("ERROR: bad input"); process.exit(1); }
pin = pin.trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0));
if (!/^[0-9]{6,12}$/.test(pin)) { console.log("ERROR: the PIN must be 6 to 12 digits"); process.exit(1); }

dotenvx.setLogLevel?.({ quiet: true });
dotenvx.set("DIRECTOR_WEB_PIN", pin, { path: ".env.local", envKeysFile: keysFile, encrypt: true });
const check = {};
dotenvx.config({ path: ".env.local", envKeysFile: keysFile, processEnv: check, quiet: true });
console.log(check.DIRECTOR_WEB_PIN === pin ? "OK" : "ERROR: could not verify the saved PIN");
process.exit(check.DIRECTOR_WEB_PIN === pin ? 0 : 1);
