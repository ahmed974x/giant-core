// Keys Vault (ADR-043). POST {token, pin, keys}: one-time link + PIN, HTTPS only (or the laptop itself), same origin,
// throttled. Saves encrypted (web/.env.local via dotenvx) and to the Desktop copy, loads the keys into the running
// app, tests them, burns the link, and answers with names and verdicts only.
import path from "node:path";
import { homedir } from "node:os";
import { directorData, makeThrottle } from "@/lib/director";
import { guard } from "@/lib/guard";
import { applyKeys, readEnvFile, testKey } from "@/lib/keys";
import { audit, burnSession, checkSession, validateKeys, writeDesktopFile, VAULT_KEYS, type VaultKey } from "@/lib/keys-vault";
import { defaultKeysFile } from "@/lib/security/check-secrets";

const throttle = makeThrottle();
// The env file is relative to the web folder (dotenvx 1.75 needs that); tests point it at a throwaway file.
const ENV_FILE = () => process.env.OMEGA_VAULT_ENV_FILE ?? ".env.local";
const DESKTOP_FILE = () => process.env.OMEGA_KEYS_DESKTOP_FILE ?? path.join(homedir(), "Desktop", "المفاتيح.txt");

function secureTransport(req: Request): boolean {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https" || host === "127.0.0.1" || host === "localhost";
}

export async function GET(req: Request) {
  // Lets the phone page say up front whether the link is still good (no PIN needed, nothing revealed).
  const token = new URL(req.url).searchParams.get("token");
  return Response.json({ link: await checkSession(directorData(), token), secure: secureTransport(req) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!secureTransport(req)) return Response.json({ error: "HTTPS only: open the link at https://…:8443" }, { status: 403 });
  const body = await req.json().catch(() => null) as { token?: unknown; pin?: unknown; keys?: unknown } | null;
  const blocked = guard(req, body?.pin, throttle);
  if (blocked) return blocked;
  const link = await checkSession(directorData(), body?.token);
  if (link !== "ok") return Response.json({ error: { missing: "no vault link is open", expired: "this link has expired", used: "this link was already used", wrong: "this link is not valid" }[link], link }, { status: 403 });

  let keys: Partial<Record<VaultKey, string>> | null;
  try { keys = validateKeys(body?.keys); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  const from = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const names = Object.keys(keys) as VaultKey[];
  try {
    // 1. Encrypted in web/.env.local (dotenvx, private key outside the project)
    const { set } = await import("@dotenvx/dotenvx");
    for (const k of names) set(k, keys[k]!, { path: ENV_FILE(), envKeysFile: defaultKeysFile(), encrypt: true, quiet: true } as never);
    // 2. The personal plain copy on the Desktop
    await writeDesktopFile(DESKTOP_FILE(), keys);
    // 3. Load into the running app and test
    applyKeys(await readEnvFile(path.join(process.cwd(), ENV_FILE())));
    const verdicts: Record<string, string> = {}, details: Record<string, string> = {};
    for (const k of names) { const r = await testKey(k, process.env[k] ?? ""); verdicts[k] = r.verdict; details[k] = r.detail; }
    await burnSession(directorData());
    await audit(directorData(), { at: new Date().toISOString(), from, keys: names, verdicts, result: "saved" });
    return Response.json({ ok: true, verdicts, details, saved: ["Desktop\\المفاتيح.txt", "web/.env.local (encrypted)"] });
  } catch (e) {
    await audit(directorData(), { at: new Date().toISOString(), from, keys: names, verdicts: {}, result: `failed: ${(e as Error).message.slice(0, 120)}` }).catch(() => null);
    return Response.json({ error: "saving failed on the laptop; nothing was tested" }, { status: 500 });
  } finally {
    // Drop every reference to the values (JavaScript can't zero strings; this is the best it allows).
    if (keys) for (const k of VAULT_KEYS) delete keys[k];
    keys = null;
  }
}

export const dynamic = "force-dynamic";
