// Universal maths (ADR-154), pure: used by the server (POST /api/w/:slug/math/solve) and inlined into the page.
// No eval, no Function: expressions are read by a Pratt parser into a small tree, with limits on length (400
// characters), tokens (200) and depth (40). Every answer is checked backwards before it is called verified:
// a root by |f(root)| <= 1e-9, a derivative against a central difference, a linear solve by its residual, an
// inverse by A.A^-1 = I, eigenvalues by trace and determinant, an ODE by step doubling, a factorisation by
// multiplying back, a CRT answer by every congruence. The same maths is in
// .claude/skills/replica-universal-math/universal_math.py.

export const UM_LIMITS = { chars: 400, tokens: 200, depth: 40, size: 10, odeSteps: 10000, crt: 10 };
// Every tolerance in one place: the backward checks, the pivot and root-merging thresholds, the derivative probe.
export const UM_TOL = { root: 1e-9, pole: 1e-6, sameRoot: 1e-9, pivot: 1e-12, probeStep: 1e-5, deriv: 1e-4, ode: 1e-6, sym: 1e-12, residual: 1e-9, singular: 1e-9, identity: 1e-9, trace: 1e-9, det: 1e-8, bayes: 1e-12 };
// A relative check: err is at most tol times |scale|, or times 1 when |scale| is below 1.
export function within(err, tol, scale = 1) { return err <= tol * Math.max(1, Math.abs(scale)); }
const UM_FUNCS = ["sin", "cos", "tan", "exp", "ln", "log10", "sqrt", "abs"];
const UM_CONSTS = { pi: Math.PI, e: Math.E };
export class MathError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const umFail = (m, detail) => { throw new MathError(m, detail); };

// ---- Expressions ------------------------------------------------------------------------------------
export function tokenize(src) {
  const s = String(src == null ? "" : src);
  if (!s.trim()) umFail("Write an expression first.");
  if (s.length > UM_LIMITS.chars) umFail("Keep the expression under 400 characters.");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") { i++; continue; }
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      while (j < s.length && ((s[j] >= "0" && s[j] <= "9") || s[j] === ".")) j++;
      if (j < s.length && (s[j] === "e" || s[j] === "E") && /^[eE][+-]?\d/.test(s.slice(j, j + 3))) { j += s[j + 1] === "+" || s[j + 1] === "-" ? 2 : 1; while (j < s.length && s[j] >= "0" && s[j] <= "9") j++; }
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) umFail("A number could not be read.", s.slice(i, j));
      out.push({ t: "n", v });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j).toLowerCase() });
      i = j;
    } else if ("+-*/^(),".includes(c)) { out.push({ t: c }); i++; }
    else umFail("This sign is not maths Jarvis reads.", c);
    if (out.length > UM_LIMITS.tokens) umFail("The expression has more than 200 parts.");
  }
  // Implicit multiplication: 2x, 2(x+1), (x+1)(x-1), x(...) is a function call only for known functions.
  const res = [];
  for (const tk of out) {
    const p = res[res.length - 1];
    if (p && (p.t === "n" || p.t === ")" || (p.t === "id" && !UM_FUNCS.includes(p.v))) && (tk.t === "n" || tk.t === "id" || tk.t === "(") && !(p.t === "n" && tk.t === "n")) res.push({ t: "*" });
    res.push(tk);
  }
  return res;
}

const BP = { "+": 10, "-": 10, "*": 20, "/": 20, "^": 30 };
export function parse(src) {
  const tk = tokenize(src);
  let pos = 0;
  const peek = () => tk[pos], next = () => tk[pos++];
  const expr = (rbp, depth) => {
    if (depth > UM_LIMITS.depth) umFail("The expression is nested too deeply.");
    const t = next();
    if (!t) umFail("The expression ends too early.");
    let left;
    if (t.t === "n") left = { k: "n", v: t.v };
    else if (t.t === "id") {
      if (UM_FUNCS.includes(t.v)) {
        if (!peek() || peek().t !== "(") umFail("A function needs brackets, as in sin(x).", t.v);
        next();
        const a = expr(0, depth + 1);
        if (!peek() || peek().t !== ")") umFail("A bracket is not closed.");
        next();
        left = { k: "f", f: t.v, a };
      } else if (Object.prototype.hasOwnProperty.call(UM_CONSTS, t.v)) left = { k: "c", n: t.v };
      else if (t.v.length <= 8) left = { k: "v", n: t.v };
      else umFail("A name is too long.", t.v);
    } else if (t.t === "(") {
      left = expr(0, depth + 1);
      if (!peek() || peek().t !== ")") umFail("A bracket is not closed.");
      next();
    } else if (t.t === "-") left = { k: "neg", a: expr(25, depth + 1) };
    else if (t.t === "+") left = expr(25, depth + 1);
    else umFail("Something unexpected is in the expression.", t.t);
    while (peek() && BP[peek().t] !== undefined && BP[peek().t] > rbp) {
      const op = next().t;
      left = { k: op, a: left, b: expr(op === "^" ? BP[op] - 1 : BP[op], depth + 1) };
    }
    return left;
  };
  const ast = expr(0, 0);
  if (pos < tk.length) umFail("Something unexpected follows the expression.", tk[pos].t);
  return ast;
}

export function evaluate(n, env = {}) {
  switch (n.k) {
    case "n": return n.v;
    case "c": return UM_CONSTS[n.n];
    case "v": if (!Object.prototype.hasOwnProperty.call(env, n.n) || typeof env[n.n] !== "number") umFail("A name has no value.", n.n); return env[n.n];
    case "neg": return -evaluate(n.a, env);
    case "+": return evaluate(n.a, env) + evaluate(n.b, env);
    case "-": return evaluate(n.a, env) - evaluate(n.b, env);
    case "*": return evaluate(n.a, env) * evaluate(n.b, env);
    case "/": return evaluate(n.a, env) / evaluate(n.b, env);
    case "^": return Math.pow(evaluate(n.a, env), evaluate(n.b, env));
    default: {
      const x = evaluate(n.a, env);
      return { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, ln: Math.log, log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs }[n.f](x);
    }
  }
}

const num = v => ({ k: "n", v: Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) : v });
const isN = (n, v) => n.k === "n" && (v === undefined || n.v === v);
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const hasVar = (n, x) => n.k === "v" ? n.n === x : n.k === "n" || n.k === "c" ? false : n.k === "neg" || n.k === "f" ? hasVar(n.a, x) : hasVar(n.a, x) || hasVar(n.b, x);

export function simplify(n) {
  if (n.k === "n" || n.k === "v" || n.k === "c") return n;
  if (n.k === "f") { const a = simplify(n.a); if (n.f === "ln" && a.k === "c" && a.n === "e") return num(1); return isN(a) && Number.isFinite(evaluate({ k: "f", f: n.f, a })) && ["abs"].includes(n.f) ? num(Math.abs(a.v)) : { k: "f", f: n.f, a }; }
  if (n.k === "neg") {
    const a = simplify(n.a);
    if (isN(a)) return num(-a.v);
    if (a.k === "neg") return a.a;
    return { k: "neg", a };
  }
  const a = simplify(n.a), b = simplify(n.b);
  if (isN(a) && isN(b)) { const v = evaluate({ k: n.k, a, b }); if (Number.isFinite(v)) return num(v); }
  switch (n.k) {
    case "+":
      if (isN(a, 0)) return b;
      if (isN(b, 0)) return a;
      if (b.k === "neg") return simplify({ k: "-", a, b: b.a });
      if (isN(b) && b.v < 0) return { k: "-", a, b: num(-b.v) };
      if (same(a, b)) return simplify({ k: "*", a: num(2), b: a });
      break;
    case "-":
      if (isN(b, 0)) return a;
      if (isN(a, 0)) return simplify({ k: "neg", a: b });
      if (b.k === "neg") return simplify({ k: "+", a, b: b.a });
      if (isN(b) && b.v < 0) return { k: "+", a, b: num(-b.v) };
      if (same(a, b)) return num(0);
      break;
    case "*":
      if (isN(a, 0) || isN(b, 0)) return num(0);
      if (isN(a, 1)) return b;
      if (isN(b, 1)) return a;
      if (isN(a, -1)) return simplify({ k: "neg", a: b });
      if (isN(b) && !isN(a)) return simplify({ k: "*", a: b, b: a });
      if (isN(a) && b.k === "*" && isN(b.a)) return simplify({ k: "*", a: num(a.v * b.a.v), b: b.b });
      if (same(a, b)) return { k: "^", a, b: num(2) };
      if (b.k === "^" && same(a, b.a) && isN(b.b)) return { k: "^", a, b: num(b.b.v + 1) };
      if (a.k === "^" && same(a.a, b) && isN(a.b)) return { k: "^", a: b, b: num(a.b.v + 1) };
      if (a.k === "neg") return simplify({ k: "neg", a: { k: "*", a: a.a, b } });
      if (b.k === "neg") return simplify({ k: "neg", a: { k: "*", a, b: b.a } });
      break;
    case "/":
      if (isN(a, 0) && !isN(b, 0)) return num(0);
      if (isN(b, 1)) return a;
      if (same(a, b) && !isN(a, 0)) return num(1);
      break;
    case "^":
      if (isN(b, 0)) return num(1);
      if (isN(b, 1)) return a;
      if (isN(a, 1)) return num(1);
      if (a.k === "^" && isN(a.b) && isN(b)) return { k: "^", a: a.a, b: num(a.b.v * b.v) };
      break;
  }
  return { k: n.k, a, b };
}

const D = (n, x) => {
  switch (n.k) {
    case "n": case "c": return num(0);
    case "v": return num(n.n === x ? 1 : 0);
    case "neg": return { k: "neg", a: D(n.a, x) };
    case "+": case "-": return { k: n.k, a: D(n.a, x), b: D(n.b, x) };
    case "*": return { k: "+", a: { k: "*", a: D(n.a, x), b: n.b }, b: { k: "*", a: n.a, b: D(n.b, x) } };
    case "/": return { k: "/", a: { k: "-", a: { k: "*", a: D(n.a, x), b: n.b }, b: { k: "*", a: n.a, b: D(n.b, x) } }, b: { k: "^", a: n.b, b: num(2) } };
    case "^": {
      const ua = hasVar(n.a, x), ub = hasVar(n.b, x);
      if (!ub) return { k: "*", a: { k: "*", a: n.b, b: { k: "^", a: n.a, b: { k: "-", a: n.b, b: num(1) } } }, b: D(n.a, x) };
      if (!ua) return { k: "*", a: { k: "*", a: n, b: { k: "f", f: "ln", a: n.a } }, b: D(n.b, x) };
      return { k: "*", a: n, b: { k: "+", a: { k: "*", a: D(n.b, x), b: { k: "f", f: "ln", a: n.a } }, b: { k: "/", a: { k: "*", a: n.b, b: D(n.a, x) }, b: n.a } } };
    }
    default: {
      const u = n.a, du = D(u, x);
      const outer = {
        sin: { k: "f", f: "cos", a: u },
        cos: { k: "neg", a: { k: "f", f: "sin", a: u } },
        tan: { k: "/", a: num(1), b: { k: "^", a: { k: "f", f: "cos", a: u }, b: num(2) } },
        exp: { k: "f", f: "exp", a: u },
        ln: { k: "/", a: num(1), b: u },
        log10: { k: "/", a: num(1), b: { k: "*", a: u, b: { k: "f", f: "ln", a: num(10) } } },
        sqrt: { k: "/", a: num(1), b: { k: "*", a: num(2), b: { k: "f", f: "sqrt", a: u } } },
        abs: { k: "/", a: u, b: { k: "f", f: "abs", a: u } },
      }[n.f];
      return { k: "*", a: outer, b: du };
    }
  }
};
export const derivative = (n, x = "x") => simplify(D(n, x));

const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, neg: 3, "^": 4 };
export const fmt = v => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10))));
export function show(n) {
  const wrap = (c, p, right) => { const s = show(c); const cp = c.k === "n" && c.v < 0 ? 3 : PREC[c.k] || 5; return cp < p || (right && cp === p && p !== 4) || (c.k === "^" && p === 4 && !right) || (cp === 3 && (right || p === 4)) ? "(" + s + ")" : s; };
  switch (n.k) {
    case "n": return fmt(n.v);
    case "v": return n.n;
    case "c": return n.n;
    case "f": return n.f + "(" + show(n.a) + ")";
    case "neg": return "-" + wrap(n.a, 3, true);
    default: return wrap(n.a, PREC[n.k], false) + (n.k === "^" ? "^" : " " + n.k + " ") + wrap(n.b, PREC[n.k], true);
  }
}

// ---- Calculus -----------------------------------------------------------------------------------------
export function adaptiveSimpson(f, a, b, eps = 1e-10, maxDepth = 50) {
  let evals = 0;
  const F = x => { evals++; const y = f(x); if (!Number.isFinite(y)) umFail("The function is not finite on the interval."); return y; };
  const fa = F(a), fb = F(b), m = (a + b) / 2, fm = F(m);
  const whole = (b - a) / 6 * (fa + 4 * fm + fb);
  const stack = [[a, b, fa, fm, fb, whole, eps, 0]];
  let total = 0;
  while (stack.length) {
    const [l, r, fl, fmid, fr, s, e, d] = stack.pop();
    const mid = (l + r) / 2, lm = (l + mid) / 2, rm = (mid + r) / 2;
    const flm = F(lm), frm = F(rm);
    const left = (mid - l) / 6 * (fl + 4 * flm + fmid), right = (r - mid) / 6 * (fmid + 4 * frm + fr);
    if (d >= maxDepth || Math.abs(left + right - s) <= 15 * e || evals > 200000) total += left + right + (left + right - s) / 15;
    else { stack.push([l, mid, fl, flm, fmid, left, e / 2, d + 1]); stack.push([mid, r, fmid, frm, fr, right, e / 2, d + 1]); }
  }
  return { value: total, evals };
}

// Brent (1973): bisection, secant and inverse quadratic interpolation, on a bracket where f changes sign.
export function brent(f, a, b, tol = 1e-14, maxIter = 100) {
  let fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return null;
  if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  let c = a, fc = fa, d = b - a, mflag = true;
  for (let i = 0; i < maxIter; i++) {
    if (fb === 0 || Math.abs(b - a) < tol) return b;
    let s;
    if (fa !== fc && fb !== fc) s = a * fb * fc / ((fa - fb) * (fa - fc)) + b * fa * fc / ((fb - fa) * (fb - fc)) + c * fa * fb / ((fc - fa) * (fc - fb));
    else s = b - fb * (b - a) / (fb - fa);
    const lo = (3 * a + b) / 4;
    if (!((s > Math.min(lo, b) && s < Math.max(lo, b))) || (mflag && Math.abs(s - b) >= Math.abs(b - c) / 2) || (!mflag && Math.abs(s - b) >= Math.abs(c - d) / 2)) { s = (a + b) / 2; mflag = true; } else mflag = false;
    const fs = f(s);
    d = c; c = b; fc = fb;
    if (fa * fs < 0) { b = s; fb = fs; } else { a = s; fa = fs; }
    if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  }
  return b;
}

export function findRoots(f, df, a, b, samples = 400) {
  const roots = [];
  let x0 = a, y0 = f(a);
  for (let i = 1; i <= samples; i++) {
    const x1 = a + (b - a) * i / samples, y1 = f(x1);
    // A zero at a sample is a root even when the next sample is not finite (ADR-154: found by the mutation run).
    if (y0 === 0 || (Number.isFinite(y0) && Number.isFinite(y1))) {
      let r = null;
      if (y0 === 0) r = x0;
      else if (y0 * y1 < 0) r = brent(f, x0, x1);
      if (r !== null) {
        for (let k = 0; k < 5 && df; k++) { const d = df(r); if (!d || !Number.isFinite(d)) break; const n = r - f(r) / d; if (n < x0 || n > x1 || !Number.isFinite(f(n))) break; if (Math.abs(f(n)) > Math.abs(f(r))) break; r = n; }
        if (!roots.some(q => Math.abs(q - r) < UM_TOL.sameRoot)) roots.push(r);
      }
    }
    x0 = x1; y0 = y1;
  }
  if (y0 === 0 && !roots.some(q => Math.abs(q - b) < UM_TOL.sameRoot)) roots.push(b);
  return roots;
}

// ---- Linear algebra ---------------------------------------------------------------------------------
const checkMatrix = A => {
  if (!Array.isArray(A) || !A.length || A.length > UM_LIMITS.size) umFail("Give a square matrix of at most 10 rows.");
  const n = A.length;
  for (const r of A) if (!Array.isArray(r) || r.length !== n || r.some(v => typeof v !== "number" || !Number.isFinite(v))) umFail("Give a square matrix of numbers.");
  return n;
};
export function gaussSolve(A, b) {
  const n = checkMatrix(A);
  if (!Array.isArray(b) || b.length !== n || b.some(v => typeof v !== "number" || !Number.isFinite(v))) umFail("The right-hand side needs one number per row.");
  const M = A.map((r, i) => [...r, b[i]]);
  const scale = Math.max(1, ...A.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < UM_TOL.pivot * scale) return null;
    if (p !== c) [M[p], M[c]] = [M[c], M[p]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
export function determinant(A) {
  const n = checkMatrix(A);
  const M = A.map(r => [...r]);
  let det = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return 0;
    if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; det = -det; }
    det *= M[c][c];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; }
  }
  return det;
}
export function inverse(A) {
  const n = checkMatrix(A);
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const scale = Math.max(1, ...A.flat().map(Math.abs));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < UM_TOL.pivot * scale) return null;
    if (p !== c) [M[p], M[c]] = [M[c], M[p]];
    const pv = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= pv;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map(r => r.slice(n));
}
// Cyclic Jacobi rotations for a symmetric matrix; eigenvalues in ascending order.
export function jacobiEigen(A, sweeps = 100) {
  const n = checkMatrix(A);
  const M = A.map(r => [...r]);
  for (let s = 0; s < sweeps; s++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += M[i][j] * M[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(M[p][q]) < 1e-300) continue;
      const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), sn = t * c;
      for (let k = 0; k < n; k++) { const kp = M[k][p], kq = M[k][q]; M[k][p] = c * kp - sn * kq; M[k][q] = sn * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = M[p][k], qk = M[q][k]; M[p][k] = c * pk - sn * qk; M[q][k] = sn * pk + c * qk; }
    }
  }
  return M.map((r, i) => r[i]).sort((x, y) => x - y);
}

// ---- Ordinary differential equations: classic fourth-order Runge-Kutta -------------------------------
export function rk4(f, x0, y0, x1, steps) {
  const h = (x1 - x0) / steps, pts = [[x0, y0]];
  let x = x0, y = y0;
  for (let i = 0; i < steps; i++) {
    const k1 = f(x, y), k2 = f(x + h / 2, y + h * k1 / 2), k3 = f(x + h / 2, y + h * k2 / 2), k4 = f(x + h, y + h * k3);
    y += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
    x = x0 + h * (i + 1);
    if (!Number.isFinite(y)) umFail("The solution is not finite.", "x = " + fmt(x));
    pts.push([x, y]);
  }
  return pts;
}

// ---- Number theory (BigInt) -------------------------------------------------------------------------
const big = v => { try { const b = BigInt(typeof v === "number" && Number.isInteger(v) ? v : String(v).trim()); return b; } catch (e) { return umFail("Give a whole number."); } };
const modpow = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
export const absBig = x => (x < 0n ? -x : x);
export function egcd(a, b) {
  let [r0, r1, s0, s1, t0, t1] = [a, b, 1n, 0n, 0n, 1n];
  while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; [t0, t1] = [t1, t0 - q * t1]; }
  return r0 < 0n ? { g: -r0, x: -s0, y: -t0 } : { g: r0, x: s0, y: t0 };
}
// Exact for every n below 3,317,044,064,679,887,385,961,981 (about 3.3e24) with the first thirteen primes as
// bases; that number is the first that passes all thirteen, so solve() tests only numbers below it.
const MR_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];
export const MR_LIMIT = 3317044064679887385961981n;
export function isPrime(n) {
  if (n < 2n) return false;
  for (const p of MR_BASES) { if (n === p) return true; if (n % p === 0n) return false; }
  let d = n - 1n, s = 0;
  while ((d & 1n) === 0n) { d >>= 1n; s++; }
  for (const a of MR_BASES) {
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let comp = true;
    for (let r = 1; r < s; r++) { x = x * x % n; if (x === n - 1n) { comp = false; break; } }
    if (comp) return false;
  }
  return true;
}
const rho = n => {
  if (n % 2n === 0n) return 2n;
  for (let c = 1n; c < 20n; c++) {
    let x = 2n, y = 2n, d = 1n, steps = 0;
    while (d === 1n && steps < 200000) { x = (x * x + c) % n; y = (y * y + c) % n; y = (y * y + c) % n; d = egcd(absBig(x - y), n).g; steps++; }
    if (d !== n && d !== 1n) return d;
  }
  return n;
};
export function factorize(nIn) {
  let n = big(nIn);
  if (n < 2n) umFail("Factorise a whole number of 2 or more.");
  if (n > (1n << 64n)) umFail("Factorise numbers below 2^64.");
  const out = [];
  for (let p = 2n; p < 1000n && p * p <= n; p++) while (n % p === 0n) { out.push(p); n /= p; }
  const stack = n > 1n ? [n] : [];
  while (stack.length) {
    const m = stack.pop();
    if (isPrime(m)) { out.push(m); continue; }
    const d = rho(m);
    if (d === m) umFail("This number could not be factorised within the limits.");
    stack.push(d, m / d);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
export function crt(remainders, moduli) {
  if (!Array.isArray(remainders) || !Array.isArray(moduli) || !remainders.length || remainders.length !== moduli.length || remainders.length > UM_LIMITS.crt) umFail("Give the same number of remainders and moduli, at most 10.");
  let r = 0n, m = 1n;
  for (let i = 0; i < moduli.length; i++) {
    const mi = big(moduli[i]);
    if (mi < 1n) umFail("Every modulus must be 1 or more.");
    const ri = ((big(remainders[i]) % mi) + mi) % mi;
    const { g, x } = egcd(m, mi);
    if ((ri - r) % g !== 0n) return null;
    const l = m / g * mi;
    r = (((r + m * ((ri - r) / g) * x) % l) + l) % l;
    m = l;
  }
  return { x: r, modulus: m };
}
export function bayes(prior, sensitivity, falsePositive) {
  for (const v of [prior, sensitivity, falsePositive]) if (typeof v !== "number" || !(v >= 0 && v <= 1)) umFail("Probabilities are numbers from 0 to 1.");
  const evidence = sensitivity * prior + falsePositive * (1 - prior);
  if (evidence === 0) umFail("The evidence has probability 0.");
  return { posterior: sensitivity * prior / evidence, evidence };
}

// ---- The solver: a task, its steps and its checks --------------------------------------------------
const r12 = v => Number(v.toPrecision(12));
const umStep = (text, formula) => (formula === undefined ? { text } : { text, formula: String(formula) });
const umCheck = (text, ok, formula) => (formula === undefined ? { text, ok: !!ok } : { text, ok: !!ok, formula: String(formula) });
const plotOf = (f, a, b, n = 200) => { const pts = []; for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n, y = f(x); if (Number.isFinite(y) && Math.abs(y) < 1e6) pts.push([r12(x), r12(y)]); } return pts; };
const interval = v => { const [a, b] = Array.isArray(v) && v.length === 2 ? v.map(Number) : [-10, 10]; if (!Number.isFinite(a) || !Number.isFinite(b) || !(a < b)) umFail("The interval is two numbers, smaller first."); return [a, b]; };

export function solve(req) {
  const task = String(req && req.task || "");
  if (task === "calculus") {
    const x = String(req.variable || "x").toLowerCase();
    const ast = simplify(parse(req.expression));
    const [a, b] = interval(req.interval);
    const d = derivative(ast, x);
    const f = v => evaluate(ast, { [x]: v }), df = v => evaluate(d, { [x]: v });
    // A sign change where |f| stays large is a pole or a jump, not a root: it is named, and no integral is given across it.
    const found = findRoots(f, df, a, b).map(r12), jumps = found.filter(r => !within(Math.abs(f(r)), UM_TOL.pole)), roots = found.filter(r => within(Math.abs(f(r)), UM_TOL.pole));
    const residuals = roots.map(r => Math.abs(f(r)));
    let integral = null, integralError = null;
    if (jumps.length) integralError = "x = " + jumps.map(fmt).join(", ");
    else { try { integral = r12(adaptiveSimpson(f, a, b).value); } catch (e) { integralError = e.message; } }
    const probe = [0.13, 0.37, 0.61, 0.89].map(t => a + (b - a) * t);
    const derivOk = probe.every(p => { const h = UM_TOL.probeStep * Math.max(1, Math.abs(p)); const nd = (f(p + h) - f(p - h)) / (2 * h), sd = df(p); return !Number.isFinite(sd) || !Number.isFinite(nd) || within(Math.abs(nd - sd), UM_TOL.deriv, sd); });
    const checks = [umCheck("The derivative matches a central difference at 4 points.", derivOk), ...roots.map((r, i) => umCheck("Back-check of a root: |f| is at most 1e-9.", within(residuals[i], UM_TOL.root), "|f(" + fmt(r) + ")| = " + residuals[i].toExponential(1)))];
    return { task, verified: checks.every(c => c.ok), checks,
      steps: [umStep("The expression, simplified", show(ast)), umStep("Its derivative by the power, product, quotient and chain rules", "d/d" + x + " = " + show(d)),
        umStep(roots.length ? "Roots on the interval, by Brent's method and a Newton polish" : "No root on the interval", roots.map(fmt).join(", ") || "—"),
        ...(jumps.length ? [umStep("A sign change without a root: a pole or a jump", jumps.map(fmt).join(", "))] : []),
        integral === null ? umStep("The definite integral could not be computed.", integralError) : umStep("The definite integral by adaptive Simpson", "∫[" + fmt(a) + ", " + fmt(b) + "] f(" + x + ") d" + x + " = " + fmt(integral))],
      result: { expression: show(ast), derivative: show(d), roots, poles: jumps, integral, interval: [a, b] }, plot: { kind: "function", points: plotOf(f, a, b), roots } };
  }
  if (task === "ode_rk4") {
    const ast = simplify(parse(req.expression));
    const x0 = Number(req.x0 ?? 0), y0 = Number(req.y0 ?? 0), x1 = Number(req.x_end ?? 1), steps = Math.round(Number(req.steps ?? 20));
    if (![x0, y0, x1].every(Number.isFinite) || x1 === x0) umFail("Give a start point, a start value and a different end point.");
    if (!(steps >= 1 && steps <= UM_LIMITS.odeSteps)) umFail("Steps are from 1 to 10000.");
    const f = (x, y) => evaluate(ast, { x, y });
    const pts = rk4(f, x0, y0, x1, steps), fine = rk4(f, x0, y0, x1, Math.min(UM_LIMITS.odeSteps * 2, steps * 2));
    const yEnd = pts[pts.length - 1][1], yFine = fine[fine.length - 1][1], err = Math.abs(yEnd - yFine) / 15;
    const ok = within(err, UM_TOL.ode, yFine);
    return { task, verified: ok, checks: [umCheck("Step doubling keeps the error estimate under 1e-6.", ok, "err = " + err.toExponential(1))],
      steps: [umStep("The equation", "dy/dx = " + show(ast)), umStep("Classic Runge-Kutta, 4 slopes a step", "h = " + fmt(r12((x1 - x0) / steps)) + ", steps = " + steps), umStep("The value at the end", "y(" + fmt(x1) + ") = " + fmt(r12(yEnd)))],
      result: { y_end: r12(yEnd), error_estimate: Number(err.toExponential(3)), points: pts.length }, plot: { kind: "ode", points: pts.filter((_, i) => i % Math.max(1, Math.ceil(pts.length / 400)) === 0 || i === pts.length - 1).map(([x, y]) => [r12(x), r12(y)]) } };
  }
  if (task === "linear_algebra") {
    const A = req.matrix, n = checkMatrix(A);
    const det = determinant(A), inv = inverse(A);
    const sym = A.every((r, i) => r.every((v, j) => within(Math.abs(v - A[j][i]), UM_TOL.sym, v)));
    const eig = sym ? jacobiEigen(A) : null;
    const steps = [umStep("Determinant by elimination with partial pivoting", "det(A) = " + fmt(r12(det)))];
    const checks = [];
    const result = { determinant: r12(det), singular: inv === null };
    if (req.rhs !== undefined) {
      const x = gaussSolve(A, req.rhs);
      if (x) {
        const res = Math.max(...A.map((r, i) => Math.abs(r.reduce((s, v, j) => s + v * x[j], 0) - req.rhs[i])));
        result.solution = x.map(r12);
        steps.push(umStep("The system solved by Gaussian elimination with partial pivoting", "x = [" + result.solution.map(fmt).join(", ") + "]"));
        checks.push(umCheck("The residual of the solution is at most 1e-9.", within(res, UM_TOL.residual), "max|Ax - b| = " + res.toExponential(1)));
      } else { steps.push(umStep("The matrix is singular, so the system has no single solution.")); checks.push(umCheck("A pivot is zero: singular.", within(Math.abs(det), UM_TOL.singular, Math.max(...A.flat().map(Math.abs)) ** n))); }
    }
    if (inv) {
      const err = Math.max(...A.map((r, i) => Math.max(...inv.map((_, j) => Math.abs(r.reduce((s, v, k) => s + v * inv[k][j], 0) - (i === j ? 1 : 0))))));
      result.inverse = inv.map(r => r.map(r12));
      steps.push(umStep("The inverse by Gauss-Jordan", n + " × " + n));
      checks.push(umCheck("The matrix times its inverse gives the identity to 1e-9.", within(err, UM_TOL.identity), "max|A·A^-1 - I| = " + err.toExponential(1)));
    }
    if (eig) {
      const tr = A.reduce((s, r, i) => s + r[i], 0), te = eig.reduce((s, v) => s + v, 0), pe = eig.reduce((s, v) => s * v, 1);
      result.eigenvalues = eig.map(r12);
      steps.push(umStep("Eigenvalues of the symmetric matrix by Jacobi rotations", "λ = " + result.eigenvalues.map(fmt).join(", ")));
      checks.push(umCheck("The eigenvalues add up to the trace and multiply to the determinant.", within(Math.abs(tr - te), UM_TOL.trace, tr) && within(Math.abs(det - pe), UM_TOL.det, det)));
    }
    return { task, verified: checks.length > 0 && checks.every(c => c.ok), checks, steps, result };
  }
  if (task === "number_theory") {
    const steps = [], checks = [], result = {};
    if (req.n !== undefined) {
      const n = big(req.n);
      if (n >= MR_LIMIT) umFail("Test whole numbers below 3.3 × 10^24, where the test is exact.");
      const prime = isPrime(n);
      result.n = n.toString(); result.prime = prime;
      steps.push(umStep(prime ? "Miller-Rabin test with 13 fixed bases: prime" : "Miller-Rabin test with 13 fixed bases: not prime", n.toString()));
      if (n > 1n << 64n) steps.push(umStep("Numbers above 2^64 are tested here but not factorised."));
      else if (n >= 2n) {
        const fs = factorize(n), prod = fs.reduce((p, q) => p * q, 1n);
        result.factors = fs.map(String);
        steps.push(umStep("Prime factors by trial division and Pollard's rho", fs.join(" × ")));
        checks.push(umCheck("The factors multiply back to n, and each is prime.", prod === n && fs.every(isPrime) && (fs.length === 1) === prime));
      }
    }
    if (req.a !== undefined && req.b !== undefined) {
      const a = big(req.a), b = big(req.b), { g, x, y } = egcd(a, b);
      result.gcd = g.toString(); result.bezout = [x.toString(), y.toString()];
      steps.push(umStep("Extended Euclid", "gcd = " + g + " = " + a + "·(" + x + ") + " + b + "·(" + y + ")"));
      checks.push(umCheck("a·x + b·y equals the gcd.", a * x + b * y === g));
      if (g === 1n && b > 1n) { result.inverse_mod_b = (((x % b) + b) % b).toString(); steps.push(umStep("The inverse of a modulo b", result.inverse_mod_b)); }
    }
    if (req.crt_remainders !== undefined) {
      const c = crt(req.crt_remainders, req.crt_moduli);
      if (!c) { steps.push(umStep("The congruences contradict each other: no solution.")); checks.push(umCheck("No x fits every congruence.", true)); }
      else {
        result.crt = { x: c.x.toString(), modulus: c.modulus.toString() };
        steps.push(umStep("Chinese remainder theorem, merging one congruence at a time", "x ≡ " + c.x + " (mod " + c.modulus + ")"));
        checks.push(umCheck("x leaves every given remainder.", req.crt_moduli.every((m, i) => ((c.x - big(req.crt_remainders[i])) % big(m)) === 0n)));
      }
    }
    if (!steps.length) umFail("Give a number to test, a pair for the gcd, or remainders and moduli.");
    return { task, verified: checks.length > 0 && checks.every(c => c.ok), checks, steps, result };
  }
  if (task === "bayes") {
    const p = Number(req.prior), s = Number(req.sensitivity), fp = Number(req.false_positive);
    const { posterior, evidence } = bayes(p, s, fp);
    const back = posterior * evidence / s;
    const ok = s === 0 ? posterior === 0 : within(Math.abs(back - p), UM_TOL.bayes);
    return { task, verified: ok, checks: [umCheck("Multiplying back gives the prior.", ok, "P(H|E)·P(E) / P(E|H) = " + fmt(r12(back)))],
      steps: [umStep("The probability of the evidence", "P(E) = P(E|H)·P(H) + P(E|¬H)·P(¬H) = " + fmt(r12(evidence))), umStep("Bayes' theorem", "P(H|E) = P(E|H)·P(H) / P(E) = " + fmt(r12(posterior)))], result: { posterior: r12(posterior), evidence: r12(evidence) } };
  }
  return umFail("Choose a task: calculus, an equation, a matrix, number theory or Bayes.");
}

// ---- Language: the step and check sentences in Arabic (the page's i18n-ar.json has the same lines; a test keeps
// them equal). Formulas, numbers and names stay as written.
export const UM_AR = {
  "A bracket is not closed.": "قوس لم يُغلق.",
  "A sign change without a root: a pole or a jump": "تغيّر في الإشارة بلا جذر: قطب أو قفزة",
  "A function needs brackets, as in sin(x).": "الدالة تحتاج قوسين، مثل sin(x).",
  "A name has no value.": "اسم بلا قيمة.",
  "A name is too long.": "الاسم طويل جداً.",
  "A number could not be read.": "تعذرت قراءة عدد.",
  "A pivot is zero: singular.": "أحد المحاور صفر: المصفوفة منفردة.",
  "Back-check of a root: |f| is at most 1e-9.": "التحقق العكسي من الجذر: |f| لا تتجاوز 1e-9.",
  "Bayes' theorem": "مبرهنة بايز",
  "Chinese remainder theorem, merging one congruence at a time": "مبرهنة الباقي الصينية، بدمج تطابق واحد في كل مرة",
  "Choose a task: calculus, an equation, a matrix, number theory or Bayes.": "اختر مهمة: التفاضل والتكامل، أو معادلة، أو مصفوفة، أو نظرية الأعداد، أو بايز.",
  "Classic Runge-Kutta, 4 slopes a step": "طريقة رونغه-كوتا الكلاسيكية، أربعة ميول في كل خطوة",
  "Determinant by elimination with partial pivoting": "المحدِّد بالحذف مع الارتكاز الجزئي",
  "Eigenvalues of the symmetric matrix by Jacobi rotations": "القيم الذاتية للمصفوفة المتماثلة بدورانات جاكوبي",
  "Every modulus must be 1 or more.": "كل مقياس يجب أن يكون 1 أو أكثر.",
  "Extended Euclid": "خوارزمية إقليدس الموسَّعة",
  "Factorise a whole number of 2 or more.": "حلّل عدداً صحيحاً من 2 فأكثر.",
  "Factorise numbers below 2^64.": "حلّل أعداداً أصغر من 2^64.",
  "Give a number to test, a pair for the gcd, or remainders and moduli.": "أعطِ عدداً لاختباره، أو زوجاً للقاسم المشترك الأكبر، أو بواقي ومقاييس.",
  "Give a square matrix of at most 10 rows.": "أعطِ مصفوفة مربعة من 10 صفوف على الأكثر.",
  "Give a square matrix of numbers.": "أعطِ مصفوفة مربعة من الأعداد.",
  "Give a start point, a start value and a different end point.": "أعطِ نقطة بداية وقيمة بداية ونقطة نهاية مختلفة.",
  "Give a whole number.": "أعطِ عدداً صحيحاً.",
  "Give the same number of remainders and moduli, at most 10.": "أعطِ عدداً متساوياً من البواقي والمقاييس، 10 على الأكثر.",
  "Its derivative by the power, product, quotient and chain rules": "مشتقته بقواعد القوة والضرب والقسمة والسلسلة",
  "Keep the expression under 400 characters.": "اجعل التعبير أقل من 400 حرف.",
  "Miller-Rabin test with 13 fixed bases: not prime": "اختبار ميلر-رابين بـ 13 أساساً ثابتاً: ليس أولياً",
  "Miller-Rabin test with 13 fixed bases: prime": "اختبار ميلر-رابين بـ 13 أساساً ثابتاً: أولي",
  "Multiplying back gives the prior.": "الضرب العكسي يعيد الاحتمال المسبق.",
  "No root on the interval": "لا جذر في المجال",
  "No x fits every congruence.": "لا يوجد x يحقق كل التطابقات.",
  "Prime factors by trial division and Pollard's rho": "العوامل الأولية بالقسمة التجريبية وطريقة رو لبولارد",
  "Probabilities are numbers from 0 to 1.": "الاحتمالات أعداد من 0 إلى 1.",
  "Roots on the interval, by Brent's method and a Newton polish": "الجذور في المجال بطريقة برنت ثم تنقيح نيوتن",
  "Something unexpected follows the expression.": "شيء غير متوقع بعد التعبير.",
  "Something unexpected is in the expression.": "شيء غير متوقع في التعبير.",
  "Step doubling keeps the error estimate under 1e-6.": "مضاعفة الخطوات تُبقي تقدير الخطأ دون 1e-6.",
  "Test whole numbers below 3.3 × 10^24, where the test is exact.": "اختبر أعداداً صحيحة أصغر من 3.3 × 10^24، حيث يكون الاختبار دقيقاً.",
  "Numbers above 2^64 are tested here but not factorised.": "الأعداد الأكبر من 2^64 تُختبر هنا ولا تُحلَّل.",
  "Steps are from 1 to 10000.": "عدد الخطوات من 1 إلى 10000.",
  "The congruences contradict each other: no solution.": "التطابقات متناقضة: لا حل.",
  "The definite integral by adaptive Simpson": "التكامل المحدد بطريقة سيمبسون التكيفية",
  "The definite integral could not be computed.": "تعذر حساب التكامل المحدد.",
  "The derivative matches a central difference at 4 points.": "المشتقة تطابق الفرق المركزي عند 4 نقاط.",
  "The eigenvalues add up to the trace and multiply to the determinant.": "مجموع القيم الذاتية يساوي الأثر وحاصل ضربها يساوي المحدِّد.",
  "The equation": "المعادلة",
  "The evidence has probability 0.": "احتمال الدليل صفر.",
  "The expression ends too early.": "التعبير ينتهي مبكراً.",
  "The expression has more than 200 parts.": "التعبير فيه أكثر من 200 جزء.",
  "The expression is nested too deeply.": "التعبير متداخل بعمق زائد.",
  "The expression, simplified": "التعبير بعد التبسيط",
  "The factors multiply back to n, and each is prime.": "حاصل ضرب العوامل يعيد n، وكل منها أولي.",
  "The function is not finite on the interval.": "الدالة غير منتهية على المجال.",
  "The interval is two numbers, smaller first.": "المجال عددان، الأصغر أولاً.",
  "The inverse by Gauss-Jordan": "المعكوس بطريقة غاوس-جوردان",
  "The inverse of a modulo b": "معكوس a بمقياس b",
  "The matrix is singular, so the system has no single solution.": "المصفوفة منفردة، فليس للنظام حل وحيد.",
  "The matrix times its inverse gives the identity to 1e-9.": "المصفوفة مضروبة في معكوسها تعطي مصفوفة الوحدة بدقة 1e-9.",
  "The probability of the evidence": "احتمال الدليل",
  "The residual of the solution is at most 1e-9.": "باقي الحل لا يتجاوز 1e-9.",
  "The right-hand side needs one number per row.": "الطرف الأيمن يحتاج عدداً لكل صف.",
  "The solution is not finite.": "الحل غير منتهٍ.",
  "The system solved by Gaussian elimination with partial pivoting": "حل النظام بحذف غاوس مع الارتكاز الجزئي",
  "The value at the end": "القيمة عند النهاية",
  "This number could not be factorised within the limits.": "تعذر تحليل هذا العدد ضمن الحدود.",
  "This sign is not maths Jarvis reads.": "هذه العلامة ليست من الرياضيات التي يقرؤها Jarvis.",
  "Write an expression first.": "اكتب تعبيراً أولاً.",
  "a·x + b·y equals the gcd.": "a·x + b·y يساوي القاسم المشترك الأكبر.",
  "x leaves every given remainder.": "x يعطي كل باقٍ مطلوب.",
};
export const umText = (text, lang) => (lang === "ar" && Object.prototype.hasOwnProperty.call(UM_AR, text) ? UM_AR[text] : text);
export function localize(out, lang) {
  if (lang !== "ar") return out;
  const tx = list => list.map(x => ({ ...x, text: umText(x.text, lang) }));
  return { ...out, lang: "ar", steps: tx(out.steps), checks: tx(out.checks) };
}
