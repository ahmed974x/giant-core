// Copies scripts/lib/agent-core.mjs into the core page and the Ops Room as one inline <script> (ADR-121), the same
// way the second brain engine reaches its page (ADR-119): both pages have to work when double-clicked from disk.
//   node scripts/build-core-inline.mjs            write the copies into the pages
//   node scripts/build-core-inline.mjs --check    exit 1 when a page's copy differs from the library
//   node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-core.html omega-ops-room-v1/omega-ops-room.html
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts", "lib", "agent-core.mjs");
const PAGES = ["omega-ops-room-v1/omega-core.html", "omega-ops-room-v1/omega-ops-room.html"];
const BEGIN = "<!-- OMEGA_CORE begin: generated from scripts/lib/agent-core.mjs by scripts/build-core-inline.mjs, do not edit here -->";
const END = "<!-- OMEGA_CORE end -->";

const lib = readFileSync(LIB, "utf8");
if (!lib.includes("export const OMEGA_CORE = ")) throw new Error("agent-core.mjs: the export line is missing");
if (/^\s*import\s/m.test(lib)) throw new Error("agent-core.mjs must not import anything: the page copy has no module loader");
const body = lib.replace("export const OMEGA_CORE = ", "const OMEGA_CORE = ").trimEnd();
const block = `${BEGIN}\n<script>\n(() => {\n"use strict";\n${body}\nwindow.OMEGA_CORE = OMEGA_CORE;\n})();\n</script>\n${END}`;

let bad = 0;
for (const rel of PAGES) {
  const file = join(REPO, rel), page = readFileSync(file, "utf8");
  const i = page.indexOf(BEGIN), j = page.indexOf(END);
  if (i < 0 || j < i) { console.error(`${rel}: the OMEGA_CORE markers are missing`); bad++; continue; }
  const next = page.slice(0, i) + block + page.slice(j + END.length);
  if (process.argv.includes("--check")) {
    if (next !== page) { console.error(`${rel}: the OMEGA_CORE copy differs from scripts/lib/agent-core.mjs. Run node scripts/build-core-inline.mjs`); bad++; }
    else console.log(`${rel}: OMEGA_CORE matches the library`);
  } else if (next !== page) { writeFileSync(file, next); console.log(`${rel}: OMEGA_CORE copied; now re-pin the CSP with skillspector --fix`); }
  else console.log(`${rel}: OMEGA_CORE already up to date`);
}
process.exit(bad ? 1 : 0);
