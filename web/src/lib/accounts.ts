// User accounts for the paper platform (ADR-075). NextAuth signs people in (no passwords stored here); this module
// decides who a request belongs to and where that person's paper data lives. Kept free of Next.js imports so
// `node --test` can exercise it directly.
//   - The owner (Ahmad on his laptop) keeps using the site PIN, and his data stays where it always was.
//   - A signed-in user gets an isolated folder: <data>/users/<key>/paper/... (their own paper account and queue).
//   - Anyone else is refused. Accounts are off until NEXTAUTH_SECRET and at least one provider are configured.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { guard, type Throttle } from "./guard.ts";

export type Env = Record<string, string | undefined>;
export type ProviderId = "github" | "google";
export type Actor = { kind: "owner"; dataDir: string; by: string } | { kind: "user"; key: string; dataDir: string; by: string };

/** OAuth providers whose id and secret are both set (values come from web/.env.local, never from git). */
export function configuredProviders(env: Env = process.env): ProviderId[] {
  const out: ProviderId[] = [];
  if (env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) out.push("github");
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) out.push("google");
  return out;
}

export function authEnabled(env: Env = process.env): boolean {
  return (env.NEXTAUTH_SECRET ?? "").length >= 32 && configuredProviders(env).length > 0;
}

/** Stable, non-reversible folder key for a provider account; the provider's id is never written to disk. */
export function userKey(provider: string, subject: string, secret = ""): string {
  if (!provider || !subject) throw new Error("no account id");
  return createHash("sha256").update(`${secret}|${provider}|${subject}`).digest("hex").slice(0, 24);
}

const KEY = /^[0-9a-f]{24}$/;
export function userDir(base: string, key: string): string {
  if (!KEY.test(key)) throw new Error("bad user key");
  return path.join(base, "users", key);
}

/** Who is asking: the owner (right PIN), a signed-in user, or nobody (refused with a Response). */
export async function access(req: Request, pin: unknown, throttle: Throttle, base: string,
  getUserKey: () => Promise<string | null>, env: Env = process.env): Promise<{ actor: Actor } | { blocked: Response }> {
  const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { if (origin && new URL(origin).host !== host) return { blocked: Response.json({ error: "forbidden" }, { status: 403 }) }; }
  catch { return { blocked: Response.json({ error: "forbidden" }, { status: 403 }) }; }
  if (typeof pin === "string" && pin.length > 0) {
    const blocked = guard(req, pin, throttle, env as NodeJS.ProcessEnv);
    return blocked ? { blocked } : { actor: { kind: "owner", dataDir: base, by: "web:Ahmad" } };
  }
  const key = authEnabled(env) ? await getUserKey().catch(() => null) : null;
  if (key && KEY.test(key)) return { actor: { kind: "user", key, dataDir: userDir(base, key), by: `user:${key}` } };
  return { blocked: Response.json({ error: "sign in, or enter the PIN" }, { status: 401 }) };
}

// Profile: only what the person types in. No email, no provider id, no payment details.
export type Profile = { display_name: string; country: string; language: "ar" | "en"; updated_at: string };

export function validProfile(p: unknown, now = new Date()): Profile {
  const x = (p ?? {}) as Partial<Profile>;
  const name = typeof x.display_name === "string" ? x.display_name.trim().replace(/[\u0000-\u001f<>]/g, "") : "";
  if (name.length < 2 || name.length > 40) throw new Error("display name must be 2 to 40 characters");
  const country = String(x.country ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("country must be a two-letter code, like KW or BR");
  const language = x.language === "en" ? "en" : x.language === "ar" ? "ar" : null;
  if (!language) throw new Error("language must be ar or en");
  return { display_name: name, country, language, updated_at: now.toISOString() };
}

export const profilePath = (dir: string) => path.join(dir, "profile.json");

export async function loadProfile(dir: string): Promise<Profile | null> {
  try { return JSON.parse(await readFile(profilePath(dir), "utf8")) as Profile; } catch { return null; }
}

export async function saveProfile(dir: string, p: Profile): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(profilePath(dir), JSON.stringify(p, null, 2) + "\n");
}
