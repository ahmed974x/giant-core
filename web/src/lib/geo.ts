// Shared request parsing for the live map layers.
export type View = { lat: number; lon: number; radiusKm: number };

export function parseView(url: string, maxKm: number): View | null {
  const q = new URL(url).searchParams;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon")), km = Number(q.get("km") ?? 300);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat: round(lat, 1), lon: round(lon, 1), radiusKm: Math.min(maxKm, Math.max(10, Math.round(km / 25) * 25)) };
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Tiny TTL cache so many open tabs never multiply calls to the public feeds. */
export function ttlCache<T>(ttlMs: number, max = 64) {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load();
    value.catch(() => store.delete(key));
    store.set(key, { at: Date.now(), value });
    if (store.size > max) store.delete(store.keys().next().value!);
    return value;
  };
}
