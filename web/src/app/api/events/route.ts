// World events from GDELT 2.0 (public, keyless): the 15-minute "events" export, geocoded from global news.
// The server keeps the last hour (four exports) in memory and serves the most-reported geolocated events.
// GDELT asks for gentle use, so the index is checked at most every 5 minutes and each file is fetched once.
import { inflateRawSync } from "node:zlib";

export type WorldEvent = { id: string; lat: number; lon: number; place: string; category: string; code: string; quad: number;
  goldstein: number; tone: number; mentions: number; url: string; at: string };

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

/** A GDELT export zip holds exactly one deflated CSV; read its local header and inflate it. */
function unzipSingle(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip");
  const method = buf.readUInt16LE(8), nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  let size = buf.readUInt32LE(18);
  const start = 30 + nameLen + extraLen;
  if (size === 0) size = buf.length - start; // sizes stored in a data descriptor; inflate stops at the stream end
  const body = buf.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(body) : body).toString("utf8");
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
      goldstein: Number(c[30]), mentions: Number(c[31]), tone: Math.round(Number(c[34]) * 10) / 10, url, at: stamp });
  }
  return out;
}

async function refresh() {
  const idx = await fetch("https://data.gdeltproject.org/gdeltv2/lastupdate.txt", { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!idx.ok) throw new Error(`gdelt index ${idx.status}`);
  const url = (await idx.text()).split("\n")[0]?.split(" ")[2]?.trim().replace(/^http:/, "https:");
  if (!url || files.has(url)) return;
  const zip = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!zip.ok) throw new Error(`gdelt export ${zip.status}`);
  const m = url.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const stamp = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : new Date().toISOString();
  files.set(url, parse(unzipSingle(Buffer.from(await zip.arrayBuffer())), stamp));
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
