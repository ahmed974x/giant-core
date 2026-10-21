// OMEGA_VIS (ADR-102): Apple Stocks style SVG charts shared by the Ops Room and the NABD portal.
// Monotone cubic splines (no overshoot past the data), a vertical glow gradient under the line, glowing
// event dots, and a magnetic crosshair with a glass loupe for mouse and touch. SVG is vector, so every
// line stays sharp at any devicePixelRatio. Text goes in with textContent only.
(() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const f1 = v => (Math.round(v * 10) / 10).toString();
  // Fritsch–Carlson monotone cubic through [x, y] points (x increasing). Returns an SVG path.
  function spline(pts) {
    const p = pts.filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]));
    const n = p.length;
    if (!n) return "";
    if (n < 3) return p.map((q, i) => (i ? "L" : "M") + f1(q[0]) + "," + f1(q[1])).join("");
    const dx = [], dy = [], m = [], t = new Array(n);
    for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; dy[i] = p[i + 1][1] - p[i][1]; m[i] = dx[i] ? dy[i] / dx[i] : 0; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = "M" + f1(p[0][0]) + "," + f1(p[0][1]);
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += "C" + f1(p[i][0] + h) + "," + f1(p[i][1] + h * t[i]) + " " + f1(p[i + 1][0] - h) + "," + f1(p[i + 1][1] - h * t[i + 1]) + " " + f1(p[i + 1][0]) + "," + f1(p[i + 1][1]);
    }
    return d;
  }
  const area = (pts, base) => { const p = pts.filter(q => Number.isFinite(q[1])); return p.length ? spline(p) + "L" + f1(p[p.length - 1][0]) + "," + f1(base) + "L" + f1(p[0][0]) + "," + f1(base) + "Z" : ""; };
  let uid = 0;
  // Vertical gradient for a chart area; the colours come from CSS classes (.vg-top-<tone>, .vg-bot-<tone>).
  function gradient(svg, tone) {
    const id = "vg" + (++uid);
    const defs = svg.querySelector("defs") || svg.insertBefore(el("defs"), svg.firstChild);
    const g = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.append(el("stop", { offset: "0%", class: "vg-top vg-" + tone }), el("stop", { offset: "100%", class: "vg-bot vg-" + tone }));
    defs.append(g);
    return "url(#" + id + ")";
  }
  const glow = (cx, cy, tone, r = 5) => { const g = el("g", { class: "v-glow v-" + tone }); g.append(el("circle", { cx: f1(cx), cy: f1(cy), r: r * 2.2, class: "v-halo" }), el("circle", { cx: f1(cx), cy: f1(cy), r, class: "v-core" })); return g; };
  // Magnetic crosshair + glass loupe. o = { W, H, T, B, n, x(i), rows(i) -> [[label, value]], dots(i) -> [[y, tone]] }.
  function loupe(svg, o) {
    if (svg._loupe) svg._loupe.remove();
    const g = el("g", { class: "v-loupe", visibility: "hidden", "pointer-events": "none" });
    const line = el("line", { class: "v-cross", y1: o.T, y2: o.H - o.B });
    const dots = el("g");
    const box = el("rect", { class: "v-glass", rx: 10, ry: 10 });
    const texts = el("g");
    g.append(line, dots, box, texts);
    svg.append(g);
    svg._loupe = g;
    const show = ev => {
      const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      if (!r.width || !o.n) return;
      const px = (ev.clientX - r.left) / r.width * vb.width;
      let best = 0, bd = Infinity;
      for (let i = 0; i < o.n; i++) { const d = Math.abs(o.x(i) - px); if (d < bd) { bd = d; best = i; } }
      const cx = o.x(best), rows = o.rows(best);
      line.setAttribute("x1", f1(cx)); line.setAttribute("x2", f1(cx));
      dots.replaceChildren(...(o.dots ? o.dots(best) : []).filter(d => Number.isFinite(d[0])).map(([y, tone]) => glow(cx, y, tone, 4)));
      texts.replaceChildren();
      const w = Math.max(132, ...rows.map(([a, b]) => (String(a).length + String(b).length) * 7.2 + 28)), hgt = 14 + rows.length * 18;
      const bx = cx + 14 + w > vb.width - 4 ? cx - 14 - w : cx + 14, by = o.T + 4;
      box.setAttribute("x", f1(bx)); box.setAttribute("y", f1(by)); box.setAttribute("width", f1(w)); box.setAttribute("height", f1(hgt));
      rows.forEach(([a, b], k) => {
        const yy = by + 20 + k * 18;
        texts.append(el("text", { x: f1(bx + 10), y: f1(yy), class: "v-lbl" }, a), el("text", { x: f1(bx + w - 10), y: f1(yy), class: "v-val", "text-anchor": "end" }, b));
      });
      g.setAttribute("visibility", "visible");
    };
    const hide = () => g.setAttribute("visibility", "hidden");
    svg.onpointermove = show;
    svg.onpointerdown = show;
    svg.onpointerleave = hide;
    svg.onpointercancel = hide;
  }
  window.OMEGA_VIS = { el, spline, area, gradient, glow, loupe };
})();
