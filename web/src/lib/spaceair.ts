// More God's Eye View layers (ADR-053), all keyless:
// - Military aircraft: adsb.lol's /v2/mil list (community ADS-B, ODbL); only aircraft that broadcast publicly.
// - Rocket launches: The Space Devs' Launch Library 2 (free tier, about 15 calls an hour, so cached for an hour).
// - Tropical cyclones: NOAA National Hurricane Center's CurrentStorms.json (Atlantic and East Pacific).
export type MilAircraft = { id: string; callsign: string | null; reg: string | null; type: string | null; lat: number; lon: number; altFt: number | null; speedKt: number | null; track: number };
export type Launch = { id: string; name: string; net: string; status: string; provider: string | null; pad: string | null; location: string | null; lat: number; lon: number; url: string; webcast: boolean };
export type Storm = { id: string; kind: "cyclone"; title: string; lat: number; lon: number; mag: number | null; at: string; url: string | null; source: "NOAA NHC" };

type MilAc = { hex?: string; flight?: string; r?: string; t?: string; lat?: number; lon?: number; alt_baro?: number | string; gs?: number; track?: number };
export function parseMil(j: unknown): MilAircraft[] {
  const out: MilAircraft[] = [];
  for (const a of (j as { ac?: MilAc[] })?.ac ?? []) {
    if (typeof a.lat !== "number" || typeof a.lon !== "number" || !a.hex) continue;
    out.push({ id: a.hex, callsign: a.flight?.trim() || null, reg: a.r ?? null, type: a.t ?? null, lat: a.lat, lon: a.lon,
      altFt: typeof a.alt_baro === "number" ? a.alt_baro : null, speedKt: a.gs ?? null, track: a.track ?? 0 });
  }
  return out;
}

type Ll2 = { id: string; name: string; net: string; status?: { abbrev?: string }; launch_service_provider?: { name?: string };
  pad?: { name?: string; latitude?: number | string; longitude?: number | string; location?: { name?: string } }; url: string; webcast_live?: boolean };
export function parseLaunches(j: unknown): Launch[] {
  const out: Launch[] = [];
  for (const l of (j as { results?: Ll2[] })?.results ?? []) {
    const lat = Number(l.pad?.latitude), lon = Number(l.pad?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ id: l.id, name: l.name, net: l.net, status: l.status?.abbrev ?? "?", provider: l.launch_service_provider?.name ?? null, pad: l.pad?.name ?? null,
      location: l.pad?.location?.name ?? null, lat, lon, url: `https://thespacedevs.com/llapi`, webcast: !!l.webcast_live });
  }
  return out;
}

type NhcStorm = { id: string; name: string; classification: string; intensity: string; latitudeNumeric: number; longitudeNumeric: number; lastUpdate: string };
const NHC_CLASS: Record<string, string> = { HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", STD: "Subtropical Depression", PTC: "Post-Tropical Cyclone", PC: "Potential Cyclone" };
export function parseNhc(j: unknown): Storm[] {
  return ((j as { activeStorms?: NhcStorm[] })?.activeStorms ?? []).filter(s => Number.isFinite(s.latitudeNumeric) && Number.isFinite(s.longitudeNumeric)).map(s => ({
    id: `nhc-${s.id}`, kind: "cyclone" as const, title: `${NHC_CLASS[s.classification] ?? s.classification} ${s.name} (${s.intensity} kt)`,
    lat: s.latitudeNumeric, lon: s.longitudeNumeric, mag: Number(s.intensity) || null, at: s.lastUpdate, url: "https://www.nhc.noaa.gov/", source: "NOAA NHC" as const,
  }));
}

const memo = <T,>(ttl: number, fn: () => Promise<T>) => {
  let v: { at: number; data: T } | null = null, p: Promise<T> | null = null;
  return async () => {
    if (v && Date.now() - v.at < ttl) return v.data;
    p ??= fn().then(d => { v = { at: Date.now(), data: d }; return d; }).catch(e => { if (v) return v.data; throw e; }).finally(() => { p = null; });
    return p;
  };
};
const get = (u: string) => fetch(u, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "omega-prime/0.1", Accept: "application/json" } })
  .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });

export const military = memo(20_000, async () => parseMil(await get("https://api.adsb.lol/v2/mil")));
export const launches = memo(3600_000, async () => parseLaunches(await get("https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=15&mode=normal")));
export const storms = memo(15 * 60_000, async () => parseNhc(await get("https://www.nhc.noaa.gov/CurrentStorms.json")));
