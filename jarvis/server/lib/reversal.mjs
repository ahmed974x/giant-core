// Reversal engine (ADR-150), pure: used by the server and inlined into the page. It reads what a person
// or the local model produced, finds what breaks the repository's rules, and writes the corrected copy
// with a list of corrections and SHA-256 hashes of before, after and the corrections. It never runs or
// sends anything. The same rules are in .claude/skills/replica-reversal-engine/reversal_engine.py.
//   Plan:     a money, publish, permissions, install or outbound step that is not a locked approval
//             becomes {gate: "approval", locked: true, status: "pending_approval"} (AGENTS.md §1); the
//             corrected plan is proved by prover.mjs.
//   Template: a gradient becomes one solid colour (a blue to purple one is the "AI gradient" DESIGN.md
//             forbids); glass (backdrop-filter) gets a prefers-reduced-transparency fallback; long words
//             get overflow-wrap: anywhere.
// Running the engine on its own output finds nothing more to correct.
import { enforceApprovalGates } from "./llm-plan.mjs";
import { provePlan } from "./prover.mjs";
import { sha256Hex } from "./snapshot.mjs";

export const REVERSAL_RULES = ["lock-sensitive-step", "ai-gradient", "gradient", "reduced-transparency", "overflow-wrap"];
const LOCKED_TO = { gate: "approval", locked: true, status: "pending_approval" };
const MAX_TEXT = 200000;

export function correctionVector(corrections) {
  const values = REVERSAL_RULES.map(r => corrections.filter(c => c.rule === r).length);
  return { rules: REVERSAL_RULES, values, total: values.reduce((a, b) => a + b, 0) };
}
// One line in plain English for each correction (the log, the memory lesson and the page use it).
export const describeCorrection = c => c.rule === "lock-sensitive-step" ? `step ${c.step + 1} «${c.title}» (${c.category}) was ${c.from.locked ? "locked, status " + (c.from.status || "none") : "not locked"}; now a locked approval, pending_approval`
  : c.rule === "reduced-transparency" ? "glass without a fallback: " + c.selectors.join(", ") + "; now solid under prefers-reduced-transparency"
  : c.rule === "overflow-wrap" ? "long words could overflow; added overflow-wrap: anywhere"
  : `${c.rule === "ai-gradient" ? "blue to purple gradient" : "gradient"} in ${c.property}; now ${c.to}`;
function sealed(kind, beforeText, afterText, corrections, extra) {
  const before = sha256Hex(beforeText), after = sha256Hex(afterText);
  return { kind, corrections, vector: correctionVector(corrections), before, after, proofHash: sha256Hex(before + "\n" + after + "\n" + JSON.stringify(corrections)), changed: corrections.length > 0, ...extra };
}

export function reversePlan(rawSteps) {
  const list = (Array.isArray(rawSteps) ? rawSteps : []).slice(0, 20);
  const corrections = [];
  const steps = enforceApprovalGates(list).map((s, i) => {
    if (!s.locked) return s;
    const o = list[i] && typeof list[i] === "object" ? list[i] : {};
    const from = { gate: o.gate == null ? null : String(o.gate), locked: o.locked === true, status: o.status == null ? null : String(o.status) };
    if (from.gate !== "approval" || !from.locked || from.status !== "pending_approval") corrections.push({ rule: "lock-sensitive-step", step: i, title: s.title, category: s.category, from, to: LOCKED_TO });
    return { ...s, ...LOCKED_TO };
  });
  const p = provePlan(steps);
  return sealed("plan", JSON.stringify(list), JSON.stringify(steps), corrections, { steps, proof: { verified: p.verified, states: p.states, effects: p.effects, lockedStates: p.lockedStates, violations: p.violations.length } });
}

// ---- Template rules -----------------------------------------------------------------------------------
// Every scan below is one linear pass or a pattern with bounded repeats, so a 200 KB paste of hostile text
// takes milliseconds, not minutes (found by the mutation run's 200,005-character case).
const GRADIENT = /(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]{0,200}\)){0,2000}\)/gi;
const COLOUR = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab)\([^()]{0,200}\)|\b[a-z]{1,30}\b/gi;
const NAMED = { blue: 240, navy: 240, royalblue: 225, dodgerblue: 210, deepskyblue: 195, steelblue: 207, cornflowerblue: 219, mediumblue: 240, darkblue: 240, cyan: 180, aqua: 180,
  purple: 300, violet: 300, indigo: 275, magenta: 300, fuchsia: 300, orchid: 302, plum: 300, mediumpurple: 260, blueviolet: 271, darkviolet: 282, rebeccapurple: 270, slateblue: 248,
  red: 0, orange: 39, yellow: 60, green: 120, lime: 120, teal: 180, pink: 350, black: null, white: null, gray: null, grey: null, transparent: null };
// The hue of a colour in HSL degrees, or null for a grey. OKLCH and LCH hues sit about 22° above HSL's for
// the same colour (blue 264 against 240, purple 328 against 300), so they are moved onto the HSL wheel.
export function hueOf(c) {
  const s = String(c).trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
    return rgbHue(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
  }
  m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)/.exec(s);
  if (m) return rgbHue(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^hsla?\(\s*(-?[\d.]+)/.exec(s);
  if (m) return ((Number(m[1]) % 360) + 360) % 360;
  m = /^(?:oklch|lch)\(\s*[\d.]+%?\s+([\d.]+)%?\s+(-?[\d.]+)/.exec(s);
  if (m) return Number(m[1]) < 0.02 && !s.startsWith("lch") ? null : ((Math.round(Number(m[2]) - 22) % 360) + 360) % 360;
  return Object.prototype.hasOwnProperty.call(NAMED, s) ? NAMED[s] : undefined;
}
function rgbHue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 8) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((Math.round(h * 60) % 360) + 360) % 360;
}
const isBlue = h => h != null && h >= 190 && h < 255;
const isPurple = h => h != null && h >= 255 && h < 320;
export function gradientColours(g) {
  const inner = g.slice(g.indexOf("(") + 1, -1);
  return (inner.match(COLOUR) || []).filter(c => hueOf(c) !== undefined);
}
export const isAiGradient = g => { const hs = gradientColours(g).map(hueOf); return hs.some(isBlue) && hs.some(isPurple); };

// Each declaration with a gradient becomes one solid colour: the gradient's first stop. A declaration runs
// from the last ; { } " ' < or > before the gradient to the next one after it.
const DECL_STOP = new Set([";", "{", "}", '"', "'", "<", ">"]);
const PROP = /\s*([a-z-]{1,60})(\s*:\s*)/iy;
function fixGradients(text, corrections) {
  const n = text.length, prevStop = new Int32Array(n + 1), nextStop = new Int32Array(n + 1);
  prevStop[0] = 0;
  for (let i = 0; i < n; i++) prevStop[i + 1] = DECL_STOP.has(text[i]) ? i + 1 : prevStop[i];
  nextStop[n] = n;
  for (let i = n - 1; i >= 0; i--) nextStop[i] = DECL_STOP.has(text[i]) ? i : nextStop[i + 1];
  let out = "", last = 0;
  for (const g of text.matchAll(GRADIENT)) {
    if (g.index < last) continue;
    const a = Math.max(prevStop[g.index], last);
    PROP.lastIndex = a;
    const d = PROP.exec(text);
    if (!d || PROP.lastIndex > g.index) continue;
    const b = nextStop[g.index + g[0].length], value = text.slice(PROP.lastIndex, b);
    const grads = value.match(GRADIENT);
    const solid = gradientColours(grads[0])[0] || "transparent";
    corrections.push({ rule: grads.some(isAiGradient) ? "ai-gradient" : "gradient", property: d[1].toLowerCase(), from: value.trim().slice(0, 200), to: solid });
    const lead = /^\s*/.exec(d[0])[0], tail = /\s*$/.exec(value)[0];
    out += text.slice(last, a) + lead + (/^background(-image)?$/i.test(d[1]) ? "background-color" + d[2] + solid : d[1] + d[2] + "none") + tail;
    last = b;
  }
  return out + text.slice(last);
}
// The CSS text of a page: the inside of its <style> elements, or the text itself when it is a stylesheet.
const isHtml = t => /<(?:!doctype|html|head|body|style|div|section|main|p|h[1-6])\b/i.test(t);
function cssOf(t) {
  if (!isHtml(t)) return t;
  const low = t.toLowerCase(), parts = [];
  for (let i = low.indexOf("<style"); i >= 0; i = low.indexOf("<style", i)) {
    if (!/^<style[\s>]/.test(low.slice(i, i + 7))) { i += 6; continue; }
    const open = low.indexOf(">", i), close = open < 0 ? -1 : low.indexOf("</style>", open);
    if (close < 0) break;
    parts.push(t.slice(open + 1, close));
    i = close + 8;
  }
  return parts.join("\n");
}
// The innermost blocks of a stylesheet, in one pass: { selector, body, fallback } where fallback is true
// inside an @media (prefers-reduced-transparency) block.
export function cssBlocks(css) {
  const out = [], stack = [];
  let run = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") {
      const prelude = css.slice(run, i), parent = stack[stack.length - 1];
      if (parent) parent.leaf = false;
      stack.push({ prelude, start: i + 1, leaf: true, fallback: (parent ? parent.fallback : false) || /^\s*@media\b[^{]*prefers-reduced-transparency/i.test(prelude) });
      run = i + 1;
    } else if (c === "}") {
      const b = stack.pop();
      if (b && b.leaf && !/[@;]/.test(b.prelude) && b.prelude.trim()) out.push({ selector: b.prelude.trim(), body: css.slice(b.start, i), fallback: b.fallback });
      run = i + 1;
    } else if (c === ";") run = i + 1;
  }
  return out;
}
const GLASS = /(?:^|[;\s])(?:-webkit-)?backdrop-filter\s*:\s*(?!none\b)[^;]/i;
export function glassSelectors(css) {
  const blocks = cssBlocks(css), covered = new Set(), missing = [];
  for (const b of blocks) if (b.fallback) for (const s of b.selector.split(",")) covered.add(s.trim());
  for (const b of blocks) {
    if (b.fallback || !GLASS.test(b.body)) continue;
    for (const s of b.selector.split(",").map(x => x.trim()).filter(Boolean)) if (!covered.has(s) && !missing.includes(s)) missing.push(s);
  }
  return missing;
}
const WRAP_RULE = ":where(h1, h2, h3, h4, p, li, td, th, dd, dt, a, blockquote, figcaption) { overflow-wrap: anywhere; }";
function addCss(text, css) {
  if (!isHtml(text)) return text.replace(/\s*$/, "") + "\n" + css + "\n";
  const at = text.toLowerCase().lastIndexOf("</style>");
  if (at >= 0) return text.slice(0, at) + css + "\n" + text.slice(at);
  const head = text.toLowerCase().indexOf("</head>");
  return head >= 0 ? text.slice(0, head) + "<style>\n" + css + "\n</style>\n" + text.slice(head) : "<style>\n" + css + "\n</style>\n" + text;
}

export function reverseTemplate(input) {
  const original = String(input == null ? "" : input).slice(0, MAX_TEXT);
  const corrections = [];
  let text = fixGradients(original, corrections);
  const missing = glassSelectors(cssOf(text));
  const added = [];
  if (missing.length) {
    added.push("@media (prefers-reduced-transparency: reduce) {\n  " + missing.join(", ") + " { -webkit-backdrop-filter: none; backdrop-filter: none; background-color: Canvas; color: CanvasText; }\n}");
    corrections.push({ rule: "reduced-transparency", selectors: missing, to: "solid Canvas background when the person asks for less transparency" });
  }
  if (!/overflow-wrap\s*:\s*anywhere/i.test(cssOf(text)) && /\S/.test(original)) {
    added.push(WRAP_RULE);
    corrections.push({ rule: "overflow-wrap", to: WRAP_RULE });
  }
  if (added.length) text = addCss(text, added.join("\n"));
  return sealed("template", original, text, corrections, { text, html: isHtml(original) });
}
