// Log redaction (ADR-042): no secret ever reaches a log. Every console call on the server goes through redact(),
// which replaces the live values of secret-looking environment variables and well-known secret shapes with
// [REDACTED]. Installed once at server start from instrumentation.ts.
export const REDACTED = "[REDACTED]";

// Names whose values are secrets. DIRECTOR_DB_URL carries a password; the PIN gates every private route.
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PIN|PRIVATE|CREDENTIAL|DB_URL|DATABASE_URL)/i;
// dotenvx's public key is meant to be visible; npm_* and Next.js internals (npm_package_scripts_secrets_check,
// __NEXT_PRIVATE_*) are tooling metadata whose names only look secret.
const NOT_SECRET = /^(DOTENV_PUBLIC_KEY|npm_|__NEXT_|NEXT_PRIVATE_|NEXT_RUNTIME|NEXT_PHASE)/i;

// Shapes worth hiding even when we don't know the value (a key pasted into a request, an error echoing a URL).
const PATTERNS: [RegExp, string][] = [
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi, `$1${REDACTED}$3`],             // scheme://user:password@
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`],                          // Authorization headers
  [/\b(x-api-key|x-omega-pin|apikey|api_key|map_key|token|pin)(["']?\s*[:=]\s*["']?)[^\s"',&}]{4,}/gi, `$1$2${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],                // JWTs
  [/\b(fc|sk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{16,}/g, REDACTED],                // provider key prefixes
  [/\bencrypted:[A-Za-z0-9+/=]{20,}/g, "encrypted:" + REDACTED],                             // dotenvx ciphertext
];

/** Secret values currently in the environment (6+ characters, so short flags aren't masked everywhere). */
export function secretValues(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 6 || NOT_SECRET.test(name) || !SECRET_NAME.test(name)) continue;
    out.add(value);
    try {                                                          // also the password inside a URL, on its own
      const u = new URL(value);
      if (u.password && u.password.length >= 6) out.add(decodeURIComponent(u.password));
    } catch { /* not a URL */ }
  }
  return [...out].sort((a, b) => b.length - a.length);           // longest first, so a URL hides before its password
}

export function redact(text: string, secrets: string[] = secretValues()): string {
  let s = text;
  for (const v of secrets) if (s.includes(v)) s = s.split(v).join(REDACTED);
  for (const [re, to] of PATTERNS) s = s.replace(re, to);
  return s;
}

function redactArg(a: unknown, secrets: string[]): unknown {
  if (typeof a === "string") return redact(a, secrets);
  if (a instanceof Error) {
    const e = new Error(redact(a.message, secrets));
    e.name = a.name;
    e.stack = a.stack ? redact(a.stack, secrets) : undefined;
    return e;
  }
  if (a && typeof a === "object") {
    try { return JSON.parse(redact(JSON.stringify(a), secrets)); } catch { return "[unloggable object]"; }
  }
  return a;
}

let installed = false;
/** Route console.log/info/warn/error/debug through redact(). Idempotent. */
export function installLogRedaction(c: Console = console): void {
  if (installed) return;
  installed = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = c[level].bind(c);
    c[level] = (...args: unknown[]) => { const s = secretValues(); original(...args.map(a => redactArg(a, s))); };
  }
}
