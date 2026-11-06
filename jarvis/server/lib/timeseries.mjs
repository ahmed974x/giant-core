// Time-series maths (ADR-147), pure: used by the server's telemetry and inlined into the page. The same
// formulas are in .claude/skills/replica-timeseries-math/ts_math.py. Nothing here starts a process.
//   Welford (1962): running mean and variance in O(1) memory: n, mean, M2; variance = M2 / (n - 1).
//   EWMA: e = alpha * x + (1 - alpha) * e, started at the first value.
//   z-score: (x - mean) / sd against the values seen BEFORE x, so a spike does not hide itself.
//   VPIN (Easley, López de Prado and O'Hara, 2012), adapted to telemetry [INFERENCE]: each new value is an
//   "up" or "down" tick by the tick rule; ticks fill buckets of equal size; VPIN is the mean of
//   |up - down| / size over the last buckets. 0 means balanced, 1 means every tick goes one way.
//   LTTB (Steinarsson, 2013): keeps the first and last point and, in each bucket, the point that makes the
//   largest triangle with the point kept before it and the mean of the next bucket, so peaks and troughs
//   survive the downsampling.
export const welford = () => ({ n: 0, mean: 0, m2: 0 });
export function welfordPush(s, x) {
  const n = s.n + 1, d = x - s.mean, mean = s.mean + d / n;
  return { n, mean, m2: s.m2 + d * (x - mean) };
}
export const variance = s => (s.n > 1 ? s.m2 / (s.n - 1) : 0);
export const stdev = s => Math.sqrt(variance(s));
export const ewmaPush = (e, x, alpha = 0.1) => (e == null ? x : alpha * x + (1 - alpha) * e);
export const zscore = (s, x) => { const sd = stdev(s); return sd > 0 ? (x - s.mean) / sd : 0; };

export function vpin(values, size = 50, window = 10) {
  const buckets = [];
  let up = 0, down = 0, last = 0, prev = null;
  for (const x of values) {
    if (prev !== null) {
      const side = x > prev ? 1 : x < prev ? -1 : last;
      if (side > 0) up++; else if (side < 0) down++; else { up += 0.5; down += 0.5; }
      last = side;
      if (up + down >= size) { buckets.push(Math.abs(up - down) / size); up = 0; down = 0; }
    }
    prev = x;
  }
  const tail = buckets.slice(-window);
  return { vpin: tail.length ? Math.round(1000 * tail.reduce((a, b) => a + b, 0) / tail.length) / 1000 : null, buckets: buckets.length, size };
}

export function lttb(points, threshold) {
  const n = points.length;
  if (threshold >= n || threshold < 3) return points.slice();
  const out = [points[0]];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const s = Math.floor((i + 1) * every) + 1, e = Math.min(Math.floor((i + 2) * every) + 1, n);
    let ax = 0, ay = 0;
    for (let j = s; j < e; j++) { ax += points[j].t; ay += points[j].v; }
    const len = e - s || 1;
    ax /= len; ay /= len;
    const rs = Math.floor(i * every) + 1, re = Math.floor((i + 1) * every) + 1;
    let best = -1, pick = rs;
    for (let j = rs; j < re; j++) {
      const area = Math.abs((points[a].t - ax) * (points[j].v - points[a].v) - (points[a].t - points[j].t) * (ay - points[a].v));
      if (area > best) { best = area; pick = j; }
    }
    out.push(points[pick]);
    a = pick;
  }
  out.push(points[n - 1]);
  return out;
}

// One pass over a series: running stats, EWMA, online anomalies (|z| > limit once `warm` values are seen).
export function analyse(points, { alpha = 0.1, limit = 3, warm = 30 } = {}) {
  let s = welford(), e = null;
  const anomalies = [];
  for (const p of points) {
    const z = s.n >= warm ? zscore(s, p.v) : 0;
    if (Math.abs(z) > limit) anomalies.push({ t: p.t, v: p.v, z: Math.round(z * 100) / 100 });
    s = welfordPush(s, p.v);
    e = ewmaPush(e, p.v, alpha);
  }
  const r = x => Math.round(x * 1000) / 1000;
  return { n: s.n, mean: r(s.mean), sd: r(stdev(s)), ewma: e == null ? null : r(e), anomalies, ...vpin(points.map(p => p.v)) };
}
