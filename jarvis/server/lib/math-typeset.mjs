// The SVG maths typesetter (ADR-157), pure: used by the server (POST /api/w/:slug/math/solve adds formula_svg)
// and inlined into the page above the Math lab's plot. It lays out the tree that universal-math.mjs's Pratt
// parser builds, in the box-and-glue way of TeX: every piece is a box with a width, a height above the
// baseline and a depth below it, boxes join side by side with fixed glue, and fractions, radicals,
// superscripts, integrals and matrices are boxes built from boxes. Units are em; y grows downwards from the
// baseline, as in SVG. Glyph widths come from one fixed table (MT_WIDTH), not from a font file, so the layout
// is the same on every machine and in every test; the page draws with the system's maths font.
// Nothing here runs code: the only text drawn is digits, variable names of letters, the eight function names
// and fixed signs.
import { parse } from "./universal-math.mjs";

export const MT = { em: 24, pad: 0.25, scriptScale: 0.7, minScale: 0.5, rule: 0.05, axis: 0.25, gap: 0.12, thin: 0.12, med: 0.22 };
// Advance widths in em at scale 1: digits and most letters are half an em; narrow and wide letters and the
// signs have their own entries.
export const MT_WIDTH = { ".": 0.28, ",": 0.28, "i": 0.3, "j": 0.3, "l": 0.3, "t": 0.36, "f": 0.4, "r": 0.42, "m": 0.82, "w": 0.72, "+": 0.78, "−": 0.78, "=": 0.78, "·": 0.28, "π": 0.57, "d": 0.52, "∞": 1 };
export const MT_ASCENT = 0.72, MT_DEPTH = 0.22;
const r4 = x => Math.round(x * 1e4) / 1e4;

export function textWidth(str) { let w = 0; for (const c of str) w += MT_WIDTH[c] ?? 0.5; return w; }

// A box is { w, h, d, items }; items are { t: "text", x, y, s, str, cls }, { t: "rect", x, y, w, h } (a filled
// bar) and { t: "path", d: [[cmd, x, y, …]], sw } (a stroke). Coordinates are relative to the box's origin
// on its baseline.
export function textBox(str, cls, s) {
  return { w: textWidth(str) * s, h: MT_ASCENT * s, d: MT_DEPTH * s, items: [{ t: "text", x: 0, y: 0, s, str, cls }] };
}
export function glue(w) { return { w, h: 0, d: 0, items: [] }; }
export function moveItem(it, dx, dy) {
  if (it.t === "path") return { ...it, d: it.d.map(([c, ...p]) => [c, ...p.map((v, i) => v + (i % 2 ? dy : dx))]) };
  return { ...it, x: it.x + dx, y: it.y + dy };
}
export function hbox(boxes) {
  let x = 0, h = 0, d = 0;
  const items = [];
  for (const b of boxes) {
    for (const it of b.items) items.push(moveItem(it, x, 0));
    x += b.w; h = Math.max(h, b.h); d = Math.max(d, b.d);
  }
  return { w: x, h, d, items };
}
// The fraction bar sits on the maths axis, a quarter em above the baseline; the numerator rests above it and
// the denominator hangs below it, each centred on the wider of the two.
export function fracBox(num, den, s) {
  const th = MT.rule * s, axis = MT.axis * s, gap = MT.gap * s, W = Math.max(num.w, den.w) + 0.2 * s;
  const ny = -axis - th / 2 - gap - num.d, dy = -axis + th / 2 + gap + den.h;
  const items = [...num.items.map(it => moveItem(it, (W - num.w) / 2, ny)), ...den.items.map(it => moveItem(it, (W - den.w) / 2, dy)),
    { t: "rect", x: 0.05 * s, y: -axis - th / 2, w: W - 0.1 * s, h: th }];
  return { w: W, h: -ny + num.h, d: dy + den.d, items };
}
// A superscript is set at 0.7 of its base's size (never under half size) and raised so that it clears the
// base's top by a fixed share or sits at least 0.42 em up.
export function supBox(base, exp, s) {
  const u = Math.max(base.h - 0.3 * s, 0.42 * s), kern = 0.04 * s;
  const items = [...base.items, ...exp.items.map(it => moveItem(it, base.w + kern, -u))];
  return { w: base.w + kern + exp.w, h: Math.max(base.h, u + exp.h), d: Math.max(base.d, exp.d - u), items };
}
// A subscript (only log's base 10 here) is set small and lowered a fifth of an em.
export function subBox(base, sub, s) {
  const v = 0.2 * s;
  return { w: base.w + sub.w, h: Math.max(base.h, sub.h - v), d: Math.max(base.d, sub.d + v), items: [...base.items, ...sub.items.map(it => moveItem(it, base.w, v))] };
}
// Brackets are drawn as strokes that stretch to the content, so a tall fraction gets tall brackets.
export function delimBox(inner, s, kind) {
  const top = -inner.h - 0.08 * s, bot = inner.d + 0.08 * s, mid = (top + bot) / 2, sw = 0.06 * s;
  const side = kind === "bar" ? 0.18 * s : kind === "square" ? 0.28 * s : 0.27 * s;
  const shape = x0 => {
    if (kind === "bar") return [["M", x0 + side / 2, top], ["L", x0 + side / 2, bot]];
    if (kind === "square") return x0 === 0 ? [["M", side * 0.8, top], ["L", side * 0.25, top], ["L", side * 0.25, bot], ["L", side * 0.8, bot]] : [["M", x0 + side * 0.2, top], ["L", x0 + side * 0.75, top], ["L", x0 + side * 0.75, bot], ["L", x0 + side * 0.2, bot]];
    return x0 === 0 ? [["M", side * 0.8, top], ["Q", side * 0.05, mid, side * 0.8, bot]] : [["M", x0 + side * 0.2, top], ["Q", x0 + side * 0.95, mid, x0 + side * 0.2, bot]];
  };
  const items = [{ t: "path", d: shape(0), sw }, ...inner.items.map(it => moveItem(it, side, 0)), { t: "path", d: shape(side + inner.w), sw }];
  return { w: inner.w + 2 * side, h: inner.h + 0.08 * s, d: inner.d + 0.08 * s, items };
}
// The radical: a short tick, a long stroke down and up, and the bar over the content (the vinculum).
export function sqrtBox(inner, s) {
  const top = -inner.h - 0.16 * s, bot = inner.d + 0.06 * s, H = bot - top, lead = 0.62 * s, sw = 0.06 * s;
  const d = [["M", 0.02 * s, top + H * 0.58], ["L", 0.14 * s, top + H * 0.5], ["L", 0.32 * s, bot], ["L", 0.56 * s, top], ["L", lead + inner.w + 0.08 * s, top]];
  return { w: lead + inner.w + 0.12 * s, h: inner.h + 0.16 * s + sw / 2, d: inner.d + 0.06 * s, items: [{ t: "path", d, sw }, ...inner.items.map(it => moveItem(it, lead, 0))] };
}

const atom = n => (n.k === "n" && n.v >= 0) || n.k === "v" || n.k === "c";
const startsNeg = n => n.k === "neg" || (n.k === "*" && startsNeg(n.a));
const startsWithNumber = n => n.k === "n" || ((n.k === "*" || n.k === "^" || n.k === "+" || n.k === "-") && startsWithNumber(n.a));
export function numText(v) { return String(v).replace("-", "−").replace("e+", "e"); }

// The tree to a box. s is the size: 1 for the main line, 0.7 inside a superscript, never below 0.5.
export function layout(n, s = 1) {
  const paren = (x, cond) => (cond ? delimBox(layout(x, s), s, "round") : layout(x, s));
  switch (n.k) {
    case "n": return textBox(numText(n.v), "mn", s);
    case "v": return textBox(n.n, "mi", s);
    case "c": return textBox(n.n === "pi" ? "π" : "e", "mi", s);
    case "neg": return hbox([textBox("−", "mo", s), glue(0.04 * s), paren(n.a, n.a.k === "+" || n.a.k === "-")]);
    case "+": case "-": return hbox([layout(n.a, s), glue(MT.med * s), textBox(n.k === "+" ? "+" : "−", "mo", s), glue(MT.med * s),
      paren(n.b, startsNeg(n.b) || (n.k === "-" && (n.b.k === "+" || n.b.k === "-")))]);
    case "*": {
      const L = paren(n.a, n.a.k === "+" || n.a.k === "-"), R = paren(n.b, n.b.k === "+" || n.b.k === "-" || startsNeg(n.b));
      const dot = startsWithNumber(n.b) && !(n.b.k === "+" || n.b.k === "-");
      return hbox(dot ? [L, glue(MT.thin * s), textBox("·", "mo", s), glue(MT.thin * s), R] : [L, glue(0.06 * s), R]);
    }
    case "/": return fracBox(layout(n.a, s), layout(n.b, s), s);
    case "^": {
      const es = Math.max(s * MT.scriptScale, MT.minScale);
      return supBox(paren(n.a, !atom(n.a)), layout(n.b, es), s);
    }
    case "f": {
      const arg = layout(n.a, s);
      if (n.f === "sqrt") return sqrtBox(arg, s);
      if (n.f === "abs") return delimBox(arg, s, "bar");
      const name = n.f === "log10" ? subBox(textBox("log", "fn", s), textBox("10", "mn", Math.max(s * MT.scriptScale, MT.minScale)), s) : textBox(n.f, "fn", s);
      return hbox([name, glue(0.06 * s), delimBox(arg, s, "round")]);
    }
    default: throw new Error("unknown node " + n.k);
  }
}

// An integral sign stretched over the integrand, with its limits set small at the top and bottom right.
export function integralBox(body, lo, hi, v, s = 1) {
  const H = Math.max(body.h + body.d + 0.5 * s, 1.9 * s), top = -(H / 2) - MT.axis * s, bot = H / 2 - MT.axis * s, sw = 0.07 * s, iw = 0.5 * s;
  const sign = [["M", 0.06 * s, bot - 0.06 * s], ["Q", 0.2 * s, bot + 0.04 * s, 0.24 * s, bot - 0.2 * s], ["L", 0.3 * s, top + 0.2 * s], ["Q", 0.34 * s, top - 0.04 * s, 0.48 * s, top + 0.06 * s]];
  const ls = Math.max(s * MT.scriptScale, MT.minScale), hiB = textBox(numText(hi), "mn", ls), loB = textBox(numText(lo), "mn", ls);
  const limW = Math.max(hiB.w, loB.w) + 0.08 * s;
  const items = [{ t: "path", d: sign, sw }, ...hiB.items.map(it => moveItem(it, iw, top + hiB.h * 0.6)), ...loB.items.map(it => moveItem(it, iw - 0.12 * s, bot + loB.h * 0.35))];
  const rest = hbox([body, glue(MT.thin * s), textBox("d", "fn", s), textBox(v, "mi", s)]);
  for (const it of rest.items) items.push(moveItem(it, iw + limW, 0));
  // The limits reach past the sign's curls (0.04 em beyond top and bot), so they set the height and depth.
  return { w: iw + limW + rest.w, h: Math.max(-(top + hiB.h * 0.6) + hiB.h, rest.h), d: Math.max(bot + loB.h * 0.35 + loB.d, rest.d), items };
}
// A matrix: each column as wide as its widest cell, cells centred, rows a fixed distance apart, square brackets.
export function matrixBox(rows, s = 1) {
  const cells = rows.map(r => r.map(v => textBox(numText(v), "mn", s)));
  const cols = Math.max(...cells.map(r => r.length)), colW = Array.from({ length: cols }, (_, j) => Math.max(...cells.map(r => (r[j] ? r[j].w : 0))));
  const gapX = 0.6 * s, rowH = 1.2 * s, n = cells.length, first = -((n - 1) * rowH) / 2 - MT.axis * s;
  const items = [];
  let width = 0;
  cells.forEach((r, i) => {
    let x = 0;
    r.forEach((c, j) => { for (const it of c.items) items.push(moveItem(it, x + (colW[j] - c.w) / 2, first + i * rowH + 0.25 * s)); x += colW[j] + (j < cols - 1 ? gapX : 0); });
    width = Math.max(width, x);
  });
  const inner = { w: width, h: -first + MT_ASCENT * s - 0.25 * s, d: first + (n - 1) * rowH + MT_DEPTH * s + 0.25 * s, items };
  return delimBox(inner, s, "square");
}

// Lines for a Math lab request: what to show above the plot. Each line is a box; the request is parsed again
// with the same Pratt parser, so a request the solver refused is never typeset.
export function solutionLines(req, result) {
  const r = req && typeof req === "object" ? req : {}, v = typeof r.variable === "string" ? r.variable : "x";
  const lhs = name => hbox([textBox(name, "mi", 1), delimBox(textBox(v, "mi", 1), 1, "round"), glue(MT.med), textBox("=", "mo", 1), glue(MT.med)]);
  const eq = (L, R) => hbox([L, glue(MT.med), textBox("=", "mo", 1), glue(MT.med), R]);
  if (r.task === "calculus" && typeof r.expression === "string") {
    const f = parse(r.expression), lines = [hbox([lhs("f"), layout(f)])];
    if (result && result.result && typeof result.result.derivative === "string")
      lines.push(eq(hbox([fracBox(textBox("d", "fn", 1), hbox([textBox("d", "fn", 1), textBox(v, "mi", 1)]), 1), glue(0.06), textBox("f", "mi", 1)]), layout(parse(result.result.derivative))));
    if (result && result.result && typeof result.result.integral === "number" && Array.isArray(r.interval))
      lines.push(eq(integralBox(f.k === "+" || f.k === "-" ? delimBox(layout(f), 1, "round") : layout(f), r.interval[0], r.interval[1], v), textBox(numText(result.result.integral), "mn", 1)));
    return lines;
  }
  if (r.task === "ode_rk4" && typeof r.expression === "string")
    return [eq(fracBox(hbox([textBox("d", "fn", 1), textBox("y", "mi", 1)]), hbox([textBox("d", "fn", 1), textBox("x", "mi", 1)]), 1), layout(parse(r.expression)))];
  if (r.task === "linear_algebra" && Array.isArray(r.matrix) && r.matrix.length && r.matrix.every(Array.isArray)) {
    const lines = [eq(textBox("A", "mi", 1), matrixBox(r.matrix))];
    if (Array.isArray(r.rhs)) lines.push(eq(textBox("b", "mi", 1), matrixBox(r.rhs.map(x => [x]))));
    if (result && result.result && Array.isArray(result.result.solution)) lines.push(eq(textBox("x", "mi", 1), matrixBox(result.result.solution.map(x => [x]))));
    return lines;
  }
  return [];
}

// One SVG for a column of lines: numbers only in the geometry, text only from the tree. Each line's box is
// checked to hold every item before it is drawn (boxesHold).
export function boxesHold(box) {
  const eps = 1e-9;
  return box.items.every(it => {
    if (it.t === "text") return it.x >= -eps && it.x + textWidth(it.str) * it.s <= box.w + eps && it.y - MT_ASCENT * it.s >= -box.h - eps && it.y + MT_DEPTH * it.s <= box.d + eps;
    if (it.t === "rect") return it.x >= -eps && it.x + it.w <= box.w + eps && it.y >= -box.h - eps && it.y + it.h <= box.d + eps;
    return it.d.every(([, ...p]) => p.every((q, i) => (i % 2 ? q >= -box.h - eps && q <= box.d + eps : q >= -eps && q <= box.w + eps)));
  });
}
export function typesetSvg(lines, theme) {
  const ink = theme === "light" ? "#16181d" : "#eef2f8", em = MT.em, pad = MT.pad * em;
  const W = Math.max(0, ...lines.map(b => b.w)) * em + 2 * pad;
  let y = pad;
  const parts = [];
  const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const b of lines) {
    const by = y + b.h * em, X = x => r4(pad + x * em), Y = v => r4(by + v * em);
    for (const it of b.items) {
      if (it.t === "text") parts.push(`<text x="${X(it.x)}" y="${Y(it.y)}" font-size="${r4(it.s * em)}"${it.cls === "mi" ? ' font-style="italic"' : ""} fill="${ink}">${esc(it.str)}</text>`);
      else if (it.t === "rect") parts.push(`<rect x="${X(it.x)}" y="${Y(it.y)}" width="${r4(it.w * em)}" height="${r4(it.h * em)}" fill="${ink}"/>`);
      else parts.push(`<path d="${it.d.map(([c, ...p]) => c + p.map((q, i) => (i % 2 ? Y(q) : X(q))).join(" ")).join(" ")}" fill="none" stroke="${ink}" stroke-width="${r4(it.sw * em)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    y = by + b.d * em + 0.5 * em;
  }
  const H = r4(y - 0.5 * em + pad);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r4(W)} ${H}" width="${r4(W)}" height="${H}" font-family="'STIX Two Math', 'Cambria Math', 'Latin Modern Math', serif" role="img">${parts.join("")}</svg>`;
}
