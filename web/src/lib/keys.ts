// Data keys (ADR-041): which optional API keys are filled in, whether each one actually works, and hot-loading them
// from web/.env.local so a key added on the laptop takes effect without restarting the app. Key values never leave
// this file: callers only ever see set/unset, a length and a test verdict.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const KEYS = {
  NASA_FIRMS_KEY: { feed: "NASA FIRMS fires", signup: "https://firms.modaps.eosdis.nasa.gov/api/map_key/" },
  AISSTREAM_API_KEY: { feed: "AISStream ships", signup: "https://aisstream.io/apikeys" },
  WINDY_WEBCAMS_KEY: { feed: "Windy webcams", signup: "https://api.windy.com/keys" },
  FIRECRAWL_API_KEY: { feed: "Firecrawl page reader", signup: "https://www.firecrawl.dev/app/api-keys" },
} as const;
export type KeyName = keyof typeof KEYS;
export type Verdict = "ok" | "invalid" | "unreachable" | "not-set";
export type KeyStatus = { name: KeyName; feed: string; signup: string; set: boolean; length: number; loaded: boolean; verdict?: Verdict; detail?: string };

/** Parse KEY=value lines (no interpolation, quotes trimmed). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** .env.local, decrypted in memory with dotenvx when it is encrypted (ADR-042). Plain files still work. */
export async function readEnvFile(file = path.join(process.cwd(), ".env.local")): Promise<Record<string, string>> {
  let text: string;
  try { text = await readFile(file, "utf8"); } catch { return {}; }
  if (!text.includes("encrypted:")) return parseEnv(text);
  const { config } = await import("@dotenvx/dotenvx");
  const { defaultKeysFile } = await import("./security/check-secrets.ts");
  const out: Record<string, string> = {};
  config({ path: file, envKeysFile: defaultKeysFile(), processEnv: out, quiet: true, ignore: ["MISSING_ENV_FILE"] });
  return Object.fromEntries(Object.entries(out).filter(([, v]) => !v.startsWith("encrypted:")));
}

/** Status of every key from the file, and copy filled-in values into this process (only these four names). */
export function applyKeys(fileEnv: Record<string, string>, env: Record<string, string | undefined> = process.env): KeyStatus[] {
  return (Object.keys(KEYS) as KeyName[]).map(name => {
    const v = (fileEnv[name] ?? "").trim();
    if (v) env[name] = v;
    return { name, ...KEYS[name], set: Boolean(v), length: v.length, loaded: Boolean(v) && env[name] === v };
  });
}

type Fetch = typeof fetch;

export async function testFirms(key: string, f: Fetch = fetch): Promise<{ verdict: Verdict; detail: string }> {
  try {
    const r = await f(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_NOAA20_NRT/47,28,49,30/1`, { signal: AbortSignal.timeout(15_000) });
    const body = (await r.text()).slice(0, 300);
    if (r.ok && body.startsWith("latitude")) return { verdict: "ok", detail: `${Math.max(0, body.trim().split("\n").length - 1)} fire pixels in a test box` };
    return { verdict: /invalid|map_key|not valid/i.test(body) || r.status === 400 || r.status === 401 ? "invalid" : "unreachable", detail: body.split("\n")[0].slice(0, 120) || `HTTP ${r.status}` };
  } catch (e) { return { verdict: "unreachable", detail: (e as Error).message }; }
}

export async function testWindy(key: string, f: Fetch = fetch): Promise<{ verdict: Verdict; detail: string }> {
  try {
    const r = await f("https://api.windy.com/webcams/api/v3/webcams?limit=1", { headers: { "x-windy-api-key": key }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? { verdict: "ok", detail: "webcams answered" } : { verdict: r.status === 401 || r.status === 403 ? "invalid" : "unreachable", detail: `HTTP ${r.status}` };
  } catch (e) { return { verdict: "unreachable", detail: (e as Error).message }; }
}

export async function testFirecrawl(key: string, f: Fetch = fetch): Promise<{ verdict: Verdict; detail: string }> {
  try {
    const r = await f("https://api.firecrawl.dev/v2/team/credit-usage", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? { verdict: "ok", detail: "account answered" } : { verdict: r.status === 401 || r.status === 403 ? "invalid" : "unreachable", detail: `HTTP ${r.status}` };
  } catch (e) { return { verdict: "unreachable", detail: (e as Error).message }; }
}

/** AISStream: subscribe to a small box and wait for the first position report (or the server's error). */
export function testAis(key: string, timeoutMs = 20_000, WS: typeof WebSocket = WebSocket): Promise<{ verdict: Verdict; detail: string }> {
  return new Promise(resolve => {
    let done = false;
    const ws = new WS("wss://stream.aisstream.io/v0/stream");
    const finish = (v: { verdict: Verdict; detail: string }) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve(v); };
    const timer = setTimeout(() => finish({ verdict: "unreachable", detail: "no message within 20 s (key may still be valid; the test box was quiet)" }), timeoutMs);
    let opened = false;
    ws.onopen = () => { opened = true; ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[25, 50], [27.5, 57]]], FilterMessageTypes: ["PositionReport"] })); };
    ws.onmessage = e => {
      const text = typeof e.data === "string" ? e.data : Buffer.from(e.data as ArrayBuffer).toString();
      try {
        const m = JSON.parse(text);
        if (m.error) finish({ verdict: /api ?key|unauthori|invalid/i.test(m.error) ? "invalid" : "unreachable", detail: String(m.error).slice(0, 120) });
        else finish({ verdict: "ok", detail: "first ship position received" });
      } catch { finish({ verdict: "ok", detail: "stream answered" }); }
    };
    // AISStream drops the connection right after a bad key (observed: close 1006, no message). Reaching the server
    // and then being dropped means "rejected"; failing to connect at all means "unreachable".
    const dropped = () => finish(opened ? { verdict: "invalid", detail: "the stream closed right after the key was sent" } : { verdict: "unreachable", detail: "could not reach stream.aisstream.io" });
    ws.onerror = dropped;
    ws.onclose = dropped;
  });
}

export async function testKey(name: KeyName, key: string): Promise<{ verdict: Verdict; detail: string }> {
  if (!key) return { verdict: "not-set", detail: "" };
  if (name === "NASA_FIRMS_KEY") return testFirms(key);
  if (name === "AISSTREAM_API_KEY") return testAis(key);
  if (name === "WINDY_WEBCAMS_KEY") return testWindy(key);
  return testFirecrawl(key);
}
