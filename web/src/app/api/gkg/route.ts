// GDELT 2.0 Global Knowledge Graph (public, keyless): who and what the world's news is talking about, and where.
// Each 15-minute GKG file (~1,000 articles, ~11 MB unzipped) is reduced on arrival to per-place hotspots with their
// top people, organisations and themes, plus global top entities. Only the aggregates are kept (last hour).
import { fetchCsv, latestUrl, stampOf } from "@/lib/gdelt";

type Agg = { place: string; lat: number; lon: number; articles: number; tone: number;
  persons: Map<string, number>; orgs: Map<string, number>; themes: Map<string, number>; url: string };
type FileAgg = { at: string; places: Map<string, Agg>; persons: Map<string, number>; orgs: Map<string, number> };

export type Hotspot = { id: string; place: string; lat: number; lon: number; articles: number; tone: number;
  persons: string[]; orgs: string[]; themes: string[]; url: string };

const KEEP = 4;
const files = new Map<string, FileAgg>();
let checkedAt = 0;
let pending: Promise<void> | null = null;

const bump = (m: Map<string, number>, k: string, n = 1) => { if (k) m.set(k, (m.get(k) ?? 0) + n); };
const top = (m: Map<string, number>, n: number, min = 1) => [...m.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
// People are only surfaced once several articles name them: public figures in the news, not someone named once in a
// local story (ADR 006: no profiling of individuals).
const PERSON_MIN_HOTSPOT = 2, PERSON_MIN_GLOBAL = 3;
// GKG themes look like "ECON_OILPRICE" or "TAX_FNCACT_PRESIDENT"; keep a readable tail.
const theme = (t: string) => t.replace(/^(TAX_|WB_\d+_|CRISISLEX_|UNGP_|SOC_|EPU_)/, "").replace(/_/g, " ").toLowerCase();

function reduce(csv: string, at: string): FileAgg {
  const out: FileAgg = { at, places: new Map(), persons: new Map(), orgs: new Map() };
  for (const line of csv.split("\n")) {
    const c = line.split("\t");
    if (c.length < 16) continue;
    const url = c[4]?.trim();
    const persons = (c[11] || "").split(";").filter(Boolean);
    const orgs = (c[13] || "").split(";").filter(Boolean);
    const themes = (c[7] || "").split(";").filter(Boolean).slice(0, 12).map(theme);
    const tone = Number((c[15] || "").split(",")[0]) || 0;
    persons.forEach(p => bump(out.persons, p));
    orgs.forEach(o => bump(out.orgs, o));
    const seen = new Set<string>();
    for (const loc of (c[10] || "").split(";")) {
      const f = loc.split("#");
      const lat = Number(f[5]), lon = Number(f[6]);
      if (f.length < 8 || !f[5] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const key = f[7] || `${lat.toFixed(2)},${lon.toFixed(2)}`;
      if (seen.has(key)) continue;                         // count each article once per place
      seen.add(key);
      const a = out.places.get(key) ?? { place: f[1], lat, lon, articles: 0, tone: 0, persons: new Map(), orgs: new Map(), themes: new Map(), url: url ?? "" };
      a.articles += 1;
      a.tone += tone;
      persons.forEach(p => bump(a.persons, p));
      orgs.forEach(o => bump(a.orgs, o));
      themes.forEach(t => bump(a.themes, t));
      out.places.set(key, a);
    }
  }
  return out;
}

async function refresh() {
  const url = await latestUrl("gkg");
  if (files.has(url)) return;
  files.set(url, reduce(await fetchCsv(url), stampOf(url)));
  while (files.size > KEEP) files.delete(files.keys().next().value!);
}

export async function GET() {
  if (Date.now() - checkedAt > 5 * 60_000 && !pending) {
    checkedAt = Date.now();
    pending = refresh().catch(() => { checkedAt = 0; }).finally(() => { pending = null; });
  }
  if (!files.size && pending) await pending;
  if (!files.size) return Response.json({ error: "GDELT GKG unreachable" }, { status: 503 });

  // Merge the kept files: same place across files adds up.
  const merged = new Map<string, Agg>(), persons = new Map<string, number>(), orgs = new Map<string, number>();
  for (const f of files.values()) {
    f.persons.forEach((n, k) => bump(persons, k, n));
    f.orgs.forEach((n, k) => bump(orgs, k, n));
    for (const [key, a] of f.places) {
      const m = merged.get(key) ?? { ...a, articles: 0, tone: 0, persons: new Map(), orgs: new Map(), themes: new Map() };
      m.articles += a.articles; m.tone += a.tone;
      a.persons.forEach((n, k) => bump(m.persons, k, n));
      a.orgs.forEach((n, k) => bump(m.orgs, k, n));
      a.themes.forEach((n, k) => bump(m.themes, k, n));
      merged.set(key, m);
    }
  }
  const hotspots: Hotspot[] = [...merged.entries()].sort((a, b) => b[1].articles - a[1].articles).slice(0, 400).map(([id, a]) => ({
    id, place: a.place, lat: a.lat, lon: a.lon, articles: a.articles, tone: Math.round((a.tone / a.articles) * 10) / 10,
    persons: top(a.persons, 5, PERSON_MIN_HOTSPOT), orgs: top(a.orgs, 5), themes: top(a.themes, 5), url: a.url,
  }));
  return Response.json({ source: "GDELT 2.0 GKG", window: `${files.size * 15} min`, count: hotspots.length,
    topPersons: top(persons, 12, PERSON_MIN_GLOBAL), topOrgs: top(orgs, 12), hotspots }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
