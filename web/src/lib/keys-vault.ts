// Keys Vault (ADR-043): Ahmad pastes his data keys on the phone; the laptop stores them encrypted in web/.env.local
// (dotenvx), writes the personal plain copy he asked for on the Desktop, tests each key, and answers the phone.
// Access: a one-time link (random token, only its SHA-256 is stored, 10 minutes, burned on first save) plus the PIN,
// HTTPS through Caddy. Nothing here logs or returns a key value; the audit log holds names and verdicts only.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const VAULT_KEYS = ["NASA_FIRMS_KEY", "AISSTREAM_API_KEY"] as const;
export type VaultKey = (typeof VAULT_KEYS)[number];
export const LINK_TTL_MS = 10 * 60_000;

type Session = { hash: string; expires: number; used: boolean; created: string };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Create a one-time session; returns the token (shown once, in the link) and when it expires. */
export async function createSession(dataDir: string, now = Date.now()): Promise<{ token: string; expires: number }> {
  const token = randomBytes(24).toString("base64url");
  const s: Session = { hash: sha(token), expires: now + LINK_TTL_MS, used: false, created: new Date(now).toISOString() };
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "keys-vault-session.json"), JSON.stringify(s));
  return { token, expires: s.expires };
}

export async function checkSession(dataDir: string, token: unknown, now = Date.now()): Promise<"ok" | "missing" | "expired" | "used" | "wrong"> {
  let s: Session;
  try { s = JSON.parse(await readFile(path.join(dataDir, "keys-vault-session.json"), "utf8")); } catch { return "missing"; }
  if (typeof token !== "string" || token.length < 20) return "wrong";
  const a = Buffer.from(sha(token)), b = Buffer.from(s.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "wrong";
  if (s.used) return "used";
  if (now > s.expires) return "expired";
  return "ok";
}

export async function burnSession(dataDir: string): Promise<void> {
  const f = path.join(dataDir, "keys-vault-session.json");
  try { const s: Session = JSON.parse(await readFile(f, "utf8")); s.used = true; await writeFile(f, JSON.stringify(s)); } catch { /* gone already */ }
}

/** Keys arrive as typed: trimmed, no spaces or quotes inside, sane length. Only the two vault keys are accepted. */
export function validateKeys(input: unknown): Partial<Record<VaultKey, string>> {
  const out: Partial<Record<VaultKey, string>> = {};
  const v = (input ?? {}) as Record<string, unknown>;
  for (const k of VAULT_KEYS) {
    const raw = typeof v[k] === "string" ? (v[k] as string).trim() : "";
    if (!raw) continue;
    if (!/^[A-Za-z0-9_\-.:]{8,200}$/.test(raw)) throw new Error(`${k} doesn't look like a key (letters, digits, - _ . only)`);
    out[k] = raw;
  }
  if (!Object.keys(out).length) throw new Error("paste at least one key");
  return out;
}

/** The personal plain copy Ahmad asked for (C:\Users\Hp\Desktop\المفاتيح.txt). Other lines he added are kept. */
export function desktopFileText(existing: string, keys: Partial<Record<VaultKey, string>>, now = new Date()): string {
  const header = [
    "# OMEGA PRIME - مفاتيح البيانات",
    `# التاريخ: ${now.toISOString().slice(0, 10)}`,
    "",
  ];
  const kept = existing.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("#") && !VAULT_KEYS.some(k => l.startsWith(`${k}=`)));
  const values = VAULT_KEYS.map(k => {
    const old = existing.split(/\r?\n/).find(l => l.startsWith(`${k}=`));
    return keys[k] ? `${k}=${keys[k]}` : old ?? `${k}=`;
  });
  return [...header, ...values, ...kept, "", "# ملاحظة: هذا ملف شخصي - لا تشاركه", "# النسخة المشفرة في: web/.env.local (dotenvx)", ""].join("\r\n");
}

export async function writeDesktopFile(file: string, keys: Partial<Record<VaultKey, string>>, now = new Date()): Promise<void> {
  let existing = "";
  try { existing = (await readFile(file, "utf8")).replace(/^\ufeff/, ""); } catch { /* first time */ }
  await writeFile(`${file}.tmp`, "\ufeff" + desktopFileText(existing, keys, now), "utf8");
  await rename(`${file}.tmp`, file);
}

export type AuditEntry = { at: string; from: string; keys: string[]; verdicts: Record<string, string>; result: string };
export async function audit(dataDir: string, entry: AuditEntry): Promise<void> {
  await appendFile(path.join(dataDir, "keys-vault-audit.jsonl"), JSON.stringify(entry) + "\n");
}
