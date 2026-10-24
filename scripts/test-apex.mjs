// Tests for the APEX council engine (scripts/lib/apex-council.mjs), its inline copy in the APEX page and the dark
// gold peak tone on every page (ADR-127).
//   node scripts/test-apex.mjs        exits 0 when every test passes
// No network, no dependencies.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OMEGA_APEX as A } from "./lib/apex-council.mjs";
import { OMEGA_BRAIN as B } from "./lib/second-brain.mjs";
import { OMEGA_CORE as C } from "./lib/agent-core.mjs";
import { OMEGA_KNOW as K } from "./lib/knowledge-domain.mjs";
import { registry } from "./build-apex-inline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = join(HERE, "..");
let failed = 0, passed = 0;
function test(name, f) {
  try { f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const REG = registry(), opt = { tokens: B.tokens };

test("one field helper per knowledge domain, each with a role, a guard and an ORACLE mode", () => {
  ok(A.FIELD_HELPERS.length === K.DOMAINS.length, `${A.FIELD_HELPERS.length} helpers for ${K.DOMAINS.length} domains`);
  ok(K.DOMAINS.every(d => A.FIELD_HELPERS.some(f => f.domain === d.id)), "a domain has no helper");
  for (const f of A.FIELD_HELPERS) {
    ok(f.ar && f.en && f.role.ar && f.role.en && f.guard.ar && f.guard.en, `${f.domain} is missing text`);
    ok(["scholar", "intel"].includes(f.oracle.mode) && ["general", "medicine", "science", "industry", "algorithms"].includes(f.oracle.field), `${f.domain} ORACLE mode`);
  }
  for (const f of A.fields(REG)) for (const p of f.partners) ok(REG.helpers.some(h => h[0] === p), `${f.id} partners unknown helper ${p}`);
});
test("the register: one tool or two per field, licence, GitHub repo, a source page and nothing installed", () => {
  ok(/^\d{4}-\d{2}-\d{2}$/.test(A.REG_ASOF), "no date read");
  const doms = new Set(K.DOMAINS.map(d => d.id)), lib = new Set(REG.library.map(t => t.name.toLowerCase()));
  for (const t of A.REGISTER) {
    ok(doms.has(t.domain), `${t.name}: unknown field ${t.domain}`);
    ok(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(t.repo) && /^https:\/\//.test(t.src) && t.licence.length > 2 && t.ar && t.en, `${t.name} row`);
    ok(!lib.has(t.name.toLowerCase()), `${t.name} is already in the library`);
    ok(!("status" in t) || t.status === "idea", `${t.name} claims to be in use`);
  }
  ok(new Set(A.REGISTER.map(t => t.name)).size === A.REGISTER.length, "duplicate tool");
});
test("routing: oil in Hormuz seats the oil and straits helpers, medicine seats the medical researcher", () => {
  const r = A.council(REG, "كيف أراقب ناقلات النفط في مضيق هرمز وسعر برنت", opt);
  ok(r.ok && r.briefs[0].domain === "energy" && r.briefs.some(b => b.domain === "sea"), r.briefs.map(b => b.domain).join(","));
  ok(Math.abs(r.rows.reduce((s, x) => s + x.share, 0) - 1) < 1e-9, "shares do not sum to 1");
  ok(r.briefs.every(b => b.share >= A.SEAT_MIN) && r.briefs.length <= A.SEATS, "seat rule");
  const m = A.council(REG, "diabetes clinical trials", opt);
  ok(m.briefs[0].domain === "medicine" && m.briefs[0].oracle.field === "medicine", "medicine lens");
  ok(m.review.some(v => v.helper === "research" && /not medical advice/.test(v.en)), "no medical advice line");
});
test("no shared word: the knowledge keeper takes it and the verdict says so", () => {
  const r = A.council(REG, "zzqx wvvy", opt);
  ok(r.ok && r.none && r.briefs.length === 1 && r.briefs[0].domain === "knowledge" && /No field matched/.test(r.verdict.en), "fallback");
  ok(!A.council(REG, "   ", opt).ok, "an empty question was answered");
});
test("every council plan passes PRIME's checker, starts with recall, ends with the note, names no order", () => {
  for (const q of ["كيف أراقب ناقلات النفط في مضيق هرمز وسعر برنت", "ثغرات سيبرانية تهدد الكابلات البحرية", "bitcoin order book whale liquidity", "تصميم واجهة ذهبية داكنة", "solar storm satellites", "zzqx"]) {
    const r = A.council(REG, q, opt), c = C.checkPlan(r.plan);
    ok(c.ok, `${q}: ${c.errors.join("; ")}`);
    ok(r.plan.steps[0].tool === "recall" && r.plan.steps.at(-1).tool === "note" && r.plan.steps.length <= 12, `${q}: shape`);
    ok(r.plan.steps.at(-1).after.length === r.plan.steps.length - 1, `${q}: the note does not wait for every step`);
    ok(!r.plan.steps.some(s => s.tool === "exec"), `${q}: the paper executor is in a plan`);
  }
});
test("a trading question gets the audit and a risk gate after every market reading; risk can only stop", () => {
  const r = A.council(REG, "bitcoin market trading price whale liquidity", opt);
  ok(r.trade, "not seen as trading");
  const risk = r.plan.steps.find(s => s.tool === "risk"), reads = r.plan.steps.filter(s => ["scout", "analyst", "quant", "audit", "sentinel"].includes(s.tool)).map(s => s.id);
  ok(risk && reads.every(x => risk.after.includes(x)), "risk does not wait for the readings");
  ok(r.review.find(v => v.helper === "risk").verdict === "stop-only", "risk verdict");
  ok(r.review.some(v => v.helper === "exec" && /opens nothing from a plan/.test(v.en)), "executor line");
});
test("world questions keep OSINT passive", () => {
  const r = A.council(REG, "ثغرات سيبرانية تهدد الكابلات البحرية", opt);
  ok(r.review.some(v => v.helper === "sentinel" && v.verdict === "passive"), "no passive line");
  ok(r.briefs.every(b => b.read.every(s => REG.sources[s.id])), "a source outside ORACLE's keyless list");
});
test("inboxes: each idea goes to the field that would lead it; unmatched ideas stay open", () => {
  const ideas = [{ text: "أراقب ناقلات النفط في مضيق هرمز وأربطها بسعر برنت", score: 0.9 }, { text: "وقف الخسارة قبل كل صفقة ورقية", score: 0.5 }, { text: "qqzz xxvv", score: 0.2 }, { text: "" }, null];
  const b = A.inboxes(REG, ideas, opt);
  ok(b.total === 3 && b.open.length === 1 && b.box["f-energy"].length === 1, JSON.stringify(Object.fromEntries(Object.entries(b.box).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]))));
  ok(Object.keys(b.box).length === A.FIELD_HELPERS.length, "a helper has no inbox");
});
test("the network holds only table links, and lights the seats of the last council", () => {
  const n0 = A.network(REG, null);
  ok(n0.nodes.filter(x => x.kind === "apex").length === 1 && n0.nodes.filter(x => x.kind === "core").length === REG.helpers.length && n0.nodes.filter(x => x.kind === "field").length === A.FIELD_HELPERS.length, "node counts");
  ok(n0.edges.every(e => e.w === 0), "lit before any council");
  const r = A.council(REG, "diabetes clinical trials", opt), n1 = A.network(REG, r);
  ok(n1.edges.some(e => e.kind === "seats" && e.w > 0) && n1.nodes.find(x => x.id === "f-medicine").lit === 1, "medicine not lit");
  const pos = A.layout(n1, 1000, 720);
  ok(pos.length === n1.nodes.length && pos.every(([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 720), "a node off the canvas");
  const tall = A.layout(n1, 1000, 1250);
  ok(tall.every(([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 1250), "a node off the phone canvas");
});
test("markdown export names the inference and paper-only rule", () => {
  const md = A.toMarkdown(A.council(REG, "solar storm satellites", opt), "2026-10-24T00:00:00Z");
  ok(/\[INFERENCE\]/.test(md) && /Paper only/.test(md) && /## Paper plan for PRIME/.test(md), "markdown");
});
test("the APEX page carries the current engine and registry copy, with no network in its CSP", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-apex-inline.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stderr || r.stdout).trim());
  const page = readFileSync(join(REPO, "omega-ops-room-v1", "omega-apex.html"), "utf8");
  ok(/connect-src 'none'/.test(page), "the APEX page may connect somewhere");
  ok(!/innerHTML|eval\(|new Function/.test(page.replace(/<!-- OMEGA_[A-Z0-9]+ begin[\s\S]*?OMEGA_[A-Z0-9]+ end -->/g, "")), "unsafe DOM or code in the page script");
});
test("every page has the dark gold tone, the same suite copy and the APEX link", () => {
  const pages = ["omega-ops-room", "the-chain", "omega-oracle", "omega-trade-lab", "omega-second-brain", "omega-core", "omega-knowledge", "omega-apex"].map(n => `omega-ops-room-v1/${n}.html`);
  const suites = new Set();
  for (const p of pages) {
    const h = readFileSync(join(REPO, p), "utf8");
    ok(/:root\[data-theme="dark"\]\[data-tone="gold"\] \{/.test(h), `${p}: no gold tone`);
    ok(/localStorage\.getItem\("omega-tone"\) === "gold"/.test(h), `${p}: no pre-paint of the tone`);
    ok(/k: "apex"/.test(h), `${p}: the switcher has no APEX link`);
    const i = h.indexOf("// OMEGA suite"), j = h.indexOf("</script>", i);
    suites.add(h.slice(i, j).replace(/const PAGE = "\w+"/, ""));
  }
  ok(suites.size === 1, `${suites.size} different suite copies`);
  const css = readFileSync(join(REPO, "site-landing", "style.css"), "utf8"), js = readFileSync(join(REPO, "site-landing", "suite.js"), "utf8");
  ok(/:root\[data-theme="dark"\]\[data-tone="gold"\] \{/.test(css) && /function applyTone/.test(js) && /k: "apex"/.test(js), "NABD misses the tone or the link");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
