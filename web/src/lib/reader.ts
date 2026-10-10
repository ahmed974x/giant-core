// Page reader (ADR-026): turns a link sent from the phone into a short readable snapshot for Director 00.
// With FIRECRAWL_API_KEY set (Ahmad's opt-in: the URL then goes to Firecrawl's cloud) it uses Firecrawl's scrape API,
// which handles JavaScript pages and PDFs. Without it, a small local reader fetches the page itself, refusing anything
// that resolves to the laptop, the LAN or other private addresses so a link can't be used to probe the home network.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Page = { title: string; text: string; source: "firecrawl" | "local" };
type Fetch = typeof fetch;

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 20_000;

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") ||
    x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
}

async function assertPublic(url: URL): Promise<void> {
  if (!/^https?:$/.test(url.protocol)) throw new Error("only http(s) links can be read");
  if (url.username || url.password) throw new Error("links with credentials are not read");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local$|\.localhost$|\.internal$|\.lan$/i.test(host)) throw new Error("private address");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) throw new Error("private address");
}

/** Plain text and title from HTML: drops scripts, styles, navigation chrome and tags; decodes common entities. */
export function htmlToText(html: string): { title: string; text: string } {
  const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim());
  const body = html.match(/<(article|main)[\s>][\s\S]*?<\/\1>/i)?.[0] ?? html;
  const text = decode(body
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section)>|<br\s*\/?>/gi, "\n")
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, " "))
    .replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: text.slice(0, MAX_TEXT) };
}

async function readLocal(url: string, f: Fetch): Promise<Page> {
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u);
    const r = await f(u, { redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "OMEGA-PRIME-reader/1.0", Accept: "text/html,text/plain;q=0.9" } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = new URL(r.headers.get("location")!, u); continue; }
    if (!r.ok) throw new Error(`page answered ${r.status}`);
    const type = r.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error("not a web page (set FIRECRAWL_API_KEY to read PDFs)");
    const buf = new Uint8Array(await r.arrayBuffer()).subarray(0, MAX_BYTES);
    const raw = new TextDecoder("utf-8").decode(buf);
    const page = /text\/plain/i.test(type) ? { title: "", text: raw.slice(0, MAX_TEXT) } : htmlToText(raw);
    return { ...page, source: "local" };
  }
  throw new Error("too many redirects");
}

async function readFirecrawl(url: string, key: string, f: Fetch): Promise<Page> {
  const r = await f("https://api.firecrawl.dev/v2/scrape", {
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, blockAds: true }),
  });
  const j = await r.json().catch(() => ({})) as { success?: boolean; error?: string; data?: { markdown?: string; metadata?: { title?: string } } };
  if (!r.ok || !j.success || typeof j.data?.markdown !== "string") throw new Error(`firecrawl: ${j.error ?? r.status}`);
  return { title: String(j.data.metadata?.title ?? "").trim(), text: j.data.markdown.slice(0, MAX_TEXT), source: "firecrawl" };
}

/** Read a public page. Firecrawl when a key is configured (falls back to the local reader if it fails), otherwise local. */
export async function readPage(url: string, env: Record<string, string | undefined> = process.env, f: Fetch = fetch): Promise<Page> {
  const key = env.FIRECRAWL_API_KEY?.trim();
  if (key) {
    try { return await readFirecrawl(url, key, f); } catch { /* fall through to the local reader */ }
  }
  return readLocal(url, f);
}

/** The few lines that go into the Director 00 request: title and the opening of the text. */
export function excerpt(page: Page, n = 400): string {
  const body = page.text.replace(/[#*_>`|[\]()!-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  return [page.title && `Title: ${page.title}`, body && `Excerpt: ${body}`].filter(Boolean).join(" — ");
}
