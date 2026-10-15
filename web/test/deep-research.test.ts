import { test } from "node:test";
import assert from "node:assert/strict";
import { bm25, canonicalUrl, dedupeNear, normalize, rrf, sentences, support, tokens } from "../src/lib/deep-research/text.ts";
import { abstractFromIndex, pickScouts } from "../src/lib/deep-research/sources.ts";
import { parseJson, chain } from "../src/lib/deep-research/llm.ts";
import { checkCitations, cleanPlan, extractive, research, type Event, type Source } from "../src/lib/deep-research/pipeline.ts";

test("Arabic normalisation and tokens", () => {
  assert.equal(normalize("أسعارُ النفطِ ٢٠٢٦"), "اسعار النفط 2026");
  assert.deepEqual(tokens("ما هي أسعار النفط في الخليج؟"), ["اسعار", "نفط", "خليج"]);
  assert.ok(tokens("Oil prices rose 12% in October").includes("12%"));
});

test("BM25 ranks the relevant passage first", () => {
  const docs = ["Brent crude rose after Hormuz tanker attacks", "Football results from the weekend", "Gold steady as oil climbs"].map(tokens);
  const s = bm25(tokens("hormuz brent oil"), docs);
  assert.ok(s[0] > s[2] && s[2] > s[1]);
});

test("RRF rewards items several scouts agree on", () => {
  const score = rrf([["a", "b", "c"], ["b", "d"], ["b", "a"]]);
  assert.equal([...score.entries()].sort((x, y) => y[1] - x[1])[0][0], "b");
});

test("canonical URLs and MinHash near-duplicates", () => {
  assert.equal(canonicalUrl("https://www.Reuters.com/a/b/?utm_source=x&id=2#top"), "reuters.com/a/b?id=2");
  const wire = "Oil prices jumped five percent on Monday after reports of drone attacks on tankers near the Strait of Hormuz, traders said.";
  const keep = dedupeNear([wire, `${wire} Reporting by staff.`, "The central bank kept interest rates unchanged and signalled patience on cuts."]);
  assert.deepEqual(keep, [0, 2]);
});

test("support measures claim/evidence overlap, tolerant of Arabic inflection", () => {
  assert.ok(support("ارتفع سعر برنت إلى 90 دولارا", "وارتفعت أسعار برنت الى 90 دولارا للبرميل") >= 0.5);
  assert.ok(support("Gold fell sharply", "Brent rose on supply fears") < 0.2);
});

test("sentences keep their citation markers", () => {
  assert.deepEqual(sentences("Brent rose 5%. [1] Gold fell. [2][3]\n- Bullet one [4]"), ["Brent rose 5%. [1]", "Gold fell. [2][3]", "- Bullet one [4]"]);
});

test("planner output is cleaned and falls back safely", () => {
  const plan = cleanPlan(parseJson('Sure!\n```json\n{"subquestions":[{"q":"Why?","queries":["a b","c d","e f"]},{"q":"","queries":["x"]}]}\n```'), "main question", 3);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].queries, ["main question", "a b", "c d"]);
  assert.equal(cleanPlan(null, "q?", 3)[0].q, "q?");
});

test("OpenAlex abstracts and scout choice", () => {
  assert.equal(abstractFromIndex({ world: [1], hello: [0] }), "hello world");
  assert.ok(pickScouts("latest oil price news", false).includes("gdelt"));
  assert.ok(pickScouts("دراسة عن الذكاء الاصطناعي", false).includes("arxiv"));
  assert.equal(pickScouts("hello", true).length, 6);
});

test("model chain: Cortex only with a token, local unless switched off", () => {
  assert.deepEqual(chain({}).map(l => l.name), ["local:qwen2.5:3b"]);
  assert.deepEqual(chain({ OMEGA_GATEWAY_TOKEN: "t", OLLAMA_URL: "" }).map(l => l.name), ["cortex:omega/oracle", "cortex:omega/free-smart"]);
});

const SRC: Source[] = [
  { n: 1, url: "https://a.com/x", title: "Brent jumps", domain: "a.com", scout: "searxng", quote: "Brent crude rose 5 percent to 91 dollars after tanker attacks near Hormuz.", score: 3 },
  { n: 2, url: "https://b.org/y", title: "Gold report", domain: "b.org", scout: "gdelt", quote: "Gold prices held steady at 3,900 dollars an ounce as investors waited for the Fed.", score: 2 },
];

test("cite check: fake numbers removed, wrong citation re-attributed, unsupported flagged", () => {
  const r = checkCitations("Brent crude rose 5 percent to 91 dollars [2].\nGold held steady at 3,900 dollars an ounce [7].\nBitcoin will surely double next month according to insiders [1].", SRC);
  assert.equal(r.claims[0].verdict, "supported");
  assert.deepEqual(r.claims[0].cites, [1], "re-attributed to the source that backs it");
  assert.doesNotMatch(r.claims[1].text, /\[7\]/, "citation to a non-existent [7] dropped");
  assert.deepEqual(r.claims[1].cites, [2], "then attached to the source that backs it");
  assert.equal(r.claims[1].verdict, "supported");
  assert.equal(checkCitations("Bitcoin will double next month says an anonymous insider.", SRC).claims[0].verdict, "uncited");
  assert.equal(r.claims[2].verdict, "unsupported");
  assert.ok(r.confidence > 0 && r.confidence < 100);
});

test("extractive answer quotes sources with citations", () => {
  const a = extractive([{ q: "What happened to Brent?", queries: [] }], SRC, false);
  assert.match(a, /Brent crude rose 5 percent.*\[1\]/);
});

test("full run with fake sources and a fake model streams every stage and a checked answer", async () => {
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/search?format=json")) return Response.json({ results: [
      { url: "http://93.184.216.34/brent", title: "Brent jumps on Hormuz", content: "Brent crude rose 5 percent to 91 dollars after tanker attacks near Hormuz." },
      { url: "http://93.184.216.35/gold?utm_source=x", title: "Gold steady", content: "Gold prices held steady at 3,900 dollars an ounce." },
    ] });
    if (url.includes("wikipedia.org")) return Response.json({ query: { pages: { 1: { index: 1, title: "Strait of Hormuz", fullurl: "https://en.wikipedia.org/wiki/Strait_of_Hormuz", extract: "The Strait of Hormuz carries about a fifth of global oil consumption between Iran and Oman." } } } });
    if (url.startsWith("http://93.184.216.34/")) return new Response("<html><title>Brent</title><body><article><p>Brent crude rose 5 percent to 91 dollars a barrel on Monday after tanker attacks near Hormuz, traders said, the biggest daily jump this year. Analysts expect more volatility while shipping insurers raise war-risk premiums for vessels crossing the strait.</p></article></body></html>", { headers: { "content-type": "text/html" } });
    if (url.endsWith("/chat/completions")) {
      const body = JSON.parse(String(init?.body));
      const sys = body.messages[0].content as string;
      if (sys.includes("planner")) return Response.json({ choices: [{ message: { content: '{"subquestions":[{"q":"Brent move","queries":["brent hormuz"]}]}' } }] });
      return Response.json({ model: "qwen2.5:3b", choices: [{ message: { content: "Brent rose 5 percent to 91 dollars after tanker attacks near Hormuz [1].\n- The strait carries about a fifth of global oil consumption [2]." } }] });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  const events: Event[] = [];
  const r = await research("How did Hormuz attacks move Brent oil?", e => events.push(e), { f, env: { SEARXNG_URL: "http://searx.test" } });
  const done = new Set(events.filter(e => e.type === "stage" && e.status === "done").map(e => (e as { node: string }).node));
  for (const n of ["planner", "scout:searxng", "scout:wikipedia", "merge", "dedupe", "read", "rank", "writer", "citecheck", "verify"]) assert.ok(done.has(n), n);
  assert.equal(r.mode, "model");
  assert.equal(r.model, "local:qwen2.5:3b");
  assert.ok(r.stats.read >= 1, "the article page was read");
  assert.ok(r.claims.filter(c => c.verdict === "supported").length >= 2, JSON.stringify(r.claims));
  assert.ok(r.confidence >= 50);
});

test("no model anywhere: extractive answer, never empty", async () => {
  const f = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("wikipedia.org")) return Response.json({ query: { pages: { 1: { index: 1, title: "Qwen", fullurl: "https://en.wikipedia.org/wiki/Qwen", extract: "Qwen is a family of open large language models developed by Alibaba Cloud, released under open licences." } } } });
    throw new Error("offline");
  }) as typeof fetch;
  const r = await research("What is Qwen?", () => {}, { f, env: {} });
  assert.equal(r.mode, "extractive");
  assert.match(r.answer, /Alibaba.*\[1\]/);
});
