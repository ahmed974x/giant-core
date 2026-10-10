// Startup secrets check (ADR-042). Before the server serves anything:
//   1. web/.env.local is encrypted with dotenvx (every value is ciphertext)
//   2. the secrets are loaded and decrypted in this process (the app was started through dotenvx)
//   3. the private key lives outside the project
//   4. Git ignores .env.local and .env.keys, tracks neither, and no tracked file contains a live secret value
// Any failure stops the server (exit 1) unless OMEGA_SECRETS_CHECK=report (tests) or off (emergency only).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { secretValues } from "../logger.ts";

export type Finding = { check: string; ok: boolean; detail: string };
export type Report = { ok: boolean; findings: Finding[] };

const PUBLIC = /^DOTENV_PUBLIC_KEY/;

export function envFileLines(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out.push([m[1], m[2].replace(/^(['"])(.*)\1$/, "$2")]);
  }
  return out;
}

export function defaultKeysFile(env: Record<string, string | undefined> = process.env): string {
  const home = env.USERPROFILE ?? env.HOME ?? ".";
  return env.OMEGA_ENV_KEYS ?? path.join(home, ".omega", "secrets", "web.env.keys");
}

type Deps = { git: (args: string[]) => { code: number; out: string } };
const realGit: Deps["git"] = args => {
  try { return { code: 0, out: execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 15_000 }) }; }
  catch (e) { const err = e as { status?: number; stdout?: string }; return { code: err.status ?? 1, out: err.stdout ?? "" }; }
};

export function checkSecrets(webDir: string, env: Record<string, string | undefined> = process.env, deps: Deps = { git: realGit }): Report {
  const findings: Finding[] = [];
  const add = (check: string, ok: boolean, detail: string) => findings.push({ check, ok, detail });
  const envFile = path.join(webDir, ".env.local");

  // 1. Encrypted at rest
  if (!existsSync(envFile)) add("encrypted", false, ".env.local is missing");
  else {
    const lines = envFileLines(readFileSync(envFile, "utf8")).filter(([k, v]) => v && !PUBLIC.test(k));
    const plain = lines.filter(([, v]) => !v.startsWith("encrypted:")).map(([k]) => k);
    add("encrypted", plain.length === 0, plain.length ? `plain text values: ${plain.join(", ")}` : `${lines.length} values encrypted`);

    // 2. Loaded and decrypted in this process
    // An empty value decrypts to "" (a key not filled in yet), which is fine; still-encrypted or missing is not.
    const notLoaded = lines.map(([k]) => k).filter(k => env[k] === undefined || env[k]!.startsWith("encrypted:"));
    add("loaded", notLoaded.length === 0, notLoaded.length ? `not decrypted: ${notLoaded.join(", ")} (start through dotenvx: npm run start)` : "all values decrypted in memory");
  }

  // 3. Private key outside the project
  const keys = defaultKeysFile(env), project = path.resolve(webDir, "..");
  const inside = path.resolve(keys).toLowerCase().startsWith(project.toLowerCase() + path.sep);
  add("key-location", existsSync(keys) && !inside, !existsSync(keys) ? "private key file not found" : inside ? "private key is inside the project" : "private key outside the project");
  for (const stray of [path.join(webDir, ".env.keys"), path.join(project, ".env.keys")])
    if (existsSync(stray)) add("key-location", false, `a private key file sits in the project: ${path.relative(project, stray)}`);

  // 4. Git
  const tracked = deps.git(["-C", webDir, "ls-files", "--", ".env.local", ".env.keys", "../.env", "../.env.keys"]);
  add("git-tracked", tracked.code === 0 && !tracked.out.trim(), tracked.out.trim() ? `tracked by Git: ${tracked.out.trim().split(/\s+/).join(", ")}` : "no secret files tracked");
  const ignored = deps.git(["-C", webDir, "check-ignore", "-q", ".env.local"]).code === 0 && deps.git(["-C", webDir, "check-ignore", "-q", ".env.keys"]).code === 0;
  add("git-ignored", ignored, ignored ? ".env.local and .env.keys are ignored" : ".env.local or .env.keys is not in .gitignore");
  const values = secretValues(env).filter(v => v.length >= 8 && !v.startsWith("encrypted:"));
  if (values.length) {
    const grep = deps.git(["-C", project, "grep", "-l", "-F", ...values.flatMap(v => ["-e", v])]);
    add("git-content", grep.code !== 0 || !grep.out.trim(), grep.out.trim() ? `a secret value appears in tracked files: ${grep.out.trim().split(/\s+/).join(", ")}` : "no secret value in tracked files");
  }
  return { ok: findings.every(f => f.ok), findings };
}

/** Run at server start: print the verdict (no values) and stop the server if it isn't safe. */
export function enforceSecrets(webDir: string = process.cwd(), env = process.env): Report {
  const mode = (env.OMEGA_SECRETS_CHECK ?? "enforce").toLowerCase();
  if (mode === "off") { console.warn("[secrets] check is OFF (OMEGA_SECRETS_CHECK=off)"); return { ok: true, findings: [] }; }
  const report = checkSecrets(webDir, env);
  for (const f of report.findings) (f.ok ? console.log : console.error)(`[secrets] ${f.ok ? "ok  " : "FAIL"} ${f.check}: ${f.detail}`);
  if (!report.ok && mode === "enforce") {
    console.error("[secrets] refusing to start. See docs/SECURITY.md, section Secrets.");
    process.exit(1);
  }
  return report;
}
