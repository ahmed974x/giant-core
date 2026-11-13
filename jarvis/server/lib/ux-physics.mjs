// UX physics for the Studio (ADR-144), pure: inlined into the page, where the sandboxed preview measures its
// own element boxes and posts them to the page. The same formulas are in
// .claude/skills/replica-ux-physics/ux_physics.py, which also reads HTML and CSS without a browser.
//   - Fitts's law: index of difficulty ID = log2(D / W + 1), D the distance from the thumb's rest point
//     (bottom centre of the viewport) to the target's centre, W its smaller side. Targets under 44 × 44 px
//     fail the touch-size rule (DESIGN.md §5).
//   - Hick's law: reaction time RT = a + b · log2(n + 1) for a group of n choices, with a = 0.2 s and
//     b = 0.15 s [INFERENCE: textbook constants, not measured here]. A group above 7 choices is flagged.
//   - RTL / LTR symmetry: the right-to-left layout should mirror the left-to-right one. For each element
//     present in both, the error is |x_ltr − (W − x_rtl − w)| / W; symmetry = 1 − mean error.
//   - Heatmap: a grid of attention weights [INFERENCE]: interactive targets weigh 1.0, headings 0.8 to 0.5
//     by level, text 0.25, images 0.6, spread over each box and lifted near the thumb's reach on a phone.
// boxes: [{ id, kind: "action"|"heading"|"text"|"image", level?, group?, x, y, w, h }] in CSS pixels.

export const TOUCH_MIN = 44;
export const HICK_A = 0.2, HICK_B = 0.15, HICK_MAX = 7;

export function fitts(boxes, vw, vh) {
  const rest = { x: vw / 2, y: vh - 24 };
  const targets = boxes.filter(b => b.kind === "action").map(b => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const d = Math.hypot(cx - rest.x, cy - rest.y), w = Math.max(1, Math.min(b.w, b.h));
    return { id: b.id, w: Math.round(b.w), h: Math.round(b.h), id_bits: Math.round(Math.log2(d / w + 1) * 100) / 100, small: b.w < TOUCH_MIN || b.h < TOUCH_MIN };
  });
  const small = targets.filter(t => t.small).length;
  const meanId = targets.length ? targets.reduce((n, t) => n + t.id_bits, 0) / targets.length : 0;
  // 100 when every target meets 44 × 44; each small one takes its share off.
  return { targets, small, meanId: Math.round(meanId * 100) / 100, score: targets.length ? Math.round(100 * (1 - small / targets.length)) : 100 };
}

export function hick(boxes) {
  const groups = new Map();
  for (const b of boxes) if (b.kind === "action" && b.group) groups.set(b.group, (groups.get(b.group) || 0) + 1);
  const out = [...groups].map(([group, n]) => ({ group, n, rt: Math.round((HICK_A + HICK_B * Math.log2(n + 1)) * 1000) / 1000, over: n > HICK_MAX }));
  const worst = out.reduce((m, g) => Math.max(m, g.rt), 0);
  return { groups: out.sort((a, b) => b.n - a.n), worstRt: worst, over: out.filter(g => g.over).length };
}

export function symmetry(ltr, rtl, vw) {
  const byId = new Map(rtl.map(b => [b.id, b]));
  const errs = [];
  for (const a of ltr) {
    const b = byId.get(a.id);
    if (!b || !a.w) continue;
    errs.push(Math.abs(a.x - (vw - b.x - b.w)) / vw);
  }
  const mean = errs.length ? errs.reduce((n, e) => n + e, 0) / errs.length : 0;
  return { pairs: errs.length, score: Math.round((1 - Math.min(1, mean)) * 1000) / 10 };
}

export function heatGrid(boxes, vw, vh, cols = 24, rows = 16, phone = vw <= 480) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const cw = vw / cols, ch = vh / rows;
  const weight = b => b.kind === "action" ? 1 : b.kind === "heading" ? Math.max(0.5, 0.9 - 0.1 * (b.level || 1)) : b.kind === "image" ? 0.6 : 0.25;
  for (const b of boxes) {
    if (b.y > vh || b.y + b.h < 0) continue;
    const w = weight(b);
    for (let r = Math.max(0, Math.floor(b.y / ch)); r <= Math.min(rows - 1, Math.floor((b.y + b.h) / ch)); r++)
      for (let c = Math.max(0, Math.floor(b.x / cw)); c <= Math.min(cols - 1, Math.floor((b.x + b.w) / cw)); c++) grid[r][c] += w;
  }
  if (phone) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    // The thumb reaches the lower middle best; the top corners least.
    const dx = (c + 0.5) / cols - 0.5, dy = 1 - (r + 0.5) / rows;
    grid[r][c] *= 1 + 0.5 * Math.max(0, 1 - Math.hypot(dx * 1.4, dy));
  }
  const max = Math.max(1e-9, ...grid.flat());
  return { cols, rows, cell: [Math.round(cw * 10) / 10, Math.round(ch * 10) / 10], grid: grid.map(row => row.map(v => Math.round(v / max * 100) / 100)) };
}

export function uxReport(boxes, vw, vh, rtlBoxes) {
  const f = fitts(boxes, vw, vh), k = hick(boxes);
  return { viewport: [vw, vh], fitts: f, hick: k, symmetry: rtlBoxes ? symmetry(boxes, rtlBoxes, vw) : null, heat: heatGrid(boxes, vw, vh) };
}
