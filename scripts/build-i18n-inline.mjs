// Copies the Arabic / English engine (scripts/lib/i18n.mjs) and each page's dictionary (scripts/lib/i18n/*.mjs)
// into the pages as one inline <script> at the end of <body> (ADR-119), the same way the research and trade lab
// engines reach their pages: every page must work when double-clicked from disk (file://), with no build step.
//   node scripts/build-i18n-inline.mjs            write the copies into the pages
//   node scripts/build-i18n-inline.mjs --check    exit 1 when a page's copy differs from the library
//   node scripts/skillspector-audit.mjs --fix <pages>   then re-pin the CSP hashes
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts", "lib", "i18n.mjs");
const BEGIN = "<!-- OMEGA_I18N begin: generated from scripts/lib/i18n.mjs and scripts/lib/i18n/ by scripts/build-i18n-inline.mjs, do not edit here -->";
const END = "<!-- OMEGA_I18N end -->";
export const PAGES = [
  { page: "omega-ops-room-v1/omega-ops-room.html", dict: ["ops.mjs", "OPS"], source: "both", flipDir: false },
  { page: "omega-ops-room-v1/the-chain.html", dict: ["chain.mjs", "CHAIN"], source: "ar" },
  { page: "omega-ops-room-v1/omega-oracle.html", dict: ["oracle.mjs", "ORACLE"], source: "ar" },
  { page: "omega-ops-room-v1/omega-trade-lab.html", dict: ["tradelab.mjs", "TRADELAB"], source: "ar" },
  { page: "omega-ops-room-v1/omega-second-brain.html", dict: ["brain.mjs", "BRAIN"], source: "ar" },
  { page: "omega-ops-room-v1/omega-core.html", dict: ["core.mjs", "CORE"], source: "ar" },
  { page: "omega-ops-room-v1/omega-knowledge.html", dict: ["know.mjs", "KNOW"], source: "ar" }
];

const lib = readFileSync(LIB, "utf8");
if (!lib.includes("export const OMEGA_I18N = ")) throw new Error("i18n.mjs: the export line is missing");
if (/^\s*import\s/m.test(lib)) throw new Error("i18n.mjs must not import anything: the page copy has no module loader");
const body = lib.replace("export const OMEGA_I18N = ", "const OMEGA_I18N = ").trimEnd();
const { COMMON } = await import(pathToFileURL(join(REPO, "scripts", "lib", "i18n", "common.mjs")).href);

let bad = 0;
for (const p of PAGES) {
  const mod = await import(pathToFileURL(join(REPO, "scripts", "lib", "i18n", p.dict[0])).href);
  const pairs = COMMON.concat(mod[p.dict[1]]);
  // JSON with "<" escaped, so no dictionary string can close the script element.
  const data = JSON.stringify(pairs).replace(/</g, "\\u003c");
  const opts = JSON.stringify({ source: p.source, button: "themeToggle", flipDir: p.flipDir !== false });
  const block = `${BEGIN}\n<script>\n(() => {\n"use strict";\n${body}\nconst PAIRS = ${data};\nwindow.OMEGA_I18N = OMEGA_I18N;\nconst start = () => { window.OMEGA_LANG = OMEGA_I18N.mount(Object.assign({ pairs: PAIRS }, ${opts})); };\nif (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();\n})();\n</script>\n${END}`;
  const file = join(REPO, p.page);
  let page;
  try { page = readFileSync(file, "utf8"); } catch (e) { console.error("missing page " + p.page); bad++; continue; }
  const i = page.indexOf(BEGIN), j = page.indexOf(END);
  let next;
  if (i >= 0 && j > i) next = page.slice(0, i) + block + page.slice(j + END.length);
  else { const k = page.lastIndexOf("</body>"); if (k < 0) throw new Error(p.page + ": no </body>"); next = page.slice(0, k) + block + "\n" + page.slice(k); }
  if (process.argv.includes("--check")) {
    if (next !== page) { console.error(`${p.page}: the OMEGA_I18N copy differs from the library. Run node scripts/build-i18n-inline.mjs`); bad++; }
    else console.log(`${p.page}: OMEGA_I18N matches (${pairs.length} pairs)`);
  } else if (next !== page) { writeFileSync(file, next); console.log(`${p.page}: OMEGA_I18N written (${pairs.length} pairs); re-pin the CSP`); }
  else console.log(`${p.page}: already up to date`);
}
process.exit(bad ? 1 : 0);
