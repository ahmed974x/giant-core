// Static checks over every OMEGA page (ADR-120). No network, no browser, no dependencies.
//   node scripts/test-pages.mjs        exits 0 when every test passes
// 1. Each inline <style> block and site-landing/style.css closes every brace it opens. An unclosed
//    @media (pointer: coarse) block once swallowed the second brain's layout on laptops (ADR-120).
// 2. Arabic is never tracked or set in a monospace face: each page that keeps tracked brand or status text
//    or monospace number-column headers resets them under :root[lang="ar"] (DESIGN.md §2).
// 3. The Ops Room self-test badge shows the number of checks the self-test runs.
// 4. The language engine fires its first "omega-lang" event after mount() returns, so pages that re-render on
//    it read the chosen language.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0, passed = 0;
function test(name, f) {
  try { f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message || e)); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const read = p => readFileSync(join(ROOT, p), "utf8");
const PAGES = readdirSync(join(ROOT, "omega-ops-room-v1")).filter(f => f.endsWith(".html")).map(f => "omega-ops-room-v1/" + f)
  .concat(readdirSync(join(ROOT, "site-landing")).filter(f => f.endsWith(".html")).map(f => "site-landing/" + f));

// Brace depth of CSS text, ignoring comments, strings and url(...) bodies (base64 fonts).
function depth(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "url()").replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  let d = 0;
  for (const c of s) { if (c === "{") d++; else if (c === "}") { d--; if (d < 0) return -1; } }
  return d;
}

for (const p of PAGES) {
  const html = read(p), blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  test(`${p}: every <style> block closes its braces`, () => {
    blocks.forEach((b, i) => { const d = depth(b); assert(d === 0, `style block ${i + 1} ends at depth ${d}`); });
  });
}
test("site-landing/style.css closes its braces", () => { const d = depth(read("site-landing/style.css")); assert(d === 0, `ends at depth ${d}`); });

for (const p of ["omega-oracle", "omega-trade-lab", "omega-second-brain", "omega-core", "omega-knowledge", "omega-apex", "the-chain"].map(n => `omega-ops-room-v1/${n}.html`)) {
  test(`${p}: Arabic brand and status text untracked, number headers in the Arabic face`, () => {
    const h = read(p);
    assert(/:root\[lang="ar"\] \.brand, :root\[lang="ar"\] \.status-pill \{ letter-spacing: 0; \}/.test(h), "missing the Arabic letter-spacing reset");
    assert(/:root\[lang="ar"\] table\.data th\.n \{ font-family: var\(--font-ar\); \}/.test(h), "missing the Arabic face for th.n");
  });
}
test("site-landing/style.css: the calculator's Arabic row label is not monospace", () => {
  assert(/html\[lang="ar"\] \.calc-table td:first-child \{ font-family: var\(--font-ar\); \}/.test(read("site-landing/style.css")), "missing rule");
});

test("Ops Room: the self-test badge and label show the number of checks", () => {
  const h = read("omega-ops-room-v1/omega-ops-room.html");
  const start = h.indexOf("const CHECKS = ["), end = h.indexOf("\n  ];", start);
  assert(start > 0 && end > start, "CHECKS list not found");
  const n = (h.slice(start, end).match(/^ {4}\["/gm) || []).length;
  const badge = (h.match(/id="stBadge" aria-hidden="true">(\d+)</) || [])[1], label = (h.match(/aria-label="Verify system, (\d+) checks/) || [])[1];
  assert(n === 24, `expected 24 checks, found ${n}`);
  assert(Number(badge) === n, `badge says ${badge}, the self-test runs ${n}`);
  assert(Number(label) === n, `label says ${label}, the self-test runs ${n}`);
});

test("i18n engine: the first omega-lang event waits for mount() to return", () => {
  const src = read("scripts/lib/i18n.mjs");
  assert(/apply\(first, "init"\)/.test(src) && /if \(from === "init"\) Promise\.resolve\(\)\.then\(fire\)/.test(src), "first event is synchronous");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
