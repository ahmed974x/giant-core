// Read-only client for the OMEGA web app's public /api routes and the private SearXNG search (ADR-056).
// Both must be on this machine (loopback). Nothing here holds a PIN or a key, so PIN-gated routes are out of reach.
import { OmegaError } from "./omega.js";

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 3_000_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function loopbackUrl(raw: string | undefined, fallback: string, name: string): URL {
  const url = new URL(raw?.trim() ? raw.trim() : fallback);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OmegaError(`${name} must be http(s)`);
  if (!LOOPBACK.has(url.hostname)) throw new OmegaError(`${name} must point at this machine (127.0.0.1 or localhost)`);
  if (url.username || url.password) throw new OmegaError(`${name} must not contain credentials`);
  url.pathname = "/"; url.search = ""; url.hash = "";
  return url;
}

async function getJson(base: URL, path: string, what: string): Promise<unknown> {
  const url = new URL(path, base);
  let res: Response;
  try { res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } }); }
  catch { throw new OmegaError(`${what} is not answering at ${base.origin}. Is the OMEGA site (or SearXNG) running?`); }
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new OmegaError(`${what} answered with too much data`);
  if (!res.ok) throw new OmegaError(`${what} answered ${res.status}`);
  try { return JSON.parse(text); } catch { throw new OmegaError(`${what} did not answer with JSON`); }
}

export type SearchHit = { title: string; url: string; snippet: string; engines: string[] };

export class SiteClient {
  constructor(private site: URL, private search: URL) {}
  get = (path: string, what: string) => getJson(this.site, path, what) as Promise<Record<string, unknown>>;

  /** Web search through the private SearXNG (Google, Bing, DuckDuckGo, Brave, Wikipedia). Results are untrusted text. */
  async webSearch(query: string, limit: number): Promise<SearchHit[]> {
    const q = new URLSearchParams({ q: query, format: "json", safesearch: "1" });
    const j = await getJson(this.search, `/search?${q}`, "SearXNG") as { results?: { title?: string; url?: string; content?: string; engines?: string[] }[] };
    return (j.results ?? []).filter(r => r.url?.startsWith("http")).slice(0, limit).map(r => ({
      title: String(r.title ?? "").slice(0, 200), url: r.url!, snippet: String(r.content ?? "").slice(0, 400), engines: r.engines ?? [],
    }));
  }
}

/** Keep tool results small: cap every array, so a busy feed can't flood the conversation. */
export function trim(value: unknown, maxItems = 30): unknown {
  if (Array.isArray(value)) return value.slice(0, maxItems).map(v => trim(v, maxItems));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "equity" ? undefined : trim(v, maxItems)]));
  return value;
}
