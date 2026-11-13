#!/usr/bin/env node
// Builds jarvis/design/index.html (the /design route, S12, ADR-132) from page.src.tmpl:
// inlines the generated tokens.css and the vendored fonts (Inter, Geist Mono, Readex Pro; OFL) so the page works
// from file:// with a strict CSP and no network. Node standard library only.
//
//   python3 .claude/skills/replica-design/build_tokens.py jarvis/replica/design/tokens.json --oklch
//   node jarvis/scripts/build-design-page.mjs            # write index.html
//   node jarvis/scripts/build-design-page.mjs --check    # exit 1 if index.html is stale
//   node scripts/skillspector-audit.mjs --fix jarvis/design/index.html   # re-pin CSP hashes
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontFaceCss } from "./lib/fonts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const src = join(here, "..", "design", "page.src.tmpl");
const out = join(here, "..", "design", "index.html");
const tokens = readFileSync(join(here, "..", "replica", "design", "tokens.css"), "utf8")
  .replace(/^\/\*[^*]*Generated[^*]*\*\/\s*/, "").trim();

let html = readFileSync(src, "utf8");
for (const marker of ["/*@TOKENS@*/", "/*@FONTS@*/"]) {
  if (!html.includes(marker)) { console.error(`build-design-page: marker ${marker} missing in page.src.tmpl`); process.exit(2); }
}
html = html.replace("/*@TOKENS@*/", () => tokens).replace("/*@FONTS@*/", () => fontFaceCss(repo));

// Keep the CSP the audit already pinned in index.html, so --check compares content only.
const cspRe = /<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/;
if (existsSync(out)) {
  const pinned = readFileSync(out, "utf8").match(cspRe);
  if (pinned) html = html.replace(cspRe, pinned[0]);
}

if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== html) { console.error("build-design-page: index.html is stale. Run the build, then skillspector --fix."); process.exit(1); }
  console.log("build-design-page: index.html is current.");
} else {
  writeFileSync(out, html);
  console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
}
