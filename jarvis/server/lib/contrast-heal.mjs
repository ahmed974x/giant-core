// OKLCH bisection contrast healer (ADR-153), pure: used by the reversal engine and the Studio, inlined into
// the page; the same maths is in .claude/skills/replica-reversal-engine/reversal_engine.py.
// When a text colour on its background misses DESIGN.md's floor (WCAG >= 4.5:1, or 3:1 for large text, and
// APCA |Lc| >= 60), the text colour's OKLCH lightness L is moved by bisection, chroma C and hue H kept, to
// the nearest L that passes both. 16 halvings of [L, 0] or [L, 1] give L to 1/65536. Both directions are
// tried (lighter wins on a dark background, darker on a light one); when both pass, the nearer L wins. Each
// candidate is judged on the 8-bit hex it would be written as, so the answer that comes back really passes.
// A lightness that leaves sRGB keeps its hue: chroma is lowered by bisection only as far as sRGB needs
// (CSS Color 4 gamut mapping keeps hue the same way), and the result says chromaReduced.

export const HEAL_STEPS = 16;
const clamp01 = x => Math.min(1, Math.max(0, x));
const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// "#rgb", "#rrggbb" or "oklch(L C H)" with L as 0-1 or a percentage. Returns [r, g, b] in 0-1, or null.
export function parseColour(s) {
  const t = String(s == null ? "" : s).trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/.exec(t);
  if (!m) return null;
  const L = Number(m[1]) / (m[2] ? 100 : 1), C = Number(m[3]), H = Number(m[4]);
  if (!(L >= 0 && L <= 1) || !(C >= 0) || !Number.isFinite(H)) return null;
  return oklchToRgb([L, C, H]).rgb;
}
export const toHex = rgb => "#" + rgb.map(c => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0")).join("");

// sRGB (0-1) -> OKLCH [L 0-1, C, H degrees], through linear sRGB and OKLab (Ottosson, 2020).
export function rgbToOklch(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.sqrt(A * A + B * B);
  return [L, C, C < 1e-7 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
export function oklchToRgb([L, C, H]) {
  const A = C * Math.cos((H * Math.PI) / 180), B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  const raw = lin.map(toGamma);
  return { rgb: raw.map(clamp01), clipped: raw.some(c => c < -1e-6 || c > 1 + 1e-6) };
}

// The colour at [L, C, H], with C lowered by bisection (16 steps) only if [L, C, H] is outside sRGB.
export function inGamut([L, C, H]) {
  const first = oklchToRgb([L, C, H]);
  if (!first.clipped) return { rgb: first.rgb, C, chromaReduced: false };
  let lo = 0, hi = C;
  for (let i = 0; i < HEAL_STEPS; i++) { const mid = (lo + hi) / 2; if (oklchToRgb([L, mid, H]).clipped) hi = mid; else lo = mid; }
  return { rgb: oklchToRgb([L, lo, H]).rgb, C: lo, chromaReduced: true };
}

// WCAG 2 contrast ratio, and APCA Lc (APCA-W3 0.1.9: the constants audits/verify-contrast.mjs uses).
const relLum = rgb => { const [r, g, b] = rgb.map(toLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function wcagRatio(a, b) { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
export function apcaLc(text, bg) {
  const y = c => { const v = 0.2126729 * c[0] ** 2.4 + 0.7151522 * c[1] ** 2.4 + 0.0721750 * c[2] ** 2.4; return v > 0.022 ? v : v + (0.022 - v) ** 1.414; };
  const yt = y(text), yb = y(bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) { const s = (yb ** 0.56 - yt ** 0.57) * 1.14; return s < 0.1 ? 0 : (s - 0.027) * 100; }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}
const round2 = x => Math.round(x * 100) / 100;
export const measure = (fg, bg) => ({ hex: toHex(fg), ratio: round2(wcagRatio(fg, bg)), lc: round2(apcaLc(fg, bg)) });
export const passes = (fg, bg, minRatio = 4.5, minLc = 60) => wcagRatio(fg, bg) >= minRatio && Math.abs(apcaLc(fg, bg)) >= minLc;
const oklchText = ([L, C, H]) => "oklch(" + (Math.round(L * 10000) / 100) + "% " + (Math.round(C * 1000) / 1000) + " " + (Math.round(H * 10) / 10) + ")";

// The heal. opts.large uses WCAG 3:1 for large text; opts.minLc defaults to 60.
export function healOklchContrast(fgIn, bgIn, opts = {}) {
  const fg = parseColour(fgIn), bg = parseColour(bgIn);
  if (!fg || !bg) return { ok: false, changed: false, reason: "not-a-colour" };
  const minRatio = opts.large ? 3 : 4.5, minLc = opts.minLc == null ? 60 : opts.minLc;
  const lch = rgbToOklch(fg), before = { ...measure(fg, bg), oklch: oklchText(lch) };
  if (passes(fg, bg, minRatio, minLc)) return { ok: true, changed: false, steps: 0, before, after: before, target: { ratio: minRatio, lc: minLc } };
  const at = L => { const o = inGamut([L, lch[1], lch[2]]); const hex = toHex(o.rgb); return { L, C: o.C, hex, rgb: parseColour(hex), chromaReduced: o.chromaReduced }; };
  const ok = c => passes(c.rgb, bg, minRatio, minLc);
  const search = end => {
    if (!ok(at(end))) return null;
    let lo = lch[0], hi = end, steps = 0;
    while (steps < HEAL_STEPS) { const mid = (lo + hi) / 2; if (ok(at(mid))) hi = mid; else lo = mid; steps++; }
    return { ...at(hi), steps };
  };
  const found = [1, 0].map(search).filter(Boolean).sort((a, b) => Math.abs(a.L - lch[0]) - Math.abs(b.L - lch[0]));
  if (!found.length) return { ok: false, changed: false, reason: "no-lightness-passes", before, target: { ratio: minRatio, lc: minLc } };
  const best = found[0];
  return { ok: true, changed: true, steps: best.steps, lightness: best.L, direction: best.L > lch[0] ? "lighter" : "darker", chromaReduced: best.chromaReduced, before, after: { ...measure(best.rgb, bg), oklch: oklchText([best.L, best.C, lch[2]]) }, target: { ratio: minRatio, lc: minLc } };
}
