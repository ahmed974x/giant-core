// World events from GDELT 2.0 (public, keyless): the 15-minute "events" export, geocoded from global news.
// The server keeps the last hour (four exports) in memory and serves the most-reported geolocated events.
// GDELT asks for gentle use, so the index is checked at most every 5 minutes and each file is fetched once.
import { fetchCsv, latestUrl, stampOf } from "@/lib/gdelt";

export type WorldEvent = { id: string; lat: number; lon: number; place: string; category: string; code: string; quad: number;
  goldstein: number; tone: number; mentions: number; sources: number; url: string; at: string };

const KEEP_FILES = 4;
const files = new Map<string, WorldEvent[]>(); // export URL -> parsed events
let checkedAt = 0;
let pending: Promise<void> | null = null;

// CAMEO root codes grouped into a few readable buckets.
function category(root: string): string {
  const r = Number(root);
  if (r === 14) return "protest";
  if (r >= 18) return "conflict";
  if (r >= 13) return "tension";
  if (r <= 8) return "cooperation";
  return "other";
}

function parse(csv: string, stamp: string): WorldEvent[] {
  const seen = new Set<string>(), out: WorldEvent[] = [];
  for (const line of csv.split("\n")) {
    const c = line.split("\t");
    if (c.length < 61) continue;
    const lat = Number(c[56]), lon = Number(c[57]), url = c[60]?.trim();
    if (!c[56] || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || !url?.startsWith("http")) continue;
    if (seen.has(url)) continue; // one story often yields several coded events; show it once
    seen.add(url);
    out.push({ id: c[0], lat, lon, place: c[52], code: c[26], category: category(c[28]), quad: Number(c[29]),
      goldstein: Number(c[30]), mentions: Number(c[31]), sources: Number(c[32]) || 1, tone: Math.round(Number(c[34]) * 10) / 10, url, at: stamp });
  }
  return out;
}

async function refresh() {
  const url = await latestUrl("export");
  if (files.has(url)) return;
  files.set(url, parse(await fetchCsv(url), stampOf(url)));
  while (files.size > KEEP_FILES) files.delete(files.keys().next().value!);
}

export async function GET() {
  if (Date.now() - checkedAt > 5 * 60_000 && !pending) {
    checkedAt = Date.now();
    pending = refresh().catch(() => { checkedAt = 0; }).finally(() => { pending = null; });
  }
  if (!files.size && pending) await pending;
  if (!files.size) return Response.json({ error: "GDELT unreachable" }, { status: 503 });
  const all = [...files.values()].flat().sort((a, b) => b.mentions - a.mentions || Math.abs(b.goldstein) - Math.abs(a.goldstein)).slice(0, 800);
  return Response.json({ source: "GDELT 2.0", window: `${files.size * 15} min`, count: all.length, events: all }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
