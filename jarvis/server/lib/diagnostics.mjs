// Diagnostics (ADR-148): the readiness of Jarvis's five layers, and a bundle that leaves this computer only
// after a scrubber has taken out anything that looks like a secret. The scrubber is pure and also runs in
// the page, so the person can see what was removed.
//   1. Memory: BM25 episodes and SHA-256 capsules.
//   2. Development and proof: the evidence logs, the UI-state gate, the measured mutation run, the prover.
//   3. Open search: the official APIs and the SSRF shield (refuses every private address in a fixed list).
//   4. Security: SkillSpector 0 critical / 0 high, the Merkle audit log verifies, the lock constraints exist.
//   5. Local bridge: the model engine and the server both on 127.0.0.1, no cloud model.

// ---- The scrubber -----------------------------------------------------------------------------------
// Values under these key names are always removed.
export const SECRET_KEY = /(pass(word|wd)?|secret|token|api[-_]?key|private[-_]?key|cookie|authori[sz]ation|credential|session[-_]?id|founder[-_]?key)/i;
// Known key formats.
export const SECRET_PATTERNS = [
  ["openai-style key", /\bsk-[A-Za-z0-9_-]{20,}/g],
  ["github token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/g],
  ["aws access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["google api key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi],
  ["json web token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["password in a url", /(\/\/[^/\s:@]+:)[^@\s/]+@/g],
];
// Shannon entropy in bits per character.
export function entropy(s) {
  const n = s.length;
  if (!n) return 0;
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) || 0) + 1);
  let h = 0;
  for (const c of counts.values()) { const p = c / n; h -= p * Math.log2(p); }
  return h;
}
// A long run of key-like characters with high entropy. Hex digests (SHA-256, git ids) top out at 4 bits a
// character and are public by design, so the 4.5 threshold keeps them; random base64 keys score near 5.5.
const RANDOMISH = /[A-Za-z0-9+/_=-]{24,}/g;
export const ENTROPY_LIMIT = 4.5;

export function scrubText(text, path, found) {
  let out = String(text);
  for (const [rule, re] of SECRET_PATTERNS) {
    out = out.replace(re, (m, g1) => {
      found.push({ path, rule });
      return rule === "password in a url" ? g1 + "[REDACTED]@" : "[REDACTED]";
    });
  }
  out = out.replace(RANDOMISH, m => {
    if (/^[0-9a-f]+$/i.test(m) || entropy(m) < ENTROPY_LIMIT) return m;
    found.push({ path, rule: "high entropy" });
    return "[REDACTED]";
  });
  return out;
}

// Walks any JSON value; returns { value, redactions }. Nothing is changed in place.
export function scrub(value) {
  const found = [];
  const walk = (v, path, key) => {
    if (v == null || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (key && SECRET_KEY.test(key) && v) { found.push({ path, rule: "secret field name" }); return "[REDACTED]"; }
      return scrubText(v, path, found);
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, path + "[" + i + "]", key));
    if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, path ? path + "." + k : k, k)]));
    return null;
  };
  const out = walk(value, "", null);
  return { value: out, redactions: found };
}

// The lock constraints that hold AGENTS.md section 1 in the database.
export const LOCK_CONSTRAINTS = ["mission_steps_locked_never_done", "approvals_locked_never_approved", "access_settings_founder_private_locked", "model_endpoints_external_locked",
  "webhooks_external_out_locked", "billing_settings_billing_locked", "subscriber_tiers_draft_only", "token_ledger_creator_free", "runtime_skills_scan_clean", "forged_skills_scan_clean"];
// Addresses the SSRF shield must refuse, in several spellings.
export const SSRF_PROBES = ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "fd00::1", "fe80::1", "100::1"];

export const layer = (id, name, checks) => ({ id, name, ok: checks.every(c => c.ok), checks });
