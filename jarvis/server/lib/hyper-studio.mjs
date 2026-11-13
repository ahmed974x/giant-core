// Hyper studio (ADR-155), pure: used by the server (POST /api/w/:slug/studio/hyper) and inlined into the page.
// No library: rotations, projections, optics and physics are written out here, and the drawing is plain SVG
// built from numbers only. Three modes:
//   projection   - a cube (SO(3), painter's sort, OKLCH face shading), a tesseract and a 16-cell (SO(4) in the
//                  six planes, perspective R4 -> R3 -> R2), an 8-cube (Petrie projection, 16-fold) and the 240
//                  roots of E8 in the Coxeter plane (30-fold), each with checks that the shape is the shape.
//   optics       - thin-lens depth of field, hyperfocal distance, field of view, background blur, EV100, and
//                  Kelvin to colour through the Planckian locus (Kim et al. 2002) for a three-point light.
//   game_physics - A* on a grid, checked against breadth-first search, and Verlet particles in a box.
// The same maths is in .claude/skills/replica-hyper-studio/hyper_studio.py.

export const HS_LIMITS = { angle: 360, grid: 40, obstacles: 400, particles: 24, ticks: 600 };
export const HS_ACCENT = { dark: "#77bcff", light: "#0b5ed7" };
export class HyperError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const hsFail = (m, detail) => { throw new HyperError(m, detail); };
const hsR = (v, d = 6) => { const p = 10 ** d, x = Math.round(v * p) / p; return Object.is(x, -0) ? 0 : x; };
const AXES = "xyzwuvst";

// ---- Rotations ---------------------------------------------------------------------------------------------
// A rotation by deg degrees in the plane of two axes, applied to every point (Givens rotation).
export function rotatePlane(points, i, j, deg) {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return points.map(p => { const q = p.slice(); q[i] = c * p[i] - s * p[j]; q[j] = s * p[i] + c * p[j]; return q; });
}
// angles: { xy: 30, zw: 45, ... } with the axes x y z w u v s t for dimensions 1 to 8. Applied in key order.
export function applyAngles(points, dim, angles) {
  let out = points;
  const keys = Object.keys(angles || {}).sort();
  if (keys.length > 28) hsFail("Give at most 28 rotation planes.");
  for (const k of keys) {
    const v = Number(angles[k]);
    if (k.length !== 2 || k[0] === k[1]) hsFail("A rotation plane is two different axes, as in xy or zw.", k);
    const i = AXES.indexOf(k[0]), j = AXES.indexOf(k[1]);
    if (i < 0 || j < 0 || i >= dim || j >= dim) hsFail("A rotation plane uses an axis this shape does not have.", k);
    if (!Number.isFinite(v) || Math.abs(v) > HS_LIMITS.angle) hsFail("Angles are degrees from -360 to 360.", k);
    out = rotatePlane(out, i, j, v);
  }
  return out;
}
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

// ---- Shapes ------------------------------------------------------------------------------------------------
// The n-cube: 2^n vertices with coordinates +-1, an edge between vertices that differ in one coordinate.
export function hypercube(n) {
  const V = [], E = [];
  for (let k = 0; k < 1 << n; k++) V.push(Array.from({ length: n }, (_, b) => ((k >> b) & 1 ? 1 : -1)));
  for (let k = 0; k < 1 << n; k++) for (let b = 0; b < n; b++) { const o = k ^ (1 << b); if (o > k) E.push([k, o]); }
  return { vertices: V, edges: E };
}
// The 16-cell: the 8 points +-e_i, every pair joined except opposite ones.
export function sixteenCell() {
  const V = [];
  for (let i = 0; i < 4; i++) for (const s of [1, -1]) { const p = [0, 0, 0, 0]; p[i] = s; V.push(p); }
  const E = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) if (dot(V[a], V[b]) !== -1) E.push([a, b]);
  return { vertices: V, edges: E };
}
// The 240 roots of E8: the 112 permutations of (+-1, +-1, 0^6) and the 128 points (+-1/2)^8 with an even
// number of minus signs. Two roots are joined when their inner product is 1 (the nearest neighbours).
export function e8Roots() {
  const V = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) for (const a of [1, -1]) for (const b of [1, -1]) { const p = new Array(8).fill(0); p[i] = a; p[j] = b; V.push(p); }
  for (let k = 0; k < 256; k++) {
    let minus = 0;
    const p = Array.from({ length: 8 }, (_, b) => ((k >> b) & 1 ? (minus++, -0.5) : 0.5));
    if (minus % 2 === 0) V.push(p);
  }
  const E = [];
  for (let a = 0; a < V.length; a++) for (let b = a + 1; b < V.length; b++) if (dot(V[a], V[b]) === 1) E.push([a, b]);
  return { vertices: V, edges: E };
}
// The cube's six faces as vertex indices, in order around each face.
const CUBE_FACES = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];

// ---- Linear algebra for the Coxeter plane -----------------------------------------------------------------
export function matMul(A, B) { return A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0))); }
// The reflection in the hyperplane orthogonal to a root a: I - 2 a a^T / (a.a).
export function reflection(a) { const n = a.length, q = dot(a, a); return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - 2 * a[i] * a[j] / q)); }
// Cyclic Jacobi on a symmetric matrix, with the eigenvectors (columns of V). Pairs sorted by value, largest first.
export function symEigen(Ain, sweeps = 60) {
  const n = Ain.length, A = Ain.map(r => r.slice()), V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sw = 0; sw < sweeps; sw++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-26) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = A[k][p], kq = A[k][q]; A[k][p] = c * kp - s * kq; A[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = A[p][k], qk = A[q][k]; A[p][k] = c * pk - s * qk; A[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
    }
  }
  return A.map((r, i) => ({ value: r[i], vector: V.map(row => row[i]) })).sort((a, b) => b.value - a.value);
}
// E8's simple roots (Bourbaki), the Coxeter element c = s1 s2 ... s8, and the Coxeter plane: the eigenspace of
// c + c^T for its largest eigenvalue 2 cos(2 pi / 30), where c turns by 1/30 of a turn.
export const E8_SIMPLE = [[0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5], [1, 1, 0, 0, 0, 0, 0, 0], [-1, 1, 0, 0, 0, 0, 0, 0], [0, -1, 1, 0, 0, 0, 0, 0], [0, 0, -1, 1, 0, 0, 0, 0], [0, 0, 0, -1, 1, 0, 0, 0], [0, 0, 0, 0, -1, 1, 0, 0], [0, 0, 0, 0, 0, -1, 1, 0]];
export function coxeterPlane() {
  const c = E8_SIMPLE.map(reflection).reduce((M, R) => matMul(M, R));
  const sym = c.map((r, i) => r.map((v, j) => v + c[j][i]));
  const eig = symEigen(sym);
  const u = eig[0].vector, w0 = eig[1].vector, k = dot(w0, u), w1 = w0.map((v, i) => v - k * u[i]), nw = Math.sqrt(dot(w1, w1));
  return { c, u, v: w1.map(x => x / nw), top: [eig[0].value, eig[1].value], next: eig[2].value };
}
// The Petrie projection of the n-cube: axis k goes to the direction k * 180 / n degrees, which shows 2n-fold symmetry.
const petrie = n => [Array.from({ length: n }, (_, k) => Math.cos(Math.PI * k / n)), Array.from({ length: n }, (_, k) => Math.sin(Math.PI * k / n))];

// ---- Projection mode ---------------------------------------------------------------------------------------
const POLY = { cube: 3, tesseract: 4, "16cell": 4, octeract: 8, e8_lattice: 8 };
// Perspective from dimension d down by one: the last coordinate is depth, seen from distance `dist`.
export function perspective(p, dist) { const f = dist / (dist - p[p.length - 1]); return p.slice(0, -1).map(v => v * f); }
// Symmetry check: the number of distinct radii and how many points share each, after projection to the plane.
export function rings(pts2, tol = 1e-6) {
  const r = pts2.map(([x, y]) => Math.hypot(x, y)).sort((a, b) => a - b), out = [];
  for (const v of r) { const last = out[out.length - 1]; if (last && Math.abs(v - last.r) <= tol) last.n++; else out.push({ r: v, n: 1 }); }
  return out.filter(g => g.r > tol);
}
// A shade of the accent for a face: OKLCH with the accent's chroma and hue, lightness from the face's angle to the light.
export function faceShade(normal, theme) {
  const light = [-0.4, -0.5, 0.77], nl = Math.hypot(...light), lambert = Math.max(0, dot(normal, light) / nl);
  const [L0, L1] = theme === "light" ? [0.42, 0.78] : [0.36, 0.82];
  return { L: hsR(L0 + (L1 - L0) * lambert, 4), C: theme === "light" ? 0.17 : 0.12, H: theme === "light" ? 259.8 : 248.9, lambert: hsR(lambert, 4) };
}
export const oklchCss = s => "oklch(" + hsR(s.L * 100, 2) + "% " + s.C + " " + s.H + ")";

export function projection(req) {
  const name = String(req.polytope || "tesseract"), theme = req.theme === "light" ? "light" : "dark";
  if (!Object.prototype.hasOwnProperty.call(POLY, name)) hsFail("Choose a shape: cube, tesseract, 16cell, octeract or e8_lattice.", name);
  const dim = POLY[name];
  if (req.dimension !== undefined && Number(req.dimension) !== dim) hsFail("The dimension does not match the shape.", req.dimension + " ≠ " + dim);
  const shape = name === "cube" ? hypercube(3) : name === "tesseract" ? hypercube(4) : name === "16cell" ? sixteenCell() : name === "octeract" ? hypercube(8) : e8Roots();
  const rot = applyAngles(shape.vertices, dim, req.angles);
  const checks = [];
  let pts, faces = null, method;
  if (dim === 3) {
    pts = rot.map(p => perspective(p, 5).concat([p[2]]));
    faces = CUBE_FACES.map(f => {
      // The cube is centred on the origin, so a face's outward normal is the direction of its centre.
      const center = [0, 1, 2].map(k => f.reduce((s, i) => s + rot[i][k], 0) / 4), len = Math.hypot(...center), nrm = center.map(v => v / len);
      const shade = faceShade(nrm, theme);
      return { vertices: f, depth: hsR(center[2]), normal: nrm.map(v => hsR(v)), visible: facesViewer(nrm), fill: oklchCss(shade), lambert: shade.lambert };
    }).sort((a, b) => a.depth - b.depth);
    method = "SO(3) rotation, perspective from z = 5, faces sorted back to front (painter's algorithm)";
    checks.push({ text: "The rotation keeps every edge length.", ok: lengthsKept(rot, shape.edges, 2) });
    checks.push({ text: "Faces are drawn from the back to the front.", ok: backToFront(faces) });
    checks.push({ text: "Three faces at most face the viewer.", ok: facingOk(faces) });
  } else if (dim === 4) {
    pts = rot.map(p => { const q = perspective(p, 3); return perspective(q, 5).concat([q[2]]); });
    method = "SO(4) rotation in the chosen planes, perspective R4 → R3 from w = 3, then R3 → R2 from z = 5";
    checks.push({ text: "The rotation keeps every vertex's distance from the centre.", ok: normsKept(rot, name === "tesseract" ? 2 : 1) });
    checks.push(name === "tesseract" ? { text: "16 vertices and 32 edges, each vertex on 4 edges.", ok: countsOk(shape, 16, 32, 4) } : { text: "8 vertices and 24 edges, each vertex on 6 edges.", ok: countsOk(shape, 8, 24, 6) });
  } else {
    let U, Vv;
    if (name === "e8_lattice") {
      const cp = coxeterPlane();
      U = cp.u; Vv = cp.v;
      const c30 = Array.from({ length: 30 }).reduce(M => matMul(M, cp.c), cp.c.map((r, i) => r.map((_, j) => (i === j ? 1 : 0))));
      checks.push({ text: "The Coxeter element has order 30.", ok: isIdentity(c30) });
      checks.push({ text: "The plane is the eigenspace of 2 cos(2π/30), which appears twice.", ok: coxeterOk(cp.top, cp.next) });
      checks.push({ text: "240 roots and 6720 edges, each root on 56 edges.", ok: countsOk(shape, 240, 6720, 56) });
      method = "Coxeter plane of E8: the eigenspace of c + cᵀ for 2 cos(2π/30), c the product of the 8 simple reflections";
    } else {
      [U, Vv] = petrie(8).map(v => { const n = Math.hypot(...v); return v.map(x => x / n); });
      checks.push({ text: "256 vertices and 1024 edges, each vertex on 8 edges.", ok: countsOk(shape, 256, 1024, 8) });
      method = "Petrie projection of the 8-cube: axis k drawn at k × 22.5°";
    }
    pts = rot.map(p => [dot(p, U), dot(p, Vv), 0]);
    const rg = rings(shape.vertices.map(p => [dot(p, U), dot(p, Vv)]), 1e-6);
    checks.push(name === "e8_lattice"
      ? { text: "Before rotation the roots fall on 8 rings of 30, a 30-fold symmetry.", ok: ringsExact(rg, 8, 30) }
      : { text: "Before rotation every ring holds a multiple of 16 vertices, a 16-fold symmetry.", ok: ringsMultiple(rg, 16) });
  }
  const span = Math.max(...pts.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1])))) || 1;
  const xy = pts.map(p => [hsR(p[0] / span), hsR(p[1] / span), hsR(p[2])]);
  return { mode: "projection", polytope: name, dimension: dim, theme, accent: HS_ACCENT[theme], method, verified: checks.every(c => c.ok), checks,
    counts: { vertices: shape.vertices.length, edges: shape.edges.length, faces: faces ? faces.length : 0 },
    points: xy, edges: shape.edges, faces: faces && faces.map(f => ({ vertices: f.vertices, depth: f.depth, visible: f.visible, fill: f.fill, lambert: f.lambert })) };
}

// ---- The checks, one function each, so that each can be tested on its own ----------------------------------
export const HS_TOL = 1e-9;
export function lengthsKept(pts, edges, len) { return edges.every(([a, b]) => Math.abs(Math.hypot(...pts[a].map((v, i) => v - pts[b][i])) - len) < HS_TOL); }
export function normsKept(pts, r) { return pts.every(p => Math.abs(Math.hypot(...p) - r) < HS_TOL); }
// A face is drawn solid when its outward normal points towards the viewer by more than the tolerance.
export function facesViewer(n) { return n[2] > HS_TOL; }
export function backToFront(faces) { return faces.every((f, i) => i === 0 || faces[i - 1].depth <= f.depth); }
export function facingOk(faces) { const n = faces.filter(f => f.visible).length; return n >= 1 && n <= 3; }
// v vertices, e edges, and every vertex on deg edges.
export function countsOk(shape, v, e, deg) {
  if (shape.vertices.length !== v || shape.edges.length !== e) return false;
  const d = new Array(v).fill(0);
  for (const [a, b] of shape.edges) { d[a]++; d[b]++; }
  return d.every(x => x === deg);
}
export function isIdentity(M) { return M.every((r, i) => r.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < HS_TOL)); }
// The two largest eigenvalues of c + c^T are both 2 cos(2 pi / 30), and the next is clearly smaller.
export function coxeterOk(top, next) { const w = 2 * Math.cos(2 * Math.PI / 30); return Math.abs(top[0] - w) < HS_TOL && Math.abs(top[1] - top[0]) < HS_TOL && next < top[0] - 1e-3; }
export function ringsExact(rg, count, size) { return rg.length === count && rg.every(g => g.n === size); }
export function ringsMultiple(rg, fold) { return rg.length > 0 && rg.every(g => g.n % fold === 0); }
export function dofOk(near, far, s) { return near < s && far > s; }
// Relative forms: s (1/near + 1/far) is 2, and the shutter time read back over t is 1.
export function harmonicOk(near, far, s, H) { return far === Infinity ? s >= H : Math.abs(s * (1 / near + 1 / far) - 2) < HS_TOL; }
export function ev100Ok(N, t, iso, ev100) { return Math.abs(N * N / 2 ** (ev100 + Math.log2(iso / 100)) / t - 1) < HS_TOL; }
export function overlapOk(maxOverlap) { return maxOverlap <= 0.01; }
export function insideBox(trails, parts, W, H) { return trails.every((tr, i) => tr.slice(1).every(([x, y]) => x >= parts[i].radius - HS_TOL && x <= W - parts[i].radius + HS_TOL && y >= parts[i].radius - HS_TOL && y <= H - parts[i].radius + HS_TOL)); }
// A path is as long as the shortest, moves one cell at a time and crosses no obstacle; no path only when none exists.
export function pathOk(path, best, blocked, W) {
  if (path === null) return best === null;
  return path.length - 1 === best && path.every((c, i) => i === 0 || Math.abs(c[0] - path[i - 1][0]) + Math.abs(c[1] - path[i - 1][1]) === 1) && path.every(c => !blocked.has(c[1] * W + c[0]));
}

// The drawing, as SVG text built from numbers only: faces for the cube, one path of edges otherwise.
export function hyperSvg(g, size = 640) {
  const c = size / 2, s = size * 0.42, P = ([x, y]) => (c + x * s).toFixed(2) + " " + (c - y * s).toFixed(2);
  const body = [];
  if (g.faces) for (const f of g.faces) body.push('<path d="M' + f.vertices.map(i => P(g.points[i])).join(" L") + ' Z" fill="' + f.fill + '" fill-opacity="' + (f.visible ? 1 : 0.25) + '" stroke="' + g.accent + '" stroke-width="1.5"/>');
  else {
    body.push('<path d="' + g.edges.map(([a, b]) => "M" + P(g.points[a]) + " L" + P(g.points[b])).join(" ") + '" fill="none" stroke="' + g.accent + '" stroke-width="' + (g.edges.length > 2000 ? 0.4 : 1.2) + '" stroke-opacity="' + (g.edges.length > 2000 ? 0.45 : 0.85) + '"/>');
    if (g.points.length <= 256) for (const p of g.points) body.push('<circle cx="' + (c + p[0] * s).toFixed(2) + '" cy="' + (c - p[1] * s).toFixed(2) + '" r="' + (g.points.length > 64 ? 1.6 : 3) + '" fill="' + g.accent + '"/>');
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + " " + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + g.polytope + ' projection">' + body.join("") + "</svg>";
}

// ---- Optics ----------------------------------------------------------------------------------------------
// Planckian locus in CIE 1931 xy (Kim et al., 2002), valid from 1667 K to 25000 K.
export function kelvinToXy(K) {
  if (!(K >= 1667 && K <= 25000)) hsFail("Colour temperatures are from 1667 K to 25000 K.", K);
  const x = K <= 4000 ? -0.2661239e9 / K ** 3 - 0.2343589e6 / K ** 2 + 0.8776956e3 / K + 0.179910 : -3.0258469e9 / K ** 3 + 2.1070379e6 / K ** 2 + 0.2226347e3 / K + 0.240390;
  const y = K <= 2222 ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : K <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}
// xy (Y = 1) to linear sRGB, scaled so the largest channel is 1, then to OKLCH.
export function kelvinToColour(K) {
  const [x, y] = kelvinToXy(K), X = x / y, Z = (1 - x - y) / y;
  const lin = [3.2404542 * X - 1.5371385 - 0.4985314 * Z, -0.9692660 * X + 1.8760108 + 0.0415560 * Z, 0.0556434 * X - 0.2040259 + 1.0572252 * Z];
  const mx = Math.max(...lin), c = lin.map(v => Math.max(0, v / mx));
  const gam = c.map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]), m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]), s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.hypot(A, B), H = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
  return { kelvin: K, xy: [hsR(x), hsR(y)], hex: "#" + gam.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join(""), oklch: "oklch(" + hsR(L * 100, 2) + "% " + hsR(C, 3) + " " + hsR(H, 1) + ")", mired: hsR(1e6 / K, 2) };
}
const posNum = (v, name, lo, hi) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) hsFail("A value is out of range.", name + ": " + lo + "–" + hi); return x; };
export function optics(req) {
  const f = posNum(req.focal_mm ?? 50, "focal_mm", 4, 1200), N = posNum(req.f_stop ?? 2.8, "f_stop", 0.7, 64), sM = posNum(req.subject_distance_m ?? 3, "subject_distance_m", 0.05, 10000);
  const w = posNum(req.sensor_width_mm ?? 36, "sensor_width_mm", 4, 70), iso = posNum(req.iso ?? 100, "iso", 25, 204800), t = posNum(req.shutter_s ?? 1 / 125, "shutter_s", 1 / 64000, 3600);
  const s = sM * 1000, h = w * 2 / 3, diag = Math.hypot(w, h), coc = diag / 1500;
  if (s <= f) hsFail("The subject must be farther than the focal length.");
  const H = f * f / (N * coc) + f;
  const near = s * (H - f) / (H + s - 2 * f), far = s < H ? s * (H - f) / (H - s) : Infinity;
  const blur = f * f / (N * (s - f));
  const fov = 2 * Math.atan(w / (2 * f)) * 180 / Math.PI, fovV = 2 * Math.atan(h / (2 * f)) * 180 / Math.PI;
  const ev100 = Math.log2(N * N / t) - Math.log2(iso / 100);
  const lights = {};
  for (const [k, def] of [["key", 5600], ["fill", 4200], ["rim", 3200]]) lights[k] = kelvinToColour(posNum(req[k + "_kelvin"] ?? def, k + "_kelvin", 1667, 25000));
  const shift = hsR(lights.fill.mired - lights.key.mired, 2);
  const checks = [
    { text: "The near limit is before the subject and the far limit after it.", ok: dofOk(near, far, s) },
    { text: "The focus distance is the harmonic mean of the near and far limits.", ok: harmonicOk(near, far, s, H) },
    { text: "EV100 read back gives the shutter time.", ok: ev100Ok(N, t, iso, ev100) },
  ];
  return { mode: "optics", verified: checks.every(c => c.ok), checks,
    lens: { focal_mm: f, f_stop: N, subject_m: sM, sensor_mm: [w, hsR(h, 3)], coc_mm: hsR(coc, 4) },
    depth_of_field: { hyperfocal_m: hsR(H / 1000, 3), near_m: hsR(near / 1000, 3), far_m: far === Infinity ? null : hsR(far / 1000, 3), total_m: far === Infinity ? null : hsR((far - near) / 1000, 3), infinite: far === Infinity },
    field_of_view_deg: { horizontal: hsR(fov, 2), vertical: hsR(fovV, 2) },
    background_blur: { disc_mm: hsR(blur, 4), percent_of_width: hsR(100 * blur / w, 3), in_coc: hsR(blur / coc, 1) },
    exposure: { ev100: hsR(ev100, 2), iso, shutter_s: t },
    lights, fill_shift_mired: shift };
}

// ---- Game physics -----------------------------------------------------------------------------------------
const cellOf = (v, W, H, what) => { if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isInteger) || v[0] < 0 || v[1] < 0 || v[0] >= W || v[1] >= H) hsFail("A cell is outside the grid.", what); return v; };
// A* with 4 moves and the Manhattan distance; returns the path or null. The open list stays in insertion order,
// so taking the first entry with the lowest f breaks ties by age.
export function astar(W, H, blocked, start, goal) {
  const key = (x, y) => y * W + x, g = new Map([[key(...start), 0]]), from = new Map(), open = [[0, start]];
  let expanded = 0;
  const closed = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open.splice(bi, 1)[0], ck = key(...cur);
    if (closed.has(ck)) continue;
    closed.add(ck); expanded++;
    if (cur[0] === goal[0] && cur[1] === goal[1]) {
      const path = [cur];
      let k = ck;
      while (from.has(k)) { k = from.get(k); path.push([k % W, Math.floor(k / W)]); }
      return { path: path.reverse(), expanded };
    }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = cur[0] + dx, ny = cur[1] + dy, nk = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked.has(nk) || closed.has(nk)) continue;
      const ng = g.get(ck) + 1;
      if (!g.has(nk) || ng < g.get(nk)) { g.set(nk, ng); from.set(nk, ck); open.push([ng + Math.abs(nx - goal[0]) + Math.abs(ny - goal[1]), [nx, ny]]); }
    }
  }
  return { path: null, expanded };
}
// Breadth-first search: the true shortest length, to check A* against.
export function bfsLength(W, H, blocked, start, goal) {
  const key = (x, y) => y * W + x, dist = new Map([[key(...start), 0]]), q = [start];
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h], d = dist.get(key(x, y));
    if (x === goal[0] && y === goal[1]) return d;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy, nk = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked.has(nk) || dist.has(nk)) continue;
      dist.set(nk, d + 1); q.push([nx, ny]);
    }
  }
  return null;
}
// Verlet integration, dt = 1 tick: x' = 2x - x_prev + a. Walls reflect; overlapping particles are pushed apart
// along the line between them (equal masses, half each), and approaching ones swap their normal velocities.
export function verlet(particles, W, H, ticks, gravity = 0) {
  const P = particles.map(p => ({ x: p.x, y: p.y, px: p.x - p.vx, py: p.y - p.vy, r: p.radius }));
  const trails = P.map(p => [[hsR(p.x, 4), hsR(p.y, 4)]]);
  let maxOverlap = 0;
  for (let t = 0; t < ticks; t++) {
    for (const p of P) { const nx = 2 * p.x - p.px, ny = 2 * p.y - p.py + gravity; p.px = p.x; p.py = p.y; p.x = nx; p.y = ny; }
    // Collisions and walls are relaxed together four times, so a wall cannot push a particle back into another.
    for (let it = 0; it < 4; it++) {
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d >= min) continue;
      // Two centres on the same point are parted along x, so the answer stays fixed.
      const nx = d ? dx / d : 1, ny = d ? dy / d : 0, push = (min - d) / 2;
      const va = (a.x - a.px) * nx + (a.y - a.py) * ny, vb = (b.x - b.px) * nx + (b.y - b.py) * ny;
      a.x -= nx * push; a.y -= ny * push; a.px -= nx * push; a.py -= ny * push;
      b.x += nx * push; b.y += ny * push; b.px += nx * push; b.py += ny * push;
      const dv = vb - va;
      if (dv < 0) { a.px -= dv * nx; a.py -= dv * ny; b.px += dv * nx; b.py += dv * ny; }
    }
    for (const p of P) {
      if (p.x < p.r) { const v = p.x - p.px; p.x = p.r; p.px = p.x + v; }
      if (p.x > W - p.r) { const v = p.x - p.px; p.x = W - p.r; p.px = p.x + v; }
      if (p.y < p.r) { const v = p.y - p.py; p.y = p.r; p.py = p.y + v; }
      if (p.y > H - p.r) { const v = p.y - p.py; p.y = H - p.r; p.py = p.y + v; }
    }
    }
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) maxOverlap = Math.max(maxOverlap, P[i].r + P[j].r - Math.hypot(P[j].x - P[i].x, P[j].y - P[i].y));
    P.forEach((p, i) => trails[i].push([hsR(p.x, 4), hsR(p.y, 4)]));
  }
  return { trails, final: P.map(p => ({ x: hsR(p.x, 4), y: hsR(p.y, 4), vx: hsR(p.x - p.px, 4), vy: hsR(p.y - p.py, 4), radius: p.r })), maxOverlap };
}
export function gamePhysics(req) {
  const gs = req.grid_size ?? [12, 12];
  if (!Array.isArray(gs) || gs.length !== 2 || !gs.every(v => Number.isInteger(v) && v >= 2 && v <= HS_LIMITS.grid)) hsFail("The grid is two whole numbers from 2 to 40.");
  const [W, H] = gs, start = cellOf(req.start ?? [0, 0], W, H, "start"), goal = cellOf(req.goal ?? [W - 1, H - 1], W, H, "goal");
  const obs = req.obstacles ?? [];
  if (!Array.isArray(obs) || obs.length > HS_LIMITS.obstacles) hsFail("Give at most 400 obstacles.");
  const blocked = new Set(obs.map((o, i) => { cellOf(o, W, H, "obstacle " + i); return o[1] * W + o[0]; }));
  if (blocked.has(start[1] * W + start[0]) || blocked.has(goal[1] * W + goal[0])) hsFail("The start and the goal must be free cells.");
  const ticks = req.ticks ?? 30;
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > HS_LIMITS.ticks) hsFail("Ticks are whole numbers from 0 to 600.");
  const parts = req.particles ?? [];
  if (!Array.isArray(parts) || parts.length > HS_LIMITS.particles) hsFail("Give at most 24 particles.");
  for (const p of parts) if (!p || !["x", "y", "vx", "vy", "radius"].every(k => Number.isFinite(p[k])) || p.radius <= 0 || p.radius > Math.min(W, H) / 2 || Math.abs(p.vx) > W || Math.abs(p.vy) > H) hsFail("Each particle needs x, y, vx, vy and a radius that fits the grid.");
  const gravity = Number(req.gravity ?? 0);
  if (!Number.isFinite(gravity) || Math.abs(gravity) > 1) hsFail("Gravity is from -1 to 1 cells per tick squared.");
  const a = astar(W, H, blocked, start, goal), best = bfsLength(W, H, blocked, start, goal);
  const sim = verlet(parts, W, H, ticks, gravity);
  const checks = [
    { text: a.path ? "A*'s path is as short as breadth-first search's, one step at a time, never through an obstacle." : "No path exists, and breadth-first search agrees.", ok: pathOk(a.path, best, blocked, W) },
    { text: "Every particle stays inside the box.", ok: insideBox(sim.trails, parts, W, H) },
    { text: "Particles never overlap by more than a hundredth of a cell after a tick.", ok: overlapOk(sim.maxOverlap) },
  ];
  return { mode: "game_physics", verified: checks.every(c => c.ok), checks, grid: [W, H], start, goal, obstacles: obs, path: a.path, path_length: a.path ? a.path.length - 1 : null, expanded: a.expanded, shortest: best, ticks, gravity, trails: sim.trails, particles: sim.final };
}

export function hyper(req) {
  const mode = String(req && req.mode || "");
  if (mode === "projection") return projection(req);
  if (mode === "optics") return optics(req);
  if (mode === "game_physics") return gamePhysics(req);
  return hsFail("Choose a mode: projection, optics or game_physics.");
}
