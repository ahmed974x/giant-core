// Copies scripts/lib/second-brain.mjs into the second brain page as one inline <script> (ADR-119), the same way the
// trade lab engine reaches TRADE LAB (ADR-116): the page has to work when double-clicked from disk (file://).
//   node scripts/build-brain-inline.mjs            write the copy into the page
//   node scripts/build-brain-inline.mjs --check    exit 1 when the page's copy differs from the library
//   node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-second-brain.html
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts", "lib", "second-brain.mjs"), PAGE = join(REPO, "omega-ops-room-v1", "omega-second-brain.html");
const BEGIN = "<!-- OMEGA_BRAIN begin: generated from scripts/lib/second-brain.mjs by scripts/build-brain-inline.mjs, do not edit here -->";
const END = "<!-- OMEGA_BRAIN end -->";

const lib = readFileSync(LIB, "utf8");
if (!lib.includes("export const OMEGA_BRAIN = ")) throw new Error("second-brain.mjs: the export line is missing");
if (/^\s*import\s/m.test(lib)) throw new Error("second-brain.mjs must not import anything: the page copy has no module loader");
const body = lib.replace("export const OMEGA_BRAIN = ", "const OMEGA_BRAIN = ").trimEnd();
const block = `${BEGIN}\n<script>\n(() => {\n"use strict";\n${body}\nwindow.OMEGA_BRAIN = OMEGA_BRAIN;\n})();\n</script>\n${END}`;

const page = readFileSync(PAGE, "utf8");
const i = page.indexOf(BEGIN), j = page.indexOf(END);
if (i < 0 || j < i) throw new Error("omega-second-brain.html: the OMEGA_BRAIN markers are missing");
const next = page.slice(0, i) + block + page.slice(j + END.length);
if (process.argv.includes("--check")) {
  if (next !== page) { console.error("The second brain page's OMEGA_BRAIN copy differs from scripts/lib/second-brain.mjs. Run node scripts/build-brain-inline.mjs"); process.exit(1); }
  console.log("OMEGA_BRAIN copy in the second brain page matches the library");
} else if (next !== page) { writeFileSync(PAGE, next); console.log("OMEGA_BRAIN copied into the second brain page; now re-pin the CSP with skillspector --fix"); }
else console.log("OMEGA_BRAIN already up to date");
