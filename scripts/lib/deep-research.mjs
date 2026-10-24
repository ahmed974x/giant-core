// Deep research engine (ADR-114): pure functions shared by the ORACLE page (inlined between the OMEGA_RESEARCH
// markers by scripts/build-research-inline.mjs, because the page must work from file:// with no build step), the
// local data proxy (scripts/omega-data-proxy.mjs), the local MCP bridge (scripts/omega-mcp-bridge.mjs) and the Node
// tests (scripts/test-research.mjs). No network, no storage, no clock except where a time is passed in.
//
// The agent follows the four stages of open deep-research systems: plan, gather, evaluate, write. Every source is
// free, keyless and public, and is read passively through its documented API: OpenAlex, Crossref, Europe PMC,
// arXiv, Semantic Scholar, Wikipedia (Arabic and English), GDELT DOC 2.0 and the Internet Archive's Wayback
// availability API; ADR-115 adds DOAJ (open access journals), dblp (computer science), Wikidata (entities and the
// Arabic/English bridge) and NVD (CVE records, through the proxy). No scraping, no search-engine dorking, no
// scanning, no paid key.
//
// Two modes (ADR-115): "scholar" (the literature, as in ADR-114) and "intel", passive open-source intelligence on a
// topic: who or what it is (Wikipedia, Wikidata), what the news says in English and Arabic and how much and in what
// tone over three months (GDELT), which published vulnerabilities name it in the last 120 days (NVD, with the CISA
// KEV flag NVD carries), and the research behind it. Nothing is scanned, probed or looked up by address.
//
// Fields (ADR-122): in scholar mode a field lens adds the specialist open sources of that field: medicine
// (ClinicalTrials.gov registered trials, PubMed through NCBI E-utilities), science (Zenodo open data and software,
// OSTI.GOV technical reports), industry (OSTI.GOV reports, Zenodo, patent offices as link-outs only) and algorithms
// (Zenodo software next to dblp and arXiv). Intel mode adds FIRST EPSS, the published 30-day exploitation
// probability of each CVE NVD returned. All keyless; nothing here is medical, legal or financial advice.
//
// Contents
//   plan(query, opts)        sub-questions, each with the sources that answer it; Arabic and English bridge terms;
//                            opts.mode "scholar" (default) or "intel" (ADR-115)
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
//   trend(volume, tone)      GDELT coverage and tone over three months: last 7 days against the 3-month mean, [INFERENCE]
//   graph(records)           evidence map: links by citation and shared topic, deterministic force layout
//   allowed(source, url)     the one API path each source may take through the local proxy
//   run(query, opts, io)     the whole agent over an injected transport io.get(source, url, type) -> {data, tier}
export const OMEGA_RESEARCH = (() => {
  "use strict";
  const VERSION = "omega-research-v3";
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
  // The question's own words, unnormalised (Arabic letters kept as typed), for APIs that match exact words.
  const words = q => String(q || "").split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);

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
    wayback: { name: "Internet Archive Wayback", terms: "availability API", kind: "archive", cors: true, home: "https://web.archive.org/" },
    // ADR-115
    doaj: { name: "DOAJ", terms: "CC0 article metadata", kind: "paper", cors: true, home: "https://doaj.org/" },
    dblp: { name: "dblp", terms: "CC0, computer science", kind: "paper", cors: true, home: "https://dblp.org/" },
    wikidata: { name: "Wikidata", terms: "CC0", kind: "entity", cors: true, home: "https://www.wikidata.org/" },
    nvd: { name: "NVD (NIST)", terms: "public domain, 5 requests per 30 s", kind: "advisory", cors: false, home: "https://nvd.nist.gov/" },
    // ADR-122
    clinicaltrials: { name: "ClinicalTrials.gov", terms: "US NLM, public domain records", kind: "trial", cors: true, home: "https://clinicaltrials.gov/" },
    pubmed: { name: "PubMed (NCBI E-utilities)", terms: "NLM, 3 requests per second without a key", kind: "paper", cors: true, home: "https://pubmed.ncbi.nlm.nih.gov/" },
    zenodo: { name: "Zenodo", terms: "CERN, CC0 metadata, 25 per page anonymous", kind: "dataset", cors: true, home: "https://zenodo.org/" },
    osti: { name: "OSTI.GOV", terms: "US DOE, public metadata", kind: "report", cors: false, home: "https://www.osti.gov/" },
    epss: { name: "FIRST EPSS", terms: "FIRST.org, free use with attribution", kind: "score", cors: false, home: "https://www.first.org/epss/" }
  });
  const MODES = Object.freeze(["scholar", "intel"]);
  // Field lenses (ADR-122): each adds steps with the specialist sources of its field; "general" adds none.
  const FIELDS = Object.freeze({
    general: { ar: "عام", en: "General", steps: [] },
    medicine: { ar: "طب وصحة", en: "Medicine and health", steps: [
      { id: "trials", ar: "التجارب السريرية المسجّلة", en: "Registered clinical trials", sources: ["clinicaltrials"] },
      { id: "medline", ar: "أدبيات PubMed الطبية", en: "PubMed medical literature", sources: ["pubmed"] }] },
    science: { ar: "علوم", en: "Science", steps: [
      { id: "data", ar: "البيانات والبرمجيات المفتوحة", en: "Open data and software", sources: ["zenodo"] },
      { id: "reports", ar: "التقارير التقنية الحكومية", en: "Government technical reports", sources: ["osti"] }] },
    industry: { ar: "صناعة وهندسة", en: "Industry and engineering", steps: [
      { id: "reports", ar: "التقارير التقنية والهندسية", en: "Technical and engineering reports", sources: ["osti"] },
      { id: "data", ar: "البيانات والنماذج المفتوحة", en: "Open data and models", sources: ["zenodo"] }] },
    algorithms: { ar: "خوارزميات وحوسبة", en: "Algorithms and computing", steps: [
      { id: "code", ar: "الشيفرة والبرمجيات المنشورة", en: "Published code and software", sources: ["zenodo"] }] }
  });
  // plan(): the sub-questions in order. `bridge` holds the other-language term found through Wikipedia language links
  // (filled in after the define step), so an Arabic question also searches the English literature and back.
  function plan(query, opts = {}) {
    const q = cleanQuery(query);
    const now = finite(opts.now) ? opts.now : Date.parse("2026-01-01T00:00:00Z");
    const year = new Date(now).getUTCFullYear();
    const lang = isArabic(q) ? "ar" : "en";
    const depth = opts.depth === 1 ? 1 : 2;
    const mode = opts.mode === "intel" ? "intel" : "scholar";
    const field = mode === "scholar" && Object.prototype.hasOwnProperty.call(FIELDS, opts.field) ? opts.field : "general";
    const off = new Set(Array.isArray(opts.off) ? opts.off : []);
    const steps = mode === "intel" ? [
      { id: "define", ar: "من هو أو ما هو", en: "Who or what it is", sources: ["wikipedia", "wikidata"] },
      { id: "news", ar: "الأخبار بالعربية والإنجليزية في آخر 3 أشهر", en: "News in Arabic and English, last 3 months", sources: ["gdelt"] },
      { id: "trend", ar: "حجم التغطية ونبرتها عبر 3 أشهر", en: "Coverage volume and tone over 3 months", sources: ["gdelt"] },
      { id: "cyber", ar: "الثغرات المنشورة في آخر 120 يوماً", en: "Published vulnerabilities, last 120 days", sources: ["nvd"] },
      { id: "exploit", ar: "احتمال الاستغلال خلال 30 يوماً (EPSS)", en: "Exploitation probability in 30 days (EPSS)", sources: ["epss"] },
      { id: "evidence", ar: "البحث المحكّم وراء الموضوع", en: "Peer-reviewed research behind it", sources: ["openalex", "semanticscholar"] },
      { id: "recent", ar: `أحدث ما نُشر منذ ${year - 2}`, en: `Newest work since ${year - 2}`, sources: ["openalex"] }
    ] : [
      { id: "define", ar: "تعريف وخلفية", en: "Definition and background", sources: ["wikipedia", "wikidata"] },
      { id: "evidence", ar: "الأدلة المحكّمة الأكثر صلة", en: "Most relevant peer-reviewed evidence", sources: ["openalex", "crossref", "europepmc", "semanticscholar", "doaj", "dblp"] },
      { id: "recent", ar: `أحدث ما نُشر منذ ${year - 2}`, en: `Newest work since ${year - 2}`, sources: ["openalex", "arxiv"] },
      { id: "foundations", ar: "الأعمال التأسيسية الأكثر استشهاداً", en: "Most-cited foundations", sources: ["openalex"] },
      { id: "counter", ar: "القيود والأدلة المعاكسة", en: "Limits and counter-evidence", sources: ["openalex"] },
      { id: "arabic", ar: "المصادر العربية", en: "Arabic-language sources", sources: ["openalex", "doaj", "wikipedia"] },
      { id: "news", ar: "الأخبار في آخر 3 أشهر", en: "News, last 3 months", sources: ["gdelt"] }
    ];
    if (mode === "scholar") for (const f of FIELDS[field].steps) steps.splice(steps.length - 1, 0, { ...f, sources: f.sources.slice() });
    if (depth === 2 && mode === "scholar") steps.push({ id: "snowball", ar: "تتبّع الاستشهادات (كرة الثلج)", en: "Citation chasing (snowball)", sources: ["openalex"] });
    for (const s of steps) s.sources = s.sources.filter(k => !off.has(k));
    return { format: VERSION + "-plan", query: q, lang, year, depth, mode, field, steps: steps.filter(s => s.sources.length), terms: tokens(q).slice(0, 12) };
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
      const term = gdeltTerm(q, lang);
      return term ? `https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(term)}&mode=artlist&format=json&maxrecords=20&timespan=3months&sort=hybridrel` : null;
    },
    // ADR-115: daily coverage volume ("timelinevol", share of all monitored articles) or average tone ("timelinetone").
    gdeltTimeline: (q, kind) => {
      const term = gdeltTerm(q);
      return term ? `https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(term)}&mode=${kind === "tone" ? "timelinetone" : "timelinevol"}&format=json&timespan=3months` : null;
    },
    wayback: u => `https://archive.org/wayback/available?url=${enc(u)}`,
    // ADR-115. DOAJ takes the query in the path (Elasticsearch query string), so only plain words go in.
    doaj: q => { const w = words(q).slice(0, 8); return w.length ? `https://doaj.org/api/search/articles/${enc(w.join(" "))}?pageSize=15&page=1` : null; },
    dblp: q => { const w = words(q).filter(t => /^[A-Za-z0-9]+$/.test(t)).slice(0, 8); return w.length ? `https://dblp.org/search/publ/api?q=${enc(w.join(" "))}&format=json&h=15` : null; },
    wikidataSearch: (lang, q) => `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(q.slice(0, 120))}&language=${lang === "ar" ? "ar" : "en"}&uselang=${lang === "ar" ? "ar" : "en"}&type=item&limit=3&format=json&origin=*`,
    wikidataEntity: id => /^Q\d{1,12}$/.test(String(id)) ? `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=labels|descriptions|sitelinks/urls&languages=ar|en&sitefilter=arwiki|enwiki&format=json&origin=*` : null,
    // NVD CVE API 2.0: every word must appear in the description; published in the 120 days before `now` (its maximum range).
    nvd: (q, now) => {
      const w = [...new Set(words(q).map(t => t.toLowerCase()).filter(t => /^[a-z0-9][a-z0-9.-]{2,}$/.test(t) && !STOP.has(t)))].slice(0, 3);
      if (!w.length) return null;
      const end = new Date(finite(now) ? now : Date.parse("2026-01-01T00:00:00Z")), start = new Date(end.getTime() - 119 * 864e5);
      const iso = d => d.toISOString().slice(0, 19) + ".000";
      return `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${enc(w.join(" "))}&pubStartDate=${enc(iso(start))}&pubEndDate=${enc(iso(end))}&resultsPerPage=20&noRejected`;
    },
    // ADR-122. ClinicalTrials.gov API v2: registered studies that match the words, most relevant first.
    clinicaltrials: q => { const w = words(q).slice(0, 8); return w.length ? `https://clinicaltrials.gov/api/v2/studies?query.term=${enc(w.join(" "))}&pageSize=15&format=json&countTotal=true` : null; },
    // PubMed: esearch finds the PMIDs, esummary reads their titles, journals, dates and publication types.
    pubmedSearch: q => { const w = words(q).slice(0, 8); return w.length ? `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc(w.join(" "))}&retmode=json&retmax=15&sort=relevance&tool=omega-oracle` : null; },
    pubmedSummary: ids => { const list = (ids || []).map(String).filter(i => /^\d{1,10}$/.test(i)).slice(0, 15); return list.length ? `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${list.join(",")}&retmode=json&tool=omega-oracle` : null; },
    // Zenodo records; `type` narrows to software (the algorithms lens) or dataset. 25 per page is the anonymous maximum.
    zenodo: (q, type) => { const w = words(q).slice(0, 8); return w.length ? `https://zenodo.org/api/records?q=${enc(w.join(" "))}&size=15&sort=bestmatch${type === "software" || type === "dataset" ? "&type=" + type : ""}` : null; },
    osti: q => { const w = words(q).slice(0, 8); return w.length ? `https://www.osti.gov/api/v1/records?q=${enc(w.join(" "))}&rows=15` : null; },
    // FIRST EPSS for up to 20 CVE ids at once.
    epss: ids => { const list = [...new Set((ids || []).map(String).filter(i => /^CVE-\d{4}-\d{4,7}$/.test(i)))].slice(0, 20); return list.length ? `https://api.first.org/data/v1/epss?cve=${list.join(",")}` : null; }
  };
  function gdeltTerm(q, lang) {
    const w = q.split(" ").filter(x => x.length >= 3);
    if (!w.length) return null;
    return (w.length > 1 ? `"${w.slice(0, 6).join(" ")}"` : w[0]) + (lang === "ar" ? " sourcelang:arabic" : "");
  }
  // The proxy (and the static page) refuse every other host.
  const HOSTS = Object.freeze(["en.wikipedia.org", "ar.wikipedia.org", "api.openalex.org", "api.crossref.org", "www.ebi.ac.uk", "export.arxiv.org", "api.semanticscholar.org", "api.gdeltproject.org", "archive.org",
    "doaj.org", "dblp.org", "www.wikidata.org", "services.nvd.nist.gov",
    "clinicaltrials.gov", "eutils.ncbi.nlm.nih.gov", "zenodo.org", "www.osti.gov", "api.first.org"]);
  // allowed(): the one request shape each source may take through the local proxy: https, its own host, its one
  // API path, no credentials or port in the address. Anything else is refused before a byte leaves the laptop.
  // A third entry `true` means the path is a prefix followed by one encoded segment (DOAJ puts the query there).
  // The path may be a list when one source has two fixed API paths (PubMed's esearch and esummary, ADR-122).
  const ENDPOINTS = Object.freeze({
    wikipedia: [/^(ar|en)\.wikipedia\.org$/, "/w/api.php"], openalex: [/^api\.openalex\.org$/, "/works"], crossref: [/^api\.crossref\.org$/, "/works"],
    europepmc: [/^www\.ebi\.ac\.uk$/, "/europepmc/webservices/rest/search"], arxiv: [/^export\.arxiv\.org$/, "/api/query"], semanticscholar: [/^api\.semanticscholar\.org$/, "/graph/v1/paper/search"],
    gdelt: [/^api\.gdeltproject\.org$/, "/api/v2/doc/doc"], wayback: [/^archive\.org$/, "/wayback/available"],
    doaj: [/^doaj\.org$/, "/api/search/articles/", true], dblp: [/^dblp\.org$/, "/search/publ/api"], wikidata: [/^www\.wikidata\.org$/, "/w/api.php"],
    nvd: [/^services\.nvd\.nist\.gov$/, "/rest/json/cves/2.0"],
    clinicaltrials: [/^clinicaltrials\.gov$/, "/api/v2/studies"], pubmed: [/^eutils\.ncbi\.nlm\.nih\.gov$/, ["/entrez/eutils/esearch.fcgi", "/entrez/eutils/esummary.fcgi"]],
    zenodo: [/^zenodo\.org$/, "/api/records"], osti: [/^www\.osti\.gov$/, "/api/v1/records"], epss: [/^api\.first\.org$/, "/data/v1/epss"]
  });
  function allowed(source, url) {
    const e = Object.prototype.hasOwnProperty.call(ENDPOINTS, source) ? ENDPOINTS[source] : null;
    if (!e || typeof url !== "string" || url.length > 2000) return false;
    try {
      const u = new URL(url);
      const path = e[2] ? u.pathname.startsWith(e[1]) && /^[^/]{1,400}$/.test(u.pathname.slice(e[1].length)) : Array.isArray(e[1]) ? e[1].includes(u.pathname) : u.pathname === e[1];
      return u.protocol === "https:" && e[0].test(u.hostname) && path && !u.username && !u.password && !u.port && !u.hash;
    } catch { return false; }
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
    },
    // ADR-115. DOAJ: every journal it lists is open access and peer reviewed, so the full-text link is the oa link.
    doaj: (j, step) => ((j && j.results) || []).map(a => {
      const b = (a && a.bibjson) || {}, ids = Array.isArray(b.identifier) ? b.identifier : [], links = Array.isArray(b.link) ? b.link : [];
      const doi = ids.find(i => i && /^doi$/i.test(i.type || "")), ft = links.find(l => l && /fulltext/i.test(l.type || "")), y = Number(b.year);
      const jl = b.journal && Array.isArray(b.journal.language) ? b.journal.language.map(x => String(x).toLowerCase()) : [];
      const title = stripTags(b.title || "");
      return rec({ kind: "paper", title, authors: (b.author || []).map(x => x && x.name), year: Number.isFinite(y) && y > 1800 ? y : null,
        date: Number.isFinite(y) && y > 1800 ? String(y) + (b.month ? "-" + String(b.month).padStart(2, "0") : "") : null, venue: b.journal && b.journal.title, doi: normDoi(doi && doi.id),
        url: ft ? ft.url : null, oa: ft ? ft.url : null, abstract: b.abstract ? stripTags(b.abstract) : null, lang: isArabic(title) ? "ar" : jl.length === 1 ? jl[0].slice(0, 2) : null,
        topics: Array.isArray(b.keywords) ? b.keywords.slice(0, 5) : [], via: "doaj", step });
    }).filter(r => r.title),
    // dblp: computer-science bibliography. No abstracts; CoRR (arXiv) entries are "Informal" and count as preprints.
    dblp: (j, step) => {
      const hits = j && j.result && j.result.hits && j.result.hits.hit;
      return (Array.isArray(hits) ? hits : hits ? [hits] : []).map(h => {
        const i = (h && h.info) || {}, au = i.authors && i.authors.author, list = Array.isArray(au) ? au : au ? [au] : [], y = Number(i.year);
        const ee = Array.isArray(i.ee) ? i.ee[0] : i.ee, venue = Array.isArray(i.venue) ? i.venue[0] : i.venue;
        return rec({ kind: /informal/i.test(i.type || "") ? "preprint" : "paper", title: stripTags(i.title || "").replace(/\.$/, ""), authors: list.map(a => (typeof a === "string" ? a : a && a.text)),
          year: Number.isFinite(y) ? y : null, venue, doi: normDoi(i.doi), url: ee || i.url, via: "dblp", step });
      }).filter(r => r.title);
    },
    // Wikidata: the best-matching item for the question, then its labels, descriptions and Wikipedia pages in both languages.
    wikidataSearch: j => ((j && j.search) || []).map(x => ({ id: /^Q\d{1,12}$/.test(String(x && x.id)) ? x.id : null, label: str(x && x.label, 200), description: str(x && x.description, 300) })).filter(x => x.id),
    wikidataEntity: (j, id, lang) => {
      const e = j && j.entities && j.entities[id];
      if (!e || e.missing !== undefined) return null;
      const lab = k => (e.labels && e.labels[k] && str(e.labels[k].value, 200)) || null, des = k => (e.descriptions && e.descriptions[k] && str(e.descriptions[k].value, 300)) || null;
      const wiki = k => (e.sitelinks && e.sitelinks[k + "wiki"] && safeUrl(e.sitelinks[k + "wiki"].url)) || null;
      const other = lang === "ar" ? "en" : "ar";
      return { id, url: `https://www.wikidata.org/wiki/${id}`, label: lab(lang) || lab(other), description: des(lang) || des(other), other: lab(other), labels: { ar: lab("ar"), en: lab("en") },
        descriptions: { ar: des("ar"), en: des("en") }, wiki: { ar: wiki("ar"), en: wiki("en") } };
    },
    // NVD: one record per CVE, with its CVSS base score and the CISA KEV date NVD carries when the flaw is exploited.
    nvd: (j, step) => ((j && j.vulnerabilities) || []).map(v => {
      const c = (v && v.cve) || {}, id = str(c.id, 24);
      if (!/^CVE-\d{4}-\d{4,}$/.test(id)) return null;
      const d = (c.descriptions || []).find(x => x && x.lang === "en"), m = c.metrics || {};
      const M = (m.cvssMetricV40 || m.cvssMetricV31 || m.cvssMetricV30 || m.cvssMetricV2 || [])[0], cv = (M && M.cvssData) || {};
      const pub = str(c.published, 10), text = str(d && d.value, 2400);
      const r = rec({ kind: "advisory", title: `${id} · ${text.length > 140 ? text.slice(0, 137) + "…" : text}`, year: /^\d{4}/.test(pub) ? Number(pub.slice(0, 4)) : null, date: pub || null,
        venue: "NVD · NIST", url: `https://nvd.nist.gov/vuln/detail/${id}`, abstract: text || null, via: "nvd", step });
      r.key = "cve:" + id;
      r.cve = { id, score: finite(cv.baseScore) ? cv.baseScore : null, severity: str(cv.baseSeverity || (M && M.baseSeverity), 12) || null, version: str(cv.version, 4) || null,
        kev: !!c.cisaExploitAdd, kevDate: c.cisaExploitAdd ? str(c.cisaExploitAdd, 10) : null };
      return r;
    }).filter(Boolean),
    // ADR-122. ClinicalTrials.gov v2: one record per registered study, with its status, phase, size and sponsor.
    clinicaltrials: (j, step) => ((j && j.studies) || []).map(st => {
      const p = (st && st.protocolSection) || {}, id = p.identificationModule || {}, sm = p.statusModule || {}, dm = p.designModule || {};
      const nct = str(id.nctId, 12);
      if (!/^NCT\d{8}$/.test(nct)) return null;
      const start = str(sm.startDateStruct && sm.startDateStruct.date, 10), y = /^\d{4}/.test(start) ? Number(start.slice(0, 4)) : null;
      const phases = (Array.isArray(dm.phases) ? dm.phases : []).map(x => str(x, 16)).filter(x => /^[A-Z0-9_]+$/.test(x));
      const status = str(sm.overallStatus, 32) || null, sponsor = str(p.sponsorCollaboratorsModule && p.sponsorCollaboratorsModule.leadSponsor && p.sponsorCollaboratorsModule.leadSponsor.name, 160) || null;
      const n = Number(dm.enrollmentInfo && dm.enrollmentInfo.count);
      const r = rec({ kind: "trial", title: id.briefTitle || id.officialTitle, year: y, date: start || null, venue: "ClinicalTrials.gov",
        url: `https://clinicaltrials.gov/study/${nct}`, abstract: p.descriptionModule && p.descriptionModule.briefSummary, authors: sponsor ? [sponsor] : [],
        topics: (p.conditionsModule && Array.isArray(p.conditionsModule.conditions) ? p.conditionsModule.conditions : []).slice(0, 5), via: "clinicaltrials", step });
      r.key = "nct:" + nct;
      r.trial = { id: nct, status, phases, type: str(dm.studyType, 20) || null, enrollment: Number.isFinite(n) && n >= 0 ? n : null, sponsor, results: !!st.hasResults,
        updated: str(sm.lastUpdatePostDateStruct && sm.lastUpdatePostDateStruct.date, 10) || null };
      return r;
    }).filter(Boolean),
    pubmedSearch: j => ((j && j.esearchresult && j.esearchresult.idlist) || []).map(String).filter(i => /^\d{1,10}$/.test(i)).slice(0, 15),
    // esummary: PubMed's own publication types say when a work is a preprint or has been retracted.
    pubmedSummary: (j, step) => {
      const res = (j && j.result) || {};
      return (Array.isArray(res.uids) ? res.uids : []).map(uid => {
        const d = res[uid];
        if (!d || !/^\d{1,10}$/.test(String(uid)) || d.error) return null;
        const types = (Array.isArray(d.pubtype) ? d.pubtype : []).map(t => str(t, 60));
        const doi = (Array.isArray(d.articleids) ? d.articleids : []).find(a => a && a.idtype === "doi");
        const y = /^(\d{4})/.exec(str(d.pubdate || d.epubdate, 40));
        const lang = Array.isArray(d.lang) && d.lang[0] ? str(d.lang[0], 3).toLowerCase() : null;
        return rec({ kind: types.some(t => /preprint/i.test(t)) ? "preprint" : "paper", title: str(d.title, 400).replace(/\.$/, ""), authors: (Array.isArray(d.authors) ? d.authors : []).map(a => a && a.name),
          year: y ? Number(y[1]) : null, date: y ? str(d.sortpubdate || d.pubdate, 10).replace(/\//g, "-") : null, venue: d.fulljournalname || d.source, doi: normDoi(doi && doi.value),
          url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`, retracted: types.some(t => /retracted publication/i.test(t)), lang: lang === "eng" ? "en" : lang === "ara" ? "ar" : lang, via: "pubmed", step });
      }).filter(r => r && r.title);
    },
    // Zenodo: datasets and software are "dataset" records (archived, not peer reviewed); other uploads are preprints.
    zenodo: (j, step) => ((j && j.hits && j.hits.hits) || []).map(h => {
      const m = (h && h.metadata) || {}, type = str(m.resource_type && m.resource_type.type, 20), d = str(m.publication_date, 10);
      const open = String(m.access_right || (h.access && h.access.record) || "").toLowerCase() === "open" || (h.access && h.access.record === "public");
      const page = (h.links && (h.links.self_html || h.links.html)) || (h.id ? `https://zenodo.org/records/${enc(String(h.id))}` : null);
      const r = rec({ kind: type === "dataset" || type === "software" ? "dataset" : "preprint", title: m.title, authors: (m.creators || []).map(c => c && c.name), year: /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null,
        date: d || null, venue: "Zenodo" + (type ? " · " + type : ""), doi: normDoi(h.doi || m.doi), url: page, oa: open ? page : null, abstract: m.description ? stripTags(m.description) : null,
        topics: Array.isArray(m.keywords) ? m.keywords.slice(0, 5) : [], via: "zenodo", step });
      r.licence = str(m.license && (m.license.id || m.license), 40) || null;
      r.resource = type || null;
      return r;
    }).filter(r => r.title),
    // OSTI.GOV: journal articles count as papers, everything else (technical reports, conference papers) as reports.
    osti: (j, step) => (Array.isArray(j) ? j : []).map(x => {
      if (!x || !x.title) return null;
      const links = Array.isArray(x.links) ? x.links : [], cit = links.find(l => l && l.rel === "citation"), ft = links.find(l => l && l.rel === "fulltext");
      const d = str(x.publication_date, 10), type = str(x.product_type, 40);
      return rec({ kind: /journal article/i.test(type) ? "paper" : "report", title: x.title, authors: (Array.isArray(x.authors) ? x.authors : []).map(a => String(a).replace(/\s*\[.*$/, "")),
        year: /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null, date: d || null, venue: x.journal_name || ("OSTI.GOV" + (type ? " · " + type : "")), doi: normDoi(x.doi),
        url: (cit && cit.href) || (/^\d{1,12}$/.test(String(x.osti_id)) ? `https://www.osti.gov/biblio/${x.osti_id}` : null), oa: ft && ft.href, abstract: x.description ? stripTags(x.description) : null,
        topics: Array.isArray(x.subjects) ? x.subjects.slice(0, 5) : [], via: "osti", step });
    }).filter(Boolean),
    // EPSS: CVE id -> {epss 0..1, percentile 0..1, date} as FIRST publishes them.
    epss: j => {
      const out = {};
      for (const d of (j && Array.isArray(j.data) ? j.data : [])) {
        const id = str(d && d.cve, 24), e = Number(d && d.epss), p = Number(d && d.percentile);
        if (/^CVE-\d{4}-\d{4,7}$/.test(id) && Number.isFinite(e) && e >= 0 && e <= 1) out[id] = { epss: +e.toFixed(5), percentile: Number.isFinite(p) ? +p.toFixed(5) : null, date: str(d.date, 10) || null };
      }
      return out;
    },
    // GDELT timelines -> [{date, value}] per day (volume: % of all monitored articles; tone: average, about -10..+10).
    gdeltTimeline: j => {
      const s = j && Array.isArray(j.timeline) ? j.timeline[0] : null;
      return (s && Array.isArray(s.data) ? s.data : []).map(p => {
        const m = /^(\d{4})(\d{2})(\d{2})/.exec(String((p && p.date) || "")), v = Number(p && p.value);
        return m && Number.isFinite(v) ? { date: `${m[1]}-${m[2]}-${m[3]}`, value: v } : null;
      }).filter(Boolean).slice(-400);
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
  const KIND_W = { paper: 1, preprint: 0.85, advisory: 0.9, trial: 0.9, report: 0.8, dataset: 0.7, encyclopedia: 0.75, news: 0.6 };
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
  // C = preprint or encyclopedia; D = news; G = official public record (an NVD CVE entry, ADR-115, or a registered
  // clinical trial, ADR-122); R = technical report, dataset or software, archived but not peer reviewed (ADR-122);
  // X = retracted. Fixed rules, not a judgement of quality. [INFERENCE]
  function grade(r) {
    if (r.retracted) return "X";
    if (r.kind === "advisory" || r.kind === "trial") return "G";
    if (r.kind === "report" || r.kind === "dataset") return "R";
    if (r.kind === "paper") return r.via.length >= 2 || (r.cites || 0) >= 50 ? "A" : "B";
    if (r.kind === "preprint" || r.kind === "encyclopedia") return "C";
    return "D";
  }

  /* ---------------- trend (ADR-115) ---------------- */
  // trend(): the last 7 days of GDELT coverage against the whole 3-month mean, the peak day, and the same for tone.
  // "rising" at 1.5x or more, "falling" at 0.67x or less, else "steady". Fixed rules over GDELT's own numbers. [INFERENCE]
  function trend(volume, tone) {
    const v = (volume || []).filter(p => p && finite(p.value));
    if (v.length < 14) return null;
    const mean = a => a.reduce((x, p) => x + p.value, 0) / (a.length || 1);
    const all = mean(v), last7 = mean(v.slice(-7)), ratio = all > 0 ? last7 / all : null;
    const peak = v.reduce((b, p) => (p.value > b.value ? p : b), v[0]);
    const t = (tone || []).filter(p => p && finite(p.value));
    const tn = t.length >= 14 ? { mean: +mean(t).toFixed(3), last7: +mean(t.slice(-7)).toFixed(3) } : null;
    if (tn) tn.delta = +(tn.last7 - tn.mean).toFixed(3);
    return { label: "[INFERENCE] fixed rules over GDELT DOC 2.0 timelines", from: v[0].date, to: v[v.length - 1].date, days: v.length,
      mean: +all.toFixed(5), last7: +last7.toFixed(5), ratio: ratio === null ? null : +ratio.toFixed(3),
      dir: ratio === null ? "steady" : ratio >= 1.5 ? "rising" : ratio <= 0.67 ? "falling" : "steady", peak: { date: peak.date, value: +peak.value.toFixed(5) },
      tone: tn, series: v.slice(-92).map(p => ({ date: p.date, value: +p.value.toFixed(5) })), toneSeries: t.slice(-92).map(p => ({ date: p.date, value: +p.value.toFixed(3) })) };
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
  function evaluate(planned, ranked, runs, now, extra = {}) {
    const intel = planned.mode === "intel";
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
    if (peer.length < 3 && !intel) gaps.push({ level: "red", ar: `أقل من 3 أوراق محكّمة (${peer.length}). الخلاصة ضعيفة السند.`, en: `Fewer than 3 peer-reviewed papers (${peer.length}).` });
    if (intel && !extra.trend && runs.some(x => x.step === "trend")) gaps.push({ level: "amber", ar: "لا منحنى للتغطية الإخبارية: GDELT لم يرجع 14 يوماً على الأقل.", en: "No coverage curve: GDELT returned fewer than 14 days." });
    if (intel && ranked.filter(r => r.kind === "news").length < 3) gaps.push({ level: "amber", ar: "أقل من 3 أخبار؛ الصورة الإخبارية ناقصة.", en: "Fewer than 3 news items." });
    if (ranked.length && !ranked.some(r => r.year && r.year >= year - 2 && r.kind !== "news")) gaps.push({ level: "amber", ar: `لا بحث منشور منذ ${year - 2}، قد تكون المعرفة قديمة.`, en: `Nothing published since ${year - 2}.` });
    const field = planned.field || "general";
    if (field === "medicine" && !ranked.some(r => r.kind === "trial")) gaps.push({ level: "amber", ar: "لا تجربة سريرية مسجّلة تطابق السؤال في ClinicalTrials.gov.", en: "No registered clinical trial matched." });
    if (field === "medicine") gaps.push({ level: "amber", ar: "هذا ملخص أدلة منشورة وليس نصيحة طبية؛ القرار العلاجي للطبيب المختص.", en: "A summary of published evidence, not medical advice." });
    if (field === "industry") gaps.push({ level: "amber", ar: "براءات الاختراع لا تُقرأ آلياً (لا واجهة مفتوحة بلا مفتاح)؛ افتح Espacenet أو WIPO Patentscope من روابط البحث الخارجي.", en: "Patents are not read automatically (no keyless open API); use the patent link-outs." });
    if (intel && ranked.some(r => r.cve) && !ranked.some(r => r.cve && r.cve.epss)) gaps.push({ level: "amber", ar: "لا درجة EPSS للثغرات: FIRST لم يُجب أو لم ينشر درجة بعد.", en: "No EPSS score for the CVEs." });
    if (!intel && !ranked.some(r => r.lang === "ar" || isArabic(r.title))) gaps.push({ level: "amber", ar: "لا مصدر عربي في النتائج. جرّب منصة إسناد أو مستودع QSpace من روابط البحث الخارجي.", en: "No Arabic-language source found." });
    const retracted = ranked.filter(r => r.retracted);
    if (retracted.length) gaps.push({ level: "red", ar: `${retracted.length} عمل مسحوب (retracted) استُبعد من الخلاصة.`, en: `${retracted.length} retracted work(s) excluded.` });
    const single = peer.filter(r => r.via.length === 1).length;
    if (peer.length >= 4 && single / peer.length > 0.7) gaps.push({ level: "amber", ar: "معظم الأوراق ظهرت في فهرس واحد فقط؛ التحقق المتقاطع محدود.", en: "Most papers were found in one index only." });
    const top5 = ranked.filter(r => r.kind !== "news").slice(0, 5);
    if (top5.length && !top5.some(r => r.oa)) gaps.push({ level: "amber", ar: "لا نص كامل مفتوح لأعلى خمسة مصادر؛ الخلاصة مبنية على الملخصات فقط.", en: "No open full text for the top five." });
    const failed = [...new Set(runs.filter(x => !x.ok).map(x => x.source))];
    if (failed.length) gaps.push({ level: "amber", ar: `مصادر لم تُجب: ${failed.map(k => (SOURCES[k] || { name: k }).name).join("، ")}.`, en: `Sources that failed: ${failed.join(", ")}.` });
    const kinds = { paper: 0, preprint: 0, advisory: 0, trial: 0, report: 0, dataset: 0, encyclopedia: 0, news: 0 };
    for (const r of ranked) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const indexes = new Set(ranked.flatMap(r => r.via));
    const years = ranked.map(r => r.year).filter(finite);
    return { steps, gaps, kpi: { records: ranked.length, peer: peer.length, preprints: kinds.preprint, encyclopedia: kinds.encyclopedia, news: kinds.news,
      indexes: indexes.size, corroborated: ranked.filter(r => r.via.length >= 2).length, oaShare: ranked.length ? +(ranked.filter(r => r.oa).length / ranked.length).toFixed(3) : 0,
      retracted: retracted.length, newest: years.length ? Math.max(...years) : null, oldest: years.length ? Math.min(...years) : null,
      advisories: kinds.advisory, kev: ranked.filter(r => r.cve && r.cve.kev).length, trials: kinds.trial, reports: kinds.report, datasets: kinds.dataset,
      epssHigh: ranked.filter(r => r.cve && r.cve.epss && r.cve.epss.epss >= 0.1).length } };
  }

  /* ---------------- report ---------------- */
  function report(planned, ranked, evaluation, opts = {}) {
    const at = finite(opts.now) ? new Date(opts.now).toISOString() : null;
    const terms = [...planned.terms, ...tokens(opts.bridge || "")];
    const live = ranked.filter(r => !r.retracted);
    const refs = [], index = new Map();
    const cite = r => { if (!index.has(r.key)) { refs.push(r); index.set(r.key, refs.length); } return index.get(r.key); };
    const intel = planned.mode === "intel";
    const scholarly = live.filter(r => r.kind === "paper" || r.kind === "preprint");
    // Exploited first (CISA KEV), then the higher EPSS probability (ADR-122), then CVSS, then the newest.
    const ep = r => (r.cve && r.cve.epss ? r.cve.epss.epss : -1);
    const advisories = live.filter(r => r.kind === "advisory").sort((a, b) => (b.cve && b.cve.kev ? 1 : 0) - (a.cve && a.cve.kev ? 1 : 0) || ep(b) - ep(a) || ((b.cve && b.cve.score) || 0) - ((a.cve && a.cve.score) || 0) || String(b.date || "").localeCompare(String(a.date || "")));
    // Trials: those with posted results first, then completed, then recruiting, then the rest; newest start first.
    const TRIAL_RANK = { COMPLETED: 1, RECRUITING: 2, ACTIVE_NOT_RECRUITING: 3, ENROLLING_BY_INVITATION: 3, NOT_YET_RECRUITING: 4 };
    const tr = r => (r.trial && r.trial.results ? 0 : (r.trial && TRIAL_RANK[r.trial.status]) || 5);
    const trials = live.filter(r => r.kind === "trial").sort((a, b) => tr(a) - tr(b) || String(b.date || "").localeCompare(String(a.date || "")));
    const pick = (list, n) => list.slice(0, n).map(r => ({ n: cite(r), r }));
    // In intel mode the brief opens with the newest exploited or most severe advisories, then the research.
    const pool = intel ? advisories.slice(0, 6).concat(scholarly) : scholarly.concat(trials.slice(0, 4));
    const summary = keySentences(pool.length ? pool : live, terms, { n: opts.summary || 6 }).map(s => ({ text: s.text, n: cite(live.find(r => r.key === s.key)) }));
    const counterS = keySentences(scholarly.filter(r => r.steps.includes("counter")).concat(scholarly), terms, { n: 3, mode: "counter" }).map(s => ({ text: s.text, n: cite(live.find(r => r.key === s.key)) }));
    const define = live.find(r => r.kind === "encyclopedia" && r.steps.includes("define"));
    const sections = {
      define: define ? { text: sentences(define.abstract).slice(0, 2).join(" ") || str(define.abstract, 500), n: cite(define) } : null,
      summary, counter: counterS,
      strongest: pick(scholarly.filter(r => r.kind === "paper"), 6),
      recent: pick(scholarly.filter(r => r.year && r.year >= planned.year - 2).sort((a, b) => (b.year - a.year) || (b.score - a.score)), 5),
      foundations: pick(scholarly.filter(r => r.steps.includes("foundations") || r.steps.includes("snowball")).sort((a, b) => (b.cites || 0) - (a.cites || 0)), 5),
      arabic: pick(live.filter(r => r.lang === "ar" || isArabic(r.title)), 5),
      news: pick(live.filter(r => r.kind === "news"), intel ? 10 : 6),
      advisories: pick(advisories, 8),
      trials: pick(trials, 6),
      technical: pick(live.filter(r => r.kind === "report" || r.kind === "dataset").sort((a, b) => b.score - a.score), 6),
      entity: opts.entity || null,
      trend: opts.trend || null
    };
    for (const r of live.slice(0, 30)) cite(r);
    return { format: VERSION, query: planned.query, lang: planned.lang, mode: planned.mode || "scholar", field: planned.field || "general", bridge: opts.bridge || null, generatedAt: at, depth: planned.depth,
      label: "[INFERENCE] ranking, grades and grouping are fixed rules; quoted sentences are verbatim from the cited abstract",
      sections, gaps: evaluation.gaps, kpi: evaluation.kpi, steps: evaluation.steps,
      references: refs.map((r, i) => ({ n: i + 1, key: r.key, kind: r.kind, grade: grade(r), title: r.title, authors: r.authors, year: r.year, date: r.date, venue: r.venue, doi: r.doi, url: r.url, oa: r.oa,
        cites: r.cites, via: r.via, score: r.score, retracted: r.retracted, archive: r.archive || null, lang: r.lang, cve: r.cve || null, trial: r.trial || null, licence: r.licence || null })),
      retracted: ranked.filter(r => r.retracted).map(r => ({ title: r.title, doi: r.doi, url: r.url })) };
  }
  const GRADE_AR = { A: "محكّم ومؤكد", B: "محكّم", C: "مسودة أو موسوعة", D: "خبر", G: "سجل رسمي", R: "تقرير أو بيانات", X: "مسحوب" };
  const DIR_AR = { rising: "صاعد", falling: "هابط", steady: "مستقر" };
  const pct = v => (Math.round(v * 1e4) / 1e4).toString();
  function markdown(rep) {
    const L = [], ref = n => `[${n}]`;
    const item = x => `- ${x.r.title}${x.r.year ? ` (${x.r.year})` : ""}${x.r.venue ? ` · ${x.r.venue}` : ""}${finite(x.r.cites) ? ` · الاستشهادات ${x.r.cites}` : ""} ${ref(x.n)}`;
    const intel = rep.mode === "intel";
    L.push(`# ${intel ? "تقرير استخبارات مفتوحة المصدر" : "تقرير بحث عميق"}: ${rep.query}`, "");
    L.push(`> وكيل أوميغا للبحث العميق (ORACLE) · ${intel ? "وضع الاستخبارات المفتوحة (OSINT سلبي)" : "وضع البحث العلمي"}${rep.generatedAt ? ` · ${rep.generatedAt}` : ""} · المصادر ${rep.kpi.records} · الفهارس ${rep.kpi.indexes} · ${rep.label}`);
    if (rep.bridge) L.push(`> مصطلح الجسر بين العربية والإنجليزية (من ويكيبيديا وويكي بيانات): ${rep.bridge}`);
    L.push("");
    if (rep.sections.define) L.push("## تعريف", "", `${rep.sections.define.text} ${ref(rep.sections.define.n)}`, "");
    const ent = rep.sections.entity;
    if (ent) L.push("## الكيان في ويكي بيانات", "", `- ${ent.label || ent.id} (${ent.id})${ent.description ? `: ${ent.description}` : ""} · ${ent.url}`, "");
    const tr = rep.sections.trend;
    if (tr) {
      L.push("## حجم التغطية الإخبارية ونبرتها [INFERENCE]", "");
      L.push(`- من ${tr.from} إلى ${tr.to} (${tr.days} يوماً): متوسط آخر 7 أيام ${pct(tr.last7)}% من كل الأخبار المرصودة، مقابل ${pct(tr.mean)}% في الفترة كلها${tr.ratio !== null ? `، أي ${tr.ratio} ضعف` : ""}. الاتجاه: ${DIR_AR[tr.dir]}.`);
      L.push(`- الذروة: ${tr.peak.date} عند ${pct(tr.peak.value)}%.`);
      if (tr.tone) L.push(`- النبرة (GDELT، من −10 إلى +10 تقريباً): آخر 7 أيام ${tr.tone.last7}، والمتوسط ${tr.tone.mean} (فرق ${tr.tone.delta > 0 ? "+" : ""}${tr.tone.delta}).`);
      L.push("");
    }
    if (rep.sections.advisories.length) {
      L.push("## الثغرات المنشورة (NVD، آخر 120 يوماً)", "");
      for (const x of rep.sections.advisories) { const c = x.r.cve || {}; L.push(`- ${c.id}${c.score !== null && c.score !== undefined ? ` · CVSS ${c.score}${c.severity ? " " + c.severity : ""}` : ""}${c.epss ? ` · EPSS ${(c.epss.epss * 100).toFixed(2)}% (المئين ${c.epss.percentile !== null ? Math.round(c.epss.percentile * 100) : "؟"}، ${c.epss.date || "؟"})` : ""}${c.kev ? ` · مستغلة فعلاً (CISA KEV ${c.kevDate})` : ""} · نُشرت ${x.r.date || "؟"} ${ref(x.n)}`); }
      L.push("");
    }
    L.push("## الخلاصة المستخرجة", "", "جمل منقولة حرفياً من ملخصات منشورة، بلغتها الأصلية، مع رقم مرجعها.", "");
    if (rep.sections.summary.length) for (const s of rep.sections.summary) L.push(`- «${s.text}» ${ref(s.n)}`); else L.push("- تعذر التحقق منها: لا ملخص يطابق السؤال.");
    L.push("");
    const sec = (title, list) => { if (!list.length) return; L.push(`## ${title}`, ""); for (const x of list) L.push(item(x)); L.push(""); };
    if (rep.sections.trials && rep.sections.trials.length) {
      L.push("## التجارب السريرية المسجّلة (ClinicalTrials.gov)", "");
      for (const x of rep.sections.trials) { const t = x.r.trial || {}; L.push(`- ${t.id} · ${x.r.title}${t.status ? ` · ${t.status}` : ""}${t.phases && t.phases.length ? ` · ${t.phases.join("/")}` : ""}${t.enrollment !== null && t.enrollment !== undefined ? ` · المشاركون ${t.enrollment}` : ""}${t.results ? " · نتائج منشورة" : ""}${x.r.date ? ` · بدأت ${x.r.date}` : ""} ${ref(x.n)}`); }
      L.push("");
    }
    sec("أقوى الأدلة المحكّمة", rep.sections.strongest);
    sec("أحدث ما نُشر", rep.sections.recent);
    sec("الأعمال التأسيسية", rep.sections.foundations);
    if (rep.sections.counter.length) { L.push("## قيود وأدلة معاكسة", ""); for (const s of rep.sections.counter) L.push(`- «${s.text}» ${ref(s.n)}`); L.push(""); }
    sec("التقارير التقنية والبيانات والبرمجيات", rep.sections.technical || []);
    sec("السياق العربي", rep.sections.arabic);
    if (!intel) sec("الأخبار والمتابعة", rep.sections.news);
    else if (rep.sections.news.length) { L.push("## الأخبار (GDELT)", ""); for (const x of rep.sections.news) L.push(`- ${x.r.title}${x.r.date ? ` (${x.r.date})` : ""}${x.r.venue ? ` · ${x.r.venue}` : ""} ${ref(x.n)}`); L.push(""); }
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
    if (intel && rep.references.some(r => r.cve && r.cve.epss)) L.push("", "درجات EPSS من FIRST.org (Exploit Prediction Scoring System)، احتمال منشور لا حكم من الوكيل.");
    L.push("", "---", intel ? "استخبارات مفتوحة سلبية: قراءة واجهات عامة فقط، بلا مسح ولا فحص منافذ ولا بحث عن عناوين. للمساعدة في القرار فقط، ولا ينفّذ أي أمر." : "قرار المساعدة فقط. لا شيء هنا نصيحة مالية أو طبية أو قانونية، ولا ينفّذ أي أمر.");
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
    const order = { paper: 0, preprint: 1, encyclopedia: 2, news: 3, advisory: 4, trial: 5, report: 6, dataset: 7 };
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
  //   opts: {now, depth: 1 | 2, mode: "scholar" | "intel", field: one of FIELDS (scholar only), off: [source keys],
  //          wayback: true, onEvent(type, data)}
  async function run(query, opts, io) {
    const o = opts || {}, now = finite(o.now) ? o.now : Date.parse("2026-01-01T00:00:00Z");
    const P = plan(query, { ...o, now });
    if (!P.query || P.terms.length === 0) throw new Error("the question has no searchable words");
    const emit = (type, data) => { try { if (typeof o.onEvent === "function") o.onEvent(type, data); } catch { /* a display error never stops the agent */ } };
    const clock = () => (io && typeof io.clock === "function" ? io.clock() : 0);
    const want = (step, source) => P.steps.some(s => s.id === step && s.sources.includes(source));
    const runs = [], lists = [];
    async function call(step, source, url, shapeFn, type, keep = true) {
      if (!want(step, source)) return [];
      if (!url) { runs.push({ step, source, ok: false, n: 0, ms: 0, error: "the question is too short for this source" }); emit("fail", { step, source }); return []; }
      const t0 = clock();
      emit("call", { step, source });
      try {
        const res = await io.get(source, url, type || "json");
        const list = shapeFn(res && "data" in res ? res.data : res) || [];
        runs.push({ step, source, ok: true, n: list.length, ms: Math.round(clock() - t0), tier: res && res.tier ? res.tier : null });
        emit("done", { step, source, n: list.length });
        if (keep) lists.push(list);
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
    // Wikidata: the entity card, and the bridge term when Wikipedia had no language link (ADR-115).
    let entity = null;
    if (want("define", "wikidata")) {
      const found = await call("define", "wikidata", urls.wikidataSearch(P.lang, P.query), shape.wikidataSearch, "json", false);
      if (found[0]) {
        await call("define", "wikidata", urls.wikidataEntity(found[0].id), j => { entity = shape.wikidataEntity(j, found[0].id, P.lang); return entity ? [entity] : []; }, "json", false);
        if (!entity) entity = { id: found[0].id, url: `https://www.wikidata.org/wiki/${found[0].id}`, label: found[0].label, description: found[0].description, other: null };
        if (!bridge && entity.other) bridge = entity.other;
      }
    }
    const sq = P.lang === "ar" ? (bridge || P.query) : P.query;
    const arq = P.lang === "ar" ? P.query : bridge;
    let volume = null, tone = null;
    const jobs = P.mode === "intel" ? [
      call("news", "gdelt", urls.gdelt(sq), j => shape.gdelt(j, "news")),
      call("news", "gdelt", urls.gdelt(arq || P.query, "ar"), j => shape.gdelt(j, "news")),
      call("trend", "gdelt", urls.gdeltTimeline(sq, "volume"), j => (volume = shape.gdeltTimeline(j)), "json", false),
      call("trend", "gdelt", urls.gdeltTimeline(sq, "tone"), j => (tone = shape.gdeltTimeline(j)), "json", false),
      call("cyber", "nvd", urls.nvd(sq, now), j => shape.nvd(j, "cyber")),
      call("evidence", "openalex", urls.openalex(sq), j => shape.openalex(j, "evidence")),
      call("evidence", "semanticscholar", urls.semanticscholar(sq), j => shape.semanticscholar(j, "evidence")),
      call("recent", "openalex", urls.openalex(sq, "recent", P.year), j => shape.openalex(j, "recent"))
    ] : [
      call("evidence", "doaj", urls.doaj(sq), j => shape.doaj(j, "evidence")),
      call("evidence", "dblp", urls.dblp(sq), j => shape.dblp(j, "evidence")),
      call("arabic", "doaj", arq ? urls.doaj(arq) : null, j => shape.doaj(j, "arabic")),
      call("evidence", "openalex", urls.openalex(sq), j => shape.openalex(j, "evidence")),
      call("evidence", "crossref", urls.crossref(sq), j => shape.crossref(j, "evidence")),
      call("evidence", "europepmc", urls.europepmc(sq), j => shape.europepmc(j, "evidence")),
      call("evidence", "semanticscholar", urls.semanticscholar(sq), j => shape.semanticscholar(j, "evidence")),
      call("recent", "openalex", urls.openalex(sq, "recent", P.year), j => shape.openalex(j, "recent")),
      call("recent", "arxiv", urls.arxiv(sq), x => shape.arxiv(x, "recent"), "text"),
      call("foundations", "openalex", urls.openalex(sq, "cited"), j => shape.openalex(j, "foundations")),
      call("counter", "openalex", urls.openalex(sq, "counter"), j => shape.openalex(j, "counter")),
      call("arabic", "openalex", urls.openalex(arq || sq, "ar"), j => shape.openalex(j, "arabic")),
      call("news", "gdelt", urls.gdelt(sq), j => shape.gdelt(j, "news")),
      // ADR-122 field lenses (each call is skipped unless the plan has its step)
      call("trials", "clinicaltrials", urls.clinicaltrials(sq), j => shape.clinicaltrials(j, "trials")),
      (async () => {
        const ids = await call("medline", "pubmed", urls.pubmedSearch(sq), shape.pubmedSearch, "json", false);
        if (ids.length) await call("medline", "pubmed", urls.pubmedSummary(ids), j => shape.pubmedSummary(j, "medline"));
      })(),
      call("data", "zenodo", urls.zenodo(sq), j => shape.zenodo(j, "data")),
      call("code", "zenodo", urls.zenodo(sq, "software"), j => shape.zenodo(j, "code")),
      call("reports", "osti", urls.osti(sq), j => shape.osti(j, "reports"))
    ];
    if (P.mode !== "intel" && P.lang === "en" && arq) jobs.push(call("arabic", "wikipedia", urls.wikiPage("ar", arq, "en"), j => { const w = shape.wikiPage(j, "ar", "arabic"); return w ? [w.record] : []; }));
    if (P.mode !== "intel" && P.lang === "ar") jobs.push(call("news", "gdelt", urls.gdelt(P.query, "ar"), j => shape.gdelt(j, "news")));
    await Promise.all(jobs);
    // ADR-122: FIRST EPSS for the CVEs NVD returned, joined onto their records (no records of its own).
    if (P.mode === "intel" && want("exploit", "epss")) {
      const cves = lists.flat().filter(r => r && r.cve).map(r => r.cve.id);
      if (cves.length) {
        const scores = {};
        await call("exploit", "epss", urls.epss(cves), j => { Object.assign(scores, shape.epss(j)); return Object.keys(scores); }, "json", false);
        for (const r of lists.flat()) if (r && r.cve && scores[r.cve.id]) r.cve.epss = scores[r.cve.id];
      }
    }
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
    const tr = trend(volume, tone);
    const evaluation = evaluate(P, ranked, runs, now, { trend: tr });
    emit("stage", { stage: "write" });
    const rep = report(P, ranked, evaluation, { now, bridge, entity, trend: tr });
    return { plan: P, bridge, entity, trend: tr, records: ranked, runs, evaluation, report: rep, markdown: markdown(rep), graph: graph(ranked) };
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
    { name: "arXiv", en: "arXiv", url: q => `https://arxiv.org/search/?query=${enc(q)}&searchtype=all` },
    // ADR-122: patent offices have no keyless open API, so they stay links the reader opens.
    { name: "Espacenet", en: "European Patent Office", url: q => `https://worldwide.espacenet.com/patent/search?q=${enc(q)}` },
    { name: "Patentscope", en: "WIPO patents", url: q => `https://patentscope.wipo.int/search/en/result.jsf?query=${enc(q)}` },
    { name: "ClinicalTrials.gov", en: "Registered clinical trials", url: q => `https://clinicaltrials.gov/search?term=${enc(q)}` }
  ]);

  return Object.freeze({ VERSION, SOURCES, MODES, FIELDS, HOSTS, ENDPOINTS, allowed, LINKOUTS, GRADE_AR, DIR_AR, run, plan, urls, shape, merge, score, grade, snowball, keySentences, sentences, evaluate, report, markdown, facts, checkCitations, graph, trend,
    tokens, words, isArabic, normDoi, normTitle, safeUrl, cleanQuery, abstractFromIndex, arxivQuery });
})();
