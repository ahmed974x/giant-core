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
    if (meta) meta.setAttribute("content", t === "dark" ? "#000000" : "#F5F5F7");
    applying = false;
  }
  function receive(raw) {
    const patch = clean(raw || {});
    if (!Object.keys(patch).length) return;
    Object.assign(state, patch);
    if (patch.theme) applyTheme(patch.theme);
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
  new MutationObserver(() => { if (!applying) publish({ theme: root.dataset.theme === "dark" ? "dark" : "light" }); }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  if (state.theme) applyTheme(state.theme); else publish({ theme: root.dataset.theme === "dark" ? "dark" : "light" });

  // Links between the five pages. GitHub Pages and the local server put NABD one folder above the Ops Room;
  // a copy opened from disk keeps the repository layout (site-landing/ next to omega-ops-room-v1/).
  const disk = location.protocol === "file:", inLanding = /\/site-landing\//.test(location.pathname);
  const HREF = {
    nabd: PAGE === "nabd" ? "index.html" : disk ? "../site-landing/index.html" : "../index.html",
    ops: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-ops-room.html" : "omega-ops-room-v1/omega-ops-room.html") : "omega-ops-room.html",
    chain: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/the-chain.html" : "omega-ops-room-v1/the-chain.html") : "the-chain.html",
    oracle: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-oracle.html" : "omega-ops-room-v1/omega-oracle.html") : "omega-oracle.html",
    lab: PAGE === "nabd" ? (inLanding ? "../omega-ops-room-v1/omega-trade-lab.html" : "omega-ops-room-v1/omega-trade-lab.html") : "omega-trade-lab.html"
  };
  const usd = v => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
  const APPS = [
    { k: "nabd", icon: "📡", en: "NABD portal", ar: "بوابة نبض", line: () => "Public site, paper simulations · الموقع العام" },
    { k: "ops", icon: "🎯", en: "Ops Room", ar: "غرفة العمليات", line: () => (state.wallet ? `Paper base ${usd(state.wallet.base)} · safe ${usd(state.wallet.safe)}` : "Paper desk, OSIRIS, receipts") + (Number.isFinite(state.pwsi) ? ` · PWSI ${state.pwsi}` : "") },
    { k: "chain", icon: "⛓️", en: "THE CHAIN", ar: "السلسلة", line: () => state.ticker ? `Last ticker ${state.ticker}` : "Research chain, local notes" },
    { k: "oracle", icon: "🔭", en: "ORACLE", ar: "العرّاف", line: () => state.research ? `Last question: ${state.research}` : "Deep research agent, open sources" },
    { k: "lab", icon: "📒", en: "TRADE LAB", ar: "مختبر المتداول", line: () => "Paper journal, desk manager agent" }
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
    document.body.append(pop);
    btn.addEventListener("click", e => { e.stopPropagation(); open(pop.hidden); });
    document.addEventListener("click", e => { if (!pop.hidden && !pop.contains(e.target)) open(false); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) { open(false); btn.focus(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  window.OMEGA_SUITE = Object.freeze({ publish, state: () => JSON.parse(JSON.stringify(state)), on: f => { listeners.push(f); }, violations: () => violations, channel: () => !!ch });
})();
