// Runs the Code nodes of the News Sentiment workflow exactly as stored in the JSON, with n8n's
// globals mocked. Zero dependencies:  node --test n8n/test/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/news-sentiment.json"), "utf8"))[0];
const nodeCode = name => wf.nodes.find(n => n.name === name).parameters.jsCode;

// $input = items arriving at the node; refs = { "Node name": [json, ...] } for $('Node name')
function run(name, input = [], refs = {}) {
  const wrap = list => list.map(json => ({ json }));
  const $input = { all: () => wrap(input), first: () => wrap(input)[0] };
  const $ = n => { const l = wrap(refs[n] || []); return { all: () => l, first: () => l[0] }; };
  const out = new Function("$input", "$", `return (() => {\n${nodeCode(name)}\n})();`)($input, $);
  return out.map(i => i.json);
}

const ago = h => new Date(Date.now() - h * 3600e3);
const RSS = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Bitcoin ETF inflows hit a record &amp; keep climbing]]></title>
  <link>https://news.example/btc-etf?utm_source=rss&amp;id=7#top</link>
  <pubDate>${ago(1).toUTCString()}</pubDate>
  <description><![CDATA[<p>Spot funds took in &#36;1.2B.</p>]]></description></item>
<item><title>Old story that should be dropped</title><link>https://news.example/old</link><pubDate>${ago(72).toUTCString()}</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>${ago(1).toUTCString()}</pubDate></item>
<item><title>Bitcoin ETF inflows duplicate</title><link>https://news.example/btc-etf?id=7&amp;utm_medium=x</link><pubDate>${ago(2).toUTCString()}</pubDate></item>
</channel></rss>`;
const ATOM = `<feed><entry><title type="html">Solana &lt;b&gt;outage&lt;/b&gt; halts blocks</title>
<link rel="alternate" href="https://atom.example/sol"/><updated>${ago(3).toISOString()}</updated>
<summary>Validators restart.</summary></entry></feed>`;

test("Feeds lists keyless sources", () => {
  const feeds = run("Feeds");
  assert.ok(feeds.length >= 4);
  for (const f of feeds) assert.match(f.url, /^https:\/\//);
});

test("Parse headlines reads RSS and Atom, drops stale, unsafe and duplicate items", () => {
  const [out] = run("Parse headlines", [{ data: RSS }, { data: ATOM }, { error: { message: "timeout" } }],
    { Feeds: [{ source: "CoinDesk" }, { source: "Decrypt" }, { source: "Dead" }] });
  assert.deepEqual(out.feeds_failed, ["Dead"]);
  assert.equal(out.headlines.length, 2);
  const [btc, sol] = out.headlines;                       // newest first
  assert.equal(btc.title, "Bitcoin ETF inflows hit a record & keep climbing");
  assert.equal(btc.url, "https://news.example/btc-etf?id=7");
  assert.equal(btc.summary, "Spot funds took in $1.2B.");
  assert.equal(btc.source, "CoinDesk");
  assert.equal(sol.title, "Solana outage halts blocks");
  assert.equal(sol.url, "https://atom.example/sol");
});

const pending = [
  { id: "11", source: "CoinDesk", title: "Bitcoin ETF inflows hit a record", summary: "" },
  { id: "12", source: "Decrypt", title: "Solana exchange hacked, $40M stolen", summary: "" },
  { id: "13", source: "Decrypt", title: "Ethereum devs schedule a call", summary: "" },
];

test("Build prompt batches pending headlines on the free route and stops when nothing is pending", () => {
  assert.deepEqual(run("Build prompt", [{ success: true }]), []);
  const [out] = run("Build prompt", pending);
  assert.equal(out.request.model, "omega/fast");
  assert.match(out.request.messages[0].content, /untrusted/);
  assert.equal(out.request.messages[1].content.split("\n").length, 4);
});

test("Check scores validates model output and falls back to keywords for anything missing", () => {
  const answer = "```json\n" + JSON.stringify({ scores: [
    { id: 11, sentiment: 1.7, relevance: "0.9", impact: "high", symbols: ["btc", "<b>", "ETH"], rationale: "record demand" },
    { id: 99, sentiment: 0.5 },                                // not asked for
    { id: 13, sentiment: "lots", impact: "huge" },             // garbled
  ] }) + "\n```";
  const [out] = run("Check scores", [{ model: "groq:openai/gpt-oss-120b", choices: [{ message: { content: answer } }] }],
    { "Build prompt": [{ pending }] });
  const by = Object.fromEntries(out.scores.map(s => [s.id, s]));
  assert.equal(out.scores.length, 3);
  assert.deepEqual(by[11], { id: 11, sentiment: 1, relevance: 0.9, impact: "high", symbols: ["BTC", "ETH"], rationale: "record demand", scored_by: "groq:openai/gpt-oss-120b" });
  assert.equal(by[12].scored_by, "lexicon");
  assert.ok(by[12].sentiment < 0, "hack headline reads bearish");
  assert.deepEqual(by[12].symbols, ["SOL"]);
  assert.equal(by[13].scored_by, "lexicon");
  assert.equal(out.fallback, 2);
});

test("Check scores survives a dead Cortex", () => {
  const [out] = run("Check scores", [{ error: { message: "connect ECONNREFUSED" } }], { "Build prompt": [{ pending }] });
  assert.equal(out.served_by, "lexicon");
  assert.equal(out.scores.length, 3);
  assert.match(out.cortex_error, /ECONNREFUSED/);
});

const scoredRows = [
  { id: 11, published_at: ago(1).toISOString(), source: "CoinDesk", title: "Bitcoin ETF inflows hit a record", url: "https://n.example/a",
    symbols: ["BTC"], sentiment: 0.8, relevance: 0.9, impact: "high", label: "bullish", rationale: "<b>demand</b>", scored_by: "groq:x" },
  { id: 12, published_at: ago(2).toISOString(), source: "Decrypt", title: "Exchange hacked", url: "https://n.example/b?a=1&b=\"2\"",
    symbols: [], sentiment: -0.9, relevance: 0.8, impact: "high", label: "bearish", rationale: null, scored_by: "groq:x" },
  { id: 13, published_at: ago(3).toISOString(), source: "Decrypt", title: "Devs call", url: "https://n.example/c",
    symbols: ["ETH"], sentiment: 0.1, relevance: 0.4, impact: "low", label: "neutral", rationale: null, scored_by: "lexicon" },
];

test("Digest forwards scored rows to the Ops Room", () => {
  const [out] = run("Digest", [...scoredRows, { success: true }], { "Check scores": [{ served_by: "groq:x", fallback: 1 }] });
  assert.equal(out.items.length, 3);
  assert.equal(out.items[0].id, 11);
  assert.equal(out.fallback, 1);
  assert.deepEqual(run("Digest", [{ success: true }], { "Check scores": [{}] }), []);
});

test("Format Telegram sends only high-impact, directional news, escaped", () => {
  const [msg] = run("Format Telegram", scoredRows);
  assert.match(msg.text, /BULLISH \+0\.80 · BTC/);
  assert.match(msg.text, /BEARISH -0\.90 · market/);
  assert.ok(!msg.text.includes("Devs call"));
  assert.ok(msg.text.includes("&lt;b&gt;demand&lt;/b&gt;"));
  assert.ok(msg.text.includes('href="https://n.example/b?a=1&amp;b=&quot;2&quot;"'));
  assert.deepEqual(run("Format Telegram", [scoredRows[2]]), []);
});

test("Workflow wiring: every connection names a real node, credentials match the seeder", () => {
  const names = new Set(wf.nodes.map(n => n.name));
  for (const [from, c] of Object.entries(wf.connections)) {
    assert.ok(names.has(from), from);
    for (const t of c.main.flat()) assert.ok(names.has(t.node), t.node);
  }
  const creds = new Set(wf.nodes.flatMap(n => Object.values(n.credentials || {}).map(c => c.id)));
  const init = fs.readFileSync(path.join(__dirname, "../init.sh"), "utf8");
  for (const id of creds) assert.ok(init.includes(`"${id}"`), `init.sh seeds ${id}`);
});
