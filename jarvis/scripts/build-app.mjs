#!/usr/bin/env node
// Builds jarvis/app/index.html (ADR-133) from jarvis/app/src: inlines the design tokens, the vendored
// fonts, the app CSS and JS, the Studio preview runtime (in a <template>, so the parent CSP pins its
// hashes and the sandboxed srcdoc frame inherits them) and a snapshot of the repo's skills with their
// SkillSpector status. Node standard library only; it starts no process and touches no network.
//
//   python3 .claude/skills/replica-design/build_tokens.py jarvis/replica/design/tokens.json --oklch
//   node scripts/skillspector-audit.mjs --json jarvis/app/data/skills-scan.json .claude/skills
//   node jarvis/scripts/build-app.mjs              # write jarvis/app/index.html
//   node scripts/skillspector-audit.mjs --fix jarvis/app/index.html   # re-pin the CSP hashes
//   node jarvis/scripts/build-app.mjs --check      # exit 1 if index.html is stale
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontFaceCss } from "./lib/fonts.mjs";
// The scanner's main() only runs when it is the entry script, so this import just reads its rule set.
import { RULES } from "../../scripts/skillspector-audit.mjs";
// Mission templates and the gate's evidence rules come from the server's engine, so both modes agree.
import { TEMPLATES, judge } from "../server/lib/missions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const src = p => readFileSync(join(here, "..", "app", "src", p), "utf8");
const out = join(here, "..", "app", "index.html");
const dataDir = join(here, "..", "app", "data");
const fail = msg => { console.error("build-app: " + msg); process.exit(2); };

// 1. Tokens and fonts.
const tokens = readFileSync(join(here, "..", "replica", "design", "tokens.css"), "utf8").replace(/^\/\*[^*]*Generated[^*]*\*\/\s*/, "").trim();
const fonts = fontFaceCss(repo);
const previewFonts = fontFaceCss(repo, ["Inter Variable", "Readex Pro Variable", "Geist Mono Variable"]);

// 2. Preview runtime: its exact text is what the parent CSP pins and what the download carries.
const previewCss = src("preview.css").replace("/*@PREVIEW_FONTS@*/", previewFonts);
const previewJs = src("preview.js");
// Inside <style> only "</style" ends the element; inside <script> only "</script" does.
for (const [name, text, tag] of [["preview.css", previewCss, "style"], ["app.css", src("app.css"), "style"], ["preview.js", previewJs, "script"], ["app.js", src("app.js"), "script"]]) {
  if (new RegExp("</" + tag, "i").test(text)) fail(`${name} contains "</${tag}"; it would end the element early. Write <\\/${tag}> in strings.`);
}
const sha = s => "sha256-" + createHash("sha256").update(s, "utf8").digest("base64");

// 3. Skills snapshot (real data from the repo at build time).
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const fm = m[1];
  const name = (/^name:\s*(.+)$/m.exec(fm) || [])[1];
  const d = /^description:\s*(>-?|\|-?)?[ \t]*\r?\n?([\s\S]*?)(?=^[A-Za-z][\w-]*:|(?![\s\S]))/m.exec(fm);
  return { name: name && name.trim(), description: d ? d[2].replace(/\s+/g, " ").trim() : "" };
}
const readme = readFileSync(join(repo, ".claude", "skills", "README.md"), "utf8");
const projectSection = readme.slice(readme.indexOf("## Project skills"));
const projectNames = new Set([...projectSection.matchAll(/^\| `([a-z0-9-]+)`/gm)].map(m => m[1]));
const REVIEWS = {
  "replica-design": "docs/security/REPLICA-DESIGN-SKILL-REVIEW-2026-11-04.md",
  "replica-architect": "docs/security/REPLICA-SKILLS-REVIEW-2026-11-04.md",
  "replica-build": "docs/security/REPLICA-SKILLS-REVIEW-2026-11-04.md",
  "replica-test": "docs/security/REPLICA-SKILLS-REVIEW-2026-11-04.md",
  "replica-diff": "docs/security/REPLICA-SKILLS-REVIEW-2026-11-04.md",
  "replica-backend": "docs/security/JARVIS-SERVER-AND-SKILLS-REVIEW-2026-11-04.md",
  "replica-entrepreneur": "docs/security/JARVIS-SERVER-AND-SKILLS-REVIEW-2026-11-04.md",
  "replica-long-horizon": "docs/security/LONG-HORIZON-SKILL-REVIEW-2026-11-05.md",
  "replica-cyber-recon": "docs/security/CYBER-RECON-SKILL-REVIEW-2026-11-05.md",
  "replica-hybrid-python": "docs/security/HYBRID-PYTHON-SKILL-REVIEW-2026-11-05.md",
  "replica-impeccable": "docs/security/GOVERNANCE-SKILLS-REVIEW-2026-11-06.md",
  "replica-graphify": "docs/security/GOVERNANCE-SKILLS-REVIEW-2026-11-06.md",
  "replica-humanizer": "docs/security/GOVERNANCE-SKILLS-REVIEW-2026-11-06.md",
};
const scanPath = join(dataDir, "skills-scan.json");
if (!existsSync(scanPath)) fail("missing jarvis/app/data/skills-scan.json; run the skillspector --json command in the header first.");
const scan = JSON.parse(readFileSync(scanPath, "utf8"));
const rules = RULES.map(({ id, sev, re, flags, files, msg }) => ({ id, sev, re, flags, files, msg }));
const skillsDir = join(repo, ".claude", "skills");
const skills = [];
for (const name of readdirSync(skillsDir).sort()) {
  const dir = join(skillsDir, name);
  if (!statSync(dir).isDirectory() || !existsSync(join(dir, "SKILL.md"))) continue;
  const fm = frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8"));
  const source = name.startsWith("replica-") ? "reviewed" : (projectNames.has(name) || name.startsWith("omega-") || name === "awesome-research") ? "project" : "vendored";
  const findings = { critical: 0, high: 0, medium: 0, low: 0, suppressed: 0 };
  const prefix = `.claude/skills/${name}/`;
  for (const f of scan.findings || []) if (f.file.startsWith(prefix) && findings[f.sev] != null) findings[f.sev]++;
  for (const f of scan.suppressed || []) if (f.file.startsWith(prefix)) findings.suppressed++;
  skills.push({ name: fm.name || name, folder: name, description: fm.description, source, review: REVIEWS[name] || null, findings });
}
// 3b. Evidence snapshot for sample-mode gates: every file a template's gate names, judged at build time.
const evidence = [];
for (const t of Object.values(TEMPLATES)) for (const st of t.steps) for (const c of st.criteria || []) {
  if (evidence.some(e => e.path === c.evidence && e.check === c.check)) continue;
  const abs = join(repo, c.evidence);
  if (!existsSync(abs)) { evidence.push({ path: c.evidence, check: c.check, ok: false, detail: "No evidence file at " + c.evidence + ".", sha256: null, savedAt: null }); continue; }
  const buf = readFileSync(abs);
  const j = judge(c.check, buf.toString("utf8"));
  evidence.push({ path: c.evidence, check: c.check, ok: j.ok, detail: j.detail, sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16), savedAt: null });
}
function readGraph() {
  const p = join(dataDir, "knowledge-graph.json");
  if (!existsSync(p)) return null;
  const g = JSON.parse(readFileSync(p, "utf8"));
  const keep = n => ({ id: n.id, kind: n.kind, label: n.label, file: n.file, line: n.line || null, constraints: n.constraints || undefined, functions: n.functions ? n.functions.slice(0, 12) : undefined, nav: n.nav });
  return { counts: g.counts, edges: g.edges, unlinked: g.unlinked, sha256: g.sha256, nodes: g.nodes.map(keep), built: new Date(statSync(p).mtimeMs).toISOString() };
}
function readQuality() {
  const p = join(dataDir, "impeccable-report.json");
  if (!existsSync(p)) return null;
  const r = JSON.parse(readFileSync(p, "utf8"));
  return { rules: r.rules, files: r.files, summary: r.summary, byRule: r.byRule, sha256: r.sha256, findings: r.findings.filter(f => f.severity !== "low").concat(r.findings.filter(f => f.severity === "low").slice(0, 30)), built: new Date(statSync(p).mtimeMs).toISOString() };
}
// ADR-146: measured evidence. A mutation result counts only while each tested file still has the hash it was
// tested with; the UI-state gate is a hard gate, so a failed gate stops the build.
function readMutation() {
  const p = join(here, "..", "replica", "evidence", "mutation-audit.log");
  if (!existsSync(p)) return null;
  const log = JSON.parse(readFileSync(p, "utf8"));
  const root = join(here, "..", "..");
  const targets = log.targets.map(t => ({ file: t.file, functions: t.functions, mutants: t.mutants, killed: t.killed, equivalent: t.equivalent, survived: t.survived, score: t.score,
    current: existsSync(join(root, t.file)) && createHash("sha256").update(readFileSync(join(root, t.file))).digest("hex") === t.sha256 }));
  return { ranAt: log.ranAt, total: log.total, killed: log.killed, equivalent: log.equivalent, score: log.score, sha256: log.sha256, targets, verified: targets.every(t => t.current) };
}
function readUiStates() {
  const p = join(here, "..", "replica", "evidence", "ui-states.json");
  if (!existsSync(p)) fail("jarvis/replica/evidence/ui-states.json is missing: run state_prover.py --ui jarvis/app/src/app.css --spec jarvis/replica/ui-states.json --json.");
  const r = JSON.parse(readFileSync(p, "utf8"));
  if (!r.gate || !r.complete) fail("the UI-state gate failed: " + r.components.filter(c => c.missing.length).map(c => c.component + " misses " + c.missing.join(", ")).join("; "));
  return { covered: r.covered, total: r.total, percent: r.percent, components: r.components.map(c => ({ component: c.component, required: c.required })) };
}
// ADR-151: the last bilingual purity run (written by test-app.mjs and test-live.mjs). The flows run on the
// built page, so a missing file only shows as "no evidence" here, never stops the build.
function readPurity() {
  const p = join(here, "..", "replica", "evidence", "bilingual-purity.log");
  if (!existsSync(p)) return null;
  const r = JSON.parse(readFileSync(p, "utf8"));
  const modes = ["sample", "live"].filter(m => r[m]);
  return { modes: modes.length, screens: modes.reduce((n, m) => n + r[m].screens, 0), left: modes.reduce((n, m) => n + r[m].arabic.violations + r[m].english.violations, 0) };
}
const data = {
  built: new Date(statSync(scanPath).mtimeMs).toISOString(),
  scan: { generated: scan.generated, summary: scan.summary },
  skills,
  preview: { cssHash: sha(previewCss), jsHash: sha(previewJs) },
  templates: TEMPLATES,
  i18n: JSON.parse(readFileSync(join(here, "..", "app", "src", "i18n-ar.json"), "utf8")),
  evidence,
  // ADR-143: build-time snapshots from replica-graphify and replica-impeccable (rerun the tools, then build).
  graph: readGraph(),
  quality: readQuality(),
  mutation: readMutation(),
  uiStates: readUiStates(),
  purity: readPurity(),
  // ADR-162: the skill tree's input, written by replica-skill-tree's snapshot.
  tree: existsSync(join(dataDir, "skill-tree-input.json")) ? JSON.parse(readFileSync(join(dataDir, "skill-tree-input.json"), "utf8")) : null,
};

// 4. Assemble.
let html = src("shell.tmpl");
const fill = (marker, value) => {
  if (!html.includes(marker)) fail(`marker ${marker} missing in shell.tmpl`);
  html = html.replace(marker, () => value);
};
fill("/*@FONTS@*/", fonts);
fill("/*@TOKENS@*/", tokens);
fill("/*@APP_CSS@*/", src("app.css"));
fill("/*@PREVIEW_CSS@*/", previewCss);
fill("/*@PREVIEW_JS@*/", previewJs);
fill("/*@DATA@*/", JSON.stringify(data).replace(/</g, "\\u003c"));
// The rule set goes into the app script between the scanner's own markers, which it blanks out
// before scanning (the same way the Ops Room carries it), so the patterns do not flag themselves.
const llmPlanSrc = readFileSync(join(here, "..", "server", "lib", "llm-plan.mjs"), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, "");
if (/<\/script/i.test(llmPlanSrc)) fail('llm-plan.mjs contains "</script"; it would end the element early.');
const inlineLib = name => { const t = readFileSync(join(here, "..", "server", "lib", name), "utf8").replace(/^export \{[^}]*\} from .*$/gm, "").replace(/^export /gm, "").replace(/^import .*$/gm, ""); if (/<\/script/i.test(t)) fail(name + ' contains "</script".'); return t; };
const bm25Src = inlineLib("bm25.mjs"), forgeSrc = inlineLib("forge.mjs"), selfCheckSrc = inlineLib("selfcheck.mjs"), skillAuditSrc = inlineLib("skill-audit.mjs"), catalogSrc = inlineLib("model-catalog.mjs");
// ADR-144: the council, the Studio time machine and UX physics run in the page too (sample mode and the
// heatmap). The council's address check is fetch-public.mjs's own pure part (v4Blocked to isBlockedAddress),
// cut from the file so the page and the server refuse the same ranges; node:net is replaced by two tests.
const fpSrc = readFileSync(join(here, "..", "server", "lib", "fetch-public.mjs"), "utf8");
const fpA = fpSrc.indexOf("function v4Blocked("), fpB = fpSrc.indexOf("export function checkUrl(");
if (fpA < 0 || fpB < fpA) fail("fetch-public.mjs: could not find isBlockedAddress for the page.");
const councilSrc = "const net = { isIPv4: s => /^(\\d{1,3})(\\.\\d{1,3}){3}$/.test(s) && s.split(\".\").every(n => Number(n) <= 255), isIPv6: s => /^[0-9a-f:.]+(%.+)?$/i.test(s) && s.includes(\":\") };\n" +
  "const isLocalModelEngine = e => e === \"ollama-local-loopback\" || e === \"openai-compat-loopback\";\n" +
  fpSrc.slice(fpA, fpB).replace(/^export /gm, "") + inlineLib("council.mjs") + "\n" + inlineLib("snapshot.mjs") + "\n" + inlineLib("ux-physics.mjs") + "\n" + inlineLib("prover.mjs") + "\n" + inlineLib("exporter.mjs") + "\n" + inlineLib("timeseries.mjs") + "\n" + inlineLib("merkle-audit.mjs") + "\n" + inlineLib("diagnostics.mjs") + "\n" + inlineLib("contrast-heal.mjs") + "\n" + inlineLib("reversal.mjs") + "\n" + inlineLib("passive-recon.mjs") + "\n" + inlineLib("prompt-metacodes.mjs") + "\n" + inlineLib("foss-atlas.mjs") +
  // ADR-159: the universal agent in its own scope (its helper names are short); it uses the prover and reversal above.
  "\nconst UniversalAgent = (() => {\n" + inlineLib("universal-agent.mjs") + "\nreturn { universalAgent, catalog, UA_MODES };\n})();";
const wfGraphSrc = readFileSync(join(here, "..", "server", "lib", "workflow-graph.mjs"), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, "");
if (/<\/script/i.test(wfGraphSrc)) fail('workflow-graph.mjs contains "</script"; it would end the element early.');
const cleanCloneSrc = readFileSync(join(here, "..", "server", "lib", "clean-clone.mjs"), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, "");
if (/<\/script/i.test(cleanCloneSrc)) fail('clean-clone.mjs contains "</script"; it would end the element early.');
fill("/*@APP_JS@*/", src("app.js").replace("/*@RULES@*/[]", () => "/* SKILLSPECTOR_RULES_START */" + JSON.stringify(rules).replace(/</g, "\\u003c") + "/* SKILLSPECTOR_RULES_END */").replace("/*@CLEAN_CLONE@*/", () => cleanCloneSrc).replace("/*@LLM_PLAN@*/", () => llmPlanSrc).replace("/*@WORKFLOW_GRAPH@*/", () => wfGraphSrc).replace("/*@COUNCIL_LIBS@*/", () => councilSrc).replace("/*@UNIVERSAL_MATH@*/", () => inlineLib("universal-math.mjs") + "\n" + inlineLib("math-typeset.mjs")).replace("/*@UNIFIED_WORKBENCH@*/", () => inlineLib("unified-workbench.mjs")).replace("/*@POLYMATH@*/", () => inlineLib("polymath-engine.mjs")).replace("/*@SKILL_TREE@*/", () => inlineLib("skill-tree.mjs")).replace("/*@HYPER_STUDIO@*/", () => inlineLib("hyper-studio.mjs") + "\n" + inlineLib("cinematic-presets.mjs")).replace("/*@MEMORY_LIBS@*/", () => bm25Src + "\n" + forgeSrc + "\n" + selfCheckSrc + "\n" + skillAuditSrc + "\n" + catalogSrc));

// The policy comes from shell.tmpl; only the sha256 lists SkillSpector pinned in the last build are
// carried over, so --check compares content and a policy change in the template still takes effect.
const cspRe = /<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/;
if (existsSync(out)) {
  const pinned = readFileSync(out, "utf8").match(cspRe);
  if (pinned) {
    const dir = (csp, name) => (new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(csp) || [])[1];
    html = html.replace(cspRe, (all, tmplCsp) => {
      let csp = tmplCsp;
      for (const name of ["script-src", "style-src"]) {
        const v = dir(pinned[1], name);
        if (v) csp = csp.replace(new RegExp(`(^|;\\s*)${name}\\s+[^;]*`), (m, pre) => `${pre}${name} ${v}`);
      }
      return all.replace(tmplCsp, () => csp);
    });
  }
}

if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== html) { console.error("build-app: jarvis/app/index.html is stale. Rebuild, then run skillspector --fix."); process.exit(1); }
  console.log("build-app: jarvis/app/index.html is current.");
} else {
  writeFileSync(out, html);
  console.log(`wrote jarvis/app/index.html (${(html.length / 1024).toFixed(1)} KB, ${skills.length} skills, ${rules.length} rules)`);
}
