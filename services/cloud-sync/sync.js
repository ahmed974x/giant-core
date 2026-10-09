// OMEGA cloud-sync: mirror the laptop's public market signals into Supabase (public.omega_* tables).
// Zero dependencies: reads the relay's read-only API, upserts through Supabase's REST API (PostgREST).
//   every minute   anomalies, whales, news (last 100 each) + the quant and neural snapshots
//   every 6 hours  omega_prune() keeps 14 days of snapshots
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_… or a legacy service_role JWT) in .env.
"use strict";

const API = (process.env.OMEGA_API_URL || "http://relay:8080").replace(/\/$/, "");
const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY || "";
const EVERY_MS = 60_000, PRUNE_EVERY_MS = 6 * 3600_000;

// Columns each mirror table accepts; anything else from the relay is dropped before it leaves the laptop.
const TABLES = {
  anomalies: { view: "anomalies?order=ts.desc&limit=100", cols: ["id", "ts", "symbol", "kind", "severity", "price", "zscore", "reason"] },
  whales: { view: "whales?order=ts.desc&limit=100", cols: ["id", "ts", "chain", "asset", "amount", "usd_value", "from_entity", "to_entity", "verdict", "severity", "tx_hash"] },
  news: { view: "news?order=published_at.desc&limit=100", cols: ["id", "published_at", "source", "title", "url", "symbols", "sentiment", "impact", "label"] },
};

const pick = (row, cols) => Object.fromEntries(cols.map(c => [c, row[c] ?? null]));

function headers(extra = {}) {
  const h = { apikey: SB_KEY, "Content-Type": "application/json", ...extra };
  if (SB_KEY.startsWith("eyJ")) h.Authorization = `Bearer ${SB_KEY}`;   // legacy JWT keys also go in Authorization
  return h;
}

async function getJson(path) {
  const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

async function upsert(table, rows) {
  if (!rows.length) return 0;
  const r = await fetch(`${SB_URL}/rest/v1/omega_${table}`, {
    method: "POST", body: JSON.stringify(rows), signal: AbortSignal.timeout(15000),
    headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
  });
  if (!r.ok) throw new Error(`supabase ${table} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return rows.length;
}

/** One sync pass. Returns {table: rowsSent} and never throws for a single failing source. */
async function syncOnce() {
  const sent = {};
  for (const [table, t] of Object.entries(TABLES)) {
    try { sent[table] = await upsert(table, (await getJson(`/api/${t.view}`)).map(r => pick(r, t.cols))); }
    catch (e) { sent[table] = `error: ${e.message}`; }
  }
  const snaps = [];
  for (const engine of ["quant", "neural"]) {
    try { const s = await getJson(`/${engine}`); if (s && s.at) snaps.push({ engine, at: s.at, source: s.source || "live", body: s }); }
    catch { /* the neural engine is opt-in; a missing one is normal */ }
  }
  try { sent.snapshots = await upsert("snapshots", snaps); } catch (e) { sent.snapshots = `error: ${e.message}`; }
  return sent;
}

async function prune() {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/omega_prune`, { method: "POST", body: "{}", headers: headers(), signal: AbortSignal.timeout(15000) });
  return r.ok ? r.json() : `error ${r.status}`;
}

if (require.main === module) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SB_URL) || SB_KEY.length < 20) {
    console.error("cloud-sync: set SUPABASE_URL (https://<ref>.supabase.co) and SUPABASE_SECRET_KEY in .env");
    process.exit(1);
  }
  const tick = () => syncOnce().then(s => console.log(new Date().toISOString(), JSON.stringify(s)));
  tick(); setInterval(tick, EVERY_MS);
  setInterval(() => prune().then(n => console.log("pruned snapshots:", n)), PRUNE_EVERY_MS);
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
}

module.exports = { syncOnce, pick, headers, TABLES };
