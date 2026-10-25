// Tests for the suite search (ADR-128): the word matcher in the shared suite script, its copies on every page and
// NABD's tools grid.
//   node scripts/test-suite.mjs        exits 0 when every test passes
// No network, no dependencies: the suite script runs in a node:vm context with a minimal stand-in for the page.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = join(HERE, "..");
let failed = 0, passed = 0;
function test(name, f) {
  try { f(); passed++; console.log("PASS " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const PAGES = ["omega-ops-room", "the-chain", "omega-oracle", "omega-trade-lab", "omega-second-brain", "omega-core", "omega-knowledge", "omega-apex"].map(n => `omega-ops-room-v1/${n}.html`);
const read = p => readFileSync(join(REPO, p), "utf8");

// The suite script waits for DOMContentLoaded before it touches the page, so a stand-in with no elements is enough.
function loadSuite(src) {
  const store = new Map(), noop = () => {};
  const document = {
    documentElement: { dataset: {}, classList: { toggle: noop } }, readyState: "loading",
    addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => []
  };
  const ctx = {
    document, location: { protocol: "https:", pathname: "/giant-core/", search: "" }, URLSearchParams, Intl, JSON, Math, Object, Number, String, Date,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    MutationObserver: class { observe() {} }, matchMedia: () => ({ matches: false }), addEventListener: noop
  };
  ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  return ctx.window.OMEGA_SUITE;
}
const S = loadSuite(read("site-landing/suite.js"));
const ITEMS = [
  { kind: "app", en: "APEX council", ar: "مجلس القمة", kw: "apex" },
  { kind: "action", en: "Dark gold peak", ar: "الذروة الذهبية المظلمة", kw: "theme gold tone ذهبي" },
  { kind: "section", en: "أسعار النفط والذهب Oil and gold", ar: "", kw: "oilgold section" },
  { kind: "app", en: "ORACLE", ar: "العرّاف", kw: "oracle" }
];
const names = r => r.map(x => x.en).join(" | ");

test("the matcher folds Arabic letter forms and marks: الذهبيه finds الذهبية, اسعار finds أسعار, العراف finds العرّاف", () => {
  ok(S.rank(ITEMS, "الذهبيه")[0].en === "Dark gold peak", names(S.rank(ITEMS, "الذهبيه")));
  ok(S.rank(ITEMS, "اسعار")[0].kw === "oilgold section", names(S.rank(ITEMS, "اسعار")));
  ok(S.rank(ITEMS, "العراف")[0].en === "ORACLE", names(S.rank(ITEMS, "العراف")));
});
test("every word must match, case does not matter, and a word start ranks above a match inside a word", () => {
  ok(S.rank(ITEMS, "GOLD peak").length === 1, names(S.rank(ITEMS, "GOLD peak")));
  ok(S.rank(ITEMS, "gold zzz").length === 0, "a missing word still matched");
  const r = S.rank([{ kind: "action", en: "Ungold", ar: "", kw: "" }, { kind: "action", en: "Gold", ar: "", kw: "" }], "gold");
  ok(r[0].en === "Gold", names(r));
});
test("apps rank above an equal section match, and at most 24 results come back", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ kind: "section", en: "Map " + i, ar: "", kw: "" }));
  ok(S.rank(many, "map").length === 24, "more than 24 results");
  const r = S.rank([{ kind: "section", en: "Radar", ar: "", kw: "" }, { kind: "app", en: "Radar", ar: "", kw: "" }], "radar");
  ok(r[0].kind === "app", names(r));
});
test("every page carries the same suite copy with the search box, its keys and the NABD link fix", () => {
  for (const p of PAGES.concat(["site-landing/suite.js"])) {
    const h = read(p);
    ok(/ADR-128: one search box/.test(h) && /e\.code === "KeyK"/.test(h) && /\(e\.ctrlKey \|\| e\.metaKey\)/.test(h), `${p}: no search box`);
    ok(/a\[data-suite-href\]/.test(h) && /suiteFind/.test(h), `${p}: no tools link fix or switcher row`);
    ok(!/innerHTML/.test(h.slice(h.indexOf("// OMEGA suite"), h.indexOf("window.OMEGA_SUITE"))), `${p}: innerHTML in the suite`);
  }
});
test("every stylesheet styles the search box, hides it when closed, and lets the switcher scroll on short screens", () => {
  for (const p of PAGES.concat(["site-landing/style.css"])) {
    const h = read(p);
    ok(/\.suite-cmd\[hidden\] \{ display: none; \}/.test(h) && /\.suite-cmd-opt\[aria-selected="true"\]/.test(h), `${p}: no search box styles`);
    ok(/\.suite-pop \{[^}]*max-height: calc\(100dvh[^}]*overflow-y: auto/.test(h), `${p}: the switcher cannot scroll`);
  }
});
test("NABD's tools grid lists the eight pages in Arabic and English, each link known to the suite and present on disk", () => {
  const keys = new Set([...read("site-landing/suite.js").matchAll(/^\s+(\w+): PAGE === "nabd"/gm)].map(m => m[1]));
  for (const p of ["site-landing/index.html", "site-landing/en.html"]) {
    const h = read(p), sec = h.slice(h.indexOf('<section id="tools"'), h.indexOf("</section>", h.indexOf('<section id="tools"')));
    const links = [...sec.matchAll(/<a class="card tool-card" href="([^"]+)" data-suite-href="(\w+)">/g)];
    ok(links.length === 8, `${p}: ${links.length} tool links`);
    for (const [, href, k] of links) ok(keys.has(k) && existsSync(join(REPO, href)), `${p}: ${k} → ${href}`);
    ok(/href="#tools"/.test(h), `${p}: the header does not link the tools section`);
    ok(/ورقي|paper only/.test(sec), `${p}: the paper-only line is missing`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
