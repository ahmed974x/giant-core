// Live AIS vessel positions from aisstream.io (free key in AISSTREAM_API_KEY).
// One WebSocket per server process, subscribed only to the watched choke-points so bandwidth and RAM stay small.
import { distanceKm } from "./geo.ts";

export type Ship = { mmsi: number; name: string | null; lat: number; lon: number; cog: number; sog: number; heading: number | null; at: number };

const BOXES: [[number, number], [number, number]][] = [
  [[23.0, 51.0], [30.0, 60.0]],   // Arabian Gulf + Hormuz
  [[11.0, 41.0], [16.0, 46.0]],   // Bab-el-Mandeb
  [[27.0, 31.5], [32.0, 34.5]],   // Suez
  [[0.0, 97.0], [6.5, 105.0]],    // Malacca + Singapore
  [[7.5, -81.0], [10.5, -78.0]],  // Panama
];
const MAX_SHIPS = 4000;
const STALE_MS = 30 * 60_000;

const ships = new Map<number, Ship>();
// Ship type per MMSI from AIS static reports (types 80-89 are tankers); bounded like the position list.
const shipTypes = new Map<number, number>();
let socket: WebSocket | null = null;
let status: "off" | "connecting" | "live" | "error" = "off";
let retry: ReturnType<typeof setTimeout> | null = null;

function connect(key: string) {
  status = "connecting";
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: BOXES, FilterMessageTypes: ["PositionReport", "ShipStaticData"] }));
  ws.onmessage = async ev => {
    try {
      const text = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
      const m = JSON.parse(text);
      const st = m?.Message?.ShipStaticData;
      if (st && typeof st.UserID === "number" && typeof st.Type === "number") {
        shipTypes.set(st.UserID, st.Type);
        if (shipTypes.size > MAX_SHIPS * 2) shipTypes.delete(shipTypes.keys().next().value!);
        return;
      }
      const p = m?.Message?.PositionReport, meta = m?.MetaData;
      if (!p || !meta || typeof meta.latitude !== "number") return;
      status = "live";
      ships.set(meta.MMSI, {
        mmsi: meta.MMSI, name: String(meta.ShipName ?? "").trim() || null, lat: meta.latitude, lon: meta.longitude,
        cog: p.Cog ?? 0, sog: p.Sog ?? 0, heading: p.TrueHeading === 511 ? null : p.TrueHeading ?? null, at: Date.now(),
      });
      if (ships.size > MAX_SHIPS) ships.delete(ships.keys().next().value!);
    } catch { /* ignore malformed frames */ }
  };
  ws.onerror = () => { status = "error"; };
  ws.onclose = () => {
    socket = null;
    if (status !== "off") { status = "error"; retry = setTimeout(() => connect(key), 15_000); }
  };
}

export function aisStatus(): { configured: boolean; status: typeof status } {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) return { configured: false, status: "off" };
  if (!socket && !retry) connect(key);
  if (retry && socket) { clearTimeout(retry); retry = null; }
  return { configured: true, status };
}

export function shipsNear(lat: number, lon: number, radiusKm: number): Ship[] {
  const now = Date.now(), out: Ship[] = [];
  for (const s of ships.values()) {
    if (now - s.at > STALE_MS) { ships.delete(s.mmsi); continue; }
    if (distanceKm(lat, lon, s.lat, s.lon) <= radiusKm) out.push(s);
    if (out.length >= 2000) break;
  }
  return out;
}

// Keyless fallback (ADR-045): Finland's Digitraffic open AIS feed (CC BY 4.0, Fintraffic). It covers the Baltic Sea
// only, but needs no key, so ships show on the globe even before an AISStream key works. Fetched on demand, at most
// once a minute, and kept in its own small cache.
const OPEN_URL = "https://meri.digitraffic.fi/api/ais/v1/locations";
const OPEN_TTL_MS = 60_000;
let open: { at: number; ships: Ship[] } = { at: 0, ships: [] };
let openLoading: Promise<void> | null = null;

type OpenFeature = { mmsi?: number; geometry?: { coordinates?: [number, number] }; properties?: { sog?: number; cog?: number; heading?: number; timestampExternal?: number } };

export function parseOpenAis(j: unknown, now = Date.now()): Ship[] {
  const features = (j as { features?: OpenFeature[] })?.features;
  if (!Array.isArray(features)) return [];
  const out: Ship[] = [];
  for (const f of features) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const p = f.properties ?? {}, at = Number(p.timestampExternal);
    if (typeof lat !== "number" || typeof lon !== "number" || !f.mmsi || !(now - at < STALE_MS)) continue;
    out.push({ mmsi: f.mmsi, name: null, lat, lon, cog: p.cog ?? 0, sog: p.sog ?? 0, heading: p.heading == null || p.heading === 511 ? null : p.heading, at });
    if (out.length >= MAX_SHIPS) break;
  }
  return out;
}

export async function openShipsNear(lat: number, lon: number, radiusKm: number, f: typeof fetch = fetch): Promise<Ship[]> {
  if (Date.now() - open.at > OPEN_TTL_MS) {
    openLoading ??= f(OPEN_URL, { headers: { "Digitraffic-User": "OMEGA-PRIME/1.0", "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(15_000) })
      .then(r => (r.ok ? r.json() : null)).then(j => { open = { at: Date.now(), ships: parseOpenAis(j) }; })
      .catch(() => { open = { at: Date.now(), ships: open.ships }; })
      .finally(() => { openLoading = null; });
    await openLoading;
  }
  return open.ships.filter(s => distanceKm(lat, lon, s.lat, s.lon) <= radiusKm).slice(0, 2000);
}

// Hormuz tanker count for Oil Watch (ADR-047): tankers seen in the Strait of Hormuz box in the last 30 minutes, from
// AISStream (needs its key). Ship types arrive in separate static reports, so the count grows as they come in.
const HORMUZ: [[number, number], [number, number]] = [[25.0, 54.5], [27.5, 58.0]];
export function hormuzTankers(now = Date.now()): { tankers: number; moving: number; typed: number; seen: number } | null {
  if (!process.env.AISSTREAM_API_KEY || status !== "live") return null;
  let tankers = 0, moving = 0, typed = 0, seen = 0;
  for (const s of ships.values()) {
    if (now - s.at > STALE_MS || s.lat < HORMUZ[0][0] || s.lat > HORMUZ[1][0] || s.lon < HORMUZ[0][1] || s.lon > HORMUZ[1][1]) continue;
    seen++;
    const t = shipTypes.get(s.mmsi);
    if (t == null) continue;
    typed++;
    if (t >= 80 && t <= 89) { tankers++; if (s.sog >= 3) moving++; }
  }
  return { tankers, moving, typed, seen };
}
