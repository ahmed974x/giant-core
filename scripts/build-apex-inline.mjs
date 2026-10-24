// Copies scripts/lib/apex-council.mjs into the APEX page as one inline <script> (ADR-127), with the registry it
// reads: the fifteen domains and the pages (knowledge-domain.mjs), ORACLE's sources (deep-research.mjs), PRIME's
// helpers and tools (agent-core.mjs) and the open-source library (second-brain.mjs). The page must work when
// double-clicked from disk, so nothing is fetched at run time; --check fails when the page's copy is stale.
//   node scripts/build-apex-inline.mjs            write the copy into the page
//   node scripts/build-apex-inline.mjs --check    exit 1 when the page's copy differs
//   node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-apex.html
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OMEGA_KNOW as K } from "./lib/knowledge-domain.mjs";
import { OMEGA_RESEARCH as R } from "./lib/deep-research.mjs";
import { OMEGA_BRAIN as B } from "./lib/second-brain.mjs";
import { OMEGA_CORE as C } from "./lib/agent-core.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts", "lib", "apex-council.mjs");
const PAGE = "omega-ops-room-v1/omega-apex.html";
const BEGIN = "<!-- OMEGA_APEX begin: generated from scripts/lib/apex-council.mjs and the registries by scripts/build-apex-inline.mjs, do not edit here -->";
const END = "<!-- OMEGA_APEX end -->";

export function registry() {
  const sources = {};
  for (const [id, s] of Object.entries(R.SOURCES)) sources[id] = { name: s.name, terms: s.terms, kind: s.kind, home: s.home };
  return {
    domains: K.DOMAINS.map(d => ({ id: d.id, ar: d.ar, en: d.en, trade: !!d.trade, words: d.words, lib: d.lib, sources: d.sources, helpers: d.helpers, pages: d.pages })),
    pages: K.PAGES.map(p => ({ id: p.id, ar: p.ar, en: p.en, file: p.file })),
    sources,
    helpers: C.HELPERS,
    tools: C.TOOLS,
    library: B.LIBRARY.map(x => ({ cat: x.cat, name: x.name, licence: x.licence, repo: x.repo, status: x.status }))
  };
}

const run = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (run) {
  const lib = readFileSync(LIB, "utf8");
  if (!lib.includes("export const OMEGA_APEX = ")) throw new Error("apex-council.mjs: the export line is missing");
  if (/^\s*import\s/m.test(lib)) throw new Error("apex-council.mjs must not import anything: the page copy has no module loader");
  const body = lib.replace("export const OMEGA_APEX = ", "const OMEGA_APEX = ").trimEnd();
  // JSON with "<" escaped, so no registry string can close the script element.
  const data = JSON.stringify(registry()).replace(/</g, "\\u003c");
  const block = `${BEGIN}\n<script>\n(() => {\n"use strict";\n${body}\nwindow.OMEGA_APEX = OMEGA_APEX;\nwindow.OMEGA_APEX_REG = Object.freeze(${data});\n})();\n</script>\n${END}`;
  const file = join(REPO, PAGE), page = readFileSync(file, "utf8");
  const i = page.indexOf(BEGIN), j = page.indexOf(END);
  if (i < 0 || j < i) { console.error(`${PAGE}: the OMEGA_APEX markers are missing`); process.exit(1); }
  const next = page.slice(0, i) + block + page.slice(j + END.length);
  if (process.argv.includes("--check")) {
    if (next !== page) { console.error(`${PAGE}: the OMEGA_APEX copy differs from the library or the registries. Run node scripts/build-apex-inline.mjs`); process.exit(1); }
    console.log(`${PAGE}: OMEGA_APEX matches the library and the registries`);
  } else if (next !== page) { writeFileSync(file, next); console.log(`${PAGE}: OMEGA_APEX copied; now re-pin the CSP with skillspector --fix`); }
  else console.log(`${PAGE}: OMEGA_APEX already up to date`);
}
