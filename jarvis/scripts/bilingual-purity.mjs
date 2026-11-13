#!/usr/bin/env node
// The bilingual purity gate (ADR-151), shared by test-app.mjs (sample mode) and test-live.mjs (real server).
// PURITY runs inside the page; checkPurity visits every screen in Arabic and in English, collects what
// breaks the rule and writes the evidence file jarvis/replica/evidence/bilingual-purity.log (one section
// per mode). Nothing here starts a process or opens a socket.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Run in the page. Arabic mode: every visible Latin text must be
// code (code, pre, kbd, samp, textarea), English data marked lang="en", workspace data shown as written
// (data-verbatim: memory, event targets, snapshot labels, file content), or names and identifiers kept
// apart from the sentence (bdi, or any element whose unicode-bidi is isolate or plaintext); inside those,
// a list item of more than one word must still be names or identifiers. English mode: Arabic only inside
// lang="ar" (the language button, the locked «قيد الموافقة» marks, the teaching label, and workspace data
// written in Arabic) or file content shown as written (data-verbatim). Attributes (aria-label, placeholder, title) follow the same rule.
export const PURITY = (lang) => {
  const out = [];
  const KEEP = /\b(Jarvis|SkillSpector|Ollama|Claude|Code|Replica|HTML|CSS|JSON|JSONL|SQL|SKILL|TDD|Lint|EN|AR|LTR|RTL|Ctrl|Pro|CI|API|ADR|WCAG|APCA|OKLCH|HMAC|SHA|sha256|SQLite|PostgreSQL|Readex|Inter|Geist|Mono|POST|GET|PATCH|DELETE|PUT|GitHub|OpenAlex|Wikipedia|SearXNG|PyPI|OSV|npm|Hacker|News|Algolia|Merkle|RFC|VPIN|EWMA|LTTB|Welford|IPv6|IPv4|SSRF|CSP|DeepSeek|Qwen|Llama|Gemma|OLMo|Phi|Mistral|MIT|Apache|BSD|URL|UI|UX|AI|MCP|GLM|LLM|node|python3|ollama|create|Studio|Lc|Lint|Superpowers|gstack|Max|Redux|Mem|Career|Ops|HyperFrames|OMEGA|PRIME)\b|--?[a-z][\w-]*|[\w-]*[._/@:#=$%§][\w.\-/@:#=$%§]*|\b[A-Z0-9][A-Z0-9_-]+\b|\b\w*_\w*\b|\b[a-z]+[A-Z]\w*\b|\b[a-z0-9]+(?:-[a-z0-9]+)+\b|\b\d+\w*\b|\b[0-9a-f]{7,}\b/g;
  const prose = t => t.split(/\s*[,·;|()]\s*|\s+[→—-]\s+/).some(piece => /\s/.test(piece.trim()) && /[A-Za-z]{2,}/.test(piece.replace(KEEP, " ")));
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; };
  const isolated = el => { for (let x = el; x && x !== document.body; x = x.parentElement) if (x.tagName === "BDI" || /isolate|plaintext/.test(getComputedStyle(x).unicodeBidi)) return true; return false; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    const t = n.nodeValue.trim(), el = n.parentElement;
    if (!t || !el || el.closest("script, style, template, iframe, .stage") || !visible(el)) continue;
    if (lang === "ar") {
      if (!/[A-Za-z]/.test(t) || el.closest('[lang="en"], [data-verbatim], code, pre, kbd, samp, textarea')) continue;
      if (!isolated(el)) out.push("not isolated: " + t);
      else if (prose(t)) out.push("English words: " + t);
    } else if (/[؀-ۿ]/.test(t) && !el.closest('[lang="ar"], [data-verbatim]')) out.push("Arabic in English: " + t);
  }
  for (const el of document.querySelectorAll("[aria-label], [placeholder], [title]")) {
    if (el.closest("template, iframe, .stage") || el.closest(lang === "ar" ? '[lang="en"]' : '[lang="ar"]')) continue;
    for (const a of ["aria-label", "placeholder", "title"]) {
      const v = el.getAttribute(a); if (!v) continue;
      if (lang === "ar" ? !/[؀-ۿ]/.test(v) && /[A-Za-z]{2,}/.test(v.replace(KEEP, " ")) : /[؀-ۿ]/.test(v)) out.push(a + ": " + v);
    }
  }
  return [...new Set(out)];
};

export const PURITY_ROUTES = ["overview", "agents", "agents/templates", "runs", "missions", "workflows", "approvals", "analytics", "logs", "studio", "skills", "memory", "search", "loader", "governance", "diagnostics", "recon", "math", "hyper", "atlas", "universal", "workbench", "webhooks", "settings", "design-system"];

// Visits each route in both languages (the language button switches them) and runs PURITY on each.
// extra: [name, async () => {}] steps that open a deeper screen (an agent, a mission, the workflow editor).
// typed: text the test typed itself, which is data and is kept as written.
export async function checkPurity({ page, go, routes = PURITY_ROUTES, extra = [], typed = [], mode, evidence }) {
  const result = { ar: {}, en: {} };
  for (const lang of ["ar", "en"]) {
    await go("#/overview");
    if ((await page.evaluate(() => document.documentElement.lang)) !== lang) { await page.locator("#langBtn").click(); await page.waitForTimeout(300); }
    const steps = routes.map(r => [r, () => go("#/" + r)]).concat(extra);
    for (const [name, open] of steps) {
      await open();
      await page.waitForTimeout(150);
      // Typed text counts as data, also when the page cut it short with "…".
      const found = (await page.evaluate(PURITY, lang)).filter(t => !typed.some(x => t.includes(x) || (t.endsWith("…") && x.startsWith(t.slice(t.indexOf(": ") + 2, -1)))));
      if (found.length) result[lang][name] = found;
    }
  }
  if ((await page.evaluate(() => document.documentElement.lang)) !== "en") { await page.locator("#langBtn").click(); await page.waitForTimeout(300); }
  const count = l => Object.values(result[l]).reduce((n, v) => n + v.length, 0);
  if (evidence) {
    const all = existsSync(evidence) ? (() => { try { return JSON.parse(readFileSync(evidence, "utf8")); } catch (e) { return {}; } })() : {};
    all.format = "jarvis-bilingual-purity-v1";
    all[mode] = { ranAt: new Date().toISOString(), screens: routes.length + extra.length, arabic: { violations: count("ar"), where: result.ar }, english: { violations: count("en"), where: result.en } };
    writeFileSync(evidence, JSON.stringify(all, null, 1) + "\n");
  }
  return { result, ar: count("ar"), en: count("en") };
}
