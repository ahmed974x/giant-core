// Immich (ADR-030): Ahmad's self-hosted photo library, reached through its REST API with an API key from web/.env.local.
// Pinned to the Immich v3 API (checked against the v3.3.1 OpenAPI spec). Nothing here works until Docker runs Immich.
export type Photo = { id: string; name: string; type: string; takenAt: string; width: number | null; height: number | null };
type Env = Record<string, string | undefined>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function immichConfig(env: Env = process.env): { url: string; key: string } | null {
  const url = env.IMMICH_URL?.trim().replace(/\/+$/, ""), key = env.IMMICH_API_KEY?.trim();
  if (!url || !key) return null;
  const u = new URL(url);
  // Immich runs on this laptop; never send the key anywhere else.
  if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) throw new Error("IMMICH_URL must point at this laptop");
  return { url, key };
}

export async function ping(env: Env = process.env, f: typeof fetch = fetch): Promise<boolean> {
  const url = env.IMMICH_URL?.trim().replace(/\/+$/, "");
  if (!url) return false;
  try { return (await f(`${url}/api/server/ping`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

export async function recentPhotos(limit = 60, env: Env = process.env, f: typeof fetch = fetch): Promise<Photo[]> {
  const c = immichConfig(env);
  if (!c) throw new Error("Immich is not configured (IMMICH_URL, IMMICH_API_KEY)");
  const r = await f(`${c.url}/api/search/metadata`, {
    method: "POST", signal: AbortSignal.timeout(8000),
    headers: { "x-api-key": c.key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ size: Math.min(Math.max(limit, 1), 200), withExif: false }),
  });
  if (!r.ok) throw new Error(`Immich answered ${r.status}`);
  const j = await r.json() as { assets?: { items?: Record<string, unknown>[] } };
  return (j.assets?.items ?? []).map(a => ({
    id: String(a.id), name: String(a.originalFileName ?? ""), type: String(a.type ?? "IMAGE"),
    takenAt: String(a.localDateTime ?? a.fileCreatedAt ?? ""), width: (a.width as number) ?? null, height: (a.height as number) ?? null,
  }));
}

export async function thumbnail(id: string, env: Env = process.env, f: typeof fetch = fetch): Promise<Response> {
  if (!UUID.test(id)) throw new Error("bad id");
  const c = immichConfig(env);
  if (!c) throw new Error("Immich is not configured");
  return f(`${c.url}/api/assets/${id}/thumbnail?size=thumbnail`, { headers: { "x-api-key": c.key }, signal: AbortSignal.timeout(8000) });
}

/** Upload a photo that came in through the phone intake. Best effort: the intake never fails because of Immich. */
export async function uploadPhoto(bytes: Uint8Array, name: string, mime: string, env: Env = process.env, f: typeof fetch = fetch): Promise<string | null> {
  const c = immichConfig(env);
  if (!c) return null;
  const now = new Date().toISOString(), form = new FormData();
  form.set("assetData", new Blob([new Uint8Array(bytes)], { type: mime }), name);
  form.set("fileCreatedAt", now); form.set("fileModifiedAt", now); form.set("filename", name);
  const r = await f(`${c.url}/api/assets`, { method: "POST", body: form, headers: { "x-api-key": c.key, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return null;
  return String((await r.json() as { id?: string }).id ?? "") || null;
}
