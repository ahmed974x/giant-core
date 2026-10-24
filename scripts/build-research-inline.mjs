// Copies scripts/lib/deep-research.mjs into the ORACLE page as one inline <script> (ADR-114), the same way the
// Brain 2 maths reach the Ops Room (ADR-108): the page has to work when double-clicked from disk (file://), with no
// build step at load time. Run it after editing the library, then re-pin the CSP:
//   node scripts/build-research-inline.mjs            write the copy into the page
//   node scripts/build-research-inline.mjs --check    exit 1 when the page's copy differs from the library
//   node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-oracle.html
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts", "lib", "deep-research.mjs"), PAGE = join(REPO, "omega-ops-room-v1", "omega-oracle.html");
const BEGIN = "<!-- OMEGA_RESEARCH begin: generated from scripts/lib/deep-research.mjs by scripts/build-research-inline.mjs, do not edit here -->";
const END = "<!-- OMEGA_RESEARCH end -->";

const lib = readFileSync(LIB, "utf8");
const at = lib.indexOf("export const OMEGA_RESEARCH = ");
if (at < 0) throw new Error("deep-research.mjs: the export line is missing");
const header = lib.slice(0, at).trim().split("\n").filter(l => l.startsWith("//")).join("\n");
const body = lib.slice(at).replace("export const OMEGA_RESEARCH = ", "const OMEGA_RESEARCH = ").trimEnd();
const block = `${BEGIN}\n<script>\n"use strict";\n${header}\n${body}\nwindow.OMEGA_RESEARCH = OMEGA_RESEARCH;\n</script>\n${END}`;

const page = readFileSync(PAGE, "utf8");
const i = page.indexOf(BEGIN), j = page.indexOf(END);
if (i < 0 || j < i) throw new Error("omega-oracle.html: the OMEGA_RESEARCH markers are missing");
const next = page.slice(0, i) + block + page.slice(j + END.length);
if (process.argv.includes("--check")) {
  if (next !== page) { console.error("The ORACLE page's OMEGA_RESEARCH copy differs from scripts/lib/deep-research.mjs. Run node scripts/build-research-inline.mjs"); process.exit(1); }
  console.log("OMEGA_RESEARCH copy in the ORACLE page matches the library");
} else if (next !== page) { writeFileSync(PAGE, next); console.log("OMEGA_RESEARCH copied into the ORACLE page; now re-pin the CSP with skillspector --fix"); }
else console.log("OMEGA_RESEARCH already up to date");
