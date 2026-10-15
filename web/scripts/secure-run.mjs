#!/usr/bin/env node
// Run Next.js with web/.env.local decrypted by dotenvx (ADR-042):  node scripts/secure-run.mjs <dev|build|start> [args]
// The private key lives outside the project (OMEGA_ENV_KEYS, default %USERPROFILE%\.omega\secrets\web.env.keys), so
// the repository and the encrypted file alone reveal nothing. dotenvx never overwrites variables already set, so
// tests and Phoenix can still pass their own values.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..");
const keys = process.env.OMEGA_ENV_KEYS ?? path.join(homedir(), ".omega", "secrets", "web.env.keys");
const [cmd, ...rest] = process.argv.slice(2);
if (!["dev", "build", "start"].includes(cmd)) { console.error("usage: secure-run.mjs <dev|build|start> [next args]"); process.exit(2); }
if (!existsSync(keys)) { console.error(`[secrets] private key not found at ${keys}. Restore it from Bitwarden (docs/SECURITY.md).`); process.exit(1); }

const dotenvx = path.join(web, "node_modules", "@dotenvx", "dotenvx", "src", "cli", "dotenvx.js");
const next = path.join(web, "node_modules", "next", "dist", "bin", "next");
// dotenvx 1.75 mishandles absolute Windows paths for -f, so the env file is passed relative to the web folder.
const child = spawn(process.execPath, [dotenvx, "run", "-f", ".env.local", "-fk", keys, "--quiet", "--", process.execPath, next, cmd, ...rest],
  { cwd: web, stdio: "inherit", windowsHide: true });
child.on("exit", code => process.exit(code ?? 1));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
