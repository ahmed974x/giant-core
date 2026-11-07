// Clean-room structure cloner for the Jarvis Studio (ADR-134). Node standard library only.
// It reads only the layout of a page (which sections it has, how many cards in a grid, how many
// links in the navigation, the shape of a table) and rebuilds it as Studio blocks filled with
// Jarvis's own placeholder copy in English and Arabic. Nothing of the source is kept: no text,
// images, colours, fonts, class names, scripts or links. A sweep then proves no source string or
// brand term survived, and the report says what was dropped.

const RAW_TEXT = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "canvas", "math", "textarea", "title"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "param"]);
const TRACKERS = /(google-analytics|googletagmanager|gtag\/js|doubleclick|facebook\.net|connect\.facebook|hotjar|segment\.(io|com)|mixpanel|clarity\.ms|amplitude|heap(analytics)?|fullstory|intercom|tiktok|snap\.licdn|linkedin\.com\/px|matomo|plausible|stats\.wp)/i;

// ── Tolerant tokenizer → light tree ───────────────────────────────────────────
export function parse(html) {
  const src = String(html || "").slice(0, 2 * 1024 * 1024);
  const root = { tag: "#root", attrs: {}, kids: [], parent: null };
  const counts = { scripts: 0, trackers: 0, styles: 0, images: 0, frames: 0, forms: 0, textChars: 0 };
  const meta = { title: "", siteName: "" };
  let cur = root, i = 0;
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
  const attrRe = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  const text = t => { const s = t.replace(/\s+/g, " "); if (s.trim()) { cur.kids.push({ tag: "#text", text: decode(s) }); counts.textChars += s.trim().length; } };
  while ((m = tagRe.exec(src))) {
    if (m.index > i) text(src.slice(i, m.index));
    i = tagRe.lastIndex;
    if (m[1]) { // closing tag: pop to the nearest open element with that name
      const name = m[1].toLowerCase();
      let n = cur;
      while (n && n.tag !== name && n !== root) n = n.parent;
      if (n && n !== root) cur = n.parent;
      continue;
    }
    if (!m[2]) continue; // comment, doctype, cdata
    const name = m[2].toLowerCase();
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[3] || ""))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    if (name === "meta" && /og:site_name|application-name/i.test(attrs.property || attrs.name || "")) meta.siteName = attrs.content || "";
    if (RAW_TEXT.has(name)) {
      const end = src.toLowerCase().indexOf("</" + name, i);
      const body = end < 0 ? src.slice(i) : src.slice(i, end);
      if (name === "script") { counts.scripts++; if (TRACKERS.test((attrs.src || "") + " " + body.slice(0, 4000))) counts.trackers++; }
      else if (name === "style") counts.styles++;
      else if (name === "iframe" || name === "object") counts.frames++;
      else if (name === "title") meta.title = decode(body.replace(/\s+/g, " ").trim());
      if (end >= 0) { const close = src.indexOf(">", end); i = close < 0 ? src.length : close + 1; tagRe.lastIndex = i; }
      else { i = src.length; tagRe.lastIndex = i; }
      continue;
    }
    if (name === "img" || name === "picture" || name === "video") counts.images++;
    if (name === "form") counts.forms++;
    if (name === "link" && /stylesheet/i.test(attrs.rel || "")) counts.styles++;
    const node = { tag: name, attrs, kids: [], parent: cur };
    cur.kids.push(node);
    if (!VOID.has(name) && !m[4]) cur = node;
  }
  if (i < src.length) text(src.slice(i));
  return { root, counts, meta };
}

function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k[0] === "#") { const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[k];
  });
}

const els = n => n.kids.filter(k => k.tag !== "#text");
function find(n, pred, out = []) { for (const k of n.kids) { if (k.tag === "#text") continue; if (pred(k)) out.push(k); find(k, pred, out); } return out; }
function textOf(n) { let s = ""; const walk = x => { for (const k of x.kids) { if (k.tag === "#text") s += k.text; else walk(k); } }; walk(n); return s.replace(/\s+/g, " ").trim(); }
const isHeading = n => /^h[1-6]$/.test(n.tag);
const isLinkish = n => n.tag === "a" || n.tag === "button";
const looksButton = n => n.tag === "button" || (n.tag === "a" && /\b(btn|button|cta)\b/i.test(n.attrs.class || "") ) || (n.tag === "a" && (n.attrs.role || "") === "button");

function sectionsOf(root) {
  const body = find(root, n => n.tag === "body")[0] || root;
  const main = find(body, n => n.tag === "main")[0];
  const out = [];
  const take = parent => {
    for (const k of els(parent)) {
      if (["header", "nav", "footer", "section", "article", "aside", "table", "form", "details", "dl"].includes(k.tag)) out.push(k);
      else if (k.tag === "main") take(k);
      else if (["div", "span"].includes(k.tag)) {
        const inner = els(k);
        if (inner.some(c => ["header", "nav", "footer", "section", "main"].includes(c.tag)) || (inner.length === 1 && inner[0].tag === "div")) take(k);
        else if (find(k, isHeading).length || find(k, n => n.tag === "table").length) out.push(k);
      }
    }
  };
  take(body);
  if (main && !out.length) take(main);
  return out.slice(0, 30);
}

// Largest set of sibling elements that look alike (a grid of cards).
function bestGrid(sec) {
  let best = null;
  const visit = n => {
    const kids = els(n);
    if (kids.length >= 2) {
      const sig = k => k.tag + ":" + (find(k, isHeading).length ? "h" : "") + (find(k, x => x.tag === "img" || x.tag === "svg" || x.tag === "picture").length ? "i" : "") + (find(k, x => x.tag === "p").length ? "p" : "");
      const groups = {};
      for (const k of kids) (groups[sig(k)] = groups[sig(k)] || []).push(k);
      for (const g of Object.values(groups)) if (g.length >= 2 && (!best || g.length > best.items.length)) best = { parent: n, items: g };
    }
    kids.forEach(visit);
  };
  visit(sec);
  return best;
}

function colsHint(grid) {
  const cls = (grid.parent.attrs.class || "") + " " + (grid.parent.attrs.style || "");
  const m = /grid-cols-(\d)|col(?:umns)?-(\d)\b|repeat\((\d)/i.exec(cls);
  const fromClass = m ? Number(m[1] || m[2] || m[3]) : 0;
  const n = grid.items.length;
  return Math.max(1, Math.min(4, fromClass || (n % 3 === 0 ? 3 : n % 4 === 0 ? 4 : n >= 3 ? 3 : 2)));
}

export function classify(sec, index, total) {
  const tag = sec.tag;
  const heads = find(sec, isHeading);
  const links = find(sec, isLinkish);
  const t = textOf(sec);
  if (tag === "nav" || (tag === "header" && !find(sec, n => n.tag === "h1").length && links.length >= 2)) {
    return { type: "nav", links: Math.min(5, Math.max(1, find(sec, n => n.tag === "a").length - (find(sec, looksButton).length ? 1 : 0))), cta: find(sec, looksButton).length > 0 };
  }
  if (tag === "footer" || (index === total - 1 && /©|copyright|all rights/i.test(t))) return { type: "footer" };
  const table = tag === "table" ? sec : find(sec, n => n.tag === "table")[0];
  if (table) {
    const rows = find(table, n => n.tag === "tr");
    const cols = rows.length ? Math.max(...rows.slice(0, 5).map(r => els(r).filter(c => c.tag === "td" || c.tag === "th").length)) : 0;
    return { type: "table", title: heads.length > 0, cols: Math.max(2, Math.min(6, cols || 2)), rows: Math.max(1, Math.min(8, rows.length - (find(table, n => n.tag === "th").length ? 1 : 0))) };
  }
  const details = find(sec, n => n.tag === "details");
  const qHeads = heads.filter(h => /[?؟]\s*$/.test(textOf(h)));
  if (details.length >= 2 || qHeads.length >= 2 || find(sec, n => n.tag === "dt").length >= 2) {
    return { type: "faq", title: heads.length > qHeads.length, items: Math.min(6, Math.max(details.length, qHeads.length, find(sec, n => n.tag === "dt").length)) };
  }
  if (find(sec, n => n.tag === "h1").length || (index <= 1 && heads.length && find(sec, looksButton).length)) {
    return { type: "hero", kicker: false, body: find(sec, n => n.tag === "p").length > 0, buttons: Math.min(2, find(sec, looksButton).length || (links.length ? 1 : 0)) };
  }
  const grid = bestGrid(sec);
  if (grid && grid.items.length >= 2) {
    const numeric = grid.items.filter(k => /^[\s\d.,%+×x$€£¥kKmMbB/-]{1,12}$/.test(textOf(k).split(" ")[0] || "") && textOf(k).length < 60).length;
    if (numeric >= Math.ceil(grid.items.length * 0.6) && grid.items.length <= 6) return { type: "stats", items: Math.min(6, grid.items.length) };
    return { type: "features", title: heads.length > grid.items.length, items: Math.min(6, grid.items.length), cols: colsHint(grid) };
  }
  if (index >= total - 3 && heads.length <= 2 && links.length >= 1 && links.length <= 3 && t.length < 400) return { type: "cta", body: find(sec, n => n.tag === "p").length > 0 };
  if (heads.length) return { type: "text", paragraphs: Math.max(1, Math.min(3, find(sec, n => n.tag === "p").length)) };
  return null;
}

// ── Our own copy, by role. Never the source's words. ─────────────────────────
const ORD_EN = ["one", "two", "three", "four", "five", "six"];
const ORD_AR = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة"];
const ORD_AR_M = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];
function copyFor(s) {
  const en = {}, ar = {};
  switch (s.type) {
    case "nav":
      en.brand = "Your brand"; ar.brand = "علامتك";
      en.links = ORD_EN.slice(0, s.links).map((w, i) => ["Product", "Features", "Pricing", "Docs", "About"][i] || "Link " + w).join(", ");
      ar.links = ["المنتج", "المزايا", "الأسعار", "التوثيق", "من نحن"].slice(0, s.links).join("، ");
      if (s.cta) { en.cta = "Get started"; ar.cta = "ابدأ الآن"; }
      break;
    case "hero":
      en.title = "Your headline in one clear line"; ar.title = "عنوانك في سطر واحد واضح";
      if (s.body) { en.body = "One or two sentences on who this is for and what it does for them."; ar.body = "جملة أو جملتان عن لمن هذا وماذا يقدّم لهم."; }
      if (s.buttons >= 1) { en.primary = "Get started"; ar.primary = "ابدأ الآن"; }
      if (s.buttons >= 2) { en.secondary = "Learn more"; ar.secondary = "اعرف أكثر"; }
      break;
    case "features":
      en.title = "What you get"; ar.title = "ماذا تحصل عليه";
      for (let i = 0; i < s.items; i++) { en["f" + (i + 1) + "t"] = "Feature " + ORD_EN[i]; en["f" + (i + 1) + "b"] = "Say what this does for the reader in one short sentence."; ar["f" + (i + 1) + "t"] = "الميزة " + ORD_AR[i]; ar["f" + (i + 1) + "b"] = "قل ما تقدّمه هذه الميزة للقارئ في جملة قصيرة."; }
      break;
    case "stats":
      for (let i = 0; i < s.items; i++) { en["s" + (i + 1) + "v"] = "—"; en["s" + (i + 1) + "l"] = "your number " + ORD_EN[i]; ar["s" + (i + 1) + "v"] = "—"; ar["s" + (i + 1) + "l"] = "رقمك " + ORD_AR_M[i]; }
      break;
    case "faq":
      en.title = "Questions"; ar.title = "أسئلة";
      for (let i = 0; i < Math.min(6, s.items); i++) { en["q" + (i + 1)] = "Question " + ORD_EN[i] + "?"; en["a" + (i + 1)] = "Write the answer in plain words."; ar["q" + (i + 1)] = "السؤال " + ORD_AR_M[i] + "؟"; ar["a" + (i + 1)] = "اكتب الجواب بكلمات بسيطة."; }
      break;
    case "table":
      en.title = "Compare"; ar.title = "قارن";
      for (let c = 0; c < s.cols; c++) { en["c" + (c + 1)] = "Column " + (c + 1); ar["c" + (c + 1)] = "العمود " + (c + 1); }
      en.cell = "—"; ar.cell = "—";
      break;
    case "text":
      en.title = "Section title"; ar.title = "عنوان القسم";
      en.body = "A short paragraph in your own words."; ar.body = "فقرة قصيرة بكلماتك أنت.";
      break;
    case "cta":
      en.title = "Ready when you are"; ar.title = "جاهز متى ما كنت جاهزاً";
      if (s.body) { en.body = "Name the one next step you want."; ar.body = "سمِّ الخطوة التالية التي تريدها."; }
      en.button = "Get started"; ar.button = "ابدأ الآن";
      break;
    case "footer":
      en.text = "© Your company"; ar.text = "© شركتك";
      break;
  }
  return { en, ar };
}

// ── Sweep: prove that nothing of the source survived ─────────────────────────
function words(s) { return String(s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3); }
export function sweep(source, blocks, meta, host) {
  const outText = JSON.stringify(blocks.map(b => b.t)).toLowerCase();
  const brand = new Set([...words(meta.title), ...words(meta.siteName), ...String(host || "").toLowerCase().replace(/^www\./, "").split(".").slice(0, -1).filter(w => w.length >= 3)]);
  // Drop everyday words that our own copy also uses, so the check targets names, not English.
  const COMMON = new Set(["the", "and", "for", "you", "your", "our", "get", "with", "from", "more", "home", "about", "features", "pricing", "docs", "product", "started", "learn", "questions", "start", "now", "one", "two", "three", "page", "site", "web", "app", "com"]);
  const brandHits = [...brand].filter(w => !COMMON.has(w) && new RegExp("(^|[^\\p{L}\\p{N}])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\p{L}\\p{N}])", "u").test(outText));
  const phrases = [];
  const collect = n => { for (const k of n.kids) { if (k.tag === "#text") { const t = k.text.trim(); if (t.length >= 12) phrases.push(t.toLowerCase()); } else collect(k); } };
  collect(source);
  const phraseHits = phrases.filter(p => outText.includes(p));
  return { brandTermsChecked: brand.size, sourcePhrasesChecked: phrases.length, leaks: brandHits.length + phraseHits.length, leaked: [...brandHits, ...phraseHits.slice(0, 5)] };
}

export function cleanClone(html, { host = "", url = "" } = {}) {
  const { root, counts, meta } = parse(html);
  const secs = sectionsOf(root);
  const shapes = [];
  secs.forEach((s, i) => { const c = classify(s, i, secs.length); if (c && !(c.type === "nav" && shapes.some(x => x.type === "nav")) && !(c.type === "footer" && shapes.some(x => x.type === "footer"))) shapes.push(c); });
  // A page always starts with navigation and a hero and ends with a footer in the rebuilt template.
  if (!shapes.some(s => s.type === "hero")) shapes.splice(shapes[0] && shapes[0].type === "nav" ? 1 : 0, 0, { type: "hero", body: true, buttons: 1, added: true });
  const blocks = shapes.slice(0, 12).map((s, i) => ({ id: "c-" + i + "-" + s.type, type: s.type, on: true, shape: s, t: copyFor(s) }));
  // Keep nav first and footer last whatever order the source used.
  blocks.sort((a, b) => (a.type === "nav" ? -1 : a.type === "footer" ? 1 : 0) - (b.type === "nav" ? -1 : b.type === "footer" ? 1 : 0));
  const sw = sweep(root, blocks, meta, host);
  // The copy is fixed text written for Jarvis, so a hit can only be a coincidence (a brand named
  // like an everyday word). It is reported, never hidden; the page shows it before anything is used.
  return {
    blocks: blocks.map(({ shape, ...b }) => ({ ...b, cols: shape.cols || null, rows: shape.rows || null })),
    report: {
      source: host || "pasted HTML", url: url || null,
      sections: shapes.map(s => s.type + (s.items ? " ×" + s.items : s.cols && s.type === "table" ? " " + s.cols + "×" + s.rows : "")),
      dropped: { scripts: counts.scripts, trackers: counts.trackers, stylesheets: counts.styles, images: counts.images, frames: counts.frames, forms: counts.forms, textCharacters: counts.textChars },
      sweep: sw,
      kept: "layout only: section order, card counts, nav link count, table shape",
    },
  };
}
