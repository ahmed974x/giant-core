#!/usr/bin/env node
// OMEGA in one file (ADR-131): packs NABD (Arabic and English), the Ops Room, THE CHAIN, ORACLE, TRADE LAB, the second
// brain, the core, the knowledge domain and the APEX council into one self-contained HTML file that opens by double-click.
//   node scripts/build-single-file.mjs [out.html]        default: _site/OMEGA-PRIME-ALL-IN-ONE.html
//   node scripts/build-single-file.mjs --check [out.html] rebuilds in memory and fails if the file on disk differs
// How it works: every page is stored unchanged as text inside an inert <script type="text/plain"> block (the only
// changes are "</script" and "<!--" written as "<#OMEGA#/script" and "<#OMEGA#!--" so the block cannot close early;
// the launcher turns them back before use). NABD's style.css, fonts and scripts are inlined first and its CSP is re-pinned;
// its install script (pwa.js) is left out because a service worker cannot run inside the bundle. The launcher opens a page
// in an <iframe srcdoc>, which inherits the launcher's CSP, so the launcher's CSP is the union of every page's CSP plus
// its own hashes; each page's own CSP meta still applies on top. Links between the pages are caught and opened inside the
// launcher. Paper only: the pages are the same files as on main, nothing here sends an order or adds a network host.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const OUT = resolve(args.find(a => !a.startsWith("--")) || join(REPO, "_site", "OMEGA-PRIME-ALL-IN-ONE.html"));
const read = p => readFileSync(join(REPO, p), "utf8");
const sha = s => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
const SENT = "<#OMEGA#";

// id, source, filename the pages link to, icon, Arabic and English name, one line each
const PAGES = [
  ["nabd", "site-landing/index.html", "index.html", "📡", "بوابة نبض", "NABD portal", "الموقع العام، محاكاة ورقية وأدوات", "Public site, paper simulations and tools"],
  ["nabd-en", "site-landing/en.html", "en.html", "🌐", "نبض بالإنجليزي", "NABD in English", "النسخة الإنجليزية من البوابة", "The English edition of the portal"],
  ["ops", "omega-ops-room-v1/omega-ops-room.html", "omega-ops-room.html", "🎯", "غرفة العمليات", "Ops Room", "المكتب الورقي، أوزيريس، الإيصالات والدرع", "Paper desk, OSIRIS, receipts and shield"],
  ["chain", "omega-ops-room-v1/the-chain.html", "the-chain.html", "⛓️", "السلسلة", "THE CHAIN", "سلسلة بحث مالي وملاحظات محلية", "Finance research chain, local notes"],
  ["oracle", "omega-ops-room-v1/omega-oracle.html", "omega-oracle.html", "🔭", "العرّاف", "ORACLE", "بحث عميق من مصادر مفتوحة", "Deep research from open sources"],
  ["lab", "omega-ops-room-v1/omega-trade-lab.html", "omega-trade-lab.html", "📒", "مختبر المتداول", "TRADE LAB", "دفتر التداول الورقي ووكيل مدير المكتب", "Paper journal and desk manager agent"],
  ["brain", "omega-ops-room-v1/omega-second-brain.html", "omega-second-brain.html", "🧠", "المخ الثاني", "Second brain", "أفكارك مدموجة ومرتبة على جهازك", "Your ideas merged and ranked on this device"],
  ["core", "omega-ops-room-v1/omega-core.html", "omega-core.html", "🧬", "النواة", "Core", "نواة الوكلاء ثلاثية الأبعاد والنماذج ومصادرها", "3D agent core, AI models and their sources"],
  ["know", "omega-ops-room-v1/omega-knowledge.html", "omega-knowledge.html", "🕸️", "نطاق المعرفة", "Knowledge domain", "الأفكار والأدوات والمصادر والوكلاء والقرارات في شبكة واحدة", "Ideas, tools, sources, agents and decisions in one graph"],
  ["apex", "omega-ops-room-v1/omega-apex.html", "omega-apex.html", "◆", "مجلس القمة", "APEX council", "القائد وخمسة عشر مساعداً ميدانياً، ورقي فقط", "The lead and fifteen field helpers, paper only"]
].map(([id, src, file, icon, ar, en, lineAr, lineEn]) => ({ id, src, file, icon, ar, en, lineAr, lineEn }));

const cspOf = html => (/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i.exec(html) || [])[1] || "";
const parseCsp = csp => Object.fromEntries(csp.split(";").map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k.toLowerCase(), v]; }));
function inlineHashes(html) {
  return {
    "script-src": [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => sha(m[1])),
    "style-src": [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => sha(m[1]))
  };
}
function setDirective(html, name, tokens) {
  return html.replace(/(<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content=")([^"]+)(")/i, (_, a, csp, z) => {
    const re = new RegExp(`(^|;)(\\s*)${name}\\s+[^;]*`, "i");
    return a + (re.test(csp) ? csp.replace(re, `$1$2${name} ${tokens.join(" ")}`) : `${csp}; ${name} ${tokens.join(" ")}`) + z;
  });
}

// NABD: inline the stylesheet (fonts as data URIs) and the scripts, drop the install script, re-pin the CSP.
function inlineNabd(html) {
  const font = f => `url("data:font/woff2;base64,${readFileSync(join(REPO, "site-landing", f)).toString("base64")}")`;
  const css = read("site-landing/style.css").replace(/url\("(fonts\/[^"]+\.woff2)"\)/g, (_, f) => font(f));
  let out = html
    .replace(/[ \t]*<link rel="(preload|alternate)"[^>]*>\n?/g, "")
    .replace(/<link rel="stylesheet" href="style.css">/, () => `<style>\n${css}</style>`)
    .replace(/<script src="pwa\.js"[^>]*><\/script>\n?/, "")
    .replace(/<script src="([a-z-]+\.js)"[^>]*><\/script>/g, (_, f) => `<script>\n${read("site-landing/" + f)}</script>`);
  if (/<script[^>]+src=|<link[^>]+href="(?!#)[^"]*\.(css|woff2)"/.test(out)) throw new Error("NABD still loads a file from disk");
  const h = inlineHashes(out);
  out = setDirective(out, "script-src", h["script-src"]);
  out = setDirective(out, "style-src", h["style-src"]);
  out = setDirective(out, "font-src", ["data:"]);
  return out;
}

// Inside the launcher a page's address is about:srcdoc, where history.replaceState("?view=…") throws. This shim, placed
// right after each page's CSP meta and pinned in it, keeps such a call from stopping the page: it retries with the
// fragment only, then gives up quietly. It changes nothing else.
const SHIM = `(() => { const H = history; for (const k of ["replaceState", "pushState"]) { const f = H[k]; H[k] = function (s, t, u) { try { return f.call(H, s, t, u); } catch (e) { try { return f.call(H, s, t, new URL(String(u), location.href).hash || "#"); } catch (e2) { return undefined; } } }; } })();`;
function addShim(html) {
  const out = html.replace(/(<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>\n?)/i, `$1<script>${SHIM}</script>\n`);
  return out.replace(/(<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="[^"]*?script-src)/i, `$1 ${sha(SHIM)}`);
}

const pages = PAGES.map(p => {
  let html = read(p.src);
  if (p.id.startsWith("nabd")) html = inlineNabd(html);
  html = addShim(html);
  if (html.includes(SENT)) throw new Error(`${p.src} already contains the marker ${SENT}`);
  const csp = cspOf(html);
  if (!/default-src 'none'/.test(csp)) throw new Error(`${p.src}: no strict CSP`);
  return { ...p, html, csp: parseCsp(csp), bytes: Buffer.byteLength(html) };
});

// The commit and its date are read from .git directly (no child process): HEAD, its ref (loose or packed), then the
// loose commit object for the committer date. Anything missing leaves "unknown".
let commit = "unknown", date = "unknown";
try {
  const git = join(REPO, ".git");
  let head = readFileSync(join(git, "HEAD"), "utf8").trim();
  if (head.startsWith("ref: ")) {
    const ref = head.slice(5);
    try { head = readFileSync(join(git, ref), "utf8").trim(); }
    catch { head = (readFileSync(join(git, "packed-refs"), "utf8").split("\n").find(l => l.endsWith(" " + ref)) || "").split(" ")[0]; }
  }
  if (/^[0-9a-f]{40}$/.test(head)) {
    commit = head.slice(0, 7);
    const obj = inflateSync(readFileSync(join(git, "objects", head.slice(0, 2), head.slice(2)))).toString("utf8");
    const m = /\ncommitter .* (\d+) ([+-]\d{4})\n/.exec(obj);
    if (m) date = new Date((Number(m[1]) + (m[2][0] === "-" ? -1 : 1) * (Number(m[2].slice(1, 3)) * 3600 + Number(m[2].slice(3)) * 60)) * 1000).toISOString().slice(0, 10);
  }
} catch { /* outside git, or a packed object: the footer keeps what it found */ }

// The launcher's tokens are taken from the APEX page, so the bundle shares light, dark and the dark gold peak exactly.
const apexCss = (/<style>([\s\S]*?)<\/style>/.exec(read("omega-ops-room-v1/omega-apex.html")) || [])[1] || "";
function cssBlock(css, startRe) {
  const m = startRe.exec(css);
  if (!m) throw new Error(`token block not found: ${startRe}`);
  let depth = 0, i = css.indexOf("{", m.index);
  for (; i < css.length; i++) { if (css[i] === "{") depth++; else if (css[i] === "}" && --depth === 0) break; }
  return css.slice(m.index, i + 1);
}
const TOKENS = [
  cssBlock(apexCss, /:root \{\n\s*color-scheme: light;/),
  cssBlock(apexCss, /:root\[data-theme="dark"\] \{\n\s*color-scheme: dark;/),
  cssBlock(apexCss, /@media \(color-gamut: p3\) \{\s*:root \{/),
  cssBlock(apexCss, /:root\[data-theme="dark"\]\[data-tone="gold"\] \{/),
  cssBlock(apexCss, /@media \(color-gamut: p3\) \{\s*:root\[data-theme="dark"\]\[data-tone="gold"\]/)
].join("\n  ");
const cairo = readFileSync(join(REPO, "site-landing/fonts/cairo-arabic-wght-normal.woff2")).toString("base64");

const STYLE = `
  @font-face { font-family: "Cairo Variable"; font-weight: 200 1000; font-display: swap;
    src: url(data:font/woff2;base64,${cairo}) format("woff2");
    unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC; }
  ${TOKENS}
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { background: var(--bg); color: var(--content-primary); font: 400 var(--text-body)/1.5 var(--font-ar); -webkit-text-size-adjust: 100%;
    display: flex; flex-direction: column; min-height: 100dvh; overflow-x: hidden; }
  :root[lang="en"] body { font-family: var(--font-en); }
  .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums slashed-zero; direction: ltr; unicode-bidi: isolate; }
  button { font: inherit; color: inherit; }
  .bar { position: sticky; top: 0; z-index: 10; background: var(--surface); border-bottom: var(--hairline) solid var(--hairline-color);
    padding: max(var(--s-2), env(safe-area-inset-top)) max(var(--s-4), env(safe-area-inset-right)) var(--s-2) max(var(--s-4), env(safe-area-inset-left));
    display: flex; align-items: center; gap: var(--s-3); }
  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .bar { background: var(--glass); -webkit-backdrop-filter: blur(32px) saturate(190%); backdrop-filter: blur(32px) saturate(190%); }
  }
  .brand { display: flex; align-items: center; gap: var(--s-2); font-weight: 800; font-size: var(--text-headline); white-space: nowrap; flex: none;
    border: 0; background: none; padding: 0; cursor: pointer; letter-spacing: 0; }
  .mark { inline-size: 28px; block-size: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--accent-fill); color: var(--on-accent-fill); font-size: 15px; }
  .rail { display: flex; gap: var(--s-1); overflow-x: auto; scrollbar-width: none; flex: 1; min-width: 0; padding: var(--s-1); border-radius: var(--r-pill); background: var(--surface-2); }
  .rail::-webkit-scrollbar { display: none; }
  .tab { flex: none; border: 0; background: transparent; border-radius: var(--r-pill); padding: 6px 12px; min-block-size: 36px; cursor: pointer;
    font-size: var(--text-footnote); font-weight: 600; color: var(--content-secondary); white-space: nowrap;
    transition: transform var(--dur-fast) var(--ease-apple-fluid), opacity var(--dur-fast) var(--ease-apple-fluid); }
  .tab:active, .btn:active, .card-open:active { transform: scale(0.97); }
  .tab[aria-current="page"] { background: var(--surface); color: var(--content-primary); box-shadow: var(--shadow-soft); }
  .tools { display: flex; gap: var(--s-2); flex: none; }
  .btn { border: var(--hairline) solid var(--hairline-color); background: var(--surface-2); color: var(--content-primary); border-radius: var(--r-pill);
    padding: 6px 14px; min-block-size: 36px; cursor: pointer; font-size: var(--text-footnote); font-weight: 700; white-space: nowrap;
    transition: transform var(--dur-fast) var(--ease-apple-fluid); }
  .btn.primary { background: var(--accent-fill); color: var(--on-accent-fill); border-color: transparent; }
  .btn:focus-visible, .tab:focus-visible, .brand:focus-visible, .card-open:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .stage { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .home { inline-size: 100%; max-inline-size: 1440px; margin-inline: auto;
    padding: var(--s-8) max(var(--s-4), env(safe-area-inset-right)) max(var(--s-12), env(safe-area-inset-bottom)) max(var(--s-4), env(safe-area-inset-left)); }
  .hero { display: grid; gap: var(--s-6); grid-template-columns: minmax(0, 1fr) auto; align-items: center; margin-block-end: var(--s-8); }
  .hero-text { display: grid; gap: var(--s-3); }
  .orbit { inline-size: clamp(200px, 22vw, 300px); block-size: auto; }
  .thread { fill: none; stroke-width: 1.4; opacity: 0.55; stroke-linecap: round; }
  .thread.arc { stroke: var(--content-tertiary); opacity: 0.22; stroke-dasharray: 2 5; }
  .g-cyan { stroke: var(--apple-cyan); } .g-indigo { stroke: var(--apple-indigo); } .g-green { stroke: var(--apple-green); }
  .g-orange { stroke: var(--apple-orange); } .g-purple { stroke: var(--apple-purple); }
  .node { fill: var(--surface); stroke-width: 3; }
  .core { fill: var(--accent-fill); }
  .core-halo { fill: none; stroke: var(--accent); stroke-width: 1; opacity: 0.4; }
  .seg { display: flex; gap: 2px; padding: 3px; border-radius: var(--r-pill); background: var(--surface-2); }
  .seg button { border: 0; background: transparent; border-radius: var(--r-pill); padding: 4px 10px; min-block-size: 30px; cursor: pointer;
    font-size: var(--text-caption); font-weight: 700; color: var(--content-secondary); transition: transform var(--dur-fast) var(--ease-apple-fluid); }
  .seg button[aria-pressed="true"] { background: var(--accent-fill); color: var(--on-accent-fill); }
  .seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .eyebrow { color: var(--accent); font-weight: 700; font-size: var(--text-footnote); margin: 0; }
  h1 { font-size: var(--text-large); line-height: 1.15; margin: 0; text-wrap: balance; font-weight: 800; }
  .lede { color: var(--content-secondary); font-size: var(--text-headline); margin: 0; max-inline-size: 70ch; text-wrap: pretty; }
  .facts { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-2) 0 0; padding: 0; list-style: none; }
  .facts li { background: var(--surface); border: var(--hairline) solid var(--hairline-color); border-radius: var(--r-pill); padding: 6px 14px;
    font-size: var(--text-footnote); color: var(--content-secondary); }
  .facts b { color: var(--content-primary); }
  .grid { display: grid; gap: var(--s-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); margin: 0; padding: 0; list-style: none; }
  .card { background: var(--surface); border: var(--hairline) solid var(--hairline-color); border-radius: var(--r-card); padding: var(--pad-card);
    box-shadow: var(--shadow-soft); display: grid; grid-template-rows: auto 1fr auto; gap: var(--s-3); }
  .card-head { display: flex; gap: var(--s-3); align-items: center; }
  .ico { inline-size: 44px; block-size: 44px; flex: none; border-radius: var(--r-inner); background: var(--surface-2); display: grid; place-items: center; font-size: 22px; }
  .card h2 { margin: 0; font-size: var(--text-headline); line-height: 1.3; }
  .card .en { margin: 0; font-size: var(--text-caption); color: var(--content-tertiary); font-family: var(--font-en); }
  .card p.line { margin: 0; color: var(--content-secondary); font-size: var(--text-footnote); text-wrap: pretty; }
  .card-foot { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
  .card-open { border: 0; background: var(--accent-fill); color: var(--on-accent-fill); border-radius: var(--r-pill); padding: 8px 18px; min-block-size: 40px;
    font-weight: 700; font-size: var(--text-footnote); cursor: pointer; transition: transform var(--dur-fast) var(--ease-apple-fluid); }
  .size { margin-inline-start: auto; color: var(--content-tertiary); font-size: var(--text-caption); }
  .notes { display: grid; gap: var(--s-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); margin-block-start: var(--s-8); }
  .note { background: var(--surface); border: var(--hairline) solid var(--hairline-color); border-radius: var(--r-card); padding: var(--pad-card); }
  .note h3 { margin: 0 0 var(--s-2); font-size: var(--text-headline); }
  .note p, .note li { color: var(--content-secondary); font-size: var(--text-footnote); margin: 0; text-wrap: pretty; }
  .note ul { margin: 0; padding-inline-start: 1.2em; display: grid; gap: var(--s-1); }
  .locked { color: var(--violet); font-weight: 700; }
  .ok { color: var(--success); font-weight: 700; }
  .foot { margin-block-start: var(--s-8); color: var(--content-tertiary); font-size: var(--text-caption); }
  .frame { flex: 1; inline-size: 100%; border: 0; display: block; min-block-size: 0; background: var(--bg); }
  .status { position: fixed; inset-block-end: max(var(--s-4), env(safe-area-inset-bottom)); inset-inline-start: 50%; transform: translateX(50%);
    background: var(--surface); color: var(--content-primary); border: var(--hairline) solid var(--hairline-color); border-radius: var(--r-pill);
    padding: 8px 16px; font-size: var(--text-footnote); box-shadow: var(--shadow-soft); z-index: 20; opacity: 0;
    transition: opacity var(--dur-base) var(--ease-apple-fluid); pointer-events: none; }
  :root[dir="ltr"] .status { transform: translateX(-50%); }
  .status.on { opacity: 1; }
  [hidden] { display: none !important; }
  @media (max-width: 767px) {
    .bar { flex-wrap: wrap; row-gap: var(--s-2); }
    .rail { order: 3; flex-basis: 100%; }
    .tools { margin-inline-start: auto; }
    .home { padding-block-start: var(--s-6); }
  }
  @media (max-width: 899px) { .hero { grid-template-columns: 1fr; } .orbit { justify-self: center; inline-size: min(240px, 70vw); } }
  @media (pointer: coarse) { .tab, .btn, .card-open, .seg button { min-block-size: 44px; } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
`;

const SCRIPT = `
(() => {
  "use strict";
  const PAGES = ${JSON.stringify(pages.map(({ id, file, icon, ar, en, lineAr, lineEn, bytes }) => ({ id, file, icon, ar, en, lineAr, lineEn, bytes })))};
  const BY_FILE = Object.fromEntries(PAGES.map(p => [p.file, p.id]));
  const T = {
    eyebrow: ["OMEGA PRIME · كل التصميم في ملف واحد", "OMEGA PRIME · the whole design in one file"],
    title: ["عشر صفحات، ملف واحد، يفتح بنقرتين", "Ten pages, one file, opens with a double-click"],
    lede: ["هذا الملف يحمل كل صفحات الموقع كما هي على الفرع الرئيسي: النواة الذهبية الداكنة، غرفة العمليات، مختبر المتداول، مجلس القمة ونطاق المعرفة. افتح أي صفحة من الشريط أو البطاقات، وانسخ كود أي صفحة أو نزّلها منفردة.",
      "This file carries every page of the site exactly as on main: the dark gold peak, the Ops Room, TRADE LAB, the APEX council and the knowledge domain. Open any page from the bar or the cards, and copy or download any page on its own."],
    home: ["الرئيسية", "Home"], open: ["افتح", "Open"], copy: ["نسخ الكود", "Copy code"], save: ["تنزيل الصفحة", "Download page"],
    lang: ["EN", "ع"], pages: ["صفحات", "pages"], size: ["الحجم", "Size"], built: ["من الفرع الرئيسي", "from main"],
    paperT: ["ورقي فقط", "Paper only"],
    paper1: ["كل مكتب التداول ورقي: لا يوجد أي كود يوقّع أو يرسل أمراً لأي منصة، ولا Testnet.", "The whole desk is paper: no code signs or sends an order to any exchange, Testnet included."],
    paper2: ["التداول الحقيقي ونسخ الصفقات وتقسيم الأرباح: قيد الموافقة.", "Real trading, copy-trading and profit split: pending approval."],
    dataT: ["البيانات الحية", "Live data"],
    data1: ["المصادر المفتوحة ذات CORS تعمل مباشرة من الملف.", "Open sources with browser CORS work straight from the file."],
    data2: ["الباقي يحتاج الوسيط على اللابتوب (start-omega.bat)؛ بدونه تقول الصفحة «تعذر التحقق منها» ولا تخترع رقماً.", "The rest needs the proxy on the laptop (start-omega.bat); without it the page says unverified and invents nothing."],
    safeT: ["الأمان", "Security"],
    safe1: ["سياسة CSP صارمة: كل كود مضمّن مثبّت ببصمة sha256، ولا مضيف جديد.", "Strict CSP: every inline script is pinned by sha256, and no new host is added."],
    safe2: ["الحفظ يبقى في هذا المتصفح. المظهر واللغة تتزامن بين الصفحات.", "Storage stays in this browser. Look and language sync across the pages."],
    copied: ["نُسخ كود الصفحة", "Page code copied"], copyFail: ["تعذر النسخ هنا؛ استخدم «تنزيل الصفحة»", "Copy is blocked here; use Download page"],
    saved: ["بدأ التنزيل", "Download started"], loading: ["يفتح…", "Opening…"],
    light: ["فاتح", "Light"], dark: ["داكن", "Dark"], gold: ["ذهبي", "Gold"], lookL: ["المظهر", "Look"]
  };
  const root = document.documentElement, $ = id => document.getElementById(id);
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* the page works without storage */ } } };
  let lang = store.get("omega-lang") === "en" ? "en" : "ar", current = "home", frame = null, observer = null, toastTimer = 0;
  const L = k => T[k][lang === "en" ? 1 : 0];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const kb = n => new Intl.NumberFormat(lang === "en" ? "en-US" : "ar-u-nu-latn", { maximumFractionDigits: 0 }).format(n / 1024) + " KB";

  // First visit: the dark gold peak. After that the stored choice, shared with every page.
  function setLook(mode) {
    const theme = mode === "light" ? "light" : "dark", tone = mode === "gold" ? "gold" : "none";
    store.set("omega-theme", theme); store.set("nabd-theme", theme); store.set("omega-tone", tone);
    let st = {}; try { st = JSON.parse(store.get("omega-suite-state-v1") || "{}") || {}; } catch { st = {}; }
    store.set("omega-suite-state-v1", JSON.stringify({ ...st, theme, tone, at: Date.now() }));
    look();
  }
  const lookNow = () => root.dataset.theme !== "dark" ? "light" : root.dataset.tone === "gold" ? "gold" : "dark";
  function lookButtons() { for (const b of document.querySelectorAll("[data-look]")) b.setAttribute("aria-pressed", String(b.dataset.look === lookNow())); }
  function look() {
    if (store.get("omega-theme") === null && store.get("nabd-theme") === null && store.get("omega-bundle-app") === null) { store.set("omega-bundle-app", "home"); setLook("gold"); return; }
    const theme = store.get("omega-theme") === "dark" || store.get("nabd-theme") === "dark" ? "dark" : "light";
    if (theme === "dark") root.dataset.theme = "dark"; else delete root.dataset.theme;
    if (theme === "dark" && store.get("omega-tone") === "gold") root.dataset.tone = "gold"; else delete root.dataset.tone;
    lookButtons();
  }
  function toast(msg) {
    const s = $("status"); s.textContent = msg; s.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => s.classList.remove("on"), 2400);
  }
  const source = id => $("omega-page-" + id).textContent.replaceAll("${SENT}", "<");

  function texts() {
    root.lang = lang; root.dir = lang === "en" ? "ltr" : "rtl";
    for (const n of document.querySelectorAll("[data-t]")) n.textContent = L(n.dataset.t);
    for (const p of PAGES) {
      const tab = document.querySelector('.tab[data-go="' + p.id + '"]'); if (tab) tab.textContent = lang === "en" ? p.en : p.ar;
      const card = document.querySelector('.card[data-id="' + p.id + '"]');
      if (card) { card.querySelector("h2").textContent = lang === "en" ? p.en : p.ar; card.querySelector(".en").textContent = lang === "en" ? p.ar : p.en; card.querySelector(".line").textContent = lang === "en" ? p.lineEn : p.lineAr; card.querySelector(".size").textContent = kb(p.bytes); }
    }
    $("factPages").textContent = String(PAGES.length);
    $("factSize").textContent = kb(PAGES.reduce((a, p) => a + p.bytes, 0));
  }

  function build() {
    const rail = $("rail");
    const homeTab = el("button", "tab"); homeTab.type = "button"; homeTab.dataset.go = "home"; homeTab.dataset.t = "home"; rail.append(homeTab);
    for (const p of PAGES) { const b = el("button", "tab"); b.type = "button"; b.dataset.go = p.id; b.translate = false; rail.append(b); }
    rail.addEventListener("click", e => { const b = e.target.closest(".tab"); if (b) go(b.dataset.go); });
    const grid = $("grid");
    for (const p of PAGES) {
      const li = el("li", "card"); li.dataset.id = p.id;
      const head = el("div", "card-head"), ico = el("span", "ico", p.icon); ico.setAttribute("aria-hidden", "true");
      const names = el("div"); names.append(el("h2"), el("p", "en"));
      head.append(ico, names);
      const foot = el("div", "card-foot");
      const open = el("button", "card-open"); open.type = "button"; open.dataset.t = "open"; open.addEventListener("click", () => go(p.id));
      const copy = el("button", "btn"); copy.type = "button"; copy.dataset.t = "copy"; copy.addEventListener("click", () => copyPage(p.id));
      const save = el("button", "btn"); save.type = "button"; save.dataset.t = "save"; save.addEventListener("click", () => savePage(p.id));
      foot.append(open, copy, save, el("span", "size num"));
      li.append(head, el("p", "line"), foot);
      grid.append(li);
    }
    for (const b of document.querySelectorAll("[data-look]")) b.addEventListener("click", () => setLook(b.dataset.look));
    constellation();
    $("brand").addEventListener("click", () => go("home"));
    $("langBtn").addEventListener("click", () => { lang = lang === "en" ? "ar" : "en"; store.set("omega-lang", lang); texts(); });
    $("copyBtn").addEventListener("click", () => { if (current !== "home") copyPage(current); });
    $("saveBtn").addEventListener("click", () => { if (current !== "home") savePage(current); });
    window.addEventListener("hashchange", () => fromHash());
    window.addEventListener("storage", e => { if (/^(omega-theme|omega-tone|nabd-theme)$/.test(e.key || "")) look(); });
  }

  // Decorative map of the suite: Ω at the centre, the ten pages on a ring, joined by Bézier threads. No text inside.
  function constellation() {
    const NS = "http://www.w3.org/2000/svg", svg = $("orbit"), C = 160, R = 118;
    const mk = (tag, attrs, cls) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (cls) n.setAttribute("class", cls); return n; };
    const pts = PAGES.map((p, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / PAGES.length; return { p, x: C + R * Math.cos(a), y: C + R * Math.sin(a) }; });
    const ring = ["g-cyan", "g-indigo", "g-green", "g-orange", "g-purple"];
    pts.forEach((q, i) => {
      const mx = (C + q.x) / 2 + (q.y - C) * 0.22, my = (C + q.y) / 2 - (q.x - C) * 0.22;
      svg.append(mk("path", { d: "M" + C + " " + C + " Q" + mx.toFixed(1) + " " + my.toFixed(1) + " " + q.x.toFixed(1) + " " + q.y.toFixed(1) }, "thread " + ring[i % ring.length]));
      const n = pts[(i + 1) % pts.length];
      svg.append(mk("path", { d: "M" + q.x.toFixed(1) + " " + q.y.toFixed(1) + " Q" + ((q.x + n.x) / 2 * 1.08 - C * 0.08).toFixed(1) + " " + ((q.y + n.y) / 2 * 1.08 - C * 0.08).toFixed(1) + " " + n.x.toFixed(1) + " " + n.y.toFixed(1) }, "thread arc"));
    });
    for (const [i, q] of pts.entries()) svg.append(mk("circle", { cx: q.x.toFixed(1), cy: q.y.toFixed(1), r: 9 }, "node " + ring[i % ring.length]));
    svg.append(mk("circle", { cx: C, cy: C, r: 30 }, "core-halo"));
    svg.append(mk("circle", { cx: C, cy: C, r: 20 }, "core"));
  }

  async function copyPage(id) {
    try { await navigator.clipboard.writeText(source(id)); toast(L("copied")); } catch { toast(L("copyFail")); }
  }
  function savePage(id) {
    const p = PAGES.find(x => x.id === id), url = URL.createObjectURL(new Blob([source(id)], { type: "text/html" }));
    const a = el("a"); a.href = url; a.download = p.file; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); toast(L("saved"));
  }

  // A link inside a page to another page of the suite opens it here instead of a missing file.
  function route(href) {
    const m = /(?:^|\\/)([a-z-]+\\.html)(\\?[^#]*)?(#.*)?$/.exec(String(href || ""));
    if (!m || !BY_FILE[m[1]]) return null;
    return { id: BY_FILE[m[1]], query: new URLSearchParams(m[2] || ""), hash: m[3] || "" };
  }
  function hook(f, query, hash) {
    let w, d;
    try { w = f.contentWindow; d = f.contentDocument; } catch { return; }
    if (!w || !d) return;
    d.addEventListener("click", e => {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || a.target === "_blank") return;
      const t = route(a.getAttribute("href"));
      if (t) { e.preventDefault(); e.stopImmediatePropagation(); go(t.id, t.query, t.hash); }
    }, true);
    if (w.navigation) w.navigation.addEventListener("navigate", e => { const t = route(e.destination && e.destination.url); if (t && e.cancelable) { e.preventDefault(); go(t.id, t.query, t.hash); } });
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => { const r = d.documentElement; if (r.dataset.theme === "dark") root.dataset.theme = "dark"; else delete root.dataset.theme; if (r.dataset.tone === "gold" && r.dataset.theme === "dark") root.dataset.tone = "gold"; else delete root.dataset.tone; lookButtons(); });
    observer.observe(d.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-tone"] });
    const v = query && query.get("view");
    if (v) { const b = d.querySelector('[data-go="' + v + '"]'); if (b) b.click(); }
    if (hash && hash.length > 1) { const t = d.getElementById(decodeURIComponent(hash.slice(1))); if (t) t.scrollIntoView(); }
  }

  function go(id, query, hash) {
    if (id !== "home" && !PAGES.some(p => p.id === id)) id = "home";
    current = id;
    for (const b of document.querySelectorAll(".tab")) { if (b.dataset.go === id) { b.setAttribute("aria-current", "page"); b.scrollIntoView({ block: "nearest", inline: "nearest" }); } else b.removeAttribute("aria-current"); }
    try { history.replaceState(null, "", "#app=" + id); } catch { /* file:// in some browsers */ }
    store.set("omega-bundle-app", id);
    $("copyBtn").hidden = $("saveBtn").hidden = id === "home";
    if (observer) { observer.disconnect(); observer = null; }
    if (frame) { frame.remove(); frame = null; }
    if (id === "home") { $("home").hidden = false; document.title = "OMEGA PRIME · " + L("home"); look(); return; }
    $("home").hidden = true;
    const p = PAGES.find(x => x.id === id);
    document.title = "OMEGA PRIME · " + (lang === "en" ? p.en : p.ar);
    toast(L("loading"));
    frame = el("iframe", "frame");
    frame.title = p.en + " · " + p.ar;
    frame.setAttribute("allow", "clipboard-write; fullscreen");
    frame.addEventListener("load", () => { hook(frame, query, hash); $("status").classList.remove("on"); frame.focus(); }, { once: true });
    frame.srcdoc = source(id);
    $("stage").append(frame);
  }
  function fromHash() {
    const m = /app=([a-z-]+)/.exec(location.hash);
    const id = m ? m[1] : "home";
    if (id !== current || !frame) go(id);
  }

  look(); build(); texts();
  const start = /app=([a-z-]+)/.exec(location.hash);
  go(start ? start[1] : "home");
})();
`;

const blocks = pages.map(p => `<script type="text/plain" id="omega-page-${p.id}" data-file="${p.file}">${p.html.replace(/<\/(script)/gi, `${SENT}/$1`).replace(/<!--/g, `${SENT}!--`)}</script>`).join("\n");

// The launcher's CSP: its own two hashes, every page's hashes and hosts (each page keeps its own stricter CSP too).
const union = {};
for (const p of pages) for (const [k, v] of Object.entries(p.csp)) (union[k] ||= new Set()) && v.forEach(t => union[k].add(t));
const own = { "script-src": [sha(SCRIPT)], "style-src": [sha(STYLE)] };
const dataHashes = pages.map(p => sha(p.html.replace(/<\/(script)/gi, `${SENT}/$1`).replace(/<!--/g, `${SENT}!--`)));
const order = ["default-src", "script-src", "style-src", "font-src", "img-src", "media-src", "manifest-src", "worker-src", "connect-src", "frame-src", "base-uri", "form-action", "object-src"];
const dir = {};
for (const k of new Set([...order, ...Object.keys(union)])) {
  let v = [...(union[k] || [])];
  if (k === "script-src") v = [...own[k], ...v, ...dataHashes];
  if (k === "style-src") v = [...own[k], ...v];
  if (k === "frame-src") v = ["'self'"];
  if (k === "default-src" || k === "base-uri" || k === "form-action" || k === "object-src") v = ["'none'"];
  if (v.length > 1) v = v.filter(t => t !== "'none'");
  if (v.length) dir[k] = [...new Set(v)];
}
const CSP = Object.entries(dir).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");

const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="referrer" content="no-referrer" />
<meta name="color-scheme" content="light dark" />
<meta name="description" content="OMEGA PRIME in one file: NABD, the Ops Room, THE CHAIN, ORACLE, TRADE LAB, the second brain, the core, the knowledge domain and the APEX council, paper only." />
<title>OMEGA PRIME · كل التصميم</title>
<!--
  OMEGA PRIME in one file (ADR-131), built by scripts/build-single-file.mjs from commit ${commit}.
  Every page below is stored unchanged as inert text and opened inside this launcher. Paper only: no code here signs or
  sends an order. Fonts: Cairo and JetBrains Mono, SIL Open Font License 1.1.
-->
<style>${STYLE}</style>
</head>
<body>
<header class="bar">
  <button class="brand" id="brand" type="button" aria-label="OMEGA PRIME home · الرئيسية"><span class="mark" aria-hidden="true">Ω</span><span translate="no">OMEGA PRIME</span></button>
  <nav class="rail" id="rail" aria-label="Pages · الصفحات"></nav>
  <div class="tools">
    <button class="btn" id="copyBtn" type="button" data-t="copy" hidden></button>
    <button class="btn" id="saveBtn" type="button" data-t="save" hidden></button>
    <div class="seg" role="group" aria-label="Look · المظهر"><button type="button" data-look="light" data-t="light"></button><button type="button" data-look="dark" data-t="dark"></button><button type="button" data-look="gold" data-t="gold"></button></div>
    <button class="btn" id="langBtn" type="button" data-t="lang" aria-label="Language · اللغة"></button>
  </div>
</header>
<main class="stage" id="stage">
  <section class="home" id="home" aria-labelledby="homeTitle">
    <div class="hero">
      <div class="hero-text">
      <p class="eyebrow" data-t="eyebrow"></p>
      <h1 id="homeTitle" data-t="title"></h1>
      <p class="lede" data-t="lede"></p>
      <ul class="facts">
        <li><b class="num" id="factPages"></b> <span data-t="pages"></span></li>
        <li><span data-t="size"></span> <b class="num" id="factSize"></b></li>
        <li><span data-t="built"></span> <b class="num" translate="no">${commit}${date === "unknown" ? "" : " · " + date}</b></li>
      </ul>
      </div>
      <svg class="orbit" id="orbit" viewBox="0 0 320 320" aria-hidden="true" focusable="false"></svg>
    </div>
    <ul class="grid" id="grid"></ul>
    <div class="notes">
      <section class="note"><h3 data-t="paperT"></h3><ul><li data-t="paper1"></li><li class="locked" data-t="paper2"></li></ul></section>
      <section class="note"><h3 data-t="dataT"></h3><ul><li data-t="data1"></li><li data-t="data2"></li></ul></section>
      <section class="note"><h3 data-t="safeT"></h3><ul><li class="ok" data-t="safe1"></li><li data-t="safe2"></li></ul></section>
    </div>
    <p class="foot" translate="no">scripts/build-single-file.mjs · ADR-131 · ${commit}</p>
  </section>
</main>
<div class="status" id="status" role="status" aria-live="polite"></div>
${blocks}
<script>${SCRIPT}</script>
</body>
</html>
`;

if (CHECK) {
  const cur = (() => { try { return readFileSync(OUT, "utf8"); } catch { return ""; } })();
  if (cur !== html) { console.error(`${OUT} is out of date; run node scripts/build-single-file.mjs`); process.exit(1); }
  console.log(`${OUT} is up to date`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  console.log(`wrote ${OUT}: ${pages.length} pages, ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB, commit ${commit}`);
  for (const p of pages) console.log(`  ${p.id.padEnd(8)} ${p.src.padEnd(42)} ${(p.bytes / 1024).toFixed(0)} KB`);
}
