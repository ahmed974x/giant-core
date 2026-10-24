// Arabic / English switch for every OMEGA page (ADR-119). One engine, shared by the Ops Room, THE CHAIN, ORACLE,
// TRADE LAB and the second brain, inlined between the OMEGA_I18N markers by scripts/build-i18n-inline.mjs because
// the pages must work from file:// with no build step. Tests: scripts/test-i18n.mjs.
//
// The pages were written in one language each (the Ops Room in English with Arabic notes, the others in Arabic).
// Rather than rewriting thousands of elements, the engine swaps whole text nodes and a few attributes against a
// page dictionary of [arabic, english] pairs. A pair may hold {n} slots for numbers and short codes, so "نجح 2 من 6"
// and "2 of 6 passed" match one entry. Text the dictionary does not know stays as written: nothing is machine
// translated and nothing leaves the browser. Brand names and code tokens under translate="no" are never touched.
// The choice lives in localStorage "omega-lang" (wrapped in try/catch) and syncs across open pages over the
// BroadcastChannel "omega-suite-lang"; ?lang=ar|en in the address wins for that visit.

const WS = /\s+/g;
const norm = s => String(s).replace(WS, " ").trim();
const SLOT = "{n}";
// What a {n} slot may hold: a number with its sign, separators, unit or percent, a time, a dash or a short code.
const SLOT_RE = "([-+−]?[\\d٠-٩][\\d٠-٩.,:/٫٬]*\\s?(?:%|٪|R|bps|USDT|\\$|ms|µs|s|x)?|[—–∞✓✗]|[A-Z0-9_./-]{1,16})";
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compile(pairs) {
  const exact = { ar: new Map(), en: new Map() }, patterns = { ar: [], en: [] };
  for (const p of pairs || []) {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "string" || typeof p[1] !== "string") continue;
    const ar = norm(p[0]), en = norm(p[1]);
    if (!ar || !en) continue;
    if (ar.includes(SLOT) || en.includes(SLOT)) {
      const nA = ar.split(SLOT).length - 1, nE = en.split(SLOT).length - 1;
      if (nA !== nE) continue;
      // Slots keep their order unless the pair names them {n1} {n2}… (not needed so far).
      patterns.en.push({ re: new RegExp("^" + ar.split(SLOT).map(esc).join(SLOT_RE) + "$"), out: en });
      patterns.ar.push({ re: new RegExp("^" + en.split(SLOT).map(esc).join(SLOT_RE) + "$"), out: ar });
    } else {
      if (!exact.en.has(ar)) exact.en.set(ar, en);
      if (!exact.ar.has(en)) exact.ar.set(en, ar);
    }
  }
  return { exact, patterns, size: exact.en.size + patterns.en.length };
}

// Translate one string into `to` ("ar" or "en"). Returns null when the dictionary has no entry, so the caller keeps
// the original. Leading and trailing white space is kept exactly.
function translate(text, table, to) {
  if (typeof text !== "string" || !table || (to !== "ar" && to !== "en")) return null;
  const core = norm(text);
  if (!core) return null;
  let out = table.exact[to].get(core);
  if (out == null) {
    for (const p of table.patterns[to]) {
      const m = core.match(p.re);
      if (m) { let i = 1; out = p.out.split(SLOT).reduce((s, part, k) => k === 0 ? part : s + m[i++] + part, ""); break; }
    }
  }
  if (out == null) return null;
  const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
  return lead + out + trail;
}

function pickLang(search, stored, fallback) {
  const q = /[?&]lang=(ar|en)\b/.exec(search || "");
  if (q) return q[1];
  if (stored === "ar" || stored === "en") return stored;
  return fallback === "en" ? "en" : "ar";
}

// Share of the page's visible text (by characters, Arabic or Latin letters only) that is in the target language.
function coverage(texts, to) {
  let want = 0, other = 0;
  const AR = /[؀-ۿ]/g, EN = /[A-Za-z]/g;
  for (const t of texts) { const a = (t.match(AR) || []).length, e = (t.match(EN) || []).length; if (to === "en") { want += e; other += a; } else { want += a; other += e; } }
  return want + other ? want / (want + other) : 1;
}

// Letters of each script, used to tell which language a text node is in.
const HAS = { ar: /[\u0600-\u06FF]/, en: /[A-Za-z]/ };
const other = l => l === "ar" ? "en" : "ar";
// A trailing separator left when the other half of a bilingual label is hidden ("Run again · ").
const SEP_TAIL = /\s*[·•|/]\s*$/;
// Labels that stay as written in both languages: [INFERENCE…] tags and similar bracketed codes.
const TOKEN = /^\s*\[[A-Z][A-Za-z0-9 .:_-]*\]\s*$/;

// The DOM part. `opts`: { pairs, source: "ar" | "en" | "both", button: id of the control to place the switch
// before, flipDir: false to keep the page's direction }. A page in "both" was written bilingual: English text with
// an Arabic <span class="ar"> beside it (the Ops Room). Arabic pages mark English sub-labels with class "en". For a
// label that has both halves, the chosen language shows its own half and the other half is hidden; a label with one
// half is translated through the dictionary when it can be.
function mount(opts) {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc || !doc.body) return null;
  const table = compile(opts.pairs), source = opts.source === "en" || opts.source === "both" ? opts.source : "ar";
  const modes = source === "both" ? ["both", "ar", "en"] : ["ar", "en"];
  const root = doc.documentElement, srcDir = root.getAttribute("dir") || (source === "ar" ? "rtl" : "ltr"), srcLang = root.getAttribute("lang") || "ar";
  const origText = new WeakMap(), wrote = new WeakMap(), origAttr = new WeakMap(), hiddenBy = new WeakSet(), superseded = new WeakSet();
  const ATTRS = ["aria-label", "placeholder", "title", "alt"];
  const skip = n => { const e = n.nodeType === 1 ? n : n.parentElement; return !e || !!e.closest("script,style,textarea,[data-i18n-skip]"); };
  const frozen = n => { const e = n.nodeType === 1 ? n : n.parentElement; return !!(e && e.closest("[translate=\"no\"]")); };
  const half = e => e && e.nodeType === 1 && (e.classList.contains("ar") || e.classList.contains("en")) ? (e.classList.contains("ar") ? "ar" : "en") : null;
  let lang = source, busy = false, chan = null, btn = null;
  const store = { get() { try { return localStorage.getItem("omega-lang"); } catch (e) { return null; } }, set(v) { try { localStorage.setItem("omega-lang", v); } catch (e) { /* the page works without storage */ } } };
  const docTitle = doc.title;

  // The bilingual partner of a text node: a marked half among its parent's children, or the half it sits inside.
  function partnerOf(n) {
    const e = n.parentElement;
    if (!e) return null;
    const own = half(e.closest(".ar,.en"));
    if (own) return { inside: own };
    for (const c of e.children) { const h = half(c); if (h) return { beside: h, el: c }; }
    // A plain inline wrapper (<span id="…">English</span> <span class="ar">…</span>) pairs one level up.
    if (e.tagName === "SPAN" && e.id && !e.children.length && e.parentElement) for (const c of e.parentElement.children) { const h = half(c); if (h && c !== e) return { beside: h, el: c }; }
    return null;
  }
  function wantText(n, src) {
    if (lang === "both" || lang === source && source !== "both") return src;
    const p = partnerOf(n);
    // A marked half is shown or hidden whole; it is rewritten only when the dictionary knows it (a lone half).
    if (p && p.inside) return HAS[other(lang)].test(src) ? (translate(src, table, lang) ?? src) : src;
    if (p && p.beside) {
      // This node is the other half of a pair whose marked half is in the chosen language: it gives way.
      // Translated when the dictionary knows it (the marked half then reads as a sub-label, as on the source page).
      // On a bilingual page the marked half already says it, so this half gives way.
      // A dictionary line that says more (a live state such as "OFF") replaces both halves.
      if (p.beside === lang && HAS[other(lang)].test(src) && !HAS[lang].test(src) && !TOKEN.test(src)) {
        const t = translate(src, table, lang);
        if (source === "both") { if (t != null && /[:：]/.test(src)) { superseded.add(p.el); return t; } superseded.delete(p.el); return ""; }
        return t ?? "";
      }
      if (p.beside !== lang && HAS[lang].test(src)) return src.replace(SEP_TAIL, "");
    }
    if (!HAS[other(lang)].test(src) || TOKEN.test(src)) return src;
    return translate(src, table, lang) ?? src;
  }
  // Arabic written into a box styled for Latin (tracked capitals, a left-to-right number line) gets letter-spacing 0
  // and its own paragraph direction through the CSSOM, and gets the page's style back when the text does.
  // A monospace box also gets the Arabic font (ADR-120): a monospace fallback draws each Arabic letter in a
  // fixed cell, which breaks the joins ("هادئ" showed as "ها دئ"); digits keep tabular-nums.
  const fixed = new WeakMap();
  const MONO = /mono|courier|consolas|menlo/i;
  function fitBox(e, arabic) {
    if (!e || !e.style) return;
    if (arabic && !fixed.has(e)) {
      fixed.set(e, { ls: e.style.letterSpacing, ub: e.style.unicodeBidi, tt: e.style.textTransform, ff: e.style.fontFamily });
      e.style.letterSpacing = "0"; e.style.unicodeBidi = "plaintext"; e.style.textTransform = "none";
      const g = typeof getComputedStyle === "function" ? getComputedStyle(e) : null;
      if (g && MONO.test(String(g.fontFamily).split(",")[0])) e.style.fontFamily = "var(--font-ar, system-ui, sans-serif)";
    } else if (!arabic && fixed.has(e)) {
      const o = fixed.get(e); fixed.delete(e);
      e.style.letterSpacing = o.ls; e.style.unicodeBidi = o.ub; e.style.textTransform = o.tt; e.style.fontFamily = o.ff;
    }
  }
  function doText(n) {
    if (skip(n) || frozen(n)) return;
    const cur = n.nodeValue;
    // A value the page wrote after us is the new source text.
    if (!origText.has(n) || (wrote.has(n) && wrote.get(n) !== cur)) origText.set(n, cur);
    const src = origText.get(n), want = wantText(n, src);
    if (cur !== want) n.nodeValue = want;
    wrote.set(n, want);
    if (source !== "ar") fitBox(n.parentElement, want !== src && HAS.ar.test(want));
  }
  function doHalf(e) {
    const h = half(e);
    if (!h) return;
    let hide = lang !== "both" && h === lang && superseded.has(e);
    // A page in its own language shows both halves as written; only a switched page hides one.
    if (lang !== "both" && h !== lang && (source === "both" || lang !== source)) {
      // Hide the half in the other language only when its partner carries the chosen language (or a translation).
      const par = e.parentElement;
      if (par) for (const c of par.childNodes) {
        if (c === e) continue;
        const t = c.nodeType === 3 ? origText.get(c) ?? c.nodeValue : c.nodeType === 1 && !half(c) ? c.textContent : "";
        if (t && (HAS[lang].test(t) || (HAS[other(lang)].test(t) && translate(t, table, lang) != null))) { hide = true; break; }
      }
    }
    if (hide) { if (e.style.display !== "none") { e.style.display = "none"; hiddenBy.add(e); } }
    else if (hiddenBy.has(e)) { e.style.display = ""; hiddenBy.delete(e); }
    // An Arabic half shown on its own inside a tracked-capitals label loses the tracking.
    if (source === "both") fitBox(e, h === "ar" && lang === "ar");
  }
  function doAttrs(e) {
    // A text field's typed value is never touched, but its placeholder, label and title are the page's own words
    // and switch with the language (ADR-120: textarea placeholders stayed Arabic on the English page).
    if (e.closest("script,style,[data-i18n-skip]") || frozen(e)) return;
    let o = origAttr.get(e);
    for (const a of ATTRS) {
      if (!e.hasAttribute(a)) continue;
      const v = e.getAttribute(a);
      if (!o) { o = {}; origAttr.set(e, o); }
      if (!(a in o) || (o["w" + a] != null && o["w" + a] !== v)) o[a] = v;
      let want = o[a];
      if (lang !== "both" && !(lang === source && source !== "both")) {
        const parts = want.split(" · ");
        // "English · العربية" labels keep the chosen half.
        if (parts.length === 2 && HAS.en.test(parts[0]) && HAS.ar.test(parts[1]) && !HAS.ar.test(parts[0])) want = lang === "ar" ? parts[1] : parts[0];
        else if (HAS[other(lang)].test(want)) want = translate(want, table, lang) ?? want;
      }
      if (v !== want) e.setAttribute(a, want);
      o["w" + a] = want;
    }
  }
  function walk(node) {
    if (node.nodeType === 3) { doText(node); if (node.parentElement) for (const c of node.parentElement.children) doHalf(c); return; }
    if (node.nodeType !== 1 || skip(node)) return;
    doAttrs(node);
    const w = doc.createTreeWalker(node, 5 /* elements and text */);
    const halves = [];
    if (half(node)) halves.push(node);
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else { doAttrs(n); if (half(n)) halves.push(n); } }
    for (const e of halves) doHalf(e);
  }
  const mo = new MutationObserver(list => {
    if (busy || lang === "both" || (lang === source && source !== "both")) return;
    for (const m of list) pending.add(m.target);
    if (!queued && pending.size) {
      queued = true;
      Promise.resolve().then(() => { queued = false; busy = true; try { for (const n of pending) if (n.isConnected) walk(n); } finally { busy = false; pending.clear(); mo.takeRecords(); } });
    }
  });
  const pending = new Set();
  let queued = false;
  const LABEL = { both: "ع+EN", ar: "ع", en: "EN" };
  function apply(next, from) {
    lang = modes.includes(next) ? next : source;
    busy = true;
    try {
      root.lang = lang === "both" ? srcLang : lang;
      root.dir = opts.flipDir === false || lang === "both" ? srcDir : (lang === "ar" ? "rtl" : "ltr");
      root.dataset.lang = lang;
      walk(doc.body);
      const t = lang === source || lang === "both" ? docTitle : (translate(docTitle, table, lang) ?? docTitle);
      if (doc.title !== t) doc.title = t;
      if (btn) {
        const nx = modes[(modes.indexOf(lang) + 1) % modes.length];
        btn.textContent = LABEL[lang];
        btn.setAttribute("aria-label", `Language: ${LABEL[lang]}, switch to ${LABEL[nx]} · اللغة`);
        btn.title = btn.getAttribute("aria-label");
      }
    } finally { busy = false; mo.takeRecords(); }
    if (from !== "remote" && from !== "init") { store.set(lang); if (chan) try { chan.postMessage({ lang }); } catch (e) { /* closed channel */ } }
    if (typeof opts.onChange === "function") opts.onChange(lang);
    const fire = () => { try { doc.dispatchEvent(new CustomEvent("omega-lang", { detail: lang })); } catch (e) { /* old browser: pages re-render on their own */ } };
    // The first apply runs inside mount(), before the page has stored the handle mount() returns in window.OMEGA_LANG,
    // so its event waits one microtask: a page that re-renders on "omega-lang" then reads the chosen language (ADR-120).
    if (from === "init") Promise.resolve().then(fire); else fire();
  }
  mo.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  const anchor = opts.button && doc.getElementById(opts.button);
  if (anchor && anchor.parentNode && !doc.getElementById("langToggle")) {
    btn = doc.createElement("button");
    btn.type = "button"; btn.id = "langToggle"; btn.className = anchor.className || "icon-btn"; btn.setAttribute("translate", "no");
    btn.classList.add("lang-btn");
    // The label is text, not an icon, so the square icon button grows to fit it (CSSOM, allowed by the CSP).
    btn.style.width = "auto"; btn.style.minWidth = "44px"; btn.style.paddingInline = "10px"; btn.style.fontWeight = "700";
    btn.addEventListener("click", () => apply(modes[(modes.indexOf(lang) + 1) % modes.length]));
    anchor.parentNode.insertBefore(btn, anchor);
  }
  try { chan = new BroadcastChannel("omega-suite-lang"); chan.onmessage = e => { const v = e && e.data && e.data.lang; if ((v === "ar" || v === "en" || v === "both") && v !== lang) apply(v === "both" && !modes.includes("both") ? source : v, "remote"); }; } catch (e) { chan = null; }
  let first = pickLang(typeof location !== "undefined" ? location.search : "", store.get(), source === "en" ? "en" : "ar");
  // A page that is bilingual by design opens bilingual until someone picks a language.
  if (source === "both" && !/[?&]lang=(ar|en)\b/.test(typeof location !== "undefined" ? location.search : "") && store.get() !== "ar" && store.get() !== "en") first = "both";
  apply(first, "init");
  return {
    get lang() { return lang; }, set: v => apply(v), t: (ar, en) => lang === "en" ? en : ar, size: table.size,
    coverage: () => { const out = []; const w = doc.createTreeWalker(doc.body, 4); let n; while ((n = w.nextNode())) { const e = n.parentElement; if (!skip(n) && n.nodeValue.trim() && e && e.offsetParent !== null) out.push(n.nodeValue); } return coverage(out, lang === "both" ? "en" : lang); }
  };
}

export const OMEGA_I18N = Object.freeze({ VERSION: "omega-i18n-v1", compile, translate, pickLang, coverage, norm, mount });
