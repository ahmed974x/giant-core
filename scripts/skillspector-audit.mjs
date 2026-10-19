#!/usr/bin/env node
// SkillSpector · security scanner and auto-patcher for giant-core (ADR-089).
// Node 18+ standard library only. No network unless --fetch is passed.
//
// Scans project files and any skill, plugin or MCP server for:
//   - access to secrets: process.env / os.environ, localStorage / sessionStorage / IndexedDB, key-shaped literals
//   - dangerous execution: eval, new Function, string timers, child_process / subprocess / os.system, curl | sh
//   - XSS sinks: innerHTML / outerHTML / insertAdjacentHTML / document.write, inline on* handlers
//   - outside links: hosts not in the allowlist, plain http://, target=_blank without rel
//   - HTML hardening: strict CSP meta (no 'unsafe-inline' / 'unsafe-eval' for scripts), SRI on external scripts and styles
//   - prompt-injection phrases and permission bypass flags inside SKILL.md / agent files
//
// Usage:
//   node scripts/skillspector-audit.mjs [paths...]            report (default: whole repo)
//   node scripts/skillspector-audit.mjs --strict [paths...]   exit 1 on any unsuppressed critical or high finding
//   node scripts/skillspector-audit.mjs --fix [paths...]      auto-patch: rel on target=_blank, refresh CSP hashes,
//                                                             sync the rule set into the Ops Room panel
//   node scripts/skillspector-audit.mjs --fix --fetch ...     also add SRI integrity to external <script>/<link> (downloads them)
//   node scripts/skillspector-audit.mjs --json out.json       also write the machine-readable report
//   node scripts/skillspector-audit.mjs --rules               print the rule set as JSON
// Suppressions live in .skillspector.json: { "allowHosts": [...], "suppress": [{ "rule", "path", "reason" }] }.
// A suppression needs a reason; it is listed in the report, never hidden.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, extname, sep } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const targets = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--json");

/* SKILLSPECTOR_RULES_START */
export const RULES = [
  { id: "SEC-KEY-LITERAL", sev: "critical", re: "(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{40,}|csk-[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)", flags: "", files: "*", msg: "Secret-shaped literal in a file. Move it to the encrypted vault or an env file outside the repo." },
  { id: "SEC-PIPE-SHELL", sev: "critical", re: "(curl|wget)[^\\n|]*\\|\\s*(sudo\\s+)?(ba|z)?sh\\b|iwr[^\\n|]*\\|\\s*iex|Invoke-Expression", flags: "i", files: "*", msg: "Downloads and runs code in one step. Review the script and pin it by hash instead." },
  { id: "SEC-EVAL", sev: "high", re: "(^|[^\\w.$])eval\\s*\\(|new\\s+Function\\s*\\(|(setTimeout|setInterval)\\s*\\(\\s*[\"'`]", flags: "", files: "code", msg: "Runs a string as code. Replace with a direct function call." },
  { id: "SEC-EXEC", sev: "high", re: "child_process|\\bexecSync\\s*\\(|\\bspawnSync\\s*\\(|\\bos\\.system\\s*\\(|\\bsubprocess\\.(run|Popen|call|check_output)\\s*\\(|Runtime\\.getRuntime\\(\\)\\.exec", flags: "", files: "code", msg: "Starts a process. Inside a skill or plugin this needs a manual review." },
  { id: "SEC-XSS-SINK", sev: "high", re: "\\.(innerHTML|outerHTML)\\s*=(?!=)|insertAdjacentHTML\\s*\\(|document\\.write(ln)?\\s*\\(|dangerouslySetInnerHTML", flags: "", files: "code", msg: "Writes markup from a string (XSS sink). Use textContent or build nodes." },
  { id: "SEC-INLINE-HANDLER", sev: "medium", re: "<[a-z][^>]*\\son(click|load|error|mouseover|focus|submit|change|input|keydown|keyup)\\s*=", flags: "i", files: "html", msg: "Inline event handler. A strict CSP blocks it; attach with addEventListener." },
  { id: "SEC-ENV", sev: "medium", re: "process\\.env\\b|\\bos\\.environ\\b|\\bos\\.getenv\\s*\\(|Deno\\.env", flags: "", files: "code", msg: "Reads environment variables (where API keys usually live)." },
  { id: "SEC-STORAGE", sev: "medium", re: "\\b(localStorage|sessionStorage|indexedDB)\\b", flags: "", files: "code", msg: "Uses browser storage. Secrets there must be encrypted (AES-GCM vault)." },
  { id: "SEC-HTTP", sev: "medium", re: "http://(?!127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0|\\[::1\\]|www\\.w3\\.org|schemas\\.|purl\\.org|ns\\.adobe\\.com)[a-z0-9.-]+", flags: "i", files: "*", msg: "Plain http:// to an outside host. Use https://." },
  { id: "SEC-HOST", sev: "low", re: "https://([a-z0-9-]+\\.)+[a-z]{2,}", flags: "gi", files: "code", msg: "Outside host not in the allowlist (.skillspector.json allowHosts)." },
  { id: "SEC-BLANK-REL", sev: "low", re: "<a\\b(?=[^>]*target=\"_blank\")(?![^>]*rel=\"[^\"]*noopener)[^>]*>", flags: "gi", files: "html", msg: "target=_blank without rel=\"noopener noreferrer\" (auto-fixable)." },
  { id: "SEC-SRI", sev: "high", re: "<script\\b(?=[^>]*\\ssrc=\"https?://)(?![^>]*\\sintegrity=)[^>]*>|<link\\b(?=[^>]*rel=\"stylesheet\")(?=[^>]*href=\"https?://)(?![^>]*\\sintegrity=)[^>]*>", flags: "gi", files: "html", msg: "External script or stylesheet without Subresource Integrity (auto-fixable with --fetch)." },
  { id: "SEC-PROMPT-INJECTION", sev: "high", re: "ignore (all )?(previous|prior|above) instructions|disregard (the )?(system|previous) prompt|--dangerously-skip-permissions|bypassPermissions|\"defaultMode\"\\s*:\\s*\"bypass", flags: "i", files: "agent", msg: "Instruction-override phrase or permission bypass inside an agent/skill file." },
];
export const DEFAULT_ALLOW_HOSTS = [
  "github.com", "raw.githubusercontent.com", "api.github.com", "claude.ai", "claude.com", "anthropic.com", "docs.anthropic.com", "code.claude.com",
  "api.gdeltproject.org", "www.gdeltproject.org", "data.sec.gov", "www.sec.gov", "sec.gov", "stooq.com",
  "api.binance.com", "data-api.binance.vision", "api.coingecko.com", "api.llama.fi", "defillama.com",
  "api.open-meteo.com", "open-meteo.com", "s3-eu-west-1.amazonaws.com", "tfl.gov.uk", "api.tfl.gov.uk",
  "fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com",
  "developer.mozilla.org", "www.w3.org", "w3c.github.io", "vercel.com", "naturalearthdata.com", "www.naturalearthdata.com",
];
/* SKILLSPECTOR_RULES_END */

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "__pycache__", ".venv", "venv", "ui-shots", ".cache"]);
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".html", ".htm", ".sh", ".ps1", ".bat", ".vue", ".svelte"]);
const TEXT_EXT = new Set([...CODE_EXT, ".md", ".json", ".yml", ".yaml", ".toml", ".env", ".txt", ".css", ".ini", ".cfg"]);
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function loadConfig() {
  const p = join(ROOT, ".skillspector.json");
  if (!existsSync(p)) return { allowHosts: [], suppress: [] };
  const c = JSON.parse(readFileSync(p, "utf8"));
  for (const s of c.suppress || []) if (!s.reason) throw new Error(`.skillspector.json: suppression for ${s.rule} ${s.path} has no reason`);
  return { allowHosts: c.allowHosts || [], suppress: c.suppress || [] };
}

function walk(p, out) {
  let st; try { st = statSync(p); } catch { return out; }
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) if (!SKIP_DIRS.has(name)) walk(join(p, name), out);
  } else if (st.isFile() && st.size < 8 * 1024 * 1024 && (TEXT_EXT.has(extname(p).toLowerCase()) || /(^|[\\/])(Dockerfile|\.env[^\\/]*)$/.test(p))) out.push(p);
  return out;
}

const kindOf = rel => {
  const ext = extname(rel).toLowerCase();
  return {
    html: ext === ".html" || ext === ".htm",
    code: CODE_EXT.has(ext),
    agent: /(^|\/)(\.claude|plugins|mcp|skills)\//.test(rel) || /(SKILL|AGENTS|CLAUDE)\.md$/.test(rel),
    skill: /(^|\/)(\.claude\/skills|plugins|mcp)\//.test(rel),
  };
};
const appliesTo = (rule, k) => rule.files === "*" || (rule.files === "code" && k.code) || (rule.files === "html" && k.html) || (rule.files === "agent" && k.agent);
// Data URIs (embedded fonts, images) are long base64 and only cause false positives.
const stripData = s => s.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g, m => m.slice(0, 40) + "…");
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;
const hostOk = (host, allow) => allow.some(a => host === a || host.endsWith("." + a));

function cspFindings(text, rel) {
  const out = [];
  const m = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i.exec(text);
  if (!m) { out.push({ rule: "SEC-CSP", sev: "high", line: 1, excerpt: "no CSP meta", msg: "HTML page without a Content-Security-Policy meta." }); return out; }
  const csp = m[1], line = lineOf(text, m.index);
  const dir = name => (new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`, "i").exec(csp) || [])[1];
  const scriptSrc = dir("script-src") ?? dir("default-src") ?? "";
  if (!dir("default-src")) out.push({ rule: "SEC-CSP", sev: "medium", line, excerpt: "default-src missing", msg: "CSP has no default-src fallback." });
  if (/'unsafe-inline'/.test(scriptSrc)) out.push({ rule: "SEC-CSP", sev: "high", line, excerpt: "script-src 'unsafe-inline'", msg: "CSP allows inline scripts. Use sha256 hashes (run --fix)." });
  if (/'unsafe-eval'/.test(scriptSrc)) out.push({ rule: "SEC-CSP", sev: "high", line, excerpt: "script-src 'unsafe-eval'", msg: "CSP allows eval." });
  if (/(^|\s)(\*|https:|http:)(\s|$)/.test(scriptSrc)) out.push({ rule: "SEC-CSP", sev: "high", line, excerpt: "script-src wildcard", msg: "CSP lets scripts load from any host." });
  if (!/object-src\s+'none'/.test(csp)) out.push({ rule: "SEC-CSP", sev: "medium", line, excerpt: "object-src", msg: "CSP should set object-src 'none'." });
  if (!/base-uri\s+'(none|self)'/.test(csp)) out.push({ rule: "SEC-CSP", sev: "medium", line, excerpt: "base-uri", msg: "CSP should set base-uri 'none'." });
  // Every inline block must be covered by a hash.
  const want = inlineHashes(text);
  for (const [kind, hashes] of Object.entries(want)) {
    const have = dir(kind) || "";
    for (const h of hashes) if (!have.includes(h)) out.push({ rule: "SEC-CSP", sev: "high", line, excerpt: `${kind} missing ${h.slice(0, 20)}…`, msg: `An inline <${kind === "script-src" ? "script" : "style"}> is not in the CSP hashes. Run --fix.` });
  }
  return out;
}
function inlineHashes(text) {
  const h = s => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
  const scripts = [...text.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => h(m[1]));
  const styles = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => h(m[1]));
  return { "script-src": scripts, "style-src": styles };
}

export function scanText(text, rel, cfg) {
  const k = kindOf(rel), allow = [...DEFAULT_ALLOW_HOSTS, ...(cfg.allowHosts || [])];
  // The rule set embedded in a page is data, not code: blank it out, keeping line numbers.
  const clean = stripData(text).replace(/\/\* SKILLSPECTOR_RULES_START \*\/[\s\S]*?\/\* SKILLSPECTOR_RULES_END \*\//g, m => m.replace(/[^\n]/g, " ")), out = [];
  for (const r of RULES) {
    if (!appliesTo(r, k)) continue;
    const re = new RegExp(r.re, r.flags.includes("g") ? r.flags : r.flags + "g");
    for (const m of clean.matchAll(re)) {
      if (r.id === "SEC-HOST") {
        const host = m[0].replace(/^https:\/\//i, "").toLowerCase();
        if (hostOk(host, allow)) continue;
      }
      let sev = r.sev;
      // Inside skills, plugins and MCP servers, reading env/storage or starting processes is a red flag.
      if (k.skill && (r.id === "SEC-ENV" || r.id === "SEC-STORAGE" || r.id === "SEC-HOST")) sev = "high";
      out.push({ rule: r.id, sev, line: lineOf(clean, m.index), excerpt: r.id === "SEC-KEY-LITERAL" ? mask(m[0]) : m[0].slice(0, 80), msg: r.msg });
    }
  }
  if (k.html) out.push(...cspFindings(text, rel));
  return out;
}

function suppressedBy(f, rel, cfg) {
  return (cfg.suppress || []).find(s => s.rule === f.rule && (s.path === rel || (s.path.endsWith("/**") && rel.startsWith(s.path.slice(0, -3)))));
}

/* ---------------- auto-patcher ---------------- */
function fixBlankRel(text) {
  return text.replace(/<a\b(?=[^>]*target="_blank")(?![^>]*rel="[^"]*noopener)([^>]*)>/gi, (m, rest) =>
    /\srel="/.test(m) ? m.replace(/\srel="([^"]*)"/, (_, v) => ` rel="${(v + " noopener noreferrer").trim()}"`) : `<a${rest} rel="noopener noreferrer">`);
}
// Never echo a secret: keep the first 6 characters and the length.
const mask = v => `${v.slice(0, 6)}… (${v.length} chars, masked)`;
function fixCspHashes(text) {
  const m = /(<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content=")([^"]+)(")/i.exec(text);
  if (!m) return text;
  const want = inlineHashes(text);
  let csp = m[2];
  for (const [kind, hashes] of Object.entries(want)) {
    const re = new RegExp(`(^|;)(\\s*)${kind}\\s+([^;]*)`, "i");
    const cur = re.exec(csp);
    const keep = cur ? cur[3].split(/\s+/).filter(t => t && t !== "'none'" && !/^'sha(256|384|512)-/.test(t)) : [];
    const value = [...keep, ...hashes].join(" ");
    csp = cur ? csp.replace(re, `$1$2${kind} ${value}`) : `${csp}; ${kind} ${value}`;
  }
  return text.slice(0, m.index) + m[1] + csp + m[3] + text.slice(m.index + m[0].length);
}
async function fixSri(text) {
  const tags = [...text.matchAll(/<(script|link)\b[^>]*\s(src|href)="(https:\/\/[^"]+)"[^>]*>/gi)].filter(t => !/\sintegrity=/.test(t[0]) && (t[1].toLowerCase() === "script" || /rel="stylesheet"/.test(t[0])));
  for (const t of tags) {
    try {
      const r = await fetch(t[3]); if (!r.ok) throw new Error("HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const sri = "sha384-" + createHash("sha384").update(buf).digest("base64");
      text = text.replace(t[0], t[0].replace(/\s*\/?>$/, m => ` integrity="${sri}" crossorigin="anonymous"${m}`));
      console.log(`  SRI added for ${t[3]}`);
    } catch (e) { console.log(`  SRI skipped for ${t[3]}: ${e.message}`); }
  }
  return text;
}
function syncRules(selfText) {
  const p = join(ROOT, "omega-ops-room-v1", "omega-ops-room.html");
  if (!existsSync(p)) return false;
  const html = readFileSync(p, "utf8");
  const block = /\/\* SKILLSPECTOR_RULES_START \*\/[\s\S]*?\/\* SKILLSPECTOR_RULES_END \*\//;
  if (!block.test(html)) return false;
  const src = block.exec(selfText)[0].replace(/export const /g, "const ");
  const next = html.replace(block, () => src);
  if (next !== html) { writeFileSync(p, fixCspHashes(next)); return true; }
  return false;
}

/* ---------------- main ---------------- */
async function main() {
  if (flag("--rules")) { console.log(JSON.stringify({ rules: RULES, allowHosts: DEFAULT_ALLOW_HOSTS }, null, 2)); return 0; }
  const cfg = loadConfig();
  const roots = targets.length ? targets.map(t => join(ROOT, t)) : [ROOT];
  const files = roots.flatMap(r => walk(r, []));
  if (flag("--fix")) {
    const self = readFileSync(new URL(import.meta.url), "utf8");
    if (syncRules(self)) console.log("synced rule set into omega-ops-room-v1/omega-ops-room.html");
    for (const f of files.filter(f => /\.html?$/i.test(f))) {
      const before = readFileSync(f, "utf8");
      let after = fixBlankRel(before);
      if (flag("--fetch")) after = await fixSri(after);
      after = fixCspHashes(after);
      if (after !== before) { writeFileSync(f, after); console.log(`patched ${relative(ROOT, f)}`); }
    }
  }
  const findings = [], suppressed = [];
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join("/");
    if (rel === "scripts/skillspector-audit.mjs" || rel === ".skillspector.json") continue; // the rule set itself
    let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
    for (const x of scanText(text, rel, cfg)) {
      const s = suppressedBy(x, rel, cfg);
      (s ? suppressed : findings).push({ file: rel, ...x, ...(s ? { reason: s.reason } : {}) });
    }
  }
  findings.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || a.file.localeCompare(b.file) || a.line - b.line);
  const count = s => findings.filter(f => f.sev === s).length;
  const summary = { scanned: files.length, critical: count("critical"), high: count("high"), medium: count("medium"), low: count("low"), suppressed: suppressed.length };
  for (const f of findings) console.log(`${f.sev.toUpperCase().padEnd(8)} ${f.rule.padEnd(20)} ${f.file}:${f.line}  ${f.excerpt}`);
  if (suppressed.length) console.log(`\n${suppressed.length} suppressed (see .skillspector.json):`);
  for (const f of suppressed) console.log(`  ${f.rule} ${f.file}:${f.line}  reason: ${f.reason}`);
  console.log(`\nSkillSpector: ${summary.scanned} files · critical ${summary.critical} · high ${summary.high} · medium ${summary.medium} · low ${summary.low} · suppressed ${summary.suppressed}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ generated: new Date().toISOString(), summary, findings, suppressed }, null, 2));
  return flag("--strict") && (summary.critical || summary.high) ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("skillspector-audit.mjs")) {
  main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
}
