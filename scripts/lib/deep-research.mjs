// Deep research engine (ADR-114): pure functions shared by the ORACLE page (inlined between the OMEGA_RESEARCH
// markers by scripts/build-research-inline.mjs, because the page must work from file:// with no build step), the
// local data proxy (scripts/omega-data-proxy.mjs), the local MCP bridge (scripts/omega-mcp-bridge.mjs) and the Node
// tests (scripts/test-research.mjs). No network, no storage, no clock except where a time is passed in.
//
// The agent follows the four stages of open deep-research systems: plan, gather, evaluate, write. Every source is
// free, keyless and public, and is read passively through its documented API: OpenAlex, Crossref, Europe PMC,
// arXiv, Semantic Scholar, Wikipedia (Arabic and English), GDELT DOC 2.0 and the Internet Archive's Wayback
// availability API. No scraping, no search-engine dorking, no scanning, no paid key.
//
// Contents
//   plan(query, opts)        sub-questions, each with the sources that answer it; Arabic and English bridge terms
//   urls.*                   the request each source gets (one place, so the page, proxy and bridge agree)
//   shape.*                  each answer cut to one record form {key, kind, title, authors, year, doi, url, oa, ...}
//   merge(lists)             de-duplication by DOI, then by normalised title; `via` lists every index that had it
//   score(records, terms)    BM25 relevance + citations + recency + corroboration + open access, [INFERENCE]
//   grade(record)            A/B/C/D evidence grade by fixed rules, [INFERENCE]
//   snowball(records)        citation chasing: works co-cited by the top papers, and newer works that cite the best one
//   keySentences(...)        extractive summary: verbatim abstract sentences, maximal marginal relevance
//   evaluate(...)            coverage per sub-question and the gaps, by fixed rules
//   report(...) / markdown   the finished brief, every sentence numbered to its reference
//   checkCitations(text, n)  verifies a model's text: which [n] exist, which sentences carry none
//   graph(records)           evidence map: links by citation and shared topic, deterministic force layout
//   allowed(source, url)     the one API path each source may take through the local proxy
//   run(query, opts, io)     the whole agent over an injected transport io.get(source, url, type) -> {data, tier}
export const OMEGA_RESEARCH = (() => {
  "use strict";
  const VERSION = "omega-research-v1";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const finite = v => typeof v === "number" && Number.isFinite(v);
  const enc = encodeURIComponent;
  const str = (v, max = 2000) => (typeof v === "string" ? v : v == null ? "" : String(v)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  const stripTags = s => str(String(s || "").replace(/<[^>]*>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"), 4000);

  /* ---------------- text ---------------- */
  const AR_RE = /[؀-ۿ]/;
  const isArabic = s => AR_RE.test(String(s || ""));
  const normAr = s => String(s).replace(/[ً-ٰٟـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  const STOP = new Set(("a an and are as at be been but by can do does for from has have how in into is it its of on or that the their there these this those to was were what when where which who why will with within without about between than then also may might more most such using use used based via vs versus our we they you i " +
    "في من على الى إلى عن ما ماذا هو هي هم و او أو ثم هذا هذه ذلك تلك التي الذي الذين كيف لماذا هل مع بين كل ان أن إن كان كانت قد لا لم لن عند حول اي أي بعد قبل دون غير منذ حتى كما ايضا أيضا").split(" ").map(normAr));
  function tokens(s) {
    const out = [];
    for (let w of normAr(String(s || "").toLowerCase()).split(/[^\p{L}\p{N}]+/u)) {
      if (!w) continue;
      if (/^[؀-ۿ]/.test(w)) { if (w.length > 4 && w.startsWith("ال")) w = w.slice(2); else if (w.length > 4 && (w.startsWith("وال") || w.startsWith("بال") || w.startsWith("لل"))) w = w.slice(w.startsWith("لل") ? 2 : 3); }
      else if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
      if (w.length < 2 || STOP.has(w)) continue;
      out.push(w);
    }
    return out;
  }
  const normTitle = s => tokens(s).join(" ").slice(0, 160);
  const normDoi = d => {
    const m = /10\.\d{4,9}\/\S+/i.exec(String(d || ""));
    return m ? m[0].replace(/[.,;)\]]+$/, "").toLowerCase() : null;
  };
  // Links from data must be http(s); anything else becomes null.
  function safeUrl(u) {
    try { const x = new URL(String(u || "")); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
  }
  const cleanQuery = q => str(q, 200).replace(/[<>{}\\]/g, " ").replace(/\s+/g, " ").trim();

  /* ---------------- plan ---------------- */
  // Sources, their licence or terms, and the kind of record they return. `cors` says whether a browser may call the
  // API directly; the others go through the local proxy (or are skipped on a static page).
  const SOURCES = Object.freeze({
    wikipedia: { name: "Wikipedia", terms: "CC BY-SA 4.0", kind: "encyclopedia", cors: true, home: "https://www.wikipedia.org/" },
    openalex: { name: "OpenAlex", terms: "CC0", kind: "paper", cors: true, home: "https://openalex.org/" },
    crossref: { name: "Crossref", terms: "metadata open (CC0 facts)", kind: "paper", cors: true, home: "https://www.crossref.org/" },
    europepmc: { name: "Europe PMC", terms: "open API, EMBL-EBI", kind: "paper", cors: true, home: "https://europepmc.org/" },
    arxiv: { name: "arXiv", terms: "arXiv API terms, 1 request per 3 s", kind: "preprint", cors: false, home: "https://arxiv.org/" },
    semanticscholar: { name: "Semantic Scholar", terms: "public API, shared rate limit", kind: "paper", cors: true, home: "https://www.semanticscholar.org/" },
    gdelt: { name: "GDELT DOC 2.0", terms: "open, 1 request per 5 s", kind: "news", cors: true, home: "https://www.gdeltproject.org/" },
    wayback: { name: "Internet Archive Wayback", terms: "availability API", kind: "archive", cors: true, home: "https://web.archive.org/" }
  });
  // plan(): the sub-questions in order. `bridge` holds the other-language term found through Wikipedia language links
  // (filled in after the define step), so an Arabic question also searches the English literature and back.
  function plan(query, opts = {}) {
    const q = cleanQuery(query);
    const now = finite(opts.now) ? opts.now : Date.parse("2026-01-01T00:00:00Z");
    const year = new Date(now).getUTCFullYear();
    const lang = isArabic(q) ? "ar" : "en";
    const depth = opts.depth === 1 ? 1 : 2;
    const off = new Set(Array.isArray(opts.off) ? opts.off : []);
    const steps = [
      { id: "define", ar: "تعريف وخلفية", en: "Definition and background", sources: ["wikipedia"] },
      { id: "evidence", ar: "الأدلة المحكّمة الأكثر صلة", en: "Most relevant peer-reviewed evidence", sources: ["openalex", "crossref", "europepmc", "semanticscholar"] },
      { id: "recent", ar: `أحدث ما نُشر منذ ${year - 2}`, en: `Newest work since ${year - 2}`, sources: ["openalex", "arxiv"] },
      { id: "foundations", ar: "الأعمال التأسيسية الأكثر استشهاداً", en: "Most-cited foundations", sources: ["openalex"] },
      { id: "counter", ar: "القيود والأدلة المعاكسة", en: "Limits and counter-evidence", sources: ["openalex"] },
      { id: "arabic", ar: "المصادر العربية", en: "Arabic-language sources", sources: ["openalex", "wikipedia"] },
      { id: "news", ar: "الأخبار في آخر 3 أشهر", en: "News, last 3 months", sources: ["gdelt"] }
    ];
    if (depth === 2) steps.push({ id: "snowball", ar: "تتبّع الاستشهادات (كرة الثلج)", en: "Citation chasing (snowball)", sources: ["openalex"] });
    for (const s of steps) s.sources = s.sources.filter(k => !off.has(k));
    return { format: VERSION + "-plan", query: q, lang, year, depth, steps: steps.filter(s => s.sources.length), terms: tokens(q).slice(0, 12) };
  }

  /* ---------------- requests ---------------- */
  const OA_SELECT = "id,doi,display_name,publication_year,publication_date,cited_by_count,open_access,primary_location,authorships,abstract_inverted_index,is_retracted,type,language,topics,referenced_works";
  const arxivQuery = q => {
    const w = tokens(q).filter(t => /^[a-z0-9]+$/.test(t)).slice(0, 6);
    return w.length ? w.map(t => "all:" + t).join(" AND ") : null;
  };
  const urls = {
    wikiSearch: (lang, q) => `https://${lang === "ar" ? "ar" : "en"}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=5&srprop=snippet|timestamp&format=json&formatversion=2&origin=*&utf8=1`,
    wikiPage: (lang, title, to) => `https://${lang === "ar" ? "ar" : "en"}.wikipedia.org/w/api.php?action=query&titles=${enc(title)}&prop=extracts|langlinks|info&inprop=url&exintro=1&explaintext=1&exsentences=5&lllang=${to === "ar" ? "ar" : "en"}&redirects=1&format=json&formatversion=2&origin=*`,
    openalex: (q, mode, year) => {
      const base = `https://api.openalex.org/works?per-page=20&select=${OA_SELECT}`;
      if (mode === "recent") return `${base}&search=${enc(q)}&filter=from_publication_date:${year - 2}-01-01`;
      if (mode === "cited") return `${base}&search=${enc(q)}&sort=cited_by_count:desc`;
      if (mode === "counter") return `${base}&search=${enc(`(${q}) AND (limitation OR limitations OR criticism OR "negative results" OR challenges OR risks)`)}`;
      if (mode === "ar") return `${base}&search=${enc(q)}&filter=language:ar`;
      return `${base}&search=${enc(q)}`;
    },
    openalexIds: ids => `https://api.openalex.org/works?per-page=${Math.min(50, ids.length)}&select=${OA_SELECT}&filter=ids.openalex:${ids.map(i => String(i).replace(/[^A-Za-z0-9]/g, "")).join("|")}`,
    openalexCites: id => `https://api.openalex.org/works?per-page=15&select=${OA_SELECT}&sort=cited_by_count:desc&filter=cites:${String(id).replace(/[^A-Za-z0-9]/g, "")}`,
    crossref: q => `https://api.crossref.org/works?query=${enc(q)}&rows=20&select=DOI,title,author,issued,container-title,is-referenced-by-count,type,abstract,URL,language`,
    europepmc: q => `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(q)}&format=json&pageSize=15&resultType=core`,
    arxiv: q => { const s = arxivQuery(q); return s ? `https://export.arxiv.org/api/query?search_query=${enc(s)}&start=0&max_results=12&sortBy=relevance&sortOrder=descending` : null; },
    semanticscholar: q => `https://api.semanticscholar.org/graph/v1/paper/search?query=${enc(q)}&limit=15&fields=title,year,publicationDate,citationCount,abstract,externalIds,openAccessPdf,venue,authors,url`,
    gdelt: (q, lang) => {
      const words = q.split(" ").filter(w => w.length >= 3);
      if (!words.length) return null;
      const term = (words.length > 1 ? `"${words.slice(0, 6).join(" ")}"` : words[0]) + (lang === "ar" ? " sourcelang:arabic" : "");
      return `https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(term)}&mode=artlist&format=json&maxrecords=20&timespan=3months&sort=hybridrel`;
    },
    wayback: u => `https://archive.org/wayback/available?url=${enc(u)}`
  };
  // The proxy (and the static page) refuse every other host.
  const HOSTS = Object.freeze(["en.wikipedia.org", "ar.wikipedia.org", "api.openalex.org", "api.crossref.org", "www.ebi.ac.uk", "export.arxiv.org", "api.semanticscholar.org", "api.gdeltproject.org", "archive.org"]);
  // allowed(): the one request shape each source may take through the local proxy: https, its own host, its one
  // API path, no credentials or port in the address. Anything else is refused before a byte leaves the laptop.
  const ENDPOINTS = Object.freeze({
    wikipedia: [/^(ar|en)\.wikipedia\.org$/, "/w/api.php"], openalex: [/^api\.openalex\.org$/, "/works"], crossref: [/^api\.crossref\.org$/, "/works"],
    europepmc: [/^www\.ebi\.ac\.uk$/, "/europepmc/webservices/rest/search"], arxiv: [/^export\.arxiv\.org$/, "/api/query"], semanticscholar: [/^api\.semanticscholar\.org$/, "/graph/v1/paper/search"],
    gdelt: [/^api\.gdeltproject\.org$/, "/api/v2/doc/doc"], wayback: [/^archive\.org$/, "/wayback/available"]
  });
  function allowed(source, url) {
    const e = Object.prototype.hasOwnProperty.call(ENDPOINTS, source) ? ENDPOINTS[source] : null;
    if (!e || typeof url !== "string" || url.length > 2000) return false;
    try { const u = new URL(url); return u.protocol === "https:" && e[0].test(u.hostname) && u.pathname === e[1] && !u.username && !u.password && !u.port && !u.hash; } catch { return false; }
  }

  /* ---------------- shapes ---------------- */
  const rec = o => ({
    key: o.doi ? "doi:" + o.doi : "t:" + normTitle(o.title || o.url || ""),
    kind: o.kind || "paper", title: str(o.title, 400), authors: (o.authors || []).map(a => str(a, 80)).filter(Boolean).slice(0, 6),
    year: finite(o.year) ? o.year : null, date: o.date ? str(o.date, 10) : null, venue: str(o.venue, 200) || null,
    doi: o.doi || null, url: safeUrl(o.url) || (o.doi ? "https://doi.org/" + o.doi : null), oa: safeUrl(o.oa), abstract: str(o.abstract, 2400) || null,
    cites: finite(o.cites) ? o.cites : null, retracted: !!o.retracted, lang: o.lang ? str(o.lang, 8) : null, topics: (o.topics || []).map(t => str(t, 80)).filter(Boolean).slice(0, 5),
    refs: (o.refs || []).map(r => String(r).replace(/^https:\/\/openalex\.org\//, "")).filter(r => /^W\d+$/.test(r)), oaId: o.oaId || null,
    via: [o.via], steps: o.step ? [o.step] : [], domain: o.domain || null, seen: o.seen || null
  });
  function abstractFromIndex(ix) {
    if (!ix || typeof ix !== "object") return null;
    const words = [];
    for (const [w, pos] of Object.entries(ix)) if (Array.isArray(pos)) for (const p of pos) if (Number.isInteger(p) && p >= 0 && p < 4000) words[p] = w;
    const text = words.filter(Boolean).join(" ");
    return text || null;
  }
  const shape = {
    // Wikipedia search answer -> [{title, snippet}] (the define step then reads the first page).
    wikiSearch: j => ((j && j.query && j.query.search) || []).map(s => ({ title: str(s.title, 200), snippet: stripTags(s.snippet || "") })).filter(s => s.title),
    // Wikipedia page answer -> {record, bridge}: the intro as an encyclopedia record and the title in the other language.
    wikiPage: (j, lang, step) => {
      const p = j && j.query && Array.isArray(j.query.pages) ? j.query.pages[0] : null;
      if (!p || p.missing || !p.title) return null;
      const ll = Array.isArray(p.langlinks) && p.langlinks[0] ? str(p.langlinks[0].title || p.langlinks[0]["*"], 200) : null;
      const url = safeUrl(p.fullurl) || `https://${lang === "ar" ? "ar" : "en"}.wikipedia.org/wiki/${enc(String(p.title).replace(/ /g, "_"))}`;
      return { record: rec({ kind: "encyclopedia", title: p.title + (lang === "ar" ? " (ويكيبيديا)" : " (Wikipedia)"), url, abstract: p.extract, lang, via: "wikipedia", step, date: p.touched ? String(p.touched).slice(0, 10) : null }), bridge: ll };
    },
    openalex: (j, step) => ((j && j.results) || []).map(w => {
      const loc = w.primary_location || {}, src = loc.source || {};
      return rec({ kind: w.type === "preprint" || /arxiv|biorxiv|medrxiv|ssrn/i.test(src.display_name || "") ? "preprint" : "paper",
        title: w.display_name || w.title, authors: (w.authorships || []).map(a => a && a.author && a.author.display_name), year: w.publication_year, date: w.publication_date,
        venue: src.display_name, doi: normDoi(w.doi), url: loc.landing_page_url || w.doi, oa: w.open_access && w.open_access.oa_url, abstract: abstractFromIndex(w.abstract_inverted_index),
        cites: w.cited_by_count, retracted: w.is_retracted, lang: w.language, topics: (w.topics || []).map(t => t && t.display_name), refs: w.referenced_works,
        oaId: String(w.id || "").replace(/^https:\/\/openalex\.org\//, "") || null, via: "openalex", step });
    }).filter(r => r.title),
    crossref: (j, step) => ((j && j.message && j.message.items) || []).map(it => {
      const dp = it.issued && Array.isArray(it.issued["date-parts"]) && it.issued["date-parts"][0];
      const y = dp && finite(dp[0]) ? dp[0] : null;
      return rec({ kind: it.type === "posted-content" ? "preprint" : "paper", title: Array.isArray(it.title) ? it.title[0] : it.title,
        authors: (it.author || []).map(a => [a.given, a.family].filter(Boolean).join(" ") || a.name), year: y,
        date: y ? [y, dp[1], dp[2]].filter(finite).map((v, i) => i ? String(v).padStart(2, "0") : String(v)).join("-") : null,
        venue: Array.isArray(it["container-title"]) ? it["container-title"][0] : null, doi: normDoi(it.DOI), url: it.URL, abstract: it.abstract ? stripTags(it.abstract).replace(/^abstract\s*/i, "") : null,
        cites: it["is-referenced-by-count"], lang: it.language, via: "crossref", step });
    }).filter(r => r.title),
    europepmc: (j, step) => ((j && j.resultList && j.resultList.result) || []).map(r => {
      const ft = r.fullTextUrlList && Array.isArray(r.fullTextUrlList.fullTextUrl) ? r.fullTextUrlList.fullTextUrl.find(f => f && /open|free/i.test(f.availability || "")) : null;
      const y = Number(r.pubYear);
      return rec({ kind: r.source === "PPR" ? "preprint" : "paper", title: stripTags(r.title || "").replace(/\.$/, ""), authors: String(r.authorString || "").split(/,\s*/).slice(0, 6), year: Number.isFinite(y) ? y : null,
        date: r.firstPublicationDate || null, venue: (r.journalInfo && r.journalInfo.journal && r.journalInfo.journal.title) || r.journalTitle, doi: normDoi(r.doi),
        url: r.pmid ? `https://europepmc.org/article/MED/${enc(r.pmid)}` : r.id ? `https://europepmc.org/article/${enc(r.source || "MED")}/${enc(r.id)}` : null,
        oa: ft ? ft.url : r.pmcid && r.isOpenAccess === "Y" ? `https://europepmc.org/article/PMC/${enc(r.pmcid)}` : null,
        abstract: r.abstractText ? stripTags(r.abstractText) : null, cites: Number.isFinite(Number(r.citedByCount)) ? Number(r.citedByCount) : null, lang: r.language || null, via: "europepmc", step });
    }).filter(r => r.title),
    // arXiv answers Atom XML; a small tag reader is enough for its fixed layout (no DOM in Node).
    arxiv: (xml, step) => {
      const text = String(xml || ""), out = [];
      const tag = (s, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(s); return m ? stripTags(m[1]) : null; };
      for (const m of text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
        const e = m[1], id = tag(e, "id"), pub = tag(e, "published");
        const pdf = /<link[^>]*title="pdf"[^>]*href="([^"]+)"/i.exec(e) || /<link[^>]*href="([^"]+)"[^>]*title="pdf"/i.exec(e);
        out.push(rec({ kind: "preprint", title: tag(e, "title"), authors: [...e.matchAll(/<name>([\s\S]*?)<\/name>/gi)].map(a => stripTags(a[1])), year: pub ? Number(pub.slice(0, 4)) : null,
          date: pub ? pub.slice(0, 10) : null, venue: "arXiv", doi: normDoi(tag(e, "arxiv:doi")), url: id, oa: pdf ? pdf[1] : id, abstract: tag(e, "summary"), via: "arxiv", step }));
      }
      return out.filter(r => r.title);
    },
    semanticscholar: (j, step) => ((j && j.data) || []).map(p => rec({ kind: "paper", title: p.title, authors: (p.authors || []).map(a => a && a.name), year: p.year, date: p.publicationDate,
      venue: p.venue || null, doi: normDoi(p.externalIds && p.externalIds.DOI), url: p.url, oa: p.openAccessPdf && p.openAccessPdf.url, abstract: p.abstract, cites: p.citationCount, via: "semanticscholar", step })).filter(r => r.title),
    gdelt: (j, step) => ((j && j.articles) || []).map(a => {
      const s = String(a.seendate || ""), d = /^(\d{4})(\d{2})(\d{2})/.exec(s);
      return rec({ kind: "news", title: a.title, url: a.url, year: d ? Number(d[1]) : null, date: d ? `${d[1]}-${d[2]}-${d[3]}` : null, venue: a.domain, domain: a.domain, lang: a.language, via: "gdelt", step });
    }).filter(r => r.title && r.url),
    // Wayback availability -> {archived, url, at} (the closest capture, or none).
    wayback: j => {
      const c = j && j.archived_snapshots && j.archived_snapshots.closest;
      if (!c || !c.available) return { archived: false, url: null, at: null };
      const t = String(c.timestamp || ""), at = /^\d{14}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null;
      return { archived: true, url: safeUrl(c.url), at };
    }
  };

  /* ---------------- merge ---------------- */
  function mergeInto(a, b) {
    for (const k of ["title", "venue", "doi", "url", "oa", "date", "lang", "oaId", "domain"]) if (!a[k] && b[k]) a[k] = b[k];
    if (b.abstract && (!a.abstract || b.abstract.length > a.abstract.length)) a.abstract = b.abstract;
    if (!a.year && b.year) a.year = b.year;
    if (finite(b.cites) && (!finite(a.cites) || b.cites > a.cites)) a.cites = b.cites;
    if (b.authors.length > a.authors.length) a.authors = b.authors;
    if (b.retracted) a.retracted = true;
    if (a.kind === "preprint" && b.kind === "paper") a.kind = "paper";
    for (const t of b.topics) if (!a.topics.includes(t) && a.topics.length < 5) a.topics.push(t);
    for (const r of b.refs) if (!a.refs.includes(r)) a.refs.push(r);
    for (const v of b.via) if (!a.via.includes(v)) a.via.push(v);
    for (const s of b.steps) if (!a.steps.includes(s)) a.steps.push(s);
    if (a.doi) a.key = "doi:" + a.doi;
    return a;
  }
  function merge(lists) {
    const byKey = new Map(), byTitle = new Map();
    for (const list of lists) for (const r0 of list || []) {
      if (!r0 || !r0.title) continue;
      const r = JSON.parse(JSON.stringify(r0)), t = normTitle(r.title);
      const hit = (r.doi && byKey.get("doi:" + r.doi)) || (t.length > 12 && byTitle.get(t)) || byKey.get(r.key);
      if (hit) { mergeInto(hit, r); byKey.set(hit.key, hit); if (t.length > 12) byTitle.set(t, hit); continue; }
      byKey.set(r.key, r);
      if (t.length > 12) byTitle.set(t, r);
    }
    return [...new Set(byKey.values())];
  }

  /* ---------------- score ---------------- */
  const KIND_W = { paper: 1, preprint: 0.85, encyclopedia: 0.75, news: 0.6 };
  // score(): BM25 (k1 1.2, b 0.75; title counted twice) normalised to the best record, then a weighted blend.
  // A retracted record keeps its place in the list with score 0 and a red flag. [INFERENCE]
  function score(records, terms, now) {
    const year = new Date(finite(now) ? now : Date.parse("2026-01-01T00:00:00Z")).getUTCFullYear();
    const q = [...new Set(terms)].filter(Boolean);
    const docs = records.map(r => { const t = tokens(r.title); return [...t, ...t, ...tokens(r.abstract || "")]; });
    const N = docs.length || 1, avg = docs.reduce((s, d) => s + d.length, 0) / N || 1;
    const df = new Map(q.map(t => [t, docs.filter(d => d.includes(t)).length]));
    const bm = docs.map(d => {
      let s = 0;
      for (const t of q) {
        const f = d.filter(x => x === t).length;
        if (!f) continue;
        const n = df.get(t), idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += idf * (f * 2.2) / (f + 1.2 * (1 - 0.75 + 0.75 * d.length / avg));
      }
      return s;
    });
    const maxBm = Math.max(1e-9, ...bm), maxC = Math.max(1, ...records.map(r => (finite(r.cites) ? r.cites : 0)));
    return records.map((r, i) => {
      const rel = bm[i] / maxBm, cite = finite(r.cites) ? Math.log1p(r.cites) / Math.log1p(maxC) : 0;
      const fresh = r.year ? Math.exp(-Math.max(0, year - r.year) / 8) : 0.3, corr = clamp((r.via.length - 1) / 2, 0, 1), oa = r.oa ? 1 : 0;
      const raw = (0.5 * rel + 0.2 * cite + 0.1 * fresh + 0.1 * corr + 0.1 * oa) * (KIND_W[r.kind] || 0.6);
      return { ...r, rel: +rel.toFixed(4), score: r.retracted ? 0 : +raw.toFixed(4) };
    }).sort((a, b) => b.score - a.score || (b.cites || 0) - (a.cites || 0));
  }
  // grade(): A = peer-reviewed and (found in two or more indexes or cited 50+ times); B = peer-reviewed;
  // C = preprint or encyclopedia; D = news; X = retracted. Fixed rules, not a judgement of quality. [INFERENCE]
  function grade(r) {
    if (r.retracted) return "X";
    if (r.kind === "paper") return r.via.length >= 2 || (r.cites || 0) >= 50 ? "A" : "B";
    if (r.kind === "preprint" || r.kind === "encyclopedia") return "C";
    return "D";
  }

  /* ---------------- snowball ---------------- */
  // Works cited by at least two of the top papers (co-citation), else the most-cited references of the best one,
  // and the best paper itself as the seed for "newer works that cite it".
  function snowball(records, opts = {}) {
    const top = records.filter(r => r.kind !== "news" && r.kind !== "encyclopedia" && !r.retracted && r.oaId).slice(0, opts.top || 6);
    const have = new Set(records.map(r => r.oaId).filter(Boolean)), count = new Map();
    for (const r of top) for (const ref of new Set(r.refs)) if (!have.has(ref)) count.set(ref, (count.get(ref) || 0) + 1);
    let ids = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (ids.length < 3 && top[0]) ids = ids.concat(top[0].refs.filter(r => !have.has(r) && !ids.includes(r)).slice(0, 10 - ids.length));
    return { cocited: ids.slice(0, 15), coCount: Object.fromEntries(ids.slice(0, 15).map(id => [id, count.get(id) || 1])), seed: top[0] ? top[0].oaId : null };
  }

  /* ---------------- sentences ---------------- */
  const FIND_CUES = /\b(we (found|show|report|demonstrate)|results? (show|indicate|suggest)|demonstrat|significant(ly)?|associated with|increase[sd]?|reduce[sd]?|improve[sd]?|outperform|evidence)\b|أظهرت|تشير|وجدت|أثبتت|ارتبط|زيادة|انخفاض/i;
  const COUNTER_CUES = /\b(however|limitation|limited|no significant|not significant|did not|does not|failed to|fail|unclear|controvers|inconsistent|bias|risk|challenge|concern|lack of|insufficient|caution)\b|لكن|إلا أن|محدود|لم يثبت|لا يوجد|مخاطر|تحدي|قيود/i;
  function sentences(text) {
    return String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?؟])\s+(?=[A-Z؀-ۿ0-9"(])/).map(s => s.trim()).filter(s => s.length >= 50 && s.length <= 420);
  }
  const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); };
  // keySentences(): verbatim sentences from the abstracts of the ranked records, picked by maximal marginal
  // relevance (term overlap times the record's score, minus similarity to sentences already picked).
  function keySentences(ranked, terms, opts = {}) {
    const want = opts.n || 6, mode = opts.mode || "findings", q = new Set(terms), pool = [];
    ranked.slice(0, opts.depth || 20).forEach((r, idx) => {
      if (r.retracted || !r.abstract) return;
      for (const s of sentences(r.abstract)) {
        const tk = tokens(s), hit = tk.filter(t => q.has(t)).length;
        const cue = mode === "counter" ? COUNTER_CUES.test(s) : FIND_CUES.test(s);
        if (mode === "counter" && !cue) continue;
        if (!hit && mode !== "counter") continue;
        const base = (hit / Math.sqrt(tk.length || 1) + (cue ? 0.35 : 0)) * (0.5 + r.score);
        pool.push({ text: s, key: r.key, rank: idx, tk, base });
      }
    });
    const out = [];
    while (out.length < want && pool.length) {
      let best = -1, bestV = -Infinity;
      pool.forEach((p, i) => {
        const sim = out.length ? Math.max(...out.map(o => jaccard(o.tk, p.tk))) : 0;
        const sameRec = out.filter(o => o.key === p.key).length;
        const v = 0.75 * p.base - 0.25 * sim - 0.2 * sameRec;
        if (sim < 0.5 && v > bestV) { bestV = v; best = i; }
      });
      if (best < 0) break;
      const [p] = pool.splice(best, 1);
      out.push(p);
    }
    return out.map(({ text, key }) => ({ text, key }));
  }

  /* ---------------- evaluate ---------------- */
  // evaluate(): per sub-question, how many records answered it and from which sources; then the gaps by fixed rules.
  function evaluate(planned, ranked, runs, now) {
    const year = new Date(finite(now) ? now : Date.parse("2026-01-01T00:00:00Z")).getUTCFullYear();
    const steps = planned.steps.map(s => {
      const own = runs.filter(x => x.step === s.id);
      return { id: s.id, ar: s.ar, en: s.en, records: ranked.filter(r => r.steps.includes(s.id)).length,
        sources: own.map(x => ({ source: x.source, ok: x.ok, n: x.n, ms: x.ms, tier: x.tier || null, error: x.ok ? null : str(x.error, 160) })) };
    });
    const peer = ranked.filter(r => r.kind === "paper" && !r.retracted);
    const gaps = [];
    for (const s of steps) if (s.sources.length && s.sources.every(x => !x.ok)) gaps.push({ level: "red", ar: `«${s.ar}»: لم يُجب أي مصدر، تعذر التحقق منها.`, en: `${s.en}: no source answered.` });
    else if (s.sources.length && !s.records && s.id !== "snowball") gaps.push({ level: "amber", ar: `«${s.ar}»: أجابت المصادر بلا نتائج مطابقة.`, en: `${s.en}: sources answered with no matching record.` });
    if (peer.length < 3) gaps.push({ level: "red", ar: `أقل من 3 أوراق محكّمة (${peer.length}). الخلاصة ضعيفة السند.`, en: `Fewer than 3 peer-reviewed papers (${peer.length}).` });
    if (ranked.length && !ranked.some(r => r.year && r.year >= year - 2 && r.kind !== "news")) gaps.push({ level: "amber", ar: `لا بحث منشور منذ ${year - 2}، قد تكون المعرفة قديمة.`, en: `Nothing published since ${year - 2}.` });
    if (!ranked.some(r => r.lang === "ar" || isArabic(r.title))) gaps.push({ level: "amber", ar: "لا مصدر عربي في النتائج. جرّب منصة إسناد أو مستودع QSpace من روابط البحث الخارجي.", en: "No Arabic-language source found." });
    const retracted = ranked.filter(r => r.retracted);
    if (retracted.length) gaps.push({ level: "red", ar: `${retracted.length} عمل مسحوب (retracted) استُبعد من الخلاصة.`, en: `${retracted.length} retracted work(s) excluded.` });
    const single = peer.filter(r => r.via.length === 1).length;
    if (peer.length >= 4 && single / peer.length > 0.7) gaps.push({ level: "amber", ar: "معظم الأوراق ظهرت في فهرس واحد فقط؛ التحقق المتقاطع محدود.", en: "Most papers were found in one index only." });
    const top5 = ranked.filter(r => r.kind !== "news").slice(0, 5);
    if (top5.length && !top5.some(r => r.oa)) gaps.push({ level: "amber", ar: "لا نص كامل مفتوح لأعلى خمسة مصادر؛ الخلاصة مبنية على الملخصات فقط.", en: "No open full text for the top five." });
    const failed = [...new Set(runs.filter(x => !x.ok).map(x => x.source))];
    if (failed.length) gaps.push({ level: "amber", ar: `مصادر لم تُجب: ${failed.map(k => (SOURCES[k] || { name: k }).name).join("، ")}.`, en: `Sources that failed: ${failed.join(", ")}.` });
    const kinds = { paper: 0, preprint: 0, encyclopedia: 0, news: 0 };
    for (const r of ranked) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const indexes = new Set(ranked.flatMap(r => r.via));
    const years = ranked.map(r => r.year).filter(finite);
    return { steps, gaps, kpi: { records: ranked.length, peer: peer.length, preprints: kinds.preprint, encyclopedia: kinds.encyclopedia, news: kinds.news,
      indexes: indexes.size, corroborated: ranked.filter(r => r.via.length >= 2).length, oaShare: ranked.length ? +(ranked.filter(r => r.oa).length / ranked.length).toFixed(3) : 0,
      retracted: retracted.length, newest: years.length ? Math.max(...years) : null, oldest: years.length ? Math.min(...years) : null } };
  }

  /* ---------------- report ---------------- */
  function report(planned, ranked, evaluation, opts = {}) {
    const at = finite(opts.now) ? new Date(opts.now).toISOString() : null;
    const terms = [...planned.terms, ...tokens(opts.bridge || "")];
    const live = ranked.filter(r => !r.retracted);
    const refs = [], index = new Map();
    const cite = r => { if (!index.has(r.key)) { refs.push(r); index.set(r.key, refs.length); } return index.get(r.key); };
    const scholarly = live.filter(r => r.kind === "paper" || r.kind === "preprint");
    const pick = (list, n) => list.slice(0, n).map(r => ({ n: cite(r), r }));
    const summary = keySentences(scholarly.length ? scholarly : live, terms, { n: opts.summary || 6 }).map(s => ({ text: s.text, n: cite(live.find(r => r.key === s.key)) }));
    const counterS = keySentences(scholarly.filter(r => r.steps.includes("counter")).concat(scholarly), terms, { n: 3, mode: "counter" }).map(s => ({ text: s.text, n: cite(live.find(r => r.key === s.key)) }));
    const define = live.find(r => r.kind === "encyclopedia" && r.steps.includes("define"));
    const sections = {
      define: define ? { text: sentences(define.abstract).slice(0, 2).join(" ") || str(define.abstract, 500), n: cite(define) } : null,
      summary, counter: counterS,
      strongest: pick(scholarly.filter(r => r.kind === "paper"), 6),
      recent: pick(scholarly.filter(r => r.year && r.year >= planned.year - 2).sort((a, b) => (b.year - a.year) || (b.score - a.score)), 5),
      foundations: pick(scholarly.filter(r => r.steps.includes("foundations") || r.steps.includes("snowball")).sort((a, b) => (b.cites || 0) - (a.cites || 0)), 5),
      arabic: pick(live.filter(r => r.lang === "ar" || isArabic(r.title)), 5),
      news: pick(live.filter(r => r.kind === "news"), 6)
    };
    for (const r of live.slice(0, 30)) cite(r);
    return { format: VERSION, query: planned.query, lang: planned.lang, bridge: opts.bridge || null, generatedAt: at, depth: planned.depth,
      label: "[INFERENCE] ranking, grades and grouping are fixed rules; quoted sentences are verbatim from the cited abstract",
      sections, gaps: evaluation.gaps, kpi: evaluation.kpi, steps: evaluation.steps,
      references: refs.map((r, i) => ({ n: i + 1, key: r.key, kind: r.kind, grade: grade(r), title: r.title, authors: r.authors, year: r.year, date: r.date, venue: r.venue, doi: r.doi, url: r.url, oa: r.oa,
        cites: r.cites, via: r.via, score: r.score, retracted: r.retracted, archive: r.archive || null, lang: r.lang })),
      retracted: ranked.filter(r => r.retracted).map(r => ({ title: r.title, doi: r.doi, url: r.url })) };
  }
  const GRADE_AR = { A: "محكّم ومؤكد", B: "محكّم", C: "مسودة أو موسوعة", D: "خبر", X: "مسحوب" };
  function markdown(rep) {
    const L = [], ref = n => `[${n}]`;
    const item = x => `- ${x.r.title}${x.r.year ? ` (${x.r.year})` : ""}${x.r.venue ? ` · ${x.r.venue}` : ""}${finite(x.r.cites) ? ` · الاستشهادات ${x.r.cites}` : ""} ${ref(x.n)}`;
    L.push(`# تقرير بحث عميق: ${rep.query}`, "");
    L.push(`> وكيل أوميغا للبحث العميق (ORACLE)${rep.generatedAt ? ` · ${rep.generatedAt}` : ""} · المصادر ${rep.kpi.records} · الفهارس ${rep.kpi.indexes} · ${rep.label}`);
    if (rep.bridge) L.push(`> مصطلح الجسر بين العربية والإنجليزية (من روابط ويكيبيديا): ${rep.bridge}`);
    L.push("");
    if (rep.sections.define) L.push("## تعريف", "", `${rep.sections.define.text} ${ref(rep.sections.define.n)}`, "");
    L.push("## الخلاصة المستخرجة", "", "جمل منقولة حرفياً من ملخصات منشورة، بلغتها الأصلية، مع رقم مرجعها.", "");
    if (rep.sections.summary.length) for (const s of rep.sections.summary) L.push(`- «${s.text}» ${ref(s.n)}`); else L.push("- تعذر التحقق منها: لا ملخص يطابق السؤال.");
    L.push("");
    const sec = (title, list) => { if (!list.length) return; L.push(`## ${title}`, ""); for (const x of list) L.push(item(x)); L.push(""); };
    sec("أقوى الأدلة المحكّمة", rep.sections.strongest);
    sec("أحدث ما نُشر", rep.sections.recent);
    sec("الأعمال التأسيسية", rep.sections.foundations);
    if (rep.sections.counter.length) { L.push("## قيود وأدلة معاكسة", ""); for (const s of rep.sections.counter) L.push(`- «${s.text}» ${ref(s.n)}`); L.push(""); }
    sec("السياق العربي", rep.sections.arabic);
    sec("الأخبار والمتابعة", rep.sections.news);
    L.push("## خطة البحث وما أجاب", "", "| الخطوة | المصادر | النتائج |", "|---|---|---|");
    for (const s of rep.steps) L.push(`| ${s.ar} | ${s.sources.map(x => `${(SOURCES[x.source] || { name: x.source }).name} ${x.ok ? `✓ ${x.n}` : "✗"}`).join("، ")} | ${s.records} |`);
    L.push("");
    L.push("## الفجوات وما لم يُتحقق منه", "");
    if (rep.gaps.length) for (const g of rep.gaps) L.push(`- ${g.ar}`); else L.push("- لا فجوة بالقواعد الثابتة.");
    L.push("", "## المراجع", "");
    for (const r of rep.references) {
      const who = r.authors.length ? r.authors.slice(0, 3).join("، ") + (r.authors.length > 3 ? " وآخرون" : "") + ". " : "";
      L.push(`${r.n}. ${who}${r.title}.${r.venue ? ` ${r.venue}` : ""}${r.year ? `، ${r.year}` : ""}. ${r.doi ? "https://doi.org/" + r.doi : r.url || ""} · الدرجة ${r.grade} (${GRADE_AR[r.grade]}) · الفهارس: ${r.via.map(v => (SOURCES[v] || { name: v }).name).join("، ")}${r.oa && r.oa !== r.url ? ` · نص مفتوح: ${r.oa}` : ""}${r.archive && r.archive.archived ? ` · أرشيف ${r.archive.at}: ${r.archive.url}` : ""}`);
    }
    if (rep.retracted.length) { L.push("", "### أعمال مسحوبة استُبعدت", ""); for (const r of rep.retracted) L.push(`- ${r.title}${r.doi ? " · https://doi.org/" + r.doi : ""}`); }
    L.push("", "---", "قرار المساعدة فقط. لا شيء هنا نصيحة مالية أو طبية أو قانونية، ولا ينفّذ أي أمر.");
    return L.join("\n");
  }
  // For the local model: numbered sources with their verbatim sentences, at most `max` characters in all.
  function facts(rep, max = 14000) {
    const out = [];
    let size = 0;
    const byN = new Map(rep.references.map(r => [r.n, { ...r, lines: [] }]));
    for (const s of rep.sections.summary.concat(rep.sections.counter)) if (byN.has(s.n)) byN.get(s.n).lines.push(s.text);
    if (rep.sections.define && byN.has(rep.sections.define.n)) byN.get(rep.sections.define.n).lines.push(rep.sections.define.text);
    for (const r of byN.values()) {
      const line = `[${r.n}] ${r.title}${r.year ? ` (${r.year})` : ""}${r.venue ? `, ${r.venue}` : ""}. Grade ${r.grade}.${r.lines.length ? " Quote: " + r.lines.join(" | ") : ""}`.slice(0, 900);
      if (size + line.length > max) break;
      out.push({ n: r.n, text: line });
      size += line.length;
    }
    return out;
  }

  /* ---------------- citation check ---------------- */
  // checkCitations(): splits a text into sentences and finds the [n] marks in each. A mark beyond the reference list
  // is invalid; a sentence of five words or more with no mark is unsupported. Coverage = supported / checked.
  function checkCitations(text, n) {
    const t = String(text || "").replace(/\[INFERENCE[^\]]*\]/g, "");
    const parts = t.split(/(?<=[.!?؟\n])\s+/).map(s => s.trim()).filter(Boolean);
    const cited = new Set(), invalid = new Set(), unsupported = [];
    let checked = 0, supported = 0;
    for (const s of parts) {
      const marks = [...s.matchAll(/\[(\d{1,3}(?:\s*[,،]\s*\d{1,3})*)\]/g)].flatMap(m => m[1].split(/\s*[,،]\s*/).map(Number));
      const words = s.replace(/\[[^\]]*\]/g, "").split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
      if (words < 5) continue;
      checked++;
      let good = false;
      for (const k of marks) { if (k >= 1 && k <= n) { cited.add(k); good = true; } else invalid.add(k); }
      if (good) supported++; else unsupported.push(s.slice(0, 240));
    }
    return { checked, supported, coverage: checked ? +(supported / checked).toFixed(3) : 0, cited: [...cited].sort((a, b) => a - b), invalid: [...invalid].sort((a, b) => a - b), unsupported };
  }

  /* ---------------- evidence map ---------------- */
  // graph(): up to `max` records as nodes; an edge when one record cites another (OpenAlex references) or when two
  // share a topic. Layout: Fruchterman-Reingold for a fixed number of steps from a seeded circle, so the same input
  // always draws the same map. Coordinates in 0..1.
  function graph(records, opts = {}) {
    const max = opts.max || 36, nodes = records.filter(r => !r.retracted).slice(0, max).map((r, i) => ({ i, key: r.key, kind: r.kind, score: r.score, title: r.title, year: r.year, oaId: r.oaId, topics: r.topics, refs: r.refs }));
    const edges = [], byOa = new Map(nodes.filter(n => n.oaId).map(n => [n.oaId, n.i]));
    for (const a of nodes) for (const ref of a.refs || []) if (byOa.has(ref)) edges.push({ a: a.i, b: byOa.get(ref), type: "cites" });
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const shared = (nodes[i].topics || []).filter(t => (nodes[j].topics || []).includes(t)).length;
      if (shared && !edges.some(e => (e.a === i && e.b === j) || (e.a === j && e.b === i))) edges.push({ a: i, b: j, type: "topic", w: shared });
    }
    const n = nodes.length || 1, K = Math.sqrt(1 / n) * 0.9;
    const order = { paper: 0, preprint: 1, encyclopedia: 2, news: 3 };
    nodes.forEach((p, k) => { const ang = (2 * Math.PI * k) / n + (order[p.kind] || 0) * 0.35; const rad = 0.18 + 0.22 * (1 - clamp(p.score, 0, 1)); p.x = 0.5 + rad * Math.cos(ang); p.y = 0.5 + rad * Math.sin(ang); });
    let temp = 0.08;
    for (let it = 0; it < 160; it++) {
      const dx = new Float64Array(n), dy = new Float64Array(n);
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        let ex = nodes[i].x - nodes[j].x, ey = nodes[i].y - nodes[j].y; const d = Math.max(1e-4, Math.hypot(ex, ey)), f = (K * K) / d;
        ex /= d; ey /= d; dx[i] += ex * f; dy[i] += ey * f; dx[j] -= ex * f; dy[j] -= ey * f;
      }
      for (const e of edges) {
        const A = nodes[e.a], B = nodes[e.b]; let ex = A.x - B.x, ey = A.y - B.y; const d = Math.max(1e-4, Math.hypot(ex, ey)), f = (d * d) / K * (e.type === "cites" ? 1 : 0.35);
        ex /= d; ey /= d; dx[e.a] -= ex * f; dy[e.a] -= ey * f; dx[e.b] += ex * f; dy[e.b] += ey * f;
      }
      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i]; dx[i] += (0.5 - p.x) * 0.6; dy[i] += (0.5 - p.y) * 0.6;
        const d = Math.max(1e-6, Math.hypot(dx[i], dy[i])), s = Math.min(d, temp) / d;
        p.x = clamp(p.x + dx[i] * s, 0.04, 0.96); p.y = clamp(p.y + dy[i] * s, 0.06, 0.94);
      }
      temp *= 0.975;
    }
    return { nodes: nodes.map(({ refs, topics, ...p }) => ({ ...p, x: +p.x.toFixed(4), y: +p.y.toFixed(4) })), edges };
  }

  /* ---------------- run ---------------- */
  // run(): the whole agent over an injected transport, so the page, the proxy-less bridge and the tests share it.
  //   io.get(source, url, "json" | "text") -> Promise<{data, tier}>   (throws when the source fails)
  //   io.clock() -> milliseconds, for the per-call timings (optional)
  //   opts: {now, depth: 1 | 2, off: [source keys], wayback: true, onEvent(type, data)}
  async function run(query, opts, io) {
    const o = opts || {}, now = finite(o.now) ? o.now : Date.parse("2026-01-01T00:00:00Z");
    const P = plan(query, { ...o, now });
    if (!P.query || P.terms.length === 0) throw new Error("the question has no searchable words");
    const emit = (type, data) => { try { if (typeof o.onEvent === "function") o.onEvent(type, data); } catch { /* a display error never stops the agent */ } };
    const clock = () => (io && typeof io.clock === "function" ? io.clock() : 0);
    const want = (step, source) => P.steps.some(s => s.id === step && s.sources.includes(source));
    const runs = [], lists = [];
    async function call(step, source, url, shapeFn, type) {
      if (!want(step, source)) return [];
      if (!url) { runs.push({ step, source, ok: false, n: 0, ms: 0, error: "the question is too short for this source" }); emit("fail", { step, source }); return []; }
      const t0 = clock();
      emit("call", { step, source });
      try {
        const res = await io.get(source, url, type || "json");
        const list = shapeFn(res && "data" in res ? res.data : res) || [];
        runs.push({ step, source, ok: true, n: list.length, ms: Math.round(clock() - t0), tier: res && res.tier ? res.tier : null });
        emit("done", { step, source, n: list.length });
        lists.push(list);
        return list;
      } catch (e) {
        runs.push({ step, source, ok: false, n: 0, ms: Math.round(clock() - t0), error: str(e && e.message ? e.message : e, 160) });
        emit("fail", { step, source, error: e && e.message });
        return [];
      }
    }
    emit("stage", { stage: "plan", plan: P });
    // 1. Define, and find the bridge term in the other language through Wikipedia's language links.
    emit("stage", { stage: "gather" });
    let bridge = null;
    if (want("define", "wikipedia")) {
      const other = P.lang === "ar" ? "en" : "ar";
      const hits = await call("define", "wikipedia", urls.wikiSearch(P.lang, P.query), shape.wikiSearch);
      lists.pop();
      if (hits[0]) {
        const page = await call("define", "wikipedia", urls.wikiPage(P.lang, hits[0].title, other), j => { const w = shape.wikiPage(j, P.lang, "define"); if (w) bridge = w.bridge; return w ? [w.record] : []; });
        if (!page.length) runs[runs.length - 1].note = "no page";
      }
    }
    const sq = P.lang === "ar" ? (bridge || P.query) : P.query;
    const arq = P.lang === "ar" ? P.query : bridge;
    const jobs = [
      call("evidence", "openalex", urls.openalex(sq), j => shape.openalex(j, "evidence")),
      call("evidence", "crossref", urls.crossref(sq), j => shape.crossref(j, "evidence")),
      call("evidence", "europepmc", urls.europepmc(sq), j => shape.europepmc(j, "evidence")),
      call("evidence", "semanticscholar", urls.semanticscholar(sq), j => shape.semanticscholar(j, "evidence")),
      call("recent", "openalex", urls.openalex(sq, "recent", P.year), j => shape.openalex(j, "recent")),
      call("recent", "arxiv", urls.arxiv(sq), x => shape.arxiv(x, "recent"), "text"),
      call("foundations", "openalex", urls.openalex(sq, "cited"), j => shape.openalex(j, "foundations")),
      call("counter", "openalex", urls.openalex(sq, "counter"), j => shape.openalex(j, "counter")),
      call("arabic", "openalex", urls.openalex(arq || sq, "ar"), j => shape.openalex(j, "arabic")),
      call("news", "gdelt", urls.gdelt(sq), j => shape.gdelt(j, "news"))
    ];
    if (P.lang === "en" && arq) jobs.push(call("arabic", "wikipedia", urls.wikiPage("ar", arq, "en"), j => { const w = shape.wikiPage(j, "ar", "arabic"); return w ? [w.record] : []; }));
    if (P.lang === "ar") jobs.push(call("news", "gdelt", urls.gdelt(P.query, "ar"), j => shape.gdelt(j, "news")));
    await Promise.all(jobs);
    const terms = [...P.terms, ...tokens(bridge || "")];
    emit("stage", { stage: "evaluate" });
    let ranked = score(merge(lists), terms, now);
    // 2. Snowball: co-cited references of the top papers and the newest works that cite the best one.
    if (P.depth === 2 && want("snowball", "openalex")) {
      const sb = snowball(ranked);
      const more = [];
      if (sb.cocited.length) more.push(call("snowball", "openalex", urls.openalexIds(sb.cocited), j => shape.openalex(j, "snowball")));
      if (sb.seed) more.push(call("snowball", "openalex", urls.openalexCites(sb.seed), j => shape.openalex(j, "snowball")));
      await Promise.all(more);
      ranked = score(merge(lists), terms, now);
    }
    // 3. Provenance: a Wayback capture for the top web items that have no DOI (news first).
    if (o.wayback !== false) {
      const web = ranked.filter(r => !r.doi && r.url && r.kind !== "encyclopedia").sort((a, b) => (a.kind === "news" ? -1 : 0) - (b.kind === "news" ? -1 : 0)).slice(0, 4);
      await Promise.all(web.map(async r => {
        try { const res = await io.get("wayback", urls.wayback(r.url), "json"); r.archive = shape.wayback(res && "data" in res ? res.data : res); }
        catch { r.archive = { archived: null, url: null, at: null }; }
      }));
    }
    const evaluation = evaluate(P, ranked, runs, now);
    emit("stage", { stage: "write" });
    const rep = report(P, ranked, evaluation, { now, bridge });
    return { plan: P, bridge, records: ranked, runs, evaluation, report: rep, markdown: markdown(rep), graph: graph(ranked) };
  }

  // Search links the agent does not read, for the reader to open in a new tab (Isnad has no public API).
  const LINKOUTS = Object.freeze([
    { name: "إسناد", en: "Isnad (Arabic open research)", url: () => "https://isnad.adriai.org/" },
    { name: "Google Scholar", en: "Google Scholar", url: q => `https://scholar.google.com/scholar?q=${enc(q)}` },
    { name: "BASE", en: "Bielefeld Academic Search Engine", url: q => `https://www.base-search.net/Search/Results?lookfor=${enc(q)}` },
    { name: "CORE", en: "CORE open access", url: q => `https://core.ac.uk/search?q=${enc(q)}` },
    { name: "Semantic Scholar", en: "Semantic Scholar", url: q => `https://www.semanticscholar.org/search?q=${enc(q)}` },
    { name: "PubMed", en: "PubMed", url: q => `https://pubmed.ncbi.nlm.nih.gov/?term=${enc(q)}` },
    { name: "QSpace", en: "Qatar University repository", url: q => `https://qspace.qu.edu.qa/discover?query=${enc(q)}` },
    { name: "DOAJ", en: "Directory of Open Access Journals", url: q => `https://doaj.org/search/articles?source=${enc(JSON.stringify({ query: { query_string: { query: q } } }))}` },
    { name: "arXiv", en: "arXiv", url: q => `https://arxiv.org/search/?query=${enc(q)}&searchtype=all` }
  ]);

  return Object.freeze({ VERSION, SOURCES, HOSTS, ENDPOINTS, allowed, LINKOUTS, GRADE_AR, run, plan, urls, shape, merge, score, grade, snowball, keySentences, sentences, evaluate, report, markdown, facts, checkCitations, graph,
    tokens, isArabic, normDoi, normTitle, safeUrl, cleanQuery, abstractFromIndex, arxivQuery });
})();
