// Copies scripts/lib/knowledge-domain.mjs into the knowledge domain page as one inline <script> (ADR-126), with the
// registry it reads: ORACLE's sources (scripts/lib/deep-research.mjs), the open-source library (second-brain.mjs),
// PRIME's tools and helpers (agent-core.mjs) and every decision record in docs/adr. The page must work when
// double-clicked from disk, so nothing is fetched at run time; --check fails when the page's copy is stale, for
// example after a new ADR, so CI keeps the registry honest.
//   node scripts/build-knowledge-inline.mjs            write the copy into the page
//   node scripts/build-knowledge-inline.mjs --check    exit 1 when the page's copy differs
//   node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-knowledge.html
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OMEGA_KNOW as K } from "./lib/knowledge-domain.mjs";
import { OMEGA_RESEARCH as R } from "./lib/deep-research.mjs";
import { OMEGA_BRAIN as B } from "./lib/second-brain.mjs";
import { OMEGA_CORE as C } from "./lib/agent-core.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts", "lib", "knowledge-domain.mjs");
const PAGE = "omega-ops-room-v1/omega-knowledge.html";
const BEGIN = "<!-- OMEGA_KNOW begin: generated from scripts/lib/knowledge-domain.mjs and the registries by scripts/build-knowledge-inline.mjs, do not edit here -->";
const END = "<!-- OMEGA_KNOW end -->";

export function registry() {
  const dir = join(REPO, "docs", "adr");
  const adrs = readdirSync(dir).filter(f => /^ADR-\d{3}-.*\.md$/.test(f)).sort()
    .map(f => K.parseAdr(readFileSync(join(dir, f), "utf8"), f)).filter(Boolean);
  const sources = {};
  for (const [id, s] of Object.entries(R.SOURCES)) sources[id] = { name: s.name, terms: s.terms, kind: s.kind, home: s.home };
  return {
    sources,
    library: B.LIBRARY.map(x => ({ cat: x.cat, name: x.name, licence: x.licence, repo: x.repo, ar: x.ar, en: x.en, status: x.status })),
    libraryCats: B.LIBRARY_CATS,
    tools: C.TOOLS,
    helpers: C.HELPERS,
    adrs
  };
}

const run = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (run) {
  const lib = readFileSync(LIB, "utf8");
  if (!lib.includes("export const OMEGA_KNOW = ")) throw new Error("knowledge-domain.mjs: the export line is missing");
  if (/^\s*import\s/m.test(lib)) throw new Error("knowledge-domain.mjs must not import anything: the page copy has no module loader");
  const body = lib.replace("export const OMEGA_KNOW = ", "const OMEGA_KNOW = ").trimEnd();
  // JSON with "<" escaped, so no registry string can close the script element.
  const data = JSON.stringify(registry()).replace(/</g, "\\u003c");
  const block = `${BEGIN}\n<script>\n(() => {\n"use strict";\n${body}\nwindow.OMEGA_KNOW = OMEGA_KNOW;\nwindow.OMEGA_KNOW_REG = Object.freeze(${data});\n})();\n</script>\n${END}`;
  const file = join(REPO, PAGE), page = readFileSync(file, "utf8");
  const i = page.indexOf(BEGIN), j = page.indexOf(END);
  if (i < 0 || j < i) { console.error(`${PAGE}: the OMEGA_KNOW markers are missing`); process.exit(1); }
  const next = page.slice(0, i) + block + page.slice(j + END.length);
  if (process.argv.includes("--check")) {
    if (next !== page) { console.error(`${PAGE}: the OMEGA_KNOW copy differs from the library or the registries (a new ADR?). Run node scripts/build-knowledge-inline.mjs`); process.exit(1); }
    console.log(`${PAGE}: OMEGA_KNOW matches the library and the registries`);
  } else if (next !== page) { writeFileSync(file, next); console.log(`${PAGE}: OMEGA_KNOW copied; now re-pin the CSP with skillspector --fix`); }
  else console.log(`${PAGE}: OMEGA_KNOW already up to date`);
}
