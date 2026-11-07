// Live open-web search for jarvis/server (ADR-139). Official, keyless, public JSON APIs only:
//   GitHub repository search, OpenAlex works, Wikipedia (Arabic and English) search, the npm registry
//   search, PyPI's JSON API for one package, OSV's vulnerability query, HN Search by Algolia, and a
//   SearXNG instance in JSON mode if the person configured one (JARVIS_SEARXNG_URL).
// No page is scraped, no HTML search page is read, no anti-bot measure is bypassed (AGENTS.md §3).
//   - Every request goes to a fixed host built from a fixed template; the query is only ever a URL
//     parameter (or the OSV JSON body). Nothing from the request, the query or an answer can choose a host.
//   - Every DNS answer is checked inside the socket's lookup (fetch-public.mjs), and an address written
//     as an IP is checked before connecting, so nothing can reach a private, loopback or reserved address.
//     The one exception is a SearXNG address the person set to http://127.0.0.1:<port>, pinned at start
//     like the Ollama bridge.
//   - An honest user agent, a timeout per call, no redirects, at most 1 MB, JSON only, and a cache so a
//     repeated search does not ask again (GitHub allows 10 keyless searches a minute).
//   - Answers are untrusted data: text is stripped of markup and control characters and cut short, and
//     a link is kept only if it is https (or the Wikipedia/OpenAlex/HN page built here).
//   - When no source answers (no internet), the server falls back to this workspace's memory and says so.
import https from "node:https";
import http from "node:http";
import net from "node:net";
import { safeLookup, isBlockedAddress, FetchError } from "./fetch-public.mjs";

export const SEARCH_UA = "JarvisOpenSearch/1.0 (+https://github.com/ahmed974x/giant-core; local tool; official public APIs only)";
const MAX_BYTES = 1024 * 1024;
export const MODES = { web: ["wikipedia-en", "wikipedia-ar", "openalex", "hn", "github", "searxng"], packages: ["npm", "pypi", "github"], osv: ["osv"] };
export const OSV_ECOSYSTEMS = { npm: "npm", pypi: "PyPI", go: "Go", maven: "Maven", cargo: "crates.io", crates: "crates.io", nuget: "NuGet", rubygems: "RubyGems", gem: "RubyGems", packagist: "Packagist", composer: "Packagist", pub: "Pub", hex: "Hex" };

const enc = encodeURIComponent;
const clean = (s, n) => String(s == null ? "" : s).replace(/<[^>]*>/g, " ").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
export const httpsLink = u => { try { const x = new URL(String(u)); return x.protocol === "https:" && !x.username && !x.password ? x.toString() : null; } catch (e) { return null; } };

export class SearchError extends Error { constructor(status, message) { super(message); this.status = status; } }

// Pin a SearXNG address: https on a public name (checked again per connection), or http://127.0.0.1:<port>.
export function pinSearxng(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw)); } catch (e) { throw new SearchError(400, "JARVIS_SEARXNG_URL is not a URL."); }
  if (u.username || u.password || u.search || u.hash) throw new SearchError(400, "JARVIS_SEARXNG_URL may not hold a user, password, query or fragment.");
  const path = u.pathname.replace(/\/+$/, "");
  if (u.protocol === "http:" && u.hostname === "127.0.0.1") return { base: "http://127.0.0.1:" + (u.port || "80") + path, loopback: true };
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && isBlockedAddress(u.hostname.replace(/^\[|\]$/g, ""))) throw new SearchError(400, "JARVIS_SEARXNG_URL may not point at a private or reserved address (except http://127.0.0.1:<port>).");
  if (u.protocol === "https:" && u.hostname.includes(".") && !/(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(u.hostname) && (!u.port || u.port === "443")) return { base: "https://" + u.hostname + path, loopback: false };
  throw new SearchError(400, "JARVIS_SEARXNG_URL must be https on a public name, or http://127.0.0.1:<port>.");
}

// The query for each mode. OSV takes "ecosystem:name" or "ecosystem:name@version".
export function parseQuery(mode, raw) {
  const q = clean(raw, 200);
  if (!MODES[mode]) throw new SearchError(400, "Mode is web, packages or osv.");
  if (q.length < 2) throw new SearchError(400, "Write at least two characters to search for.");
  if (mode !== "osv") return { q };
  const m = /^([A-Za-z.]+)\s*:\s*(@?[A-Za-z0-9._/~-]{1,120}?)(?:@([A-Za-z0-9._+~-]{1,60}))?$/.exec(q.trim());
  if (!m || !OSV_ECOSYSTEMS[m[1].toLowerCase()]) throw new SearchError(400, "Write it as ecosystem:package or ecosystem:package@version, e.g. npm:lodash@4.17.20. Ecosystems: " + Object.keys(OSV_ECOSYSTEMS).join(", ") + ".");
  return { q, ecosystem: OSV_ECOSYSTEMS[m[1].toLowerCase()], name: m[2], version: m[3] || null };
}

// One JSON request: fixed host, honest agent, timeout, no redirects, 1 MB, private addresses refused.
export function requestJson(url, { method = "GET", body = null, timeoutMs = 8000, loopback = false } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    if (u.protocol === "http:" && !(loopback && u.hostname === "127.0.0.1")) return reject(new SearchError(400, "Plain http is used only for a SearXNG on 127.0.0.1."));
    // Node does not call the lookup for an address written as an IP, so check that case here.
    const lit = u.hostname.replace(/^\[|\]$/g, "");
    if (!loopback && net.isIP(lit) && isBlockedAddress(lit)) return reject(new SearchError(400, "Private, loopback and reserved addresses are refused."));
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = mod.request(u, {
      method, agent: false, timeout: timeoutMs, ...(loopback ? {} : { lookup: safeLookup }),
      headers: { "User-Agent": SEARCH_UA, Accept: "application/json", "Accept-Encoding": "identity", ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return reject(new SearchError(502, "The API answered with a redirect, which is not followed.")); }
      if (res.statusCode === 404) { res.resume(); return resolve(null); }
      if (res.statusCode === 403 || res.statusCode === 429) { res.resume(); return reject(new SearchError(429, "The API's free limit is used up for now; try again in a minute.")); }
      if (res.statusCode !== 200) { res.resume(); return reject(new SearchError(502, "The API answered HTTP " + res.statusCode + ".")); }
      const chunks = []; let size = 0;
      res.on("data", c => { size += c.length; if (size > MAX_BYTES) { req.destroy(new SearchError(502, "The answer is larger than 1 MB.")); return; } chunks.push(c); });
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(new SearchError(502, "The answer is not JSON.")); } });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new SearchError(504, "No answer within " + timeoutMs / 1000 + " s.")));
    req.on("error", e => reject(e instanceof SearchError ? e : e instanceof FetchError ? new SearchError(400, e.message) : new SearchError(503, "Could not reach the API (" + (e.code || e.message) + ").")));
    if (data) req.write(data);
    req.end();
  });
}

const wiki = lang => ({
  label: lang === "ar" ? "Wikipedia (Arabic)" : "Wikipedia (English)", host: lang + ".wikipedia.org", licence: "CC BY-SA 4.0",
  request: ({ q }, n) => ({ url: `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=${n}&srsearch=${enc(q)}` }),
  parse: j => ((j && j.query && j.query.search) || []).map(r => ({ title: clean(r.title, 200), url: `https://${lang}.wikipedia.org/wiki/${enc(String(r.title).replace(/ /g, "_"))}`, snippet: clean(r.snippet, 300), meta: { words: r.wordcount, updated: clean(r.timestamp, 30) }, lang })),
});

export const SOURCES = {
  "wikipedia-en": wiki("en"),
  "wikipedia-ar": wiki("ar"),
  openalex: {
    label: "OpenAlex", host: "api.openalex.org", licence: "CC0",
    request: ({ q }, n) => ({ url: `https://api.openalex.org/works?search=${enc(q)}&per-page=${n}&select=id,display_name,publication_year,cited_by_count,doi,primary_location` }),
    parse: j => ((j && j.results) || []).map(r => ({ title: clean(r.display_name, 300), url: httpsLink(r.doi) || httpsLink(r.id), snippet: clean([r.publication_year, r.primary_location && r.primary_location.source && r.primary_location.source.display_name].filter(Boolean).join(" · "), 200), meta: { year: r.publication_year, citations: r.cited_by_count } })),
  },
  hn: {
    label: "Hacker News (Algolia)", host: "hn.algolia.com", licence: "HN API terms",
    request: ({ q }, n) => ({ url: `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=${n}&query=${enc(q)}` }),
    parse: j => ((j && j.hits) || []).map(r => ({ title: clean(r.title || r.story_title, 300), url: httpsLink(r.url) || (/^\d+$/.test(String(r.objectID)) ? "https://news.ycombinator.com/item?id=" + r.objectID : null), snippet: clean((r.points || 0) + " points · " + (r.num_comments || 0) + " comments", 120), meta: { points: r.points, date: clean(r.created_at, 30) } })),
  },
  github: {
    label: "GitHub", host: "api.github.com", licence: "GitHub API terms",
    request: ({ q }, n) => ({ url: `https://api.github.com/search/repositories?per_page=${n}&q=${enc(q)}` }),
    parse: j => ((j && j.items) || []).map(r => ({ title: clean(r.full_name, 200), url: httpsLink(r.html_url), snippet: clean(r.description, 300), meta: { stars: r.stargazers_count, language: clean(r.language, 40), licence: clean(r.license && r.license.spdx_id, 40), updated: clean(r.pushed_at, 30) } })),
  },
  npm: {
    label: "npm registry", host: "registry.npmjs.org", licence: "npm API terms",
    request: ({ q }, n) => ({ url: `https://registry.npmjs.org/-/v1/search?size=${n}&text=${enc(q)}` }),
    parse: j => ((j && j.objects) || []).map(o => o.package || {}).map(p => ({ title: clean(p.name, 200) + (p.version ? "@" + clean(p.version, 40) : ""), url: httpsLink(p.links && p.links.npm) || "https://www.npmjs.com/package/" + enc(String(p.name || "")), snippet: clean(p.description, 300), meta: { version: clean(p.version, 40), date: clean(p.date, 30) } })),
  },
  pypi: {
    label: "PyPI", host: "pypi.org", licence: "PyPI API terms",
    // PyPI's JSON API reads one named package; a query that is not a package name is skipped.
    request: ({ q }) => (/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(q.trim()) ? { url: `https://pypi.org/pypi/${enc(q.trim())}/json` } : null),
    parse: j => (j && j.info ? [{ title: clean(j.info.name, 200) + "@" + clean(j.info.version, 40), url: httpsLink(j.info.package_url) || httpsLink(j.info.project_url), snippet: clean(j.info.summary, 300), meta: { version: clean(j.info.version, 40), licence: clean(j.info.license, 60), python: clean(j.info.requires_python, 40) } }] : []),
  },
  osv: {
    label: "OSV.dev", host: "api.osv.dev", licence: "CC BY 4.0",
    request: p => ({ url: "https://api.osv.dev/v1/query", method: "POST", body: { package: { name: p.name, ecosystem: p.ecosystem }, ...(p.version ? { version: p.version } : {}) } }),
    parse: j => ((j && j.vulns) || []).map(v => ({ title: clean(v.id, 60) + (v.summary ? " · " + clean(v.summary, 200) : ""), url: /^[A-Za-z0-9-]{3,60}$/.test(String(v.id)) ? "https://osv.dev/vulnerability/" + v.id : null, snippet: clean((v.details || v.summary || ""), 300), meta: { aliases: (v.aliases || []).slice(0, 4).map(a => clean(a, 40)), modified: clean(v.modified, 30), severity: clean(((v.severity || [])[0] || {}).score, 80) } })),
  },
  searxng: {
    label: "SearXNG (JSON)", host: "configured", licence: "per engine",
    request: ({ q }, n, sx) => (sx ? { url: `${sx.base}/search?format=json&safesearch=1&q=${enc(q)}`, loopback: sx.loopback, limit: n } : null),
    parse: j => ((j && j.results) || []).map(r => ({ title: clean(r.title, 300), url: httpsLink(r.url), snippet: clean(r.content, 300), meta: { engine: clean(r.engine, 40) } })),
  },
};

// createOpenWebSearch({ request, searxngUrl, cacheMs }) -> { status(), search({ q, mode, limit }) }.
// request is injectable so tests run without a network.
export function createOpenWebSearch({ request = requestJson, searxngUrl = process.env.JARVIS_SEARXNG_URL, cacheMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const sx = pinSearxng(searxngUrl);
  const cache = new Map();
  async function one(id, parsed, limit) {
    const src = SOURCES[id];
    const r = src.request(parsed, limit, sx);
    if (!r) return { source: id, label: src.label, ok: true, skipped: true, count: 0, ms: 0, results: [], note: id === "searxng" ? "No SearXNG address is set." : "Not a package name." };
    const key = id + " " + (r.method || "GET") + " " + r.url + " " + JSON.stringify(r.body || null);
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMs) return { ...hit.value, cached: true };
    const t0 = now();
    try {
      const j = await request(r.url, { method: r.method || "GET", body: r.body || null, loopback: !!r.loopback });
      const results = src.parse(j).filter(x => x.title && x.url).slice(0, limit).map(x => ({ ...x, source: id }));
      const value = { source: id, label: src.label, licence: src.licence, ok: true, count: results.length, ms: now() - t0, results };
      cache.set(key, { at: now(), value });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      return value;
    } catch (e) {
      return { source: id, label: src.label, ok: false, count: 0, ms: now() - t0, results: [], error: e.message || "failed", status: e.status || 503 };
    }
  }
  return {
    status: () => ({ sources: Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label, host: id === "searxng" ? (sx ? sx.base : null) : s.host, licence: s.licence })), searxng: sx ? sx.base : null, modes: MODES }),
    async search({ q, mode = "web", limit = 5 } = {}) {
      const parsed = parseQuery(mode, q);
      const n = Math.max(1, Math.min(10, Number(limit) || 5));
      const ids = MODES[mode];
      // allSettled: one source that throws in its parser can never sink the others.
      const settled = await Promise.allSettled(ids.map(id => one(id, parsed, n)));
      const per = settled.map((x, i) => x.status === "fulfilled" ? x.value : { source: ids[i], label: SOURCES[ids[i]].label, ok: false, count: 0, ms: 0, results: [], error: "The answer could not be read." });
      const asked = per.filter(p => !p.skipped);
      const answered = asked.filter(p => p.ok);
      // Interleave sources so the first screen shows each of them.
      const results = [];
      for (let i = 0; i < n; i++) for (const p of per) if (p.results[i]) results.push(p.results[i]);
      return { q: parsed.q, mode, query: parsed, sources: per.map(({ results: _r, ...rest }) => rest), results, offline: asked.length > 0 && answered.length === 0, at: new Date(now()).toISOString(), userAgent: SEARCH_UA };
    },
  };
}
