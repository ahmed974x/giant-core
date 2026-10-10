// Bridge between the web app and Director 00 (services/director00). Reads come straight from the SQLite ledger
// (fast, read-only); every change goes through Director 00's own CLI so its approval gate, risk policy and logs stay
// the single source of truth. Kept free of Next.js imports so `node --test` can exercise it directly.
import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";

export const REJECTION_CODES = ["RISK-001", "COMPLIANCE-002", "ESCALATION-004", "USER-005"] as const;
const THREAD = /^[0-9a-f]{12}$/;

export type DirectorAction =
  | { action: "ask"; request: string }
  | { action: "approve"; thread_id: string }
  | { action: "confirm"; thread_id: string; phrase: string }
  | { action: "reject"; thread_id: string; code: string; reason?: string };

/** Validate an untrusted request body and turn it into fixed CLI arguments (never a shell string). */
export function cliArgs(body: unknown, by = "web:Ahmad"): string[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  switch (b.action) {
    case "ask": {
      const request = str(b.request, 2000);
      if (request.length < 3) throw new Error("request must be at least 3 characters");
      return ["ask", request];
    }
    case "approve":
    case "confirm":
    case "reject": {
      const tid = str(b.thread_id, 12);
      if (!THREAD.test(tid)) throw new Error("invalid thread_id");
      if (b.action === "approve") return ["approve", tid, "--by", by];
      if (b.action === "confirm") {
        const phrase = str(b.phrase, 20);
        if (!/^CONFIRM [0-9A-F]{4}$/i.test(phrase)) throw new Error("type the confirmation phrase, e.g. CONFIRM AB12");
        return ["confirm", tid, phrase.toUpperCase(), "--by", by];
      }
      const code = str(b.code, 20);
      if (!(REJECTION_CODES as readonly string[]).includes(code)) throw new Error("choose a rejection code");
      return ["reject", tid, "--code", code, "--reason", str(b.reason, 300), "--by", by];
    }
    default:
      throw new Error("unknown action");
  }
}

/** Constant-time PIN check. No PIN configured means the web cannot change anything. */
export function pinOk(given: unknown, expected: string | undefined): boolean {
  if (!expected || expected.length < 6 || typeof given !== "string") return false;
  const a = Buffer.from(given.padEnd(64).slice(0, 64)), b = Buffer.from(expected.padEnd(64).slice(0, 64));
  return timingSafeEqual(a, b) && given.length === expected.length;
}

/** Wrong-PIN throttle: 5 failures per 15 minutes per client, then a lockout. */
export function makeThrottle(limit = 5, windowMs = 15 * 60_000, now: () => number = Date.now) {
  const fails = new Map<string, number[]>();
  return {
    blocked(id: string): boolean {
      const t = (fails.get(id) ?? []).filter(x => now() - x < windowMs);
      fails.set(id, t);
      return t.length >= limit;
    },
    fail(id: string): void {
      fails.set(id, [...(fails.get(id) ?? []), now()]);
    },
  };
}

/** Director 00's data folder; DIRECTOR_DATA_DIR (shared with the Python side) lets tests use a throwaway copy. */
export function directorData(): string {
  return process.env.DIRECTOR_DATA_DIR ?? path.join(directorDir(), "data");
}

export function directorDir(): string {
  return process.env.OMEGA_DIRECTOR_DIR ?? path.resolve(/* turbopackIgnore: true */ process.cwd(), "..", "services", "director00");
}

/** Run Director 00's CLI with validated arguments; returns its JSON output. */
export function runDirector(args: string[], dir = directorDir(), timeoutMs = 120_000): Promise<unknown> {
  const py = process.env.OMEGA_DIRECTOR_PYTHON ?? path.join(dir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return new Promise((resolve, reject) =>
    execFile(py, ["cli.py", ...args], { cwd: dir, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 << 20,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).split("\n").filter(Boolean).slice(-1)[0] ?? "director failed"));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("director returned no JSON")); }
    }));
}
