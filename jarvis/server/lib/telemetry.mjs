// Telemetry on the server (ADR-147), in the process: no child process. Points go into telemetry_points; each
// metric's Welford state (n, mean, M2), EWMA and anomaly count live in telemetry_state and are updated in O(1)
// per point. A series is read back, analysed in one pass (timeseries.mjs) and downsampled with LTTB.
import { StoreError } from "./store.mjs";
import { welfordPush, ewmaPush, zscore, stdev, analyse, lttb } from "./timeseries.mjs";

export const METRIC_RE = /^[a-z][a-z0-9_.]{0,63}$/;
const MAX_BATCH = 1000, MAX_READ = 20000, KEEP = 50000, LIMIT = 3, WARM = 30;
const bad = (msg, status = 400) => { throw new StoreError(status, msg); };

export function createTelemetry({ db, store }) {
  const chains = new Map();
  async function recordInto(wid, points) {
    const by = new Map();
    for (const p of points) {
      const metric = String(p && p.metric || "");
      const value = Number(p && p.value), t = p && p.t != null ? Number(p.t) : Date.now();
      if (!METRIC_RE.test(metric)) bad("A metric name is lower-case letters, digits, dots and underscores, at most 64 characters.");
      if (!Number.isFinite(value) || Math.abs(value) > 1e12) bad("A value must be a finite number.");
      if (!Number.isFinite(t) || t < 0) bad("A time must be a finite number of milliseconds.");
      if (!by.has(metric)) by.set(metric, []);
      by.get(metric).push({ t, v: value });
    }
    const out = { recorded: 0, anomalies: [] };
    for (const [metric, pts] of by) {
      pts.sort((a, b) => a.t - b.t);
      const row = await db.one("select * from telemetry_state where workspace_id = $1 and metric = $2", [wid, metric]);
      let s = row ? { n: Number(row.n), mean: Number(row.mean), m2: Number(row.m2) } : { n: 0, mean: 0, m2: 0 };
      let e = row && row.ewma != null ? Number(row.ewma) : null, anomalies = row ? Number(row.anomalies) : 0;
      for (const p of pts) {
        const z = s.n >= WARM ? zscore(s, p.v) : 0;
        if (Math.abs(z) > LIMIT) { anomalies++; out.anomalies.push({ metric, t: p.t, v: p.v, z: Math.round(z * 100) / 100 }); }
        s = welfordPush(s, p.v); e = ewmaPush(e, p.v);
        await db.run("insert into telemetry_points (workspace_id, metric, t, value) values ($1, $2, $3, $4)", [wid, metric, p.t, p.v]);
        out.recorded++;
      }
      if (row) await db.run("update telemetry_state set n = $3, mean = $4, m2 = $5, ewma = $6, anomalies = $7, last_t = $8 where workspace_id = $1 and metric = $2", [wid, metric, s.n, s.mean, Math.max(0, s.m2), e, anomalies, pts[pts.length - 1].t]);
      else await db.run("insert into telemetry_state (workspace_id, metric, n, mean, m2, ewma, anomalies, last_t) values ($1, $2, $3, $4, $5, $6, $7, $8)", [wid, metric, s.n, s.mean, Math.max(0, s.m2), e, anomalies, pts[pts.length - 1].t]);
      const c = Number((await db.one("select count(*) as c from telemetry_points where workspace_id = $1 and metric = $2", [wid, metric])).c);
      if (c > KEEP) await db.run("delete from telemetry_points where id in (select id from telemetry_points where workspace_id = $1 and metric = $2 order by t limit " + (c - KEEP) + ")", [wid, metric]);
    }
    return out;
  }
  const api = {
    async record(slug, body) {
      const points = Array.isArray(body && body.points) ? body.points : [body];
      if (!points.length || points.length > MAX_BATCH) bad("Send 1 to 1,000 points.");
      const wid = await store.workspaceIdOf(slug);
      const run = () => recordInto(wid, points);
      const p = (chains.get(wid) || Promise.resolve()).then(run, run);
      chains.set(wid, p.catch(() => {}));
      return p;
    },
    async metrics(slug) {
      const wid = await store.workspaceIdOf(slug);
      return (await db.all("select * from telemetry_state where workspace_id = $1 order by metric", [wid])).map(r => {
        const s = { n: Number(r.n), mean: Number(r.mean), m2: Number(r.m2) };
        return { metric: r.metric, n: s.n, mean: Math.round(s.mean * 1000) / 1000, sd: Math.round(stdev(s) * 1000) / 1000, ewma: r.ewma == null ? null : Math.round(Number(r.ewma) * 1000) / 1000, anomalies: Number(r.anomalies), lastT: r.last_t == null ? null : Number(r.last_t) };
      });
    },
    async series(slug, metric, threshold) {
      if (!METRIC_RE.test(String(metric || ""))) bad("Name a metric.");
      const wid = await store.workspaceIdOf(slug);
      const th = Math.max(3, Math.min(1000, Number(threshold) || 120));
      const rows = await db.all("select t, value from (select t, value from telemetry_points where workspace_id = $1 and metric = $2 order by t desc limit " + MAX_READ + ") x order by t", [wid, metric]);
      const pts = rows.map(r => ({ t: Number(r.t), v: Number(r.value) }));
      const a = analyse(pts, { limit: LIMIT, warm: WARM });
      return { metric, raw: pts.length, threshold: th, points: lttb(pts, th), stats: { n: a.n, mean: a.mean, sd: a.sd, ewma: a.ewma, vpin: a.vpin, buckets: a.buckets }, anomalies: a.anomalies.slice(-50) };
    },
  };
  return api;
}
