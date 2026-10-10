#!/usr/bin/env node
// Open a Keys Vault link (ADR-043):  npm run keys:vault
// Creates a one-time, 10-minute session (only the token's SHA-256 is stored) and prints the phone link.
// Options: --lan <ip> (default: OMEGA_LAN_IP or the first private IPv4), --out <file> (write the link there instead
// of printing it, e.g. for emailing it without it appearing in a terminal or log).
import { writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..");
process.chdir(web);
const { createSession, LINK_TTL_MS } = await import("../src/lib/keys-vault.ts");
const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const lan = opt("--lan") ?? process.env.OMEGA_LAN_IP ?? Object.values(networkInterfaces()).flat()
  .find(a => a && a.family === "IPv4" && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(a.address))?.address ?? "127.0.0.1";
const data = process.env.DIRECTOR_DATA_DIR ?? path.resolve(web, "..", "services", "director00", "data");
const { token, expires } = await createSession(data);
const link = `https://${lan}:8443/ar/keys-vault?token=${token}`;
const out = opt("--out");
if (out) { writeFileSync(out, link); console.log(`vault link written to ${out}; valid until ${new Date(expires).toLocaleTimeString()} (${LINK_TTL_MS / 60000} min, one use)`); }
else console.log(`${link}\nvalid ${LINK_TTL_MS / 60000} minutes, one use, needs the PIN`);
