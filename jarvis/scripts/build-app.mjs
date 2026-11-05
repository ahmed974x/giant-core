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
const data = {
  built: new Date(statSync(scanPath).mtimeMs).toISOString(),
  scan: { generated: scan.generated, summary: scan.summary },
  skills,
  preview: { cssHash: sha(previewCss), jsHash: sha(previewJs) },
  templates: TEMPLATES,
  i18n: JSON.parse(readFileSync(join(here, "..", "app", "src", "i18n-ar.json"), "utf8")),
  evidence,
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
const wfGraphSrc = readFileSync(join(here, "..", "server", "lib", "workflow-graph.mjs"), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, "");
if (/<\/script/i.test(wfGraphSrc)) fail('workflow-graph.mjs contains "</script"; it would end the element early.');
const cleanCloneSrc = readFileSync(join(here, "..", "server", "lib", "clean-clone.mjs"), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, "");
if (/<\/script/i.test(cleanCloneSrc)) fail('clean-clone.mjs contains "</script"; it would end the element early.');
fill("/*@APP_JS@*/", src("app.js").replace("/*@RULES@*/[]", () => "/* SKILLSPECTOR_RULES_START */" + JSON.stringify(rules).replace(/</g, "\\u003c") + "/* SKILLSPECTOR_RULES_END */").replace("/*@CLEAN_CLONE@*/", () => cleanCloneSrc).replace("/*@LLM_PLAN@*/", () => llmPlanSrc).replace("/*@WORKFLOW_GRAPH@*/", () => wfGraphSrc));

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
