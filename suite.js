// OMEGA suite (ADR-107, ADR-114): one frosted-glass app switcher shared by NABD, the Ops Room, THE CHAIN, ORACLE and TRADE LAB, and
// cross-page state sync over a BroadcastChannel ("omega-suite"), mirrored to localStorage for pages opened later.
// Synced: the light/dark choice, a read-only summary of the paper wallet (locked base, safe vault), the PWSI
// reading and THE CHAIN's last ticker. Nothing leaves the browser. It also counts CSP violations from the
// first moment, for the Ops Room self-test.
(() => {
  "use strict";
  const PAGE = "nabd", THEME_KEY = "nabd-theme", KEY = "omega-suite-state-v1";
  const root = document.documentElement;
  let violations = 0;
  document.addEventListener("securitypolicyviolation", () => { violations++; });
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
  const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: this tab only */ } };
  let ch = null;
  try { ch = typeof BroadcastChannel === "function" ? new BroadcastChannel("omega-suite") : null; } catch { ch = null; }
  const state = read(), listeners = [];
  let pop = null, btn = null;
  const clean = patch => {
    const out = {};
    if (patch.theme === "dark" || patch.theme === "light") out.theme = patch.theme;
    if (patch.wallet && Number.isFinite(patch.wallet.base) && Number.isFinite(patch.wallet.safe)) out.wallet = { base: +patch.wallet.base, safe: +patch.wallet.safe };
    if (patch.pwsi === null || Number.isFinite(patch.pwsi)) out.pwsi = patch.pwsi === null ? null : Math.round(patch.pwsi);
    if (typeof patch.ticker === "string") out.ticker = patch.ticker.toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
    if (typeof patch.research === "string") out.research = patch.research.replace(/[\u0000-\u001F<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (typeof patch.ping === "string") out.ping = patch.ping.slice(0, 40);
    if (patch.tone === "gold" || patch.tone === "none") out.tone = patch.tone;
    return out;
  };
  // Theme: a change on any page is applied on the others and stored under each page's own key.
  let applying = false;
  function applyTheme(t) {
    if (t !== "dark" && t !== "light") return;
    if ((root.dataset.theme === "dark" ? "dark" : "light") === t) return;
    applying = true;
    root.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ }
    const btn = document.getElementById("themeToggle"), meta = document.querySelector('meta[name="theme-color"]');
    if (btn) btn.setAttribute("aria-pressed", String(t === "dark"));
    if (meta) meta.setAttribute("content", t === "dark" ? (root.dataset.tone === "gold" ? "#070502" : "#000000") : "#F5F5F7");
    applying = false;
  }
  // ADR-127: the dark gold peak is a tone over the dark theme (data-tone="gold"), stored under "omega-tone" and
  // synced like the theme. It changes only colours; the light theme ignores it.
  let toneBtn = null;
  const toneNow = () => root.dataset.tone === "gold" ? "gold" : "none";
  function syncTone() {
    if (!toneBtn) return;
    const on = toneNow() === "gold" && root.dataset.theme === "dark";
    toneBtn.setAttribute("aria-pressed", String(on));
    const s = toneBtn.querySelector("small"); if (s) s.textContent = on ? "On, gold on warm black · مفعّلة" : "Off · Tap for gold on warm black · غير مفعّلة";
  }
  function applyTone(t) {
    if (t !== "gold" && t !== "none") return;
    if (toneNow() !== t) {
      if (t === "gold") root.dataset.tone = "gold"; else delete root.dataset.tone;
      try { localStorage.setItem("omega-tone", t); } catch { /* storage blocked */ }
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta && root.dataset.theme === "dark") meta.setAttribute("content", t === "gold" ? "#070502" : "#000000");
    }
    syncTone();
  }
  function setTone(t) {
    if (t !== "gold" && t !== "none") return;
    applyTone(t);
    if (t === "gold") applyTheme("dark");
    syncTone();
    publish({ tone: t, theme: root.dataset.theme === "dark" ? "dark" : "light" });
  }
  function receive(raw) {
    const patch = clean(raw || {});
    if (!Object.keys(patch).length) return;
    Object.assign(state, patch);
    if (patch.theme) applyTheme(patch.theme);
    if (patch.tone) applyTone(patch.tone);
    syncTone();
    render();
    for (const f of listeners) { try { f(patch); } catch { /* a listener's error stays local */ } }
  }
  function publish(raw) {
    const patch = clean(raw || {}), diff = {};
    for (const [k, v] of Object.entries(patch)) if (k === "ping" || JSON.stringify(state[k]) !== JSON.stringify(v)) diff[k] = v;
    if (!Object.keys(diff).length) return false;
    Object.assign(state, diff, { at: Date.now() });
    if (!diff.ping) write(state);
    if (ch) ch.postMessage(diff);
    render();
    return true;
  }
  if (ch) ch.addEventListener("message", e => receive(e.data));
  window.addEventListener("storage", e => { if (e.key === KEY) receive(read()); });
  new MutationObserver(() => { syncTone(); if (!applying) publish({ theme: root.dataset.theme === "dark" ? "dark" : "light", tone: toneNow() }); }).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-tone"] });
  if (state.theme) applyTheme(state.theme); else publish({ theme: root.dataset.theme === "dark" ? "dark" : "light" });
  if (state.tone) applyTone(state.tone); else publish({ tone: toneNow() });
  { const q = new URLSearchParams(location.search).get("tone"); if (q === "gold" || q === "none") setTone(q); }

  // Links between the pages. GitHub Pages and the local server put NABD one folder above the Ops Room;
  // a copy opened from disk keeps the repository layout (site-landing/ next to omega-ops-room-v1/).
  const disk = location.protocol === "file:", inLanding = /\/site-landing\//.test(location.pathname);
  const HREF = {
    nabd: PAGE === "nabd" ? "index.html" : disk ? "../site-landing/index.html" : "../index.html",
    ops: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-ops-room.html" : "omega-ops-room-v1/omega-ops-room.html") : "omega-ops-room.html",
    chain: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/the-chain.html" : "omega-ops-room-v1/the-chain.html") : "the-chain.html",
    oracle: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-oracle.html" : "omega-ops-room-v1/omega-oracle.html") : "omega-oracle.html",
    lab: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-trade-lab.html" : "omega-ops-room-v1/omega-trade-lab.html") : "omega-trade-lab.html",
    brain: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-second-brain.html" : "omega-ops-room-v1/omega-second-brain.html") : "omega-second-brain.html",
    core: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-core.html" : "omega-ops-room-v1/omega-core.html") : "omega-core.html",
    know: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-knowledge.html" : "omega-ops-room-v1/omega-knowledge.html") : "omega-knowledge.html",
    apex: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-apex.html" : "omega-ops-room-v1/omega-apex.html") : "omega-apex.html"
  };
  const usd = v => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
  const APPS = [
    { k: "nabd", icon: "📡", en: "NABD portal", ar: "بوابة نبض", line: () => "Public site, paper simulations · الموقع العام" },
    { k: "ops", icon: "🎯", en: "Ops Room", ar: "غرفة العمليات", line: () => (state.wallet ? `Paper base ${usd(state.wallet.base)} · safe ${usd(state.wallet.safe)}` : "Paper desk, OSIRIS, receipts") + (Number.isFinite(state.pwsi) ? ` · PWSI ${state.pwsi}` : "") },
    { k: "chain", icon: "⛓️", en: "THE CHAIN", ar: "السلسلة", line: () => state.ticker ? `Last ticker ${state.ticker}` : "Research chain, local notes" },
    { k: "oracle", icon: "🔭", en: "ORACLE", ar: "العرّاف", line: () => state.research ? `Last question: ${state.research}` : "Deep research agent, open sources" },
    { k: "lab", icon: "📒", en: "TRADE LAB", ar: "مختبر المتداول", line: () => "Paper journal, desk manager agent" },
    { k: "brain", icon: "🧠", en: "Second brain", ar: "المخ الثاني", line: () => "Ideas merged and ranked, on this device" },
    { k: "core", icon: "🧬", en: "Core", ar: "النواة", line: () => "3D agent core, AI models and their sources" },
    { k: "know", icon: "🕸️", en: "Knowledge domain", ar: "نطاق المعرفة", line: () => "Ideas, tools, sources, agents and decisions in one graph" },
    { k: "apex", icon: "◆", en: "APEX council", ar: "مجلس القمة", line: () => "The lead and fifteen field helpers, paper only" }
  ];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  function render() {
    if (!pop) return;
    for (const a of APPS) { const n = pop.querySelector(`[data-app="${a.k}"] small`); if (n) n.textContent = a.line(); }
  }
  function open(on) {
    if (!pop) return;
    pop.hidden = !on;
    btn.setAttribute("aria-expanded", String(on));
    if (on) { render(); const first = pop.querySelector('a[aria-current="page"]') || pop.querySelector("a"); if (first) first.focus(); }
  }
  function build() {
    // ADR-128: links marked data-suite-href (NABD's tools grid) follow the same layout rules as the switcher.
    for (const a of document.querySelectorAll("a[data-suite-href]")) if (HREF[a.dataset.suiteHref]) a.href = HREF[a.dataset.suiteHref];
    const theme = document.getElementById("themeToggle");
    if (!theme || document.getElementById("suiteBtn")) return;
    btn = el("button", "icon-btn suite-btn");
    btn.id = "suiteBtn"; btn.type = "button";
    btn.setAttribute("aria-label", "Switch app · تبديل التطبيق");
    btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "suitePop");
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "suite-ico-svg");
    for (const [x, y] of [[4, 4], [10, 4], [16, 4], [4, 10], [10, 10], [16, 10], [4, 16], [10, 16], [16, 16]]) { const r = document.createElementNS(NS, "rect"); r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", 4); r.setAttribute("height", 4); r.setAttribute("rx", 1.2); svg.append(r); }
    btn.append(svg);
    theme.parentNode.insertBefore(btn, theme);
    // ADR-127: a page without its own theme handler marks its button data-suite-toggle, and the suite toggles it.
    if (theme.hasAttribute("data-suite-toggle")) theme.addEventListener("click", () => { const t = root.dataset.theme === "dark" ? "light" : "dark"; applyTheme(t); syncTone(); publish({ theme: t }); });
    pop = el("nav", "suite-pop");
    pop.id = "suitePop"; pop.hidden = true;
    pop.setAttribute("aria-label", "OMEGA apps · تطبيقات أوميغا");
    for (const a of APPS) {
      const link = el("a", "suite-app");
      link.href = HREF[a.k]; link.dataset.app = a.k;
      if (a.k === PAGE) link.setAttribute("aria-current", "page");
      const ico = el("span", "suite-ico", a.icon); ico.setAttribute("aria-hidden", "true");
      const name = el("b", "", a.en + " · "), arName = el("span", "ar", a.ar); arName.lang = "ar"; name.append(arName);
      link.append(ico, name, el("small", "", a.line()));
      pop.append(link);
    }
    toneBtn = el("button", "suite-app suite-tone");
    toneBtn.type = "button"; toneBtn.id = "suiteTone";
    const toneIco = el("span", "suite-ico", "◆"); toneIco.setAttribute("aria-hidden", "true");
    const toneName = el("b", "", "Dark gold peak · "), toneAr = el("span", "ar", "الذروة الذهبية المظلمة"); toneAr.lang = "ar"; toneName.append(toneAr);
    toneBtn.append(toneIco, toneName, el("small", "", ""));
    toneBtn.addEventListener("click", () => setTone(toneNow() === "gold" && root.dataset.theme === "dark" ? "none" : "gold"));
    pop.prepend(toneBtn);
    const find = el("button", "suite-app suite-tone suite-find");
    find.type = "button"; find.id = "suiteFind";
    const findIco = el("span", "suite-ico", "🔍"); findIco.setAttribute("aria-hidden", "true");
    const findName = el("b", "", "Search · "), findAr = el("span", "ar", "ابحث"); findAr.lang = "ar"; findName.append(findAr);
    find.append(findIco, findName, el("small", "", "Ctrl+K · ⌘K · every page"));
    find.addEventListener("click", () => palette(true));
    pop.prepend(find);
    syncTone();
    document.body.append(pop);
    btn.addEventListener("click", e => { e.stopPropagation(); open(pop.hidden); });
    document.addEventListener("click", e => { if (!pop.hidden && !pop.contains(e.target)) open(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) { open(false); btn.focus(); } });
  }
  // ADR-128: one search box for the whole suite (Ctrl+K or ⌘K on any page, or the first row of the app switcher).
  // It lists the apps, the Ops Room views, the sections shown on this page and the look and language switches,
  // matched word by word in Arabic or English. It only moves around the suite: it opens nothing, sends nothing
  // and stores nothing.
  const fold = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ًͯ-ٰٟـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  function rank(items, q) {
    const words = fold(q).split(/[\s·,،]+/).filter(Boolean), out = [];
    items.forEach((it, i) => {
      const hay = " " + fold([it.en, it.ar, it.kw].join(" ")).replace(/[^\p{L}\p{N}]+/gu, " ") + " ";
      let score = 0;
      for (const w of words) { const at = hay.indexOf(w); if (at < 0) return; score += hay[at - 1] === " " ? 2 : 1; }
      out.push({ it, score: score + (it.kind === "app" ? 0.5 : 0), i });
    });
    return out.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 24).map(x => x.it);
  }
  const OPS_VIEWS = [["1", "🎯", "Command", "القيادة"], ["2", "🌍", "OSIRIS map", "الكوكب"], ["3", "🐋", "Radar", "الرادار"], ["4", "🧾", "Receipts and shield", "الفواتير والدرع"], ["5", "🖥️", "All views", "الكل"]];
  const shown = n => !!(n && n.getClientRects().length);
  function sections() {
    const out = [], seen = new Set();
    for (const n of document.querySelectorAll("main section[id], main [data-view][id]")) {
      if (seen.has(n.id) || !shown(n)) continue;
      const lab = n.getAttribute("aria-labelledby"), h = (lab && document.getElementById(lab.split(/\s+/)[0])) || n.querySelector("h1, h2, h3");
      const text = h ? h.textContent.replace(/\s+/g, " ").trim() : "";
      if (!text) continue;
      seen.add(n.id);
      out.push({ kind: "section", icon: "§", en: text.slice(0, 90), ar: "", kw: n.id + " section قسم", line: "On this page · في هذه الصفحة", go: () => {
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        n.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
        const t = h || n; if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
        t.focus({ preventScroll: true });
      } });
    }
    return out;
  }
  function commands() {
    const items = APPS.map(a => ({ kind: "app", icon: a.icon, en: a.en, ar: a.ar, kw: a.k + " app page تطبيق صفحة", line: a.k === PAGE ? "This page · هذه الصفحة" : a.line(), go: () => { location.href = HREF[a.k]; } }));
    for (const [n, icon, en, ar] of OPS_VIEWS) items.push({ kind: "app", icon, en: "Ops Room · " + en, ar: "غرفة العمليات · " + ar, kw: "view " + n + " عرض", line: "Ops Room view " + n + " · عرض " + n, go: () => {
      const b = PAGE === "ops" && document.querySelector(`[data-go="${n}"]`);
      if (b) b.click(); else location.href = HREF.ops + "?view=" + n;
    } });
    const theme = () => document.getElementById("themeToggle");
    const toTheme = t => { if ((root.dataset.theme === "dark" ? "dark" : "light") !== t && theme()) theme().click(); if (t === "light") setTone("none"); };
    items.push(
      { kind: "action", icon: "☀️", en: "Light look", ar: "المظهر الفاتح", kw: "theme light mode وضع", line: "Look · المظهر", go: () => toTheme("light") },
      { kind: "action", icon: "🌙", en: "Dark look", ar: "المظهر الداكن", kw: "theme dark mode night وضع ليلي", line: "Look · المظهر", go: () => { setTone("none"); toTheme("dark"); } },
      { kind: "action", icon: "◆", en: "Dark gold peak", ar: "الذروة الذهبية المظلمة", kw: "theme gold tone ذهبي", line: "Look · المظهر", go: () => setTone("gold") }
    );
    if (document.getElementById("langToggle")) items.push({ kind: "action", icon: "🌐", en: "Switch language", ar: "تبديل اللغة", kw: "language arabic english عربي انجليزي", line: "Arabic / English · عربي / English", go: () => document.getElementById("langToggle").click() });
    return items.concat(sections());
  }
  let cmd = null, cmdInput = null, cmdList = null, cmdCount = null, cmdItems = [], cmdHits = [], cmdAt = 0, cmdBack = null;
  function cmdPaint() {
    cmdHits = cmdInput.value.trim() ? rank(cmdItems, cmdInput.value) : cmdItems.filter(x => x.kind !== "section").concat(cmdItems.filter(x => x.kind === "section")).slice(0, 24);
    cmdAt = Math.min(cmdAt, Math.max(0, cmdHits.length - 1));
    cmdList.replaceChildren();
    cmdHits.forEach((it, i) => {
      const li = el("li", "suite-app suite-cmd-opt");
      li.id = "suiteCmdOpt" + i; li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(i === cmdAt));
      const ico = el("span", "suite-ico", it.icon); ico.setAttribute("aria-hidden", "true");
      const name = el("b", "", it.en + (it.ar ? " · " : ""));
      if (it.ar) { const ar = el("span", "ar", it.ar); ar.lang = "ar"; name.append(ar); }
      name.dir = "auto";
      li.append(ico, name, el("small", "", it.line));
      li.addEventListener("pointerdown", e => e.preventDefault());
      li.addEventListener("click", () => cmdRun(i));
      cmdList.append(li);
    });
    if (cmdHits.length) cmdInput.setAttribute("aria-activedescendant", "suiteCmdOpt" + cmdAt); else cmdInput.removeAttribute("aria-activedescendant");
    cmdCount.textContent = cmdHits.length ? `${cmdHits.length} found · ${cmdHits.length} نتيجة` : "Nothing matches. Try another word · لا نتيجة، جرّب كلمة أخرى";
  }
  function cmdMove(d) {
    if (!cmdHits.length) return;
    cmdAt = (cmdAt + d + cmdHits.length) % cmdHits.length;
    for (const li of cmdList.children) li.setAttribute("aria-selected", String(li.id === "suiteCmdOpt" + cmdAt));
    cmdInput.setAttribute("aria-activedescendant", "suiteCmdOpt" + cmdAt);
    const li = document.getElementById("suiteCmdOpt" + cmdAt); if (li) li.scrollIntoView({ block: "nearest" });
  }
  function cmdRun(i) {
    const it = cmdHits[i]; if (!it) return;
    palette(false, it.kind === "section");
    it.go();
  }
  function palette(on, keepFocus) {
    if (!cmd) buildPalette();
    if (on === undefined) on = cmd.hidden;
    if (on && cmd.hidden) { cmdBack = document.activeElement; if (pop && !pop.hidden) open(false); cmdItems = commands(); cmdInput.value = ""; cmdAt = 0; cmdPaint(); }
    cmd.hidden = !on;
    document.documentElement.classList.toggle("suite-cmd-on", on);
    if (on) cmdInput.focus();
    else if (!keepFocus && cmdBack && cmdBack.focus && document.contains(cmdBack)) cmdBack.focus();
  }
  function buildPalette() {
    cmd = el("div", "suite-cmd"); cmd.hidden = true;
    const box = el("div", "suite-cmd-box");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "suiteCmdLabel");
    const label = el("label", "suite-cmd-label", "Search OMEGA · ");
    label.id = "suiteCmdLabel"; label.htmlFor = "suiteCmdQ";
    const arLab = el("span", "ar", "ابحث في أوميغا"); arLab.lang = "ar"; label.append(arLab);
    cmdInput = el("input", "suite-cmd-q");
    Object.assign(cmdInput, { id: "suiteCmdQ", name: "suite-q", type: "search", autocomplete: "off", spellcheck: false });
    cmdInput.dir = "auto";
    cmdInput.placeholder = "Page, section or look… · صفحة أو قسم أو مظهر…";
    cmdInput.setAttribute("role", "combobox"); cmdInput.setAttribute("aria-expanded", "true"); cmdInput.setAttribute("aria-controls", "suiteCmdList"); cmdInput.setAttribute("aria-autocomplete", "list");
    cmdList = el("ul", "suite-cmd-list"); cmdList.id = "suiteCmdList"; cmdList.setAttribute("role", "listbox"); cmdList.setAttribute("aria-label", "Results · النتائج");
    cmdCount = el("p", "suite-cmd-count"); cmdCount.setAttribute("aria-live", "polite");
    const keys = el("p", "suite-cmd-keys", "↑ ↓ choose · Enter open · Esc close · ");
    const arKeys = el("span", "ar", "الأسهم للاختيار، Enter للفتح، Esc للإغلاق"); arKeys.lang = "ar"; keys.append(arKeys);
    box.append(label, cmdInput, cmdCount, cmdList, keys);
    cmd.append(box);
    cmdInput.addEventListener("input", () => { cmdAt = 0; cmdPaint(); });
    cmdInput.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); cmdMove(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter") { e.preventDefault(); cmdRun(cmdAt); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); palette(false); }
      else if (e.key === "Tab") e.preventDefault();
    });
    cmd.addEventListener("click", e => { if (e.target === cmd) palette(false); });
    document.body.append(cmd);
  }
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyK") { e.preventDefault(); palette(); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  window.OMEGA_SUITE = Object.freeze({ publish, setTone, tone: () => toneNow(), state: () => JSON.parse(JSON.stringify(state)), on: f => { listeners.push(f); }, violations: () => violations, channel: () => !!ch, palette: on => palette(on), rank: (items, q) => rank(items, q) });
})();
