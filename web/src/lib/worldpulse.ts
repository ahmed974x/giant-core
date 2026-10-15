// World Pulse (ADR-048): a bot that reads keyless official feeds for events that move markets and says which assets
// each one tends to push, with the evidence (where, when, source link) so Ahmad can check it with his own eyes.
// - GDACS (UN + European Commission JRC): current orange/red alerts for earthquakes, cyclones, floods, volcanoes,
//   wildfires and droughts.
// - USGS: earthquakes of magnitude 6 and above in the last day.
// - GDELT 2.0: conflict events in the news, kept only when widely reported and in market-sensitive regions.
// The asset directions are rules of thumb from how markets usually react, not forecasts. Signals only: nothing here
// trades or proposes an order.
export type Asset = "oil" | "gas" | "gold" | "usd" | "btc" | "stocks" | "grain" | "shipping";
export type Dir = "up" | "down";
export type Driver = {
  id: string; source: "GDACS" | "USGS" | "GDELT"; kind: string; title: string; region: string; severity: 1 | 2 | 3;
  lat: number; lon: number; at: string; url: string | null; assets: { asset: Asset; dir: Dir }[];
};

type Box = { id: string; s: number; w: number; n: number; e: number };
// Regions where events have a known market channel (rough boxes, south/west/north/east).
const REGIONS: Box[] = [
  { id: "gulf", s: 12, w: 32, n: 38, e: 63 },           // Gulf, Hormuz, Red Sea, Bab el-Mandeb, Iran, Iraq
  { id: "us-gulf-coast", s: 18, w: -98, n: 31, e: -80 },// US refining coast, Gulf of Mexico rigs
  { id: "black-sea", s: 40, w: 27, n: 53, e: 42 },      // Ukraine, Russia's grain and oil ports
  { id: "east-asia", s: 20, w: 115, n: 46, e: 146 },    // Taiwan, Japan, Korea: chips and the yen
  { id: "russia", s: 50, w: 27, n: 70, e: 90 },
];
export const regionOf = (lat: number, lon: number) => REGIONS.find(r => lat >= r.s && lat <= r.n && lon >= r.w && lon <= r.e)?.id ?? "world";

/** Which way markets usually lean after this kind of event in this region. */
export function impact(kind: string, region: string, severity: number): { asset: Asset; dir: Dir }[] {
  const out: { asset: Asset; dir: Dir }[] = [];
  const add = (asset: Asset, dir: Dir) => { if (!out.some(x => x.asset === asset)) out.push({ asset, dir }); };
  if (region === "gulf") { add("oil", "up"); add("gas", "up"); add("shipping", "up"); add("gold", "up"); }
  if (region === "us-gulf-coast" && (kind === "cyclone" || kind === "flood")) { add("oil", "up"); add("gas", "up"); }
  if (region === "black-sea") { add("grain", "up"); add("gas", "up"); add("oil", "up"); }
  if (region === "russia" && kind === "conflict") { add("oil", "up"); add("gas", "up"); }
  if (region === "east-asia" && (kind === "earthquake" || kind === "conflict")) { add("stocks", "down"); add("usd", "up"); }
  if (kind === "drought") add("grain", "up");
  if (kind === "conflict" || severity === 3) { add("gold", "up"); add("btc", "down"); add("stocks", "down"); }
  return out;
}

type GdacsFeature = { geometry?: { coordinates?: number[] }; properties?: { eventtype?: string; eventid?: number; name?: string; alertlevel?: string;
  iscurrent?: boolean | string; country?: string; fromdate?: string; todate?: string; url?: { report?: string } } };
const GDACS_KIND: Record<string, string> = { EQ: "earthquake", TC: "cyclone", FL: "flood", VO: "volcano", WF: "wildfire", DR: "drought" };

export function fromGdacs(j: unknown): Driver[] {
  const out: Driver[] = [];
  for (const f of (j as { features?: GdacsFeature[] })?.features ?? []) {
    const p = f.properties ?? {}, [lon, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (!(p.iscurrent === true || p.iscurrent === "true")) continue;
    const severity = p.alertlevel === "Red" ? 3 : p.alertlevel === "Orange" ? 2 : 1;
    if (severity < 2) continue;
    const kind = GDACS_KIND[p.eventtype ?? ""] ?? "disaster", region = regionOf(lat, lon);
    out.push({ id: `gdacs-${p.eventtype}-${p.eventid}`, source: "GDACS", kind, title: `${p.name ?? kind}${p.country ? ` (${p.country})` : ""}`,
      region, severity, lat, lon, at: p.todate ?? p.fromdate ?? "", url: p.url?.report ?? null, assets: impact(kind, region, severity) });
  }
  return out;
}

type Hz = { id: string; kind: string; title: string; lat: number; lon: number; mag: number | null; at: string; url: string | null; source: string };
export function fromUsgs(hazards: Hz[]): Driver[] {
  return hazards.filter(h => h.source === "USGS" && (h.mag ?? 0) >= 6).map(h => {
    const severity = (h.mag ?? 0) >= 7 ? 3 : 2, region = regionOf(h.lat, h.lon);
    return { id: h.id, source: "USGS" as const, kind: "earthquake", title: `M${h.mag} ${h.title}`, region, severity: severity as 2 | 3,
      lat: h.lat, lon: h.lon, at: h.at, url: h.url, assets: impact("earthquake", region, severity) };
  });
}

type Ev = { id: string; lat: number; lon: number; place: string; category: string; mentions: number; sources: number; url: string; at: string; truth?: { status: string } };
/** News-reported conflict in a market-sensitive region, widely reported; the most-reported few per region. */
export function fromGdelt(events: Ev[], perRegion = 3): Driver[] {
  const byRegion = new Map<string, Ev[]>();
  for (const e of events) {
    if (e.category !== "conflict" || e.sources < 3) continue;
    const r = regionOf(e.lat, e.lon);
    if (r === "world") continue;
    byRegion.set(r, [...(byRegion.get(r) ?? []), e]);
  }
  const out: Driver[] = [];
  for (const [region, list] of byRegion) {
    for (const e of list.sort((a, b) => b.mentions - a.mentions).slice(0, perRegion)) {
      const severity = e.mentions >= 50 ? 3 : 2;
      out.push({ id: `gdelt-${e.id}`, source: "GDELT", kind: "conflict", title: e.place, region, severity, lat: e.lat, lon: e.lon,
        at: e.at, url: e.url, assets: impact("conflict", region, severity) });
    }
  }
  return out;
}

export type Lean = { asset: Asset; up: number; down: number; net: number };
/** Sum each asset's pushes, weighted by severity, so the screen can show which way the news is leaning. */
export function lean(drivers: Driver[]): Lean[] {
  const m = new Map<Asset, Lean>();
  for (const d of drivers) for (const a of d.assets) {
    const l = m.get(a.asset) ?? { asset: a.asset, up: 0, down: 0, net: 0 };
    if (a.dir === "up") l.up += d.severity; else l.down += d.severity;
    l.net = l.up - l.down;
    m.set(a.asset, l);
  }
  return [...m.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

export async function readGdacs(f: typeof fetch = fetch): Promise<Driver[]> {
  try {
    const r = await f("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Orange;Red", { signal: AbortSignal.timeout(15_000) });
    return r.ok ? fromGdacs(await r.json()) : [];
  } catch { return []; }
}
