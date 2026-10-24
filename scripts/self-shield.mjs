#!/usr/bin/env node
// OMEGA self-shield (ADR-122): OMEGA attacks its own code in an isolated sandbox, then reports every hole with its fix.
//
//   node scripts/self-shield.mjs                    sandbox probes + page lint + secret scan + SkillSpector
//   node scripts/self-shield.mjs --ci               the same; exits 1 when a critical or high finding is open
//   node scripts/self-shield.mjs --fix              first re-pins page CSP hashes (the only automatic fix), then checks
//   node scripts/self-shield.mjs --deps             also asks OSV.dev about the npm lockfiles (sends package names and
//                                                   versions to api.osv.dev; off by default, needs the internet)
//   --json <file> --md <file>                       write the omega-self-shield-v1 report and its Arabic Markdown
//
// The sandbox is a fresh copy of scripts/omega-data-proxy.mjs started by this script on 127.0.0.1 and a free port,
// with a temporary home and cache (deleted afterwards), OMEGA_OFFLINE=1 (every upstream call refused, so no probe can
// make it reach the internet) and a closed Ollama port. Probes go to that address only; there is no way to aim them at
// another host. Rules and the probe catalogue: scripts/lib/self-shield.mjs.
import { spawn, spawnSync } from "node:child_process";
import { createServer, connect } from "node:net";
import { request } from "node:http";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { OMEGA_SHIELD as S } from "./lib/self-shield.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = f => argv.includes(f), opt = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const HOST = "127.0.0.1";
const findings = [], stages = [];
const stage = (name, ok, note) => { stages.push({ name, ok, note }); console.log(`${ok === true ? "✓" : ok === false ? "✗" : "–"} ${name}${note ? ": " + note : ""}`); };

function freePort() {
  return new Promise((done, fail) => { const s = createServer(); s.unref(); s.on("error", fail); s.listen(0, HOST, () => { const p = s.address().port; s.close(() => done(p)); }); });
}
// One request to the sandbox. `raw` paths are written as given, so the server sees the exact bytes.
function send(port, req) {
  return new Promise(done => {
    const headers = { Host: `${HOST}:${port}`, ...(req.headers || {}) };
    if (req.body) headers["Content-Length"] = Buffer.byteLength(req.body);
    const r = request({ host: HOST, port, method: req.method || "GET", path: req.path, headers, timeout: 8000, insecureHTTPParser: false }, res => {
      const chunks = [];
      res.on("data", c => { if (chunks.reduce((n, x) => n + x.length, 0) < 65536) chunks.push(c); });
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("timeout", () => { r.destroy(); done({ error: "no answer in 8 s" }); });
    r.on("error", e => done({ error: e.code || e.message }));
    if (req.body) r.write(req.body);
    r.end();
  });
}
// Slowloris check with one connection: a header line every 2 s, never the blank line that ends the headers.
function slow(port, path) {
  return new Promise(done => {
    const t0 = Date.now(), sock = connect(port, HOST);
    let timer = null, n = 0;
    const end = () => { clearInterval(timer); clearTimeout(cap); done({ closedMs: Date.now() - t0 }); };
    const cap = setTimeout(() => { clearInterval(timer); sock.destroy(); done({ status: undefined, headers: {}, body: "", closedMs: undefined }); }, 20000);
    sock.on("connect", () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: ${HOST}:${port}\r\n`);
      timer = setInterval(() => { if (!sock.destroyed) sock.write(`X-Slow-${n++}: 1\r\n`); }, 2000);
    });
    sock.on("close", end);
    sock.on("error", () => { /* close follows */ });
    sock.on("data", () => { /* a 408 before close is fine */ });
  });
}

async function sandboxStage() {
  const port = await freePort(), home = mkdtempSync(join(tmpdir(), "omega-shield-"));
  const env = { PATH: process.env.PATH || "", SystemRoot: process.env.SystemRoot || "", HOME: home, USERPROFILE: home, OMEGA_PROXY_PORT: String(port), OMEGA_CACHE_DIR: join(home, "cache"),
    OMEGA_OFFLINE: "1", OMEGA_NO_STATUS: "1", OMEGA_OLLAMA_URL: "http://127.0.0.1:9" };
  const child = spawn(process.execPath, [join(REPO, "scripts", "omega-data-proxy.mjs")], { env, cwd: home, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", c => { log += c; }); child.stderr.on("data", c => { log += c; });
  const meta = { url: `http://${HOST}:${port}`, offline: true, pid: child.pid };
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { await new Promise(r => setTimeout(r, 100)); const a = await send(port, { path: "/health" }); up = a.status === 200; }
    if (!up) { stage("sandbox", false, "the proxy did not start: " + log.slice(-300)); return meta; }
    if (!/Offline sandbox/.test(log)) { stage("sandbox", false, "the proxy did not confirm offline mode; probes not sent"); return meta; }
    stage("sandbox", true, `${meta.url}, offline, temporary home`);
    for (const p of S.PROBES) {
      const a = p.req.slow ? await slow(port, p.req.path) : await send(port, p.req);
      const j = S.judge(p, a);
      findings.push({ id: p.id, area: p.area, severity: p.severity, ar: p.ar, status: j.ok ? "pass" : "fail", evidence: j.evidence, fix: p.fix });
    }
    const failed = findings.filter(f => f.area !== "page" && f.status === "fail").length;
    stage("probes", failed === 0, `${S.PROBES.length} probes, ${failed} open`);
  } finally {
    child.kill();
    await new Promise(r => setTimeout(r, 200));
    try { rmSync(home, { recursive: true, force: true }); } catch { /* temp folder; the OS clears it */ }
  }
  return meta;
}

const TEXT_EXT = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".md", ".py", ".sh", ".bat", ".ps1", ".yml", ".yaml", ".toml", ".env", ".txt", ".css", ".sql", ".example", ""]);
function tracked() {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\0").filter(Boolean) : [];
}
function pagesStage() {
  const pages = [];
  for (const dir of ["omega-ops-room-v1", "site-landing"]) {
    if (!existsSync(join(REPO, dir))) continue;
    for (const f of readdirSync(join(REPO, dir))) if (f.endsWith(".html")) pages.push(join(dir, f));
  }
  let n = 0;
  for (const p of pages) for (const x of S.lintPage(p.replace(/\\/g, "/"), readFileSync(join(REPO, p), "utf8"))) { findings.push({ ...x, status: "fail" }); n++; }
  if (!n) findings.push({ id: "pages-clean", area: "page", severity: "high", ar: `${pages.length} صفحة: CSP صارمة، بلا معالجات داخلية ولا style ولا سكربت خارجي بلا SRI`, status: "pass", evidence: pages.length + " pages" });
  stage("pages", n === 0, `${pages.length} pages, ${n} findings`);
}
function secretsStage() {
  let files = 0, n = 0;
  for (const f of tracked()) {
    if (/(^|\/)(node_modules|\.git)\//.test(f) || !TEXT_EXT.has(extname(f).toLowerCase())) continue;
    let st;
    try { st = statSync(join(REPO, f)); } catch { continue; }
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
    files++;
    for (const x of S.scanSecrets(f, readFileSync(join(REPO, f), "utf8"))) { findings.push({ ...x, status: "fail" }); n++; }
  }
  if (!n) findings.push({ id: "secrets-clean", area: "secrets", severity: "critical", ar: "لا نص يشبه مفتاحاً سرياً في الملفات المتتبّعة", status: "pass", evidence: files + " files" });
  stage("secrets", n === 0, `${files} tracked text files, ${n} key-shaped strings`);
}
function skillspectorStage() {
  const out = join(mkdtempSync(join(tmpdir(), "omega-shield-ss-")), "ss.json");
  const r = spawnSync(process.execPath, [join(REPO, "scripts", "skillspector-audit.mjs"), "--strict", "--json", out, "."], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let j = null;
  try { j = JSON.parse(readFileSync(out, "utf8")); } catch { /* reported below */ }
  try { rmSync(dirname(out), { recursive: true, force: true }); } catch { /* temp */ }
  const t = j && (j.totals || j.summary || j.counts) || {};
  const crit = Number(t.critical || 0), high = Number(t.high || 0);
  findings.push({ id: "skillspector", area: "code", severity: "high", ar: "SkillSpector على المستودع كله (0 حرجة، 0 عالية)", status: r.status === 0 ? "pass" : "fail",
    evidence: j ? `critical ${crit} · high ${high} · medium ${t.medium ?? "?"} · low ${t.low ?? "?"}` : (r.stderr || r.stdout || "").trim().slice(-200), fix: "node scripts/skillspector-audit.mjs --strict . and fix each finding" });
  stage("skillspector", r.status === 0, j ? `critical ${crit}, high ${high}` : "no JSON report");
}
async function depsStage() {
  if (!flag("--deps")) { stage("dependencies (OSV)", null, "off; run with --deps on the laptop (sends package names and versions to api.osv.dev)"); return; }
  const locks = tracked().filter(f => /(^|\/)package-lock\.json$/.test(f));
  const queries = [], seen = new Set();
  for (const f of locks) {
    let j;
    try { j = JSON.parse(readFileSync(join(REPO, f), "utf8")); } catch { continue; }
    for (const [k, v] of Object.entries(j.packages || {})) {
      if (!k || !v || !v.version || v.link) continue;
      const name = k.replace(/^.*node_modules\//, ""), key = name + "@" + v.version;
      if (seen.has(key)) continue;
      seen.add(key);
      queries.push({ file: f, name, version: v.version });
    }
  }
  if (!queries.length) { stage("dependencies (OSV)", null, "no npm lockfile"); return; }
  let vulns = 0;
  try {
    for (let i = 0; i < queries.length; i += 500) {
      const part = queries.slice(i, i + 500);
      const r = await fetch("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queries: part.map(q => ({ package: { name: q.name, ecosystem: "npm" }, version: q.version })) }), signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error("OSV HTTP " + r.status);
      const j = await r.json();
      (j.results || []).forEach((res, k) => {
        const ids = (res && res.vulns || []).map(v => String(v.id)).filter(id => /^[A-Z0-9-]{4,40}$/.test(id));
        if (ids.length) { vulns++; findings.push({ id: "dep-" + part[k].name, area: "deps", severity: "high", ar: "اعتمادية بثغرة منشورة في OSV", file: part[k].file, status: "fail", evidence: `${part[k].name}@${part[k].version}: ${ids.slice(0, 5).join(", ")}`, fix: "npm audit fix or pin a fixed version, then re-run" }); }
      });
    }
    if (!vulns) findings.push({ id: "deps-clean", area: "deps", severity: "high", ar: "لا اعتمادية بثغرة منشورة في OSV", status: "pass", evidence: queries.length + " packages" });
    stage("dependencies (OSV)", vulns === 0, `${queries.length} packages, ${vulns} with published vulnerabilities`);
  } catch (e) {
    findings.push({ id: "deps-unchecked", area: "deps", severity: "medium", ar: "تعذر سؤال OSV.dev", status: "skip", evidence: e.message.slice(0, 120), fix: "run --deps where api.osv.dev is reachable" });
    stage("dependencies (OSV)", null, "OSV.dev unreachable: " + e.message.slice(0, 80));
  }
}

if (flag("--fix")) {
  const pages = ["omega-ops-room-v1", "site-landing"].flatMap(d => existsSync(join(REPO, d)) ? readdirSync(join(REPO, d)).filter(f => f.endsWith(".html")).map(f => join(d, f)) : []);
  const r = spawnSync(process.execPath, [join(REPO, "scripts", "skillspector-audit.mjs"), "--fix", ...pages], { cwd: REPO, encoding: "utf8" });
  stage("fix: re-pin CSP hashes", r.status === 0, `${pages.length} pages`);
}
const sandbox = await sandboxStage();
pagesStage();
secretsStage();
if (!flag("--no-skillspector")) skillspectorStage();
await depsStage();
const rep = S.report({ at: new Date().toISOString(), sandbox, stages }, findings);
if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify(rep, null, 2) + "\n");
if (opt("--md")) writeFileSync(opt("--md"), S.markdown(rep) + "\n");
console.log(`\nScore ${rep.score.value}/100 · ${rep.score.verdict} · pass ${rep.pass} · fail ${rep.fail} · skip ${rep.skip}`);
for (const f of rep.findings.filter(x => x.status === "fail")) console.log(`  ✗ [${f.severity}] ${f.id}${f.file ? " " + f.file + (f.line ? ":" + f.line : "") : ""}: ${f.evidence}\n      fix: ${f.fix}`);
process.exit(flag("--ci") && rep.score.verdict === "block" ? 1 : 0);
