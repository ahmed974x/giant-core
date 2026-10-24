// Tests for the self-shield (scripts/lib/self-shield.mjs and scripts/self-shield.mjs, ADR-122).
//   node scripts/test-self-shield.mjs        exits 0 when every test passes
// The last test runs the real sandbox: it starts the local data proxy offline on 127.0.0.1 and a free port, sends the
// probe catalogue to it, and expects every hole closed. No internet, no dependencies.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { OMEGA_SHIELD as S } from "./lib/self-shield.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
async function test(name, f) {
  try { await f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const probe = id => S.PROBES.find(p => p.id === id);

await test("catalogue: unique ids, known severities, a fix for each, one target only", () => {
  const ids = S.PROBES.map(p => p.id);
  ok(new Set(ids).size === ids.length, "duplicate id");
  for (const p of S.PROBES) {
    ok(S.SEV[p.severity], "severity " + p.id);
    ok(p.fix && p.ar, "fix and Arabic text " + p.id);
    ok(p.req.path.startsWith("/"), "a path on the sandbox, never a URL: " + p.id);
    ok(!p.req.headers || !p.req.headers.Host || /^evil\.example(:\d+)?$/.test(p.req.headers.Host), "only the rebinding probe sets Host");
  }
  ok(S.PROBES[S.PROBES.length - 1].id === "alive", "the liveness check runs last");
});
await test("judge: status, headers, body and the slow-connection rule", () => {
  ok(S.judge(probe("trav-dotdot"), { status: 404, headers: {} }).ok, "404 on traversal passes");
  ok(!S.judge(probe("trav-dotdot"), { status: 200, headers: {} }).ok, "200 on traversal fails");
  ok(!S.judge(probe("cors-evil"), { status: 403, headers: { "access-control-allow-origin": "https://evil.example" } }).ok, "ACAO on a foreign origin fails");
  ok(!S.judge(probe("pna-null"), { status: 204, headers: { "access-control-allow-private-network": "true" } }).ok, "PNA grant to null fails");
  const page = { status: 200, headers: { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "same-site" } };
  ok(S.judge(probe("hdr-page"), page).ok && !S.judge(probe("hdr-page"), { ...page, headers: { ...page.headers, "x-frame-options": undefined } }).ok, "page headers");
  ok(!S.judge(probe("err-leak"), { status: 502, headers: {}, body: "Error at /home/ahmad/x.mjs" }).ok, "path leak fails");
  ok(!S.judge(probe("redir-open"), { status: 302, headers: { location: "//evil.example/" } }).ok && S.judge(probe("redir-open"), { status: 302, headers: { location: "/omega-ops-room-v1/omega-ops-room.html?//evil.example" } }).ok, "redirects stay local");
  ok(S.judge(probe("slow-headers"), { closedMs: 11000 }).ok && !S.judge(probe("slow-headers"), { status: undefined, headers: {}, closedMs: undefined }).ok, "slow connection must be closed");
  ok(!S.judge(probe("alive"), { error: "ECONNREFUSED" }).ok, "a dead proxy fails");
});
await test("lintPage: strict CSP passes; missing or loose directives, handlers, style and SRI are found", () => {
  const good = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-x'; style-src 'sha256-y'; img-src 'self' data:; font-src data:; connect-src https://api.example.org; object-src 'none'; base-uri 'none'; form-action 'none'"><a href="x" target="_blank" rel="noopener noreferrer">x</a>`;
  ok(S.lintPage("good.html", good).length === 0, "good page: " + JSON.stringify(S.lintPage("good.html", good)));
  const ids = html => S.lintPage("p.html", html).map(x => x.id).sort().join();
  ok(ids("<p>no csp</p>") === "csp-missing", "missing CSP");
  ok(ids(good.replace("script-src 'sha256-x'", "script-src 'unsafe-inline'")).includes("csp-unsafe"), "unsafe-inline");
  ok(ids(good.replace("object-src 'none'; ", "")).includes("csp-object-src"), "object-src");
  ok(ids(good.replace("connect-src https://api.example.org", "connect-src *")).includes("csp-wild-connect-src"), "wildcard connect-src");
  ok(ids(good + `<button onclick="x()">x</button>`).includes("inline-handler") && ids(good + `<div style="color:red"></div>`).includes("style-attr"), "handler and style");
  ok(ids(good + `<script src="https://cdn.example.org/x.js"></script>`).includes("sri-missing"), "SRI");
  ok(ids(good + `<a href="x" target="_blank">x</a>`).includes("blank-noopener"), "noopener");
  ok(!ids(good + `<script>document.body.onclick = () => 1; const s = "<b style='x'>";</script>`).includes("inline-handler"), "script bodies are not markup");
});
await test("scanSecrets: key shapes found and masked; detector fixtures and prose are not", () => {
  const key = "gsk_" + "A".repeat(52);
  const f = S.scanSecrets("x.env", "GROQ=" + key);
  ok(f.length === 1 && f[0].id === "secret-groq-key" && f[0].line === 1 && !f[0].evidence.includes(key.slice(4, 20)), "groq key masked: " + JSON.stringify(f));
  const pem = kind => "-----BEGIN " + kind + "PRIVATE " + "KEY-----";
  ok(S.scanSecrets("t.sql", `looks_secret('${pem("RSA ")}')`).length === 0, "bare PEM header in a test is not a key");
  ok(S.scanSecrets("k.pem", pem("") + "\n" + "M".repeat(64) + "\n").length === 1, "PEM with key material is");
  ok(S.scanSecrets("a.md", "AWS keys start with AKIA; never paste one. سعر برنت 80").length === 0, "prose is clean");
  ok(S.scanSecrets("b.js", "const k = 'AKIA" + "ABCDEFGHIJKLMNOP" + "';")[0].id === "secret-aws-access-key", "aws");
});
await test("score and report: severities weigh in, verdict blocks on high", () => {
  const f = [{ status: "fail", severity: "medium" }, { status: "pass", severity: "critical" }, { status: "skip", severity: "high" }];
  ok(S.score(f).value === 92 && S.score(f).verdict === "watch", "medium only: " + JSON.stringify(S.score(f)));
  ok(S.score([{ status: "fail", severity: "high" }]).verdict === "block" && S.score([]).verdict === "clear" && S.score([]).value === 100, "high blocks, empty clear");
  const r = S.report({ at: "2026-10-24T00:00:00Z", stages: [{ name: "probes", ok: true }] }, [{ id: "a", status: "pass", severity: "low", ar: "x" }, { id: "b", status: "fail", severity: "medium", ar: "y", evidence: "e|v", fix: "f" }]);
  ok(r.format === "omega-self-shield-v1" && r.findings[0].id === "b" && r.fail === 1 && /No third party/.test(r.scope), "report");
  const md = S.markdown(r);
  ok(md.includes("الدرع الذاتي") && md.includes("e\\|v") && md.includes("لا يُفحص أي طرف آخر"), "markdown");
});
await test("sandbox run: the proxy starts offline, every probe is answered safely, no page or secret finding", () => {
  const dir = mkdtempSync(join(tmpdir(), "omega-shield-test-")), out = join(dir, "r.json");
  try {
    const r = spawnSync(process.execPath, [join(HERE, "self-shield.mjs"), "--ci", "--no-skillspector", "--json", out], { encoding: "utf8", timeout: 120000 });
    const j = JSON.parse(readFileSync(out, "utf8"));
    const open = j.findings.filter(x => x.status === "fail");
    ok(j.sandbox && j.sandbox.offline && /^http:\/\/127\.0\.0\.1:\d+$/.test(j.sandbox.url), "sandbox on loopback, offline");
    ok(r.status === 0 && open.length === 0, "open findings: " + open.map(x => `${x.id}: ${x.evidence}`).join(" | ") + (r.status ? " · " + (r.stderr || "").slice(-300) : ""));
    ok(j.findings.filter(x => S.PROBES.some(p => p.id === x.id)).length === S.PROBES.length, "every probe judged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
