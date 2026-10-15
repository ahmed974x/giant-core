// Deep Research scouts (ADR-061): free, keyless, open sources only. Each scout turns one search query into a ranked
// list of hits; a failing or slow scout returns [] and the run carries on with the others. No CAPTCHA solving or
// anti-bot tricks: only official APIs and the self-hosted SearXNG.
import { isArabic } from "./text.ts";

export type Hit = { url: string; title: string; snippet: string; source: ScoutId; published?: string; full?: boolean };
export type ScoutId = "searxng" | "wikipedia" | "openalex" | "arxiv" | "hackernews" | "gdelt";
type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;

export const SCOUTS: { id: ScoutId; label: string; what: string }[] = [
  { id: "searxng", label: "SearXNG", what: "web meta-search (self-hosted, 70+ engines)" },
  { id: "wikipedia", label: "Wikipedia", what: "encyclopedia, Arabic + English" },
  { id: "openalex", label: "OpenAlex", what: "250M+ scholarly works" },
  { id: "arxiv", label: "arXiv", what: "science and AI preprints" },
  { id: "hackernews", label: "Hacker News", what: "tech discussion" },
  { id: "gdelt", label: "GDELT", what: "world news, last 3 months" },
];

const UA = "OMEGA-Prime-DeepResearch/1.0 (+https://github.com/ahmed974x/giant-core)";
const clean = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

async function getJson(f: Fetch, url: string, ms: number): Promise<any> {
  const r = await f(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms), cache: "no-store" });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

async function searxng(q: string, env: Env, f: Fetch, ms: number): Promise<Hit[]> {
  const base = (env.SEARXNG_URL ?? env.OMEGA_SEARCH_URL ?? "http://127.0.0.1:8890").replace(/\/+$/, "");
  const lang = isArabic(q) ? "ar" : "all";
  const j = await getJson(f, `${base}/search?format=json&safesearch=1&language=${lang}&q=${encodeURIComponent(q)}`, ms);
  return (j.results ?? []).slice(0, 10).filter((r: any) => /^https?:/.test(r.url ?? "")).map((r: any) => ({
    url: r.url, title: clean(r.title), snippet: clean(r.content), source: "searxng" as const, published: r.publishedDate ?? undefined,
  }));
}

async function wikipedia(q: string, _env: Env, f: Fetch, ms: number): Promise<Hit[]> {
  const langs = isArabic(q) ? ["ar", "en"] : ["en"];
  const out: Hit[] = [];
  await Promise.all(langs.map(async lang => {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&gsrsearch=${encodeURIComponent(q)}` +
      "&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exlimit=3&exchars=1800";
    const j = await getJson(f, url, ms);
    const pages = Object.values(j.query?.pages ?? {}) as any[];
    pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const p of pages) if (p.extract) out.push({ url: p.fullurl, title: `${p.title} — Wikipedia`, snippet: clean(p.extract), source: "wikipedia", full: true });
  }));
  return out;
}

/** OpenAlex stores abstracts as an inverted index (word -> positions); rebuild the text. */
export function abstractFromIndex(idx: Record<string, number[]> | null | undefined): string {
  if (!idx) return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;
  return words.filter(Boolean).join(" ");
}

async function openalex(q: string, env: Env, f: Fetch, ms: number): Promise<Hit[]> {
  const mail = env.OPENALEX_MAILTO ? `&mailto=${encodeURIComponent(env.OPENALEX_MAILTO)}` : "";
  const j = await getJson(f, `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=5&sort=relevance_score:desc${mail}`, ms);
  return (j.results ?? []).map((w: any) => ({
    url: w.doi || w.primary_location?.landing_page_url || w.id, title: clean(w.display_name),
    snippet: abstractFromIndex(w.abstract_inverted_index).slice(0, 1800) || clean(w.display_name),
    source: "openalex" as const, published: w.publication_date ?? undefined, full: true,
  })).filter((h: Hit) => h.url);
}

async function arxiv(q: string, _env: Env, f: Fetch, ms: number): Promise<Hit[]> {
  const r = await f(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=4&sortBy=relevance`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms), cache: "no-store" });
  if (!r.ok) throw new Error(`arxiv ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    url: (e.match(/<id>([^<]+)<\/id>/)?.[1] ?? "").replace(/^http:/, "https:"),
    title: clean(e.match(/<title>([\s\S]*?)<\/title>/)?.[1]), snippet: clean(e.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]).slice(0, 1800),
    source: "arxiv" as const, published: e.match(/<published>([^<]+)<\/published>/)?.[1], full: true,
  })).filter(h => h.url);
}

async function hackernews(q: string, _env: Env, f: Fetch, ms: number): Promise<Hit[]> {
  if (isArabic(q)) return [];
  const j = await getJson(f, `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=5&query=${encodeURIComponent(q)}`, ms);
  return (j.hits ?? []).filter((h: any) => h.url).map((h: any) => ({
    url: h.url, title: clean(h.title), snippet: clean(h.story_text) || `${h.points ?? 0} points, ${h.num_comments ?? 0} comments on Hacker News`,
    source: "hackernews" as const, published: h.created_at,
  }));
}

async function gdelt(q: string, _env: Env, f: Fetch, ms: number): Promise<Hit[]> {
  const terms = q.replace(/["()]/g, " ").split(/\s+/).filter(w => w.length > 2).slice(0, 6).join(" ");
  if (!terms) return [];
  const lang = isArabic(q) ? " sourcelang:arabic" : "";
  const j = await getJson(f, `https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=8&sort=hybridrel&timespan=3months&query=${encodeURIComponent(terms + lang)}`, ms)
    .catch(() => ({ articles: [] })); // GDELT answers plain text (not JSON) for queries it rejects
  return (j.articles ?? []).map((a: any) => ({
    url: a.url, title: clean(a.title), snippet: `${clean(a.title)} (${a.domain ?? ""}, ${a.sourcecountry ?? ""})`,
    source: "gdelt" as const, published: a.seendate,
  }));
}

const IMPL: Record<ScoutId, (q: string, env: Env, f: Fetch, ms: number) => Promise<Hit[]>> = { searxng, wikipedia, openalex, arxiv, hackernews, gdelt };

/** Which scouts suit a question: science words pull in arXiv/OpenAlex, news words GDELT; SearXNG and Wikipedia always. */
export function pickScouts(question: string, deep: boolean): ScoutId[] {
  const q = question.toLowerCase();
  const set = new Set<ScoutId>(["searxng", "wikipedia"]);
  const science = /(research|study|paper|model|algorithm|ai\b|llm|neural|physics|medic|gene|climate|quantum|بحث|دراس|علم|خوارزم|ذكاء|نموذج|طب|فيزياء|مناخ)/i.test(q);
  const news = /(news|today|latest|war|price|market|oil|election|attack|خبر|اخبار|اليوم|حرب|سعر|اسعار|سوق|نفط|برنت|ذهب|انتخاب|هجوم|احدث|آخر)/i.test(q);
  const tech = /(software|open.?source|github|startup|framework|programming|برمج|مفتوح|تطبيق)/i.test(q);
  if (science || deep) { set.add("openalex"); set.add("arxiv"); }
  if (news || deep) set.add("gdelt");
  if (tech || deep) set.add("hackernews");
  return [...set];
}

export async function scout(id: ScoutId, query: string, env: Env = process.env, f: Fetch = fetch, ms = 9000): Promise<Hit[]> {
  return IMPL[id](query, env, f, ms);
}
