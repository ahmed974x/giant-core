// Tests for the deep research engine (scripts/lib/deep-research.mjs, ADR-114, ADR-115 and ADR-122) and the ORACLE page's inline copy.
//   node scripts/test-research.mjs        exits 0 when every test passes
// No network, no dependencies. The answers below are small hand-made test fixtures in the shape each public API
// documents; they are never shown on a page. CI runs this in the skillspector workflow.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OMEGA_RESEARCH as R } from "./lib/deep-research.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
async function test(name, f) {
  try { await f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const NOW = Date.parse("2026-10-24T00:00:00Z");

// ---- fixtures in each API's documented shape ----
const W = (id, title, year, cites, extra = {}) => ({
  id: "https://openalex.org/" + id, doi: extra.doi ? "https://doi.org/" + extra.doi : null, display_name: title, publication_year: year, publication_date: `${year}-03-01`,
  cited_by_count: cites, open_access: { is_oa: !!extra.oa, oa_url: extra.oa || null }, primary_location: { landing_page_url: "https://example.org/" + id, source: { display_name: extra.venue || "Journal of Tests" } },
  authorships: [{ author: { display_name: "A. Researcher" } }, { author: { display_name: "B. Scholar" } }],
  abstract_inverted_index: extra.abs || { "Coral": [0], "reefs": [1], "bleach": [2], "under": [3], "heat": [4], "stress.": [5] }, is_retracted: !!extra.retracted, type: extra.type || "article",
  language: extra.lang || "en", topics: (extra.topics || ["Coral reef ecology"]).map(t => ({ display_name: t })), referenced_works: (extra.refs || []).map(r => "https://openalex.org/" + r)
});
const inv = text => { const ix = {}; text.split(" ").forEach((w, i) => { (ix[w] = ix[w] || []).push(i); }); return ix; };
const ABS1 = "Coral reefs worldwide are declining because marine heatwaves cause mass coral bleaching events. Our results show that bleaching frequency increased fivefold between 1980 and 2016 across tropical reefs. However, the recovery window between bleaching events is now too short for full recovery of slow-growing corals.";
const ABS2 = "We review coral bleaching physiology under thermal stress and the loss of symbiotic algae. Evidence suggests heat-tolerant symbionts improve survival of corals during marine heatwaves. A limitation of current studies is the short duration of field experiments on bleaching.";
const FIX = {
  wikiSearch: { query: { search: [{ title: "Coral bleaching", snippet: "<span class=\"searchmatch\">Coral</span> bleaching is" }] } },
  wikiPage: { query: { pages: [{ pageid: 1, title: "Coral bleaching", fullurl: "https://en.wikipedia.org/wiki/Coral_bleaching", extract: "Coral bleaching is the process when corals become white due to loss of symbiotic algae and photosynthetic pigments. This loss of pigmentation can be caused by various stressors, such as changes in ocean temperature.", langlinks: [{ lang: "ar", title: "ابيضاض المرجان" }] }] } },
  wikiPageAr: { query: { pages: [{ pageid: 2, title: "ابيضاض المرجان", fullurl: "https://ar.wikipedia.org/wiki/x", extract: "ابيضاض المرجان هو فقدان الشعاب المرجانية لألوانها بسبب ارتفاع حرارة مياه البحر وفقدان الطحالب المتعايشة معها." }] } },
  openalex: { results: [
    W("W1", "Global warming transforms coral reef assemblages", 2018, 1500, { doi: "10.1038/s41586-018-0041-2", abs: inv(ABS1), refs: ["W9", "W8"], oa: "https://example.org/oa1" }),
    W("W2", "Coral bleaching physiology under marine heatwaves", 2024, 40, { doi: "10.1000/cb.2024.1", abs: inv(ABS2), refs: ["W9", "W8"] }),
    W("W3", "A retracted coral bleaching study", 2020, 12, { doi: "10.1000/retracted.1", retracted: true }),
    W("W4", "تأثير ابيضاض المرجان في الخليج العربي", 2023, 3, { lang: "ar", topics: ["Coral reef ecology"] })
  ] },
  openalexIds: { results: [W("W9", "Climate change, coral bleaching and the future of the world's coral reefs", 1999, 4000, { doi: "10.1071/mf99078", topics: ["Coral reef ecology"] })] },
  openalexCites: { results: [W("W5", "Recovery of coral reefs after the 2016 heatwave", 2025, 15, { doi: "10.1000/rec.2025", refs: ["W1"] })] },
  crossref: { message: { items: [
    { DOI: "10.1038/S41586-018-0041-2", title: ["Global warming transforms coral reef assemblages"], author: [{ given: "Terry", family: "Hughes" }], issued: { "date-parts": [[2018, 4, 18]] }, "container-title": ["Nature"], "is-referenced-by-count": 1490, type: "journal-article", URL: "https://doi.org/10.1038/s41586-018-0041-2" },
    { DOI: "10.1000/only.crossref", title: ["Marine heatwaves and coral bleaching in the Red Sea"], issued: { "date-parts": [[2022]] }, "container-title": ["Reef Science"], "is-referenced-by-count": 20, type: "journal-article", abstract: "<jats:p>Marine heatwaves caused coral bleaching across the northern Red Sea in 2020.</jats:p>" }
  ] } },
  europepmc: { resultList: { result: [{ id: "123", source: "MED", pmid: "123", doi: "10.1000/cb.2024.1", title: "Coral bleaching physiology under marine heatwaves.", authorString: "Doe J, Roe K", pubYear: "2024", abstractText: ABS2, citedByCount: 42, isOpenAccess: "Y", pmcid: "PMC1", journalInfo: { journal: { title: "Marine Biology" } } }] } },
  arxiv: `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2501.00001v1</id><published>2025-01-02T00:00:00Z</published><title>Deep learning detects coral bleaching from satellite imagery</title><summary>We show that a convolutional network detects coral bleaching from satellite images with high accuracy across reefs during heatwaves.</summary><author><name>C. Coder</name></author><link title="pdf" href="https://arxiv.org/pdf/2501.00001v1" rel="related" type="application/pdf"/></entry></feed>`,
  s2: { data: [{ title: "Global warming transforms coral reef assemblages", year: 2018, citationCount: 1600, externalIds: { DOI: "10.1038/s41586-018-0041-2" }, url: "https://www.semanticscholar.org/paper/x", openAccessPdf: null, venue: "Nature", authors: [{ name: "T. Hughes" }] }] },
  gdelt: { articles: [{ url: "https://news.example.com/coral-2026", title: "Record coral bleaching reported on reefs", seendate: "20261001T101500Z", domain: "news.example.com", language: "English" }] },
  wayback: { archived_snapshots: { closest: { available: true, url: "http://web.archive.org/web/20261002000000/https://news.example.com/coral-2026", timestamp: "20261002000000", status: "200" } } },
  // ADR-115
  doaj: { results: [
    { bibjson: { title: "Coral bleaching physiology under marine heatwaves", year: "2024", month: "5", author: [{ name: "J. Doe" }], identifier: [{ type: "doi", id: "10.1000/CB.2024.1" }, { type: "eissn", id: "1234-5678" }],
      link: [{ type: "fulltext", url: "https://journal.example.org/cb2024", content_type: "HTML" }], journal: { title: "Open Marine Biology", language: ["EN"] }, abstract: ABS2, keywords: ["coral", "bleaching"] } },
    { bibjson: { title: "ابيضاض الشعاب المرجانية في البحر الأحمر", year: "2023", author: [{ name: "س. باحث" }], identifier: [], link: [{ type: "fulltext", url: "https://ar.journal.example.org/1" }], journal: { title: "مجلة علوم البحار", language: ["AR"] } } }
  ] },
  dblp: { result: { hits: { "@total": "2", hit: [
    { info: { authors: { author: [{ text: "C. Coder" }, { text: "D. Dev" }] }, title: "Deep learning detects coral bleaching from satellite imagery.", venue: "CoRR", year: "2025", type: "Informal and Other Publications", ee: "https://arxiv.org/abs/2501.00001", url: "https://dblp.org/rec/x" } },
    { info: { authors: { author: { text: "E. Engineer" } }, title: "Edge sensors for reef temperature monitoring.", venue: ["IoT J.", "x"], year: "2023", type: "Journal Articles", doi: "10.1000/edge.2023", ee: ["https://doi.org/10.1000/edge.2023"] } }
  ] } } },
  wdSearch: { search: [{ id: "Q1047062", label: "coral bleaching", description: "loss of colour in corals" }, { id: "x1", label: "bad id" }] },
  wdEntity: { entities: { Q1047062: { id: "Q1047062", labels: { en: { value: "coral bleaching" }, ar: { value: "ابيضاض المرجان" } }, descriptions: { en: { value: "loss of colour in corals" } },
    sitelinks: { enwiki: { url: "https://en.wikipedia.org/wiki/Coral_bleaching" }, arwiki: { url: "javascript:alert(1)" } } } } },
  nvd: { vulnerabilities: [
    { cve: { id: "CVE-2026-1111", published: "2026-09-01T10:00:00.000", descriptions: [{ lang: "en", value: "A buffer overflow in the reef sensor firmware allows remote attackers to execute code. Attackers exploited the flaw against coral monitoring stations." }],
      metrics: { cvssMetricV31: [{ cvssData: { version: "3.1", baseScore: 9.8, baseSeverity: "CRITICAL" } }] }, cisaExploitAdd: "2026-09-10" } },
    { cve: { id: "CVE-2026-2222", published: "2026-10-01T10:00:00.000", descriptions: [{ lang: "es", value: "x" }, { lang: "en", value: "Cross-site scripting in the coral bleaching dashboard lets attackers inject script into reports viewed by operators." }],
      metrics: { cvssMetricV31: [{ cvssData: { version: "3.1", baseScore: 6.1, baseSeverity: "MEDIUM" } }] } } },
    { cve: { id: "not-a-cve" } }
  ] },
  gdeltVol: { timeline: [{ series: "Volume Intensity", data: Array.from({ length: 30 }, (_, i) => ({ date: `202609${String(i + 1).padStart(2, "0")}T000000Z`, value: i >= 23 ? 0.3 : 0.1 })) }] },
  // ADR-122
  ct: { totalCount: 2, studies: [
    { protocolSection: { identificationModule: { nctId: "NCT01234567", briefTitle: "Heat-tolerant symbionts for coral restoration divers' health" }, statusModule: { overallStatus: "COMPLETED", startDateStruct: { date: "2023-05" }, lastUpdatePostDateStruct: { date: "2025-01-10" } },
      designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE2"], enrollmentInfo: { count: 120 } }, sponsorCollaboratorsModule: { leadSponsor: { name: "Reef Health Institute" } },
      descriptionModule: { briefSummary: "This trial tests whether divers exposed to marine heatwaves during coral bleaching surveys show heat strain, and whether cooling vests reduce it significantly." }, conditionsModule: { conditions: ["Heat Stress"] } }, hasResults: true },
    { protocolSection: { identificationModule: { nctId: "NCT0BAD" } } },
    { protocolSection: { identificationModule: { nctId: "NCT07654321", briefTitle: "Coral bleaching exposure and skin irritation" }, statusModule: { overallStatus: "RECRUITING", startDateStruct: { date: "2026-02-01" } }, designModule: { studyType: "OBSERVATIONAL" } } }
  ] },
  pmSearch: { esearchresult: { count: "2", idlist: ["40000001", "40000002", "bad"] } },
  pmSummary: { result: { uids: ["40000001", "40000002"],
    "40000001": { uid: "40000001", title: "Coral bleaching physiology under marine heatwaves.", pubdate: "2024 May", sortpubdate: "2024/05/01 00:00", fulljournalname: "Marine Biology", authors: [{ name: "Doe J" }], articleids: [{ idtype: "doi", value: "10.1000/cb.2024.1" }], pubtype: ["Journal Article"], lang: ["eng"] },
    "40000002": { uid: "40000002", title: "Retracted: coral bleaching cure", pubdate: "2021", fulljournalname: "Fake Journal", authors: [], articleids: [], pubtype: ["Journal Article", "Retracted Publication"], lang: ["eng"] } } },
  zenodo: { hits: { hits: [
    { id: 777, doi: "10.5281/zenodo.777", links: { self_html: "https://zenodo.org/records/777" }, metadata: { title: "Coral bleaching heatwave dataset 1985-2025", publication_date: "2025-06-01", creators: [{ name: "Reef Lab" }], description: "<p>Daily degree heating weeks for coral reefs.</p>", resource_type: { type: "dataset" }, access_right: "open", license: { id: "cc-by-4.0" }, keywords: ["coral", "bleaching"] } },
    { id: 778, links: { self_html: "javascript:alert(1)" }, metadata: { title: "Bleaching detector code", publication_date: "2024-01-01", resource_type: { type: "software" }, access_right: "closed" } }
  ] } },
  osti: [
    { osti_id: "1990001", title: "Thermal stress modelling of reef-building corals", authors: ["Smith, A [Sandia]", "Lee, B"], publication_date: "2024-03-01T00:00:00Z", product_type: "Technical Report", description: "We model coral bleaching thresholds under marine heatwaves for desalination outfalls.", links: [{ rel: "citation", href: "https://www.osti.gov/biblio/1990001" }, { rel: "fulltext", href: "https://www.osti.gov/servlets/purl/1990001" }] },
    { osti_id: "x", title: "" }
  ],
  epss: { status: "OK", data: [{ cve: "CVE-2026-2222", epss: "0.42100", percentile: "0.97200", date: "2026-10-23" }, { cve: "CVE-2026-1111", epss: "0.03000", percentile: "0.81000", date: "2026-10-23" }, { cve: "bad", epss: "2" }] },
  gdeltTone: { timeline: [{ series: "Average Tone", data: Array.from({ length: 30 }, (_, i) => ({ date: `202609${String(i + 1).padStart(2, "0")}T000000Z`, value: i >= 23 ? -4 : -1 })) }] }
};
const io = (fail = new Set()) => ({
  clock: () => 0,
  async get(source, url, type) {
    if (fail.has(source)) throw new Error(source + " offline");
    const u = new URL(url);
    if (!R.HOSTS.includes(u.hostname)) throw new Error("host not allowed: " + u.hostname);
    let data;
    if (source === "wikipedia") data = u.searchParams.get("list") === "search" ? FIX.wikiSearch : u.hostname.startsWith("ar.") ? FIX.wikiPageAr : FIX.wikiPage;
    else if (source === "openalex") { const f = u.searchParams.get("filter") || ""; data = f.startsWith("ids.openalex") ? FIX.openalexIds : f.startsWith("cites:") ? FIX.openalexCites : FIX.openalex; }
    else if (source === "crossref") data = FIX.crossref;
    else if (source === "europepmc") data = FIX.europepmc;
    else if (source === "arxiv") { ok(type === "text", "arXiv is XML text"); data = FIX.arxiv; }
    else if (source === "semanticscholar") data = FIX.s2;
    else if (source === "gdelt") { const m = u.searchParams.get("mode"); data = m === "timelinevol" ? FIX.gdeltVol : m === "timelinetone" ? FIX.gdeltTone : FIX.gdelt; }
    else if (source === "wayback") data = FIX.wayback;
    else if (source === "doaj") data = decodeURIComponent(u.pathname).includes("ابيضاض") ? { results: [FIX.doaj.results[1]] } : FIX.doaj;
    else if (source === "dblp") data = FIX.dblp;
    else if (source === "wikidata") data = u.searchParams.get("action") === "wbsearchentities" ? FIX.wdSearch : FIX.wdEntity;
    else if (source === "nvd") data = FIX.nvd;
    else if (source === "clinicaltrials") data = FIX.ct;
    else if (source === "pubmed") data = u.pathname.endsWith("esearch.fcgi") ? FIX.pmSearch : FIX.pmSummary;
    else if (source === "zenodo") data = FIX.zenodo;
    else if (source === "osti") data = FIX.osti;
    else if (source === "epss") data = FIX.epss;
    else throw new Error("unknown source " + source);
    return { data: JSON.parse(JSON.stringify(data)), tier: "direct" };
  }
});

await test("plan: steps, languages and the snowball only at depth 2", () => {
  const p = R.plan("Coral bleaching and marine heatwaves", { now: NOW, depth: 2 });
  ok(p.lang === "en" && p.year === 2026, "language or year");
  ok(p.steps.map(s => s.id).join() === "define,evidence,recent,foundations,counter,arabic,news,snowball", "steps " + p.steps.map(s => s.id));
  ok(!R.plan("x y coral", { depth: 1 }).steps.some(s => s.id === "snowball"), "depth 1 has no snowball");
  ok(R.plan("ابيضاض المرجان", {}).lang === "ar", "Arabic detected");
  ok(R.plan("coral", { off: ["gdelt"] }).steps.every(s => s.id !== "news"), "a switched-off source drops its step");
  ok(R.cleanQuery("<script>coral</script>") === "script coral /script", "angle brackets removed: " + R.cleanQuery("<script>coral</script>"));
});
await test("urls: every request goes to an allowed host and arXiv gets a field query", () => {
  const all = [R.urls.wikiSearch("ar", "x"), R.urls.wikiPage("en", "T", "ar"), R.urls.openalex("q"), R.urls.openalex("q", "recent", 2026), R.urls.openalex("q", "cited"), R.urls.openalex("q", "counter"),
    R.urls.openalex("q", "ar"), R.urls.openalexIds(["W1", "W2"]), R.urls.openalexCites("W1"), R.urls.crossref("q"), R.urls.europepmc("q"), R.urls.arxiv("coral bleaching"), R.urls.semanticscholar("q"), R.urls.gdelt("coral reef"), R.urls.wayback("https://a.example/")];
  for (const u of all) ok(R.HOSTS.includes(new URL(u).hostname), "host " + u);
  ok(R.urls.openalex("q", "recent", 2026).includes("from_publication_date:2024-01-01"), "recent window");
  ok(decodeURIComponent(R.urls.arxiv("coral bleaching")).includes("all:coral AND all:bleaching"), "arXiv query");
  ok(R.urls.arxiv("ابيضاض") === null && R.urls.gdelt("ab") === null, "unsearchable queries give null");
  ok(R.urls.openalexIds(["W1", "W2;drop"]).endsWith("ids.openalex:W1|W2drop"), "ids are cleaned");
  const src = { wikipedia: R.urls.wikiSearch("ar", "x"), openalex: R.urls.openalex("q"), crossref: R.urls.crossref("q"), europepmc: R.urls.europepmc("q"), arxiv: R.urls.arxiv("coral"), semanticscholar: R.urls.semanticscholar("q"), gdelt: R.urls.gdelt("coral reef"), wayback: R.urls.wayback("https://a.example/") };
  for (const [k, u] of Object.entries(src)) ok(R.allowed(k, u), "proxy shape for " + k);
  ok(!R.allowed("openalex", "https://api.openalex.org/authors?x=1") && !R.allowed("openalex", "https://user:pw@api.openalex.org/works") && !R.allowed("arxiv", "http://export.arxiv.org/api/query")
    && !R.allowed("wayback", "https://archive.org.evil.example/wayback/available") && !R.allowed("toString", "https://api.openalex.org/works") && !R.allowed("crossref", "https://api.crossref.org:8443/works"), "proxy refuses other shapes");
});
await test("shape: OpenAlex abstract rebuilt, DOI normalised, retraction kept", () => {
  const list = R.shape.openalex(FIX.openalex, "evidence");
  ok(list.length === 4, "four works");
  ok(list[0].abstract.startsWith("Coral reefs worldwide are declining"), "abstract from the inverted index");
  ok(list[0].doi === "10.1038/s41586-018-0041-2" && list[0].oaId === "W1" && list[0].refs.join() === "W9,W8", "doi, id and references");
  ok(list[2].retracted === true, "retraction flag");
  ok(R.normDoi("https://doi.org/10.1038/S41586-018-0041-2.") === "10.1038/s41586-018-0041-2", "doi normalised");
});
await test("shape: Crossref, Europe PMC, arXiv XML, Semantic Scholar, GDELT, Wikipedia, Wayback", () => {
  const cr = R.shape.crossref(FIX.crossref, "evidence");
  ok(cr[1].abstract === "Marine heatwaves caused coral bleaching across the northern Red Sea in 2020." && cr[0].date === "2018-04-18", "crossref " + JSON.stringify(cr[1].abstract));
  const ep = R.shape.europepmc(FIX.europepmc, "evidence");
  ok(ep[0].title === "Coral bleaching physiology under marine heatwaves" && ep[0].oa && ep[0].cites === 42, "europe pmc");
  const ax = R.shape.arxiv(FIX.arxiv, "recent");
  ok(ax.length === 1 && ax[0].kind === "preprint" && ax[0].year === 2025 && ax[0].oa === "https://arxiv.org/pdf/2501.00001v1", "arxiv " + JSON.stringify(ax[0]));
  ok(R.shape.semanticscholar(FIX.s2, "evidence")[0].doi === "10.1038/s41586-018-0041-2", "semantic scholar");
  const g = R.shape.gdelt(FIX.gdelt, "news");
  ok(g[0].date === "2026-10-01" && g[0].kind === "news", "gdelt");
  const w = R.shape.wikiPage(FIX.wikiPage, "en", "define");
  ok(w.bridge === "ابيضاض المرجان" && w.record.kind === "encyclopedia", "wikipedia bridge");
  ok(R.shape.wayback(FIX.wayback).at === "2026-10-02" && R.shape.wayback({}).archived === false, "wayback");
  ok(R.safeUrl("javascript:alert(1)") === null && R.safeUrl("https://a.example/x") === "https://a.example/x", "safeUrl");
});
await test("merge: one record per DOI across four indexes, title match without DOI", () => {
  const all = R.merge([R.shape.openalex(FIX.openalex, "evidence"), R.shape.crossref(FIX.crossref, "evidence"), R.shape.semanticscholar(FIX.s2, "evidence"), R.shape.europepmc(FIX.europepmc, "evidence")]);
  const gw = all.filter(r => r.doi === "10.1038/s41586-018-0041-2");
  ok(gw.length === 1 && gw[0].via.sort().join() === "crossref,openalex,semanticscholar" && gw[0].cites === 1600, "merged " + JSON.stringify(gw.map(x => x.via)));
  const cb = all.find(r => r.doi === "10.1000/cb.2024.1");
  ok(cb.via.includes("europepmc") && cb.via.includes("openalex"), "europe pmc joined");
  ok(all.length === 5, "five distinct works, got " + all.length);
});
await test("score and grade: relevance first, retracted scores zero, grades by rule", () => {
  const all = R.score(R.merge([R.shape.openalex(FIX.openalex, "evidence"), R.shape.crossref(FIX.crossref, "evidence"), R.shape.semanticscholar(FIX.s2, "evidence")]), R.tokens("coral bleaching heatwaves"), NOW);
  ok(all[0].doi === "10.1038/s41586-018-0041-2", "best first: " + all[0].title);
  const rt = all.find(r => r.retracted);
  ok(rt.score === 0 && R.grade(rt) === "X", "retracted");
  ok(R.grade(all[0]) === "A", "three indexes is grade A");
  ok(R.grade({ kind: "news", via: ["gdelt"] }) === "D" && R.grade({ kind: "preprint", via: ["arxiv"] }) === "C", "news and preprints");
  for (let i = 1; i < all.length; i++) ok(all[i - 1].score >= all[i].score, "sorted");
});
await test("Arabic tokens: article and prefixes stripped, stop words dropped", () => {
  ok(R.tokens("الشعاب المرجانية في الخليج").join() === "شعاب,مرجانيه,خليج", R.tokens("الشعاب المرجانية في الخليج").join());
  ok(R.tokens("The effects of corals on reefs").join() === "effect,coral,reef", R.tokens("The effects of corals on reefs").join());
});
await test("snowball: co-cited references and the seed", () => {
  const ranked = R.score(R.merge([R.shape.openalex(FIX.openalex, "evidence")]), R.tokens("coral bleaching"), NOW);
  const s = R.snowball(ranked);
  ok(s.cocited[0] === "W9" && s.coCount.W9 === 2 && s.cocited.includes("W8"), JSON.stringify(s));
  ok(s.seed === "W1", "seed is the best paper");
});
await test("keySentences: verbatim, cited, diverse; counter mode finds limitations", () => {
  const ranked = R.score(R.merge([R.shape.openalex(FIX.openalex, "evidence")]), R.tokens("coral bleaching heatwaves"), NOW);
  const s = R.keySentences(ranked, R.tokens("coral bleaching heatwaves"), { n: 3 });
  ok(s.length >= 2, "picked " + s.length);
  for (const x of s) ok(ranked.find(r => r.key === x.key).abstract.includes(x.text), "verbatim");
  const c = R.keySentences(ranked, R.tokens("coral bleaching"), { n: 3, mode: "counter" });
  ok(c.length >= 1 && c.every(x => /however|limitation/i.test(x.text)), "counter " + JSON.stringify(c));
});
await test("checkCitations: valid, invalid and unsupported sentences", () => {
  const c = R.checkCitations("الحرارة تسبب ابيضاض المرجان على نطاق واسع [1]. التعافي يحتاج سنوات طويلة بين الموجات [2، 7]. هذه جملة طويلة بلا أي مرجع على الإطلاق.\n[INFERENCE - local LLM]", 3);
  ok(c.checked === 3 && c.supported === 2 && c.invalid.join() === "7" && c.cited.join() === "1,2" && c.unsupported.length === 1, JSON.stringify(c));
});
await test("run: the full agent over a mock transport", async () => {
  const events = [];
  const out = await R.run("Coral bleaching and marine heatwaves", { now: NOW, depth: 2, onEvent: (t, d) => events.push(t + ":" + (d.stage || d.source || "")) }, io());
  ok(out.bridge === "ابيضاض المرجان", "bridge term " + out.bridge);
  ok(events.includes("stage:plan") && events.includes("stage:write"), "stages");
  ok(out.records.some(r => r.oaId === "W9" && r.steps.includes("snowball")), "co-cited foundation fetched");
  ok(out.records.some(r => r.oaId === "W5"), "newer citing work fetched");
  ok(out.records.some(r => r.kind === "encyclopedia" && r.lang === "ar"), "Arabic Wikipedia page through the bridge");
  const news = out.records.find(r => r.kind === "news");
  ok(news.archive && news.archive.archived && news.archive.at === "2026-10-02", "wayback provenance");
  const rep = out.report;
  ok(rep.references.length >= 6 && rep.references.every((r, i) => r.n === i + 1), "numbered references");
  ok(rep.sections.summary.length >= 2 && rep.sections.summary.every(s => s.n >= 1 && s.n <= rep.references.length), "summary cites");
  ok(rep.retracted.length === 1 && !rep.references.some(r => r.retracted), "retracted kept out of references");
  ok(rep.kpi.indexes >= 6 && rep.kpi.retracted === 1, "kpis " + JSON.stringify(rep.kpi));
  ok(out.markdown.includes("## المراجع") && out.markdown.includes("https://doi.org/10.1038/s41586-018-0041-2") && out.markdown.includes("[INFERENCE]"), "markdown");
  ok(out.graph.nodes.length === out.records.filter(r => !r.retracted).length && out.graph.edges.some(e => e.type === "cites"), "graph");
  for (const n of out.graph.nodes) ok(n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1, "layout in the unit square");
  const again = await R.run("Coral bleaching and marine heatwaves", { now: NOW, depth: 2 }, io());
  ok(JSON.stringify(again.graph) === JSON.stringify(out.graph), "deterministic layout");
  const f = R.facts(rep);
  ok(f.length && f.every(x => /^\[\d+\] /.test(x.text)), "facts for the local model");
});
await test("run: failing sources become honest gaps, not invented data", async () => {
  const out = await R.run("Coral bleaching and marine heatwaves", { now: NOW, depth: 1 }, io(new Set(["crossref", "europepmc", "semanticscholar", "gdelt", "arxiv"])));
  const g = out.evaluation.gaps.map(x => x.ar).join(" | ");
  ok(/مصادر لم تُجب/.test(g), "failed sources listed: " + g);
  ok(/لم يُجب أي مصدر/.test(g), "the news step says no source answered");
  ok(!out.records.some(r => r.kind === "news"), "no news invented");
  const none = await R.run("Coral bleaching", { now: NOW, depth: 1 }, io(new Set(Object.keys(R.SOURCES))));
  ok(none.records.length === 0 && /تعذر التحقق منها/.test(none.markdown), "empty run says unverified");
  let threw = false;
  try { await R.run("؟ ! .", { now: NOW }, io()); } catch { threw = true; }
  ok(threw, "a question with no words is refused");
});
// ---- ADR-115: new sources, intel mode, trend ----
await test("ADR-115 urls: DOAJ, dblp, Wikidata and NVD stay on their one API path", () => {
  const src = { doaj: R.urls.doaj("coral bleaching"), dblp: R.urls.dblp("coral bleaching"), wikidata: R.urls.wikidataSearch("ar", "ابيضاض"), nvd: R.urls.nvd("reef sensor firmware", NOW) };
  for (const [k, u] of Object.entries(src)) { ok(u && R.HOSTS.includes(new URL(u).hostname), "host " + k); ok(R.allowed(k, u), "proxy shape for " + k + " " + u); }
  ok(R.allowed("wikidata", R.urls.wikidataEntity("Q42")) && R.urls.wikidataEntity("Q42|Q1") === null, "entity ids are checked");
  ok(!R.allowed("doaj", "https://doaj.org/api/search/journals/coral") && !R.allowed("doaj", "https://doaj.org/api/search/articles/a/b") && !R.allowed("doaj", "https://doaj.org/api/search/articles/"), "DOAJ prefix holds one segment");
  ok(!R.allowed("nvd", "https://services.nvd.nist.gov/rest/json/cpes/2.0?x=1") && !R.allowed("dblp", "https://dblp.org/search/author/api?q=x"), "other NVD and dblp paths refused");
  const n = new URL(R.urls.nvd("Reef sensor firmware overflow attack", NOW));
  ok(n.searchParams.get("keywordSearch") === "reef sensor firmware", "three keywords: " + n.searchParams.get("keywordSearch"));
  const days = (Date.parse(n.searchParams.get("pubEndDate") + "Z") - Date.parse(n.searchParams.get("pubStartDate") + "Z")) / 864e5;
  ok(days === 119 && n.searchParams.has("noRejected"), "a 119-day window inside NVD's 120-day limit: " + days);
  ok(R.urls.nvd("ابيضاض المرجان", NOW) === null && R.urls.dblp("ابيضاض") === null, "no ASCII keyword, no NVD or dblp call");
  ok(decodeURIComponent(R.urls.doaj("ابيضاض المرجان")).includes("ابيضاض المرجان"), "DOAJ keeps Arabic letters as typed");
  ok(new URL(R.urls.gdeltTimeline("coral reef", "tone")).searchParams.get("mode") === "timelinetone", "tone timeline");
});
await test("ADR-115 shapes: DOAJ, dblp, Wikidata, NVD and GDELT timelines", () => {
  const d = R.shape.doaj(FIX.doaj, "evidence");
  ok(d.length === 2 && d[0].doi === "10.1000/cb.2024.1" && d[0].oa === "https://journal.example.org/cb2024" && d[0].date === "2024-05" && d[0].lang === "en", "doaj " + JSON.stringify(d[0]));
  ok(d[1].lang === "ar" && d[1].kind === "paper", "Arabic DOAJ article");
  const b = R.shape.dblp(FIX.dblp, "evidence");
  ok(b[0].kind === "preprint" && b[0].title === "Deep learning detects coral bleaching from satellite imagery" && b[0].authors.length === 2, "dblp CoRR is a preprint");
  ok(b[1].kind === "paper" && b[1].doi === "10.1000/edge.2023" && b[1].venue === "IoT J." && b[1].authors.join() === "E. Engineer", "dblp single author and arrays");
  const s = R.shape.wikidataSearch(FIX.wdSearch);
  ok(s.length === 1 && s[0].id === "Q1047062", "bad ids dropped");
  const e = R.shape.wikidataEntity(FIX.wdEntity, "Q1047062", "en");
  ok(e.other === "ابيضاض المرجان" && e.description === "loss of colour in corals" && e.wiki.ar === null && e.wiki.en, "entity " + JSON.stringify(e));
  const v = R.shape.nvd(FIX.nvd, "cyber");
  ok(v.length === 2 && v[0].key === "cve:CVE-2026-1111" && v[0].cve.score === 9.8 && v[0].cve.kev && v[0].cve.kevDate === "2026-09-10", "nvd " + JSON.stringify(v[0].cve));
  ok(v[1].abstract.startsWith("Cross-site scripting") && !v[1].cve.kev && R.grade(v[1]) === "G", "English description, grade G");
  const t = R.shape.gdeltTimeline(FIX.gdeltVol);
  ok(t.length === 30 && t[0].date === "2026-09-01" && t[29].value === 0.3, "timeline");
});
await test("ADR-115 trend: last 7 days against the 3-month mean, by fixed rules", () => {
  const tr = R.trend(R.shape.gdeltTimeline(FIX.gdeltVol), R.shape.gdeltTimeline(FIX.gdeltTone));
  ok(tr.dir === "rising" && tr.ratio > 1.5 && tr.peak.date === "2026-09-24" && tr.days === 30, "rising " + JSON.stringify({ r: tr.ratio, p: tr.peak }));
  ok(tr.tone.last7 === -4 && tr.tone.delta < 0, "tone falls");
  const flat = Array.from({ length: 20 }, (_, i) => ({ date: "2026-01-" + String(i + 1).padStart(2, "0"), value: 1 }));
  ok(R.trend(flat).dir === "steady" && R.trend(flat).tone === null, "steady");
  ok(R.trend(flat.map((p, i) => ({ ...p, value: i >= 13 ? 0.2 : 1 }))).dir === "falling", "falling");
  ok(R.trend(flat.slice(0, 10)) === null && R.trend(null) === null, "too short gives null");
});
await test("ADR-115 plan: intel mode reads news, trend and NVD, not the snowball", () => {
  const p = R.plan("reef sensor firmware", { now: NOW, mode: "intel", depth: 2 });
  ok(p.mode === "intel" && p.steps.map(s => s.id).join() === "define,news,trend,cyber,exploit,evidence,recent", "steps " + p.steps.map(s => s.id));
  ok(R.plan("coral", {}).mode === "scholar" && R.plan("coral", { mode: "evil" }).mode === "scholar", "default and unknown modes are scholar");
  ok(R.plan("coral", { now: NOW }).steps.find(s => s.id === "evidence").sources.includes("doaj"), "DOAJ in scholar evidence");
});
await test("ADR-115 run: scholar mode merges DOAJ and dblp, Wikidata gives the entity", async () => {
  const out = await R.run("Coral bleaching and marine heatwaves", { now: NOW, depth: 1 }, io());
  const cb = out.records.find(r => r.doi === "10.1000/cb.2024.1");
  ok(cb.via.includes("doaj") && cb.oa, "DOAJ joined by DOI " + JSON.stringify(cb.via));
  ok(out.records.some(r => r.via.includes("dblp")), "dblp record");
  ok(out.records.some(r => r.via.includes("doaj") && r.lang === "ar" && r.steps.includes("arabic")), "Arabic DOAJ article through the bridge");
  ok(out.entity && out.entity.id === "Q1047062" && out.report.sections.entity.id === "Q1047062", "entity card");
  ok(out.report.mode === "scholar" && !out.report.sections.trend && !out.report.sections.advisories.length, "no intel sections in scholar mode");
});
await test("ADR-115 run: intel mode gives the trend, exploited CVEs first and an OSINT brief", async () => {
  const out = await R.run("reef sensor firmware", { now: NOW, mode: "intel" }, io());
  const rep = out.report;
  ok(rep.mode === "intel" && rep.sections.trend && rep.sections.trend.dir === "rising", "trend in the report");
  ok(rep.sections.advisories.length === 2 && rep.sections.advisories[0].r.cve.id === "CVE-2026-1111", "KEV first");
  ok(rep.kpi.advisories === 2 && rep.kpi.kev === 1, "kpis " + JSON.stringify(rep.kpi));
  ok(rep.sections.summary.some(s => /buffer overflow|Cross-site/.test(s.text)), "advisory sentences quoted verbatim");
  ok(!out.runs.some(r => r.step === "snowball") && !out.runs.some(r => r.source === "crossref"), "intel mode skips the literature-only steps");
  ok(out.markdown.includes("تقرير استخبارات مفتوحة المصدر") && out.markdown.includes("CISA KEV 2026-09-10") && out.markdown.includes("الاتجاه: صاعد") && out.markdown.includes("OSINT سلبي"), "markdown");
  ok(rep.references.find(r => r.cve && r.cve.id === "CVE-2026-1111").grade === "G", "official record grade");
  const offline = await R.run("reef sensor firmware", { now: NOW, mode: "intel" }, io(new Set(["gdelt", "nvd"])));
  const g = offline.evaluation.gaps.map(x => x.ar).join(" | ");
  ok(!offline.report.sections.trend && /لم يُجب أي مصدر/.test(g) && /أقل من 3 أخبار/.test(g), "honest gaps offline: " + g);
});
await test("ADR-122 plan: field lenses add their specialist steps in scholar mode only", () => {
  const ids = f => R.plan("coral bleaching", { now: NOW, depth: 1, field: f }).steps.map(s => s.id).join();
  ok(ids("medicine") === "define,evidence,recent,foundations,counter,arabic,trials,medline,news", "medicine " + ids("medicine"));
  ok(ids("science").includes("data,reports,news") && ids("industry").includes("reports,data,news") && ids("algorithms").includes("code,news"), "science, industry, algorithms");
  ok(ids("general") === ids(undefined) && ids("evil") === ids("general") && R.plan("x y", { field: "toString" }).field === "general", "unknown fields are general");
  ok(R.plan("coral", { mode: "intel", field: "medicine" }).field === "general", "no field lens in intel mode");
  ok(R.plan("coral", { field: "medicine", off: ["pubmed"] }).steps.every(s => s.id !== "medline"), "a switched-off source drops its step");
});
await test("ADR-122 urls: the new sources stay on their fixed API paths", () => {
  const u = { clinicaltrials: R.urls.clinicaltrials("coral bleaching"), pubmed: R.urls.pubmedSearch("coral bleaching"), zenodo: R.urls.zenodo("coral", "software"), osti: R.urls.osti("coral"), epss: R.urls.epss(["CVE-2026-1111", "CVE-2026-1111", "x"]) };
  for (const [k, url] of Object.entries(u)) { ok(R.HOSTS.includes(new URL(url).hostname), "host " + url); ok(R.allowed(k, url), "proxy shape for " + k); }
  ok(R.allowed("pubmed", R.urls.pubmedSummary(["1", "2"])) && !R.allowed("pubmed", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=1"), "two PubMed paths, not efetch");
  ok(u.epss.endsWith("cve=CVE-2026-1111") && R.urls.epss(["x"]) === null && R.urls.pubmedSummary(["1;drop"]) === null, "ids are checked");
  ok(u.zenodo.includes("type=software") && !R.urls.zenodo("coral", "evil").includes("type="), "zenodo type allow-list");
  ok(!R.allowed("osti", "https://www.osti.gov/api/v1/records/../../etc") && !R.allowed("epss", "https://api.first.org.evil.example/data/v1/epss") && !R.allowed("zenodo", "http://zenodo.org/api/records"), "other shapes refused");
});
await test("ADR-122 shapes: trials, PubMed, Zenodo, OSTI and EPSS", () => {
  const t = R.shape.clinicaltrials(FIX.ct, "trials");
  ok(t.length === 2 && t[0].trial.id === "NCT01234567" && t[0].trial.results && t[0].trial.enrollment === 120 && t[0].year === 2023 && R.grade(t[0]) === "G", "trial " + JSON.stringify(t[0].trial));
  ok(t[0].url === "https://clinicaltrials.gov/study/NCT01234567" && t[0].key === "nct:NCT01234567", "trial link and key");
  const pm = R.shape.pubmedSummary(FIX.pmSummary, "medline");
  ok(R.shape.pubmedSearch(FIX.pmSearch).join() === "40000001,40000002", "esearch ids");
  ok(pm[0].doi === "10.1000/cb.2024.1" && pm[0].lang === "en" && pm[0].year === 2024 && pm[1].retracted === true, "pubmed " + JSON.stringify(pm[0]));
  const z = R.shape.zenodo(FIX.zenodo, "data");
  ok(z[0].kind === "dataset" && z[0].oa && z[0].licence === "cc-by-4.0" && z[0].abstract === "Daily degree heating weeks for coral reefs." && R.grade(z[0]) === "R", "zenodo " + JSON.stringify(z[0]));
  ok(z[1].url === null && z[1].oa === null, "unsafe link dropped, closed record has no oa");
  const o = R.shape.osti(FIX.osti, "reports");
  ok(o.length === 1 && o[0].kind === "report" && o[0].authors[0] === "Smith, A" && o[0].oa && o[0].year === 2024, "osti " + JSON.stringify(o[0]));
  const e = R.shape.epss(FIX.epss);
  ok(e["CVE-2026-2222"].epss === 0.421 && e["CVE-2026-2222"].percentile === 0.972 && !e.bad && Object.keys(e).length === 2, "epss " + JSON.stringify(e));
});
await test("ADR-122 run: the medicine lens reads trials and PubMed; retracted PubMed work is named", async () => {
  const out = await R.run("Coral bleaching and marine heatwaves", { now: NOW, depth: 1, field: "medicine" }, io());
  const rep = out.report;
  ok(rep.field === "medicine" && rep.sections.trials.length === 2 && rep.sections.trials[0].r.trial.results, "trials with results first");
  const cb = out.records.find(r => r.doi === "10.1000/cb.2024.1");
  ok(cb.via.includes("pubmed") && cb.via.includes("europepmc"), "PubMed joined by DOI " + JSON.stringify(cb.via));
  ok(rep.retracted.some(r => /cure/.test(r.title)) && rep.kpi.trials === 2, "retracted named, kpi");
  ok(rep.gaps.some(g => /ليس نصيحة طبية/.test(g.ar)) && out.markdown.includes("التجارب السريرية المسجّلة") && out.markdown.includes("NCT01234567"), "not medical advice, markdown");
  const sci = await R.run("Coral bleaching and marine heatwaves", { now: NOW, depth: 1, field: "industry" }, io());
  ok(sci.report.sections.technical.length >= 2 && sci.report.gaps.some(g => /براءات/.test(g.ar)) && sci.markdown.includes("التقارير التقنية"), "industry lens");
  const off = await R.run("Coral bleaching and marine heatwaves", { now: NOW, depth: 1, field: "medicine" }, io(new Set(["clinicaltrials", "pubmed"])));
  ok(off.report.gaps.some(g => /لا تجربة سريرية/.test(g.ar)) && !off.report.sections.trials.length, "honest gap when trials fail");
});
await test("ADR-122 run: intel mode joins EPSS and ranks exploited, then likely-exploited CVEs", async () => {
  const out = await R.run("reef sensor firmware", { now: NOW, mode: "intel" }, io());
  const adv = out.report.sections.advisories;
  ok(adv[0].r.cve.id === "CVE-2026-1111" && adv[1].r.cve.epss.epss === 0.421, "KEV first, EPSS joined");
  ok(out.report.kpi.epssHigh === 1 && out.markdown.includes("EPSS 42.10%") && out.markdown.includes("FIRST.org"), "kpi and markdown");
  const off = await R.run("reef sensor firmware", { now: NOW, mode: "intel" }, io(new Set(["epss"])));
  ok(off.report.gaps.some(g => /لا درجة EPSS/.test(g.ar)) && !off.records.some(r => r.cve && r.cve.epss), "honest gap without EPSS");
});
await test("the ORACLE page carries the current library copy", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-research-inline.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stderr || r.stdout).trim());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
