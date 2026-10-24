// Tests for the deep research engine (scripts/lib/deep-research.mjs, ADR-114) and the ORACLE page's inline copy.
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
  wayback: { archived_snapshots: { closest: { available: true, url: "http://web.archive.org/web/20261002000000/https://news.example.com/coral-2026", timestamp: "20261002000000", status: "200" } } }
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
    else if (source === "gdelt") data = FIX.gdelt;
    else if (source === "wayback") data = FIX.wayback;
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
  const none = await R.run("Coral bleaching", { now: NOW, depth: 1 }, io(new Set(["wikipedia", "openalex", "crossref", "europepmc", "semanticscholar", "gdelt", "arxiv", "wayback"])));
  ok(none.records.length === 0 && /تعذر التحقق منها/.test(none.markdown), "empty run says unverified");
  let threw = false;
  try { await R.run("؟ ! .", { now: NOW }, io()); } catch { threw = true; }
  ok(threw, "a question with no words is refused");
});
await test("the ORACLE page carries the current library copy", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-research-inline.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stderr || r.stdout).trim());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
