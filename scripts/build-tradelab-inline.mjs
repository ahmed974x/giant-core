// Copies scripts/lib/trade-lab.mjs into the TRADE LAB page as one inline <script> (ADR-116), the same way the
// research engine reaches ORACLE (ADR-114): the page has to work when double-clicked from disk (file://), with no
// build step at load time. Run it after editing the library, then re-pin the CSP:
//   node scripts/build-tradelab-inline.mjs            write the copy into the page
//   node scripts/build-tradelab-inline.mjs --check    exit 1 when the page's copy differs from the library
//   node scripts/skillspector-audit.mjs --fix omega-ops-room-v1/omega-trade-lab.html
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(REPO, "scripts", "lib", "trade-lab.mjs"), PAGE = join(REPO, "omega-ops-room-v1", "omega-trade-lab.html");
const BEGIN = "<!-- OMEGA_TRADELAB begin: generated from scripts/lib/trade-lab.mjs by scripts/build-tradelab-inline.mjs, do not edit here -->";
const END = "<!-- OMEGA_TRADELAB end -->";

const lib = readFileSync(LIB, "utf8");
if (!lib.includes("export const OMEGA_TRADELAB = ")) throw new Error("trade-lab.mjs: the export line is missing");
if (/^\s*import\s/m.test(lib)) throw new Error("trade-lab.mjs must not import anything: the page copy has no module loader");
// The whole module goes in, inside one function scope, so its helpers do not become page globals.
const body = lib.replace("export const OMEGA_TRADELAB = ", "const OMEGA_TRADELAB = ").trimEnd();
const block = `${BEGIN}\n<script>\n(() => {\n"use strict";\n${body}\nwindow.OMEGA_TRADELAB = OMEGA_TRADELAB;\n})();\n</script>\n${END}`;

const page = readFileSync(PAGE, "utf8");
const i = page.indexOf(BEGIN), j = page.indexOf(END);
if (i < 0 || j < i) throw new Error("omega-trade-lab.html: the OMEGA_TRADELAB markers are missing");
const next = page.slice(0, i) + block + page.slice(j + END.length);
if (process.argv.includes("--check")) {
  if (next !== page) { console.error("The TRADE LAB page's OMEGA_TRADELAB copy differs from scripts/lib/trade-lab.mjs. Run node scripts/build-tradelab-inline.mjs"); process.exit(1); }
  console.log("OMEGA_TRADELAB copy in the TRADE LAB page matches the library");
} else if (next !== page) { writeFileSync(PAGE, next); console.log("OMEGA_TRADELAB copied into the TRADE LAB page; now re-pin the CSP with skillspector --fix"); }
else console.log("OMEGA_TRADELAB already up to date");
