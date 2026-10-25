// Tests for the knowledge domain engine (scripts/lib/knowledge-domain.mjs) and the page's inline copies (ADR-126).
//   node scripts/test-knowledge.mjs        exits 0 when every test passes
// No network, no dependencies. The ideas below are small hand-made fixtures; they are never shown on a page.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { OMEGA_KNOW as K } from "./lib/knowledge-domain.mjs";
import { OMEGA_BRAIN as B } from "./lib/second-brain.mjs";
import { OMEGA_CORE as C } from "./lib/agent-core.mjs";
import { OMEGA_RESEARCH as R } from "./lib/deep-research.mjs";
import { registry } from "./build-knowledge-inline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function test(name, f) {
  try { f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const NOW = Date.UTC(2026, 9, 24, 22), DAY = 86400000;
const REG = registry();
const IDEAS = { own: [
  { text: "أراقب ناقلات النفط في مضيق هرمز وأربطها بسعر برنت", at: NOW - DAY },
  { text: "خريطة تعمل بدون إنترنت بملف PMTiles واحد", at: NOW - 2 * DAY },
  { text: "ثغرة في كابل بحري قد تقطع الإنترنت عن الخليج؟", at: NOW - 3 * DAY },
  { text: "وقف الخسارة قبل كل صفقة ورقية", at: NOW - 4 * DAY },
  { text: "diabetes clinical trials in the Gulf", at: NOW - 5 * DAY }
] };
const brain = B.organise(IDEAS, { now: NOW });
const g = K.build(REG, { brain }, { tokens: B.tokens });
const id = s => g.index.get(s);
const kind = k => g.nodes.filter(x => x.kind === k);

test("the registry holds every ORACLE source, library tool, PRIME helper and decision record", () => {
  ok(Object.keys(REG.sources).length === Object.keys(R.SOURCES).length && Object.keys(REG.sources).length >= 17, "sources " + Object.keys(REG.sources).length);
  ok(REG.library.length === B.LIBRARY.length && REG.helpers.length === C.HELPERS.length, "library or helpers");
  ok(REG.adrs.length >= 50 && REG.adrs.every(a => Number.isInteger(a.n) && a.title && ["accepted", "proposed", "superseded", "rejected", "unknown"].includes(a.status)), "adrs " + REG.adrs.length);
  ok(REG.adrs.some(a => a.n === 126), "ADR-126 is in the registry");
  ok(REG.adrs.filter(a => a.status === "unknown").length === 0, "an ADR status was not read: " + REG.adrs.filter(a => a.status === "unknown").map(a => a.n));
});
test("parseAdr reads the title, status, citations and context", () => {
  const r = K.parseAdr("# ADR-200: Test record\n\nDate: 2026-10-24 · Status: Proposed (waits)\n\n## Context\nIt builds on ADR-119 and ADR-121,\nand cites ADR-119 again.\n\n## Decision\nx", "ADR-200-test.md");
  ok(r.n === 200 && r.title === "Test record" && r.status === "proposed" && JSON.stringify(r.refs) === "[119,121]" && r.summary.startsWith("It builds on ADR-119"), JSON.stringify(r));
  ok(K.parseAdr("no header", "notes.md") === null, "a file with no ADR number is skipped");
});
test("every node kind is present and every edge points at real nodes, once", () => {
  for (const k of Object.keys(K.KINDS)) ok(kind(k).length > 0, "no " + k);
  ok(kind("domain").length === K.DOMAINS.length && kind("page").length === K.PAGES.length && kind("agent").length === C.HELPERS.length + 1, "counts");
  ok(kind("tool").length === B.LIBRARY.length + K.KG_TOOLS.length && kind("source").length === Object.keys(R.SOURCES).length, "tools or sources");
  const keys = new Set();
  for (const e of g.edges) {
    ok(g.nodes[e.a] && g.nodes[e.b] && e.a !== e.b && e.w > 0 && e.w <= 1 && K.EDGE_WHY[e.kind], "bad edge " + JSON.stringify(e));
    const key = Math.min(e.a, e.b) + "|" + Math.max(e.a, e.b); ok(!keys.has(key), "duplicate edge " + key); keys.add(key);
  }
});
test("fixed tables link what the code says: sources feed, helpers watch, tools serve", () => {
  const has = (a, b) => g.adj[id(a)].some(k => { const e = g.edges[k]; return e.a === id(b) || e.b === id(b); });
  ok(has("s:pubmed", "d:medicine") && has("s:nvd", "d:cyber") && has("a:sentinel", "d:sea") && has("t:satellite.js", "d:space"), "fixed links");
  ok(has("a:lead", "a:risk") && has("s:openalex", "p:oracle"), "lead and ORACLE");
  for (const d of K.DOMAINS) for (const s of d.sources) ok(REG.sources[s], `domain ${d.id} names unknown source ${s}`);
  for (const d of K.DOMAINS) for (const h of d.helpers) ok(C.HELPERS.some(x => x[0] === h), `domain ${d.id} names unknown helper ${h}`);
  for (const [h, t] of Object.entries(K.HELPER_TOOL)) ok(t === null || Object.prototype.hasOwnProperty.call(C.TOOLS, t), `helper ${h} names unknown tool ${t}`);
});
test("ideas reach their domains by words, decisions cite decisions, the library idea list is not duplicated", () => {
  const hormuz = kind("idea").find(x => x.text.includes("هرمز"));
  const ds = K.neighbours(g, hormuz.ix).filter(j => g.nodes[j].kind === "domain").map(j => g.nodes[j].ref);
  ok(ds.includes("sea") || ds.includes("energy"), "Hormuz idea domains: " + ds);
  const med = kind("idea").find(x => x.text.includes("diabetes"));
  ok(K.neighbours(g, med.ix).some(j => g.nodes[j].ref === "medicine"), "medicine link");
  const pm = kind("idea").find(x => x.text.includes("PMTiles"));
  ok(K.neighbours(g, pm.ix).includes(id("t:PMTiles")), "an idea that names a tool links to it");
  ok(g.edges.some(e => e.kind === "cites"), "no citation edge");
  const g2 = K.build(REG, { brain: B.organise({ library: true }, { now: NOW }) }, { tokens: B.tokens });
  ok(g2.nodes.filter(x => x.kind === "idea").length === 0, "library ideas must not become idea nodes");
});
test("PageRank sums to 1, betweenness stays in 0..1 and both are deterministic", () => {
  const r = K.pagerank(g), r2 = K.pagerank(g), b = K.betweenness(g);
  ok(Math.abs(r.reduce((s, v) => s + v, 0) - 1) < 1e-6, "sum " + r.reduce((s, v) => s + v, 0));
  ok(JSON.stringify(r) === JSON.stringify(r2) && b.every(v => v >= 0 && v <= 1), "range or determinism");
  const top = r.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1])[0][0];
  ok(["domain", "page", "agent"].includes(g.nodes[top].kind), "a hub ranks first: " + g.nodes[top].id);
});
test("predicted links join ideas to unlinked tools, sources or agents only", () => {
  const p = K.predict(g);
  ok(p.length > 0, "no prediction");
  const linked = new Set(g.edges.map(e => Math.min(e.a, e.b) + "|" + Math.max(e.a, e.b)));
  for (const x of p) {
    ok(g.nodes[x.a].kind === "idea" && ["tool", "source", "agent"].includes(g.nodes[x.b].kind), "kinds");
    ok(!linked.has(Math.min(x.a, x.b) + "|" + Math.max(x.a, x.b)) && x.score > 0 && x.via.length, "already linked or empty");
  }
});
test("gaps name their rule, and a domain with ideas and no in-use tool is flagged", () => {
  const r = K.gaps(g);
  ok(r.domains.length === K.DOMAINS.length && r.domains.every(d => d.findings.every(f => f.rule && f.ar && f.en && ["ok", "watch", "act"].includes(f.level))), "shape");
  const geo = r.domains.find(d => d.domain === "geo");
  ok(geo.ideas > 0 && geo.inUse === 0 && geo.findings.some(f => f.rule === "ideas but no tool in use"), JSON.stringify(geo));
});
test("ask: the question's words choose the domains, and every answer has a path from the seed", () => {
  const p = K.ask(g, "كيف أراقب ناقلات النفط في مضيق هرمز", { tokens: B.tokens });
  ok(p.ok && p.domains.includes("sea") && p.domains.includes("energy"), "domains " + p.domains);
  for (const [k, xs] of Object.entries(p.groups)) for (const x of xs) {
    ok(g.nodes[x.i].kind === k, "kind mismatch");
    ok(x.path.length >= 1 && x.path[x.path.length - 1] === x.i && x.path[0] === p.seeds[0].i, "path " + JSON.stringify(x.path));
    for (let s = 1; s < x.path.length; s++) ok(K.neighbours(g, x.path[s - 1]).includes(x.path[s]), "a path step is not a link");
  }
  ok(p.groups.idea.some(x => g.nodes[x.i].text.includes("هرمز")), "the Hormuz idea comes back");
  ok(!K.ask(g, "zzzz qqqq", { tokens: B.tokens }).ok && !K.ask(g, "", { tokens: B.tokens }).ok, "no match is not ok");
});
test("plan: the helpers' review fixes the draft and PRIME's own checker accepts it", () => {
  for (const q of ["كيف أراقب ناقلات النفط في مضيق هرمز", "medical research on diabetes with open sources", "تصميم واجهة الجوال", "ثغرات سيبرانية في الكابلات البحرية"]) {
    const pk = K.ask(g, q, { tokens: B.tokens }), r = K.plan(g, pk, q), c = C.checkPlan(r.plan);
    ok(c.ok, q + ": " + c.errors.join("; "));
    const steps = r.plan.steps, tools = steps.map(s => s.tool);
    ok(tools[0] === "recall" && tools[tools.length - 1] === "note" && steps.length <= 12, q + ": order " + tools);
    ok(steps[steps.length - 1].after.length === steps.length - 1, q + ": the note waits for every step");
    ok(!tools.some(t => /order|sign|exec|withdraw/.test(t)), q + ": order-like tool");
    if (r.trade) { const risk = steps.find(s => s.tool === "risk"); ok(risk && tools.includes("audit") && risk.after.includes("audit"), q + ": trading plans end at the risk gate after the audit"); }
    ok(r.review.length >= 6 && r.review.every(x => x.helper && ["ok", "fix"].includes(x.verdict) && x.ar && x.en), q + ": review");
    ok(r.review.some(x => x.helper === "exec" && x.verdict === "ok"), "the executor states it opens nothing");
  }
  const trade = K.plan(g, K.ask(g, "وقف الخسارة قبل كل صفقة بيتكوين", { tokens: B.tokens }), "");
  ok(trade.trade && trade.plan.steps.some(s => s.tool === "risk"), "a trading question adds the risk gate");
});
test("the brief lists the pack's page, sources with terms, tools as ideas and open gaps", () => {
  const pk = K.ask(g, "كيف أراقب ناقلات النفط في مضيق هرمز", { tokens: B.tokens }), b = K.brief(g, pk, K.gaps(g));
  ok(b.page && b.read.length && b.read.every(s => s.terms) && b.consider.every(t => t.licence && /^https:\/\/github\.com\//.test(t.url)), JSON.stringify(b).slice(0, 300));
  ok(b.open.every(f => f.rule), "open items name their rule");
});
test("layout is deterministic and stays inside the disc", () => {
  const a = K.layout(g), b = K.layout(g);
  ok(JSON.stringify(a) === JSON.stringify(b) && a.length === g.nodes.length, "determinism");
  ok(a.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.hypot(p.x, p.y) <= 0.52), "inside");
});
test("enrichment builds and accepts only the two keyless CC0 endpoints, and its shapes drop everything else", () => {
  const u = K.enrichUrls("sea", "ar");
  ok(K.allowedEnrich("wikidata", u.wikidata) && K.allowedEnrich("openalex", u.openalex), "built URLs pass");
  for (const bad of ["http://www.wikidata.org/w/api.php", "https://evil.example/w/api.php", "https://www.wikidata.org/w/index.php", "https://user@api.openalex.org/topics", "https://api.openalex.org:444/topics", "https://api.openalex.org/works"])
    ok(!K.allowedEnrich("wikidata", bad) && !K.allowedEnrich("openalex", bad), "accepted " + bad);
  ok(!K.allowedEnrich("nvd", u.wikidata) && K.enrichUrls("nope") === null, "unknown");
  const wd = K.shapeEnrich.wikidata({ search: [{ id: "Q1", label: "x<script>", description: "d" }, { id: "javascript:1", label: "bad" }] });
  ok(wd.length === 1 && wd[0].url === "https://www.wikidata.org/wiki/Q1", JSON.stringify(wd));
  const oa = K.shapeEnrich.openalex({ results: [{ id: "https://openalex.org/T10017", display_name: "Topic", works_count: 1234, field: { display_name: "Earth" } }, { id: "https://evil/T1" }] });
  ok(oa.length === 1 && oa[0].works === 1234 && oa[0].id === "T10017", JSON.stringify(oa));
  ok(K.shapeEnrich.wikidata(null).length === 0 && K.shapeEnrich.openalex("x").length === 0, "garbage");
});
test("the Markdown and JSON exports name every domain and mark word links", () => {
  const md = K.toMarkdown(g, "2026-10-24", K.pagerank(g));
  ok(K.DOMAINS.every(d => md.includes(`## ${d.ar} · ${d.en}`)) && md.includes("[[") && md.includes("[INFERENCE]"), "markdown");
  const j = K.toJSON(g, "2026-10-24");
  ok(j.format === "omega-knowledge-graph-v1" && j.nodes.length === g.nodes.length && j.edges.length === g.edges.length, "json");
});
test("the knowledge-graph tools are https GitHub repositories with a licence, ideas only, Kùzu left out", () => {
  ok(K.KG_TOOLS.every(t => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(t.repo) && t.licence && t.status === "idea"), "fields");
  ok(!K.KG_TOOLS.some(t => /kuzu|kùzu/i.test(t.name)), "Kùzu is archived");
  const names = B.LIBRARY.map(x => x.name).concat(K.KG_TOOLS.map(x => x.name));
  ok(new Set(names).size === names.length, "a tool is listed twice");
});
test("the page and the Ops Room never write an order path, eval or innerHTML from the engine", () => {
  const src = readFileSync(join(HERE, "lib", "knowledge-domain.mjs"), "utf8");
  ok(!/innerHTML|eval\(|new Function|fetch\(|localStorage/.test(src), "unsafe call in the engine");
  const page = readFileSync(join(HERE, "..", "omega-ops-room-v1", "omega-knowledge.html"), "utf8");
  ok(/connect-src https:\/\/www\.wikidata\.org https:\/\/api\.openalex\.org;/.test(page), "the CSP names exactly the two enrichment hosts");
  ok(!/\.innerHTML\s*=/.test(page.split("<!-- OMEGA_KNOW end -->")[1] || ""), "innerHTML in the page script");
  const ops = readFileSync(join(HERE, "..", "omega-ops-room-v1", "omega-ops-room.html"), "utf8");
  ok(/omega-know-plan-v1/.test(ops) && /K\.checkPlan\(tpl\)\.ok \? tpl : null/.test(ops), "the Ops Room checks the knowledge plan before offering it");
});

/* ---------- inline copies ---------- */
for (const [name, script] of [["knowledge engine and registries", "build-knowledge-inline.mjs"], ["second brain engine", "build-brain-inline.mjs"], ["agent core engine", "build-core-inline.mjs"]])
  test(`the pages carry the current ${name}`, () => {
    const r = spawnSync(process.execPath, [join(HERE, script), "--check"], { encoding: "utf8" });
    ok(r.status === 0, (r.stderr || r.stdout).trim());
  });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
