// Copies scripts/lib/brain2-math.mjs into the Ops Room as one inline <script> (ADR-108). The page has to work
// when double-clicked from disk (file://), with no build step at load time, so the shared maths is pasted in
// between two markers instead of being imported. Run it after editing the library, then re-pin the CSP:
//   node scripts/build-brain2-inline.mjs            write the copy into the page
//   node scripts/build-brain2-inline.mjs --check    exit 1 when the page's copy differs from the library
//   node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-ops-room.html
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts", "lib", "brain2-math.mjs"), PAGE = join(REPO, "omega-ops-room-v1", "omega-ops-room.html");
const BEGIN = "<!-- OMEGA_MATH begin: generated from scripts/lib/brain2-math.mjs by scripts/build-brain2-inline.mjs, do not edit here -->";
const END = "<!-- OMEGA_MATH end -->";

const lib = readFileSync(LIB, "utf8");
const at = lib.indexOf("export const OMEGA_MATH = ");
if (at < 0) throw new Error("brain2-math.mjs: the export line is missing");
const header = lib.slice(0, at).trim().split("\n").filter(l => l.startsWith("//")).join("\n");
const body = lib.slice(at).replace("export const OMEGA_MATH = ", "const OMEGA_MATH = ").trimEnd();
const block = `${BEGIN}\n<script>\n"use strict";\n${header}\n${body}\nwindow.OMEGA_MATH = OMEGA_MATH;\n</script>\n${END}`;

const page = readFileSync(PAGE, "utf8");
const i = page.indexOf(BEGIN), j = page.indexOf(END);
let next;
if (i >= 0 && j > i) next = page.slice(0, i) + block + page.slice(j + END.length);
else {
  // First run: place it just before the trading desk script, which uses it.
  const anchor = page.indexOf('<script>\n"use strict";\n// Trading desk (ADR-091, ADR-092)');
  if (anchor < 0) throw new Error("omega-ops-room.html: trading desk script not found");
  next = page.slice(0, anchor) + block + "\n" + page.slice(anchor);
}
if (process.argv.includes("--check")) {
  if (next !== page) { console.error("The Ops Room's OMEGA_MATH copy differs from scripts/lib/brain2-math.mjs. Run node scripts/build-brain2-inline.mjs"); process.exit(1); }
  console.log("OMEGA_MATH copy in the Ops Room matches the library");
} else if (next !== page) { writeFileSync(PAGE, next); console.log("OMEGA_MATH copied into the Ops Room; now re-pin the CSP with skillspector --fix"); }
else console.log("OMEGA_MATH already up to date");
