// Tests for the second brain engine (scripts/lib/second-brain.mjs) and the Arabic / English engine
// (scripts/lib/i18n.mjs and its dictionaries), plus the inline copies in the pages (ADR-119).
//   node scripts/test-brain.mjs        exits 0 when every test passes
// No network, no dependencies. The ideas below are small hand-made fixtures; they are never shown on a page.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OMEGA_BRAIN as B } from "./lib/second-brain.mjs";
import { OMEGA_I18N as I } from "./lib/i18n.mjs";
import { COMMON } from "./lib/i18n/common.mjs";
import { OPS } from "./lib/i18n/ops.mjs";
import { CHAIN } from "./lib/i18n/chain.mjs";
import { ORACLE } from "./lib/i18n/oracle.mjs";
import { TRADELAB } from "./lib/i18n/tradelab.mjs";
import { BRAIN } from "./lib/i18n/brain.mjs";
import { KNOW } from "./lib/i18n/know.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0, passed = 0;
function test(name, f) {
  try { f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const NOW = Date.UTC(2026, 9, 24, 6), DAY = 86400000;

/* ---------- second brain ---------- */
test("Arabic normalisation and stemming join spelling variants", () => {
  const a = B.tokens("أدخل الصفقات بعد إغلاق الشمعة"), b = B.tokens("ادخل صفقات بعد اغلاق الشمعه");
  ok(JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " vs " + JSON.stringify(b));
  ok(!a.includes("بعد"), "stop word kept");
});
test("English tokens drop stop words and plurals", () => {
  ok(JSON.stringify(B.tokens("The stops are on every trade")) === JSON.stringify(["stop", "every", "trade"]), JSON.stringify(B.tokens("The stops are on every trade")));
});
test("splitIdeas reads bullets, numbered lines and paragraphs, skips headings", () => {
  const xs = B.splitIdeas("# Title\n\n- first idea here\n- second idea here\n\n1) third idea\n2) fourth idea\n\nA plain paragraph\nthat goes on.");
  ok(xs.length === 5 && xs[4] === "A plain paragraph that goes on.", JSON.stringify(xs));
});
test("near-duplicates merge and keep every source", () => {
  const r = B.organise({ own: [{ text: "أدخل صفقة البيتكوين بعد إغلاق الشمعة فقط", at: NOW }], tradeNotes: { T1: { lesson: "ادخل صفقه البيتكوين بعد اغلاق الشمعه فقط", at: NOW } } }, { now: NOW });
  ok(r.raw === 2 && r.ideas.length === 1 && r.merged === 1, `raw ${r.raw} ideas ${r.ideas.length}`);
  ok(r.ideas[0].sources.length === 2, "sources kept");
});
test("themes group related ideas and stay apart from unrelated ones", () => {
  const r = B.organise({ own: [
    { text: "coral bleaching in the Gulf hurts fisheries", at: NOW },
    { text: "Gulf coral bleaching and fish stocks", at: NOW - DAY },
    { text: "stop loss before every paper trade", at: NOW },
    { text: "paper trade only after the candle close with a stop loss", at: NOW }
  ] }, { now: NOW });
  ok(r.themes.length === 2, "themes " + r.themes.length + " " + JSON.stringify(r.themes.map(t => t.label)));
  const coral = r.themes.find(t => t.terms.includes("coral")), trade = r.themes.find(t => t.trade);
  ok(coral && coral.size === 2 && trade && trade.size === 2 && coral !== trade, "grouping");
  ok(trade.next.some(s => s.kind === "tradelab") && coral.next.some(s => s.kind === "oracle"), "develop rules");
  ok(!coral.next.some(s => s.kind === "tradelab"), "no trade rule on a non-trading theme");
});
test("ORACLE questions, plan rules and THE CHAIN views are gathered; vault-like keys are not read", () => {
  const items = B.gather({
    oracle: [{ q: "coral bleaching Gulf", at: NOW, mode: "scholar" }],
    plan: { rules: "- no trade after two losses\n- stop before entry" },
    chain: { AAPL: "# AAPL\n\n## رأيي في 3 جمل\n1. نمو الخدمات قوي\n\n## Something else\n- ignored line here\n" },
    vault: [{ text: "secret value 123" }]
  });
  const srcs = items.map(x => x.src).sort().join(",");
  ok(srcs === "chain,oracle,plan,plan", srcs);
  ok(items.find(x => x.src === "chain").text.startsWith("AAPL: "), "ticker prefix");
});
test("organise is deterministic and the layout is seeded", () => {
  const inp = { own: [{ text: "alpha beta gamma", at: NOW }, { text: "beta gamma delta", at: NOW }, { text: "zeta eta theta", at: NOW }] };
  const a = B.organise(inp, { now: NOW }), b = B.organise(inp, { now: NOW });
  ok(JSON.stringify(a.themes.map(t => t.members)) === JSON.stringify(b.themes.map(t => t.members)), "themes differ");
  const P = B.layout(3, a.links, [0, 0, 1]), Q = B.layout(3, a.links, [0, 0, 1]);
  ok(JSON.stringify(P) === JSON.stringify(Q) && P.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), "layout");
});
test("scores stay in 0..100 and the Markdown export names every theme", () => {
  const r = B.organise({ own: [{ text: "one idea about liquidity", at: NOW - 90 * DAY }, { text: "a question about liquidity flows?", at: NOW }] }, { now: NOW });
  ok(r.ideas.every(x => x.score >= 0 && x.score <= 100), "score range");
  ok(r.ideas.some(x => x.question), "question flag");
  const md = B.toMarkdown(r, "2026-10-24");
  ok(md.startsWith("# المخ الثاني") && r.themes.every(t => md.includes("## " + t.label.join(" · "))) && md.includes("[INFERENCE]"), "markdown");
});
test("control characters are cleaned and input size is bounded", () => {
  ok(B.clean("a\u0000b\u0007 c") === "ab c", "clean");
  const many = Array.from({ length: 700 }, (_, k) => ({ text: "idea number " + k + " word" + k, at: NOW }));
  ok(B.gather({ own: many }).length === 600, "cap 600");
});

/* ---------- Arabic / English engine ---------- */
const T = I.compile([["نجح {n} من {n}", "{n} of {n} passed"], ["الصافي", "Net"], ["متوقف", "OFF"]]);
test("exact pairs translate both ways and keep surrounding space", () => {
  ok(I.translate("  الصافي ", T, "en") === "  Net ", "ar→en");
  ok(I.translate("Net", T, "ar") === "الصافي", "en→ar");
  ok(I.translate("غير معروف", T, "en") === null, "unknown stays null");
});
test("{n} slots carry numbers, percents and codes", () => {
  ok(I.translate("نجح 4 من 6", T, "en") === "4 of 6 passed", I.translate("نجح 4 من 6", T, "en"));
  ok(I.translate("12.5% of 100 passed", T, "ar") === "نجح 12.5% من 100", I.translate("12.5% of 100 passed", T, "ar"));
});
test("pickLang: the address wins, then storage, then the page language", () => {
  ok(I.pickLang("?lang=en", "ar", "ar") === "en" && I.pickLang("", "en", "ar") === "en" && I.pickLang("", null, "ar") === "ar" && I.pickLang("?x=1", "zz", "en") === "en", "pick");
});
test("coverage counts letters of the chosen script", () => {
  ok(Math.abs(I.coverage(["abc", "ابت"], "en") - 0.5) < 1e-9 && I.coverage([], "ar") === 1, "coverage");
});
test("every dictionary pair is well formed, with matching slots and no duplicate source line", () => {
  for (const [name, list] of Object.entries({ COMMON, OPS, CHAIN, ORACLE, TRADELAB, BRAIN, KNOW })) {
    const seen = new Map();
    for (const p of COMMON.concat(name === "COMMON" ? [] : list)) {
      ok(Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string" && p[0].trim() && p[1].trim(), name + ": bad pair " + JSON.stringify(p));
      ok(p[0].split("{n}").length === p[1].split("{n}").length, name + ": slot count " + JSON.stringify(p));
      const k = I.norm(p[0]);
      if (seen.has(k)) ok(seen.get(k) === I.norm(p[1]), name + ": two English lines for " + k);
      seen.set(k, I.norm(p[1]));
    }
    const t = I.compile(COMMON.concat(list));
    ok(t.size > 10, name + " too small");
  }
});
test("the engine never uses innerHTML, eval or a string timer", () => {
  const src = I.mount.toString();
  ok(!/innerHTML|eval\(|new Function|setTimeout\(\s*["'`]/.test(src), "unsafe call");
});

/* ---------- open-source library (ADR-125) ---------- */
test("the open-source library joins only when asked, grouped by category, every repo https on github", () => {
  const off = B.gather({ own: [{ text: "فكرة واحدة عن البيتكوين", at: 1 }] });
  ok(off.every(x => x.src !== "library"), "library must not join unless asked");
  const on = B.gather({ library: true });
  ok(on.length === B.LIBRARY.length && on.every(x => x.src === "library" && x.ref.startsWith("lib:")), "one idea per library entry");
  ok(B.LIBRARY.every(x => B.LIBRARY_CATS[x.cat] && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(x.repo) && x.licence && ["idea", "in use"].includes(x.status)), "fields");
  ok(new Set(B.LIBRARY.map(x => x.name)).size === B.LIBRARY.length, "names unique");
  const r = B.organise({ library: true }, { now: 0 });
  ok(r.themes.length >= 3 && r.ideas.length === B.LIBRARY.length, "the library forms themes: " + r.themes.length);
});

/* ---------- inline copies ---------- */
test("the second brain page carries the current engine copy", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-brain-inline.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stderr || r.stdout).trim());
});
test("every page carries the current language engine and dictionary", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-i18n-inline.mjs"), "--check"], { encoding: "utf8" });
  ok(r.status === 0, (r.stderr || r.stdout).trim());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
