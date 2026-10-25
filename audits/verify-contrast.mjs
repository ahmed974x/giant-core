// Contrast gate for OMEGA / NABD design tokens (ADR-087).
// Reads the OKLCH custom properties straight from a CSS or HTML file and checks every
// text/background pair the design uses, in light, dark, the dark gold tone (ADR-127) and their P3 variants:
//   WCAG 2.x ratio >= 4.5 and |APCA Lc| >= 60 (both required).
// Usage: npm i culori@4.0.1 apca-w3@0.1.9 && node verify-contrast.mjs <file.css|file.html> [...]
// Exit code 1 if any pair fails.
import { readFileSync } from "node:fs";
import { parse, converter } from "culori";
import { APCAcontrast } from "apca-w3";

const xyz = converter("xyz65");
const Y = c => Math.max(0, xyz(c).y);
const wcag = (a, b) => { const [hi, lo] = [Y(a), Y(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const apca = (t, b) => Math.abs(Number(APCAcontrast(Y(t), Y(b))));

const TEXT = ["content-primary", "content-secondary", "content-tertiary", "accent", "gold", "violet", "success", "warning", "danger"];
const BGS = ["bg", "surface", "surface-2"];
const FILLS = [["on-accent-fill", "accent-fill"], ["on-gold-fill", "gold-fill"], ["on-danger-fill", "danger-fill"]];

// Ranges of every `@media (color-gamut: p3) { ... }` block, found by matching braces (a page may have several).
function p3Ranges(css) {
  const out = [];
  let at = css.indexOf("@media (color-gamut: p3)");
  while (at >= 0) {
    const open = css.indexOf("{", at);
    let depth = 0, i = open;
    for (; i < css.length; i++) { if (css[i] === "{") depth++; else if (css[i] === "}" && --depth === 0) break; }
    out.push([open, i]);
    at = css.indexOf("@media (color-gamut: p3)", i);
  }
  return out;
}

// Returns the declarations of every block whose selector matches exactly, in source order.
function blocks(css, selector, insideP3) {
  const out = {};
  const ranges = p3Ranges(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim().split("\n").pop().trim();
    const inP3 = ranges.some(([a, b]) => m.index > a && m.index < b);
    if (sel !== selector || inP3 !== insideP3) continue;
    for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}

// ADR-127: the dark gold peak tone sits on top of the dark theme, so its pairs are checked as dark + gold.
const GOLD = ':root[data-theme="dark"][data-tone="gold"]';

let failures = 0;
for (const file of process.argv.slice(2)) {
  const css = readFileSync(file, "utf8");
  const light = blocks(css, ":root", false);
  const dark = { ...light, ...blocks(css, ':root[data-theme="dark"]', false) };
  const modes = {
    light, dark,
    "light-p3": { ...light, ...blocks(css, ":root", true) },
    "dark-p3": { ...dark, ...blocks(css, ':root[data-theme="dark"]', true) },
  };
  const gold = blocks(css, GOLD, false);
  if (Object.keys(gold).length) {
    modes.gold = { ...modes.dark, ...gold };
    modes["gold-p3"] = { ...modes["dark-p3"], ...gold, ...blocks(css, GOLD, true) };
  }
  console.log(`\n${file}`);
  for (const [mode, t] of Object.entries(modes)) {
    const pairs = [];
    for (const fg of TEXT) for (const bg of BGS) if (t[fg] && t[bg]) pairs.push([fg, bg]);
    for (const [fg, bg] of FILLS) if (t[fg] && t[bg]) pairs.push([fg, bg]);
    let worst = null;
    for (const [fg, bg] of pairs) {
      const a = parse(t[fg]), b = parse(t[bg]);
      if (!a || !b) { console.log(`  ${mode}: cannot parse --${fg} or --${bg}`); failures++; continue; }
      const w = wcag(a, b), l = apca(a, b);
      const ok = w >= 4.5 && l >= 60;
      if (!ok) { failures++; console.log(`  FAIL ${mode}: --${fg} on --${bg}  WCAG ${w.toFixed(2)}  Lc ${l.toFixed(1)}`); }
      if (!worst || l < worst.l) worst = { fg, bg, w, l };
    }
    console.log(`  ${mode.padEnd(9)} ${pairs.length} pairs checked, weakest: --${worst.fg} on --${worst.bg}  WCAG ${worst.w.toFixed(2)}  Lc ${worst.l.toFixed(1)}`);
    const tert = t["content-tertiary"];
    if (tert) console.log(`  ${" ".repeat(9)} --content-tertiary = ${tert}`);
  }
}
console.log(failures ? `\n${failures} pair(s) FAIL` : "\nAll pairs pass WCAG >= 4.5 and APCA Lc >= 60.");
process.exit(failures ? 1 : 0);
