// Live AIS vessel positions from aisstream.io (free key in AISSTREAM_API_KEY).
// One WebSocket per server process, subscribed only to the watched choke-points so bandwidth and RAM stay small.
import { distanceKm } from "./geo";

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
let socket: WebSocket | null = null;
let status: "off" | "connecting" | "live" | "error" = "off";
let retry: ReturnType<typeof setTimeout> | null = null;

function connect(key: string) {
  status = "connecting";
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: BOXES, FilterMessageTypes: ["PositionReport"] }));
  ws.onmessage = async ev => {
    try {
      const text = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
      const m = JSON.parse(text);
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
