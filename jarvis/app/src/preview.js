// Jarvis Studio preview runtime (ADR-133). Runs inside <iframe sandbox="allow-scripts" srcdoc>
// (opaque origin, no network: it inherits the parent's CSP, which pins this exact text by hash).
// It reads the site as JSON and builds the page with createElement + textContent only.
(() => {
  "use strict";
  const TYPES = new Set(["nav", "hero", "features", "stats", "faq", "table", "text", "cta", "footer"]);
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const VARS = { bg: "--bg", surface: "--surface", text: "--text", muted: "--muted", accent: "--accent", onAccent: "--on-accent", border: "--border" };
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max || 400) : "");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function link(text, href, cls) {
    const a = el("a", cls, text);
    a.href = href;
    return a;
  }
  function wrapIn(section) {
    const w = el("div", "wrap");
    section.appendChild(w);
    return w;
  }

  const BUILD = {
    nav(t) {
      const s = el("header", "nav");
      const w = wrapIn(s);
      w.appendChild(el("span", "brand", str(t.brand, 60)));
      const ul = el("ul", "links");
      str(t.links, 200).split(/[,،]/).map(x => x.trim()).filter(Boolean).slice(0, 5).forEach((x, i) => {
        const li = el("li");
        li.appendChild(link(x, "#b" + (i + 1)));
        ul.appendChild(li);
      });
      w.appendChild(ul);
      if (str(t.cta)) w.appendChild(link(str(t.cta, 40), "#cta", "btn primary"));
      return s;
    },
    hero(t) {
      const s = el("section", "hero");
      const w = wrapIn(s);
      if (str(t.kicker)) w.appendChild(el("p", "kicker", str(t.kicker, 80)));
      w.appendChild(el("h1", null, str(t.title, 160)));
      if (str(t.body)) w.appendChild(el("p", null, str(t.body, 400)));
      const a = el("div", "actions");
      if (str(t.primary)) a.appendChild(link(str(t.primary, 40), "#cta", "btn primary"));
      if (str(t.secondary)) a.appendChild(link(str(t.secondary, 40), "#b1", "btn ghost"));
      w.appendChild(a);
      return s;
    },
    features(t, b) {
      const s = el("section");
      const w = wrapIn(s);
      if (str(t.title)) w.appendChild(el("h2", null, str(t.title, 120)));
      const g = el("div", "grid");
      const cols = Number(b && b.cols);
      if (cols >= 1 && cols <= 4) { g.classList.add("fixed"); g.style.setProperty("--cols", String(cols)); }
      for (let i = 1; i <= 6; i++) {
        if (!str(t["f" + i + "t"])) continue;
        const c = el("article", "card");
        c.append(el("h3", null, str(t["f" + i + "t"], 80)), el("p", null, str(t["f" + i + "b"], 240)));
        g.appendChild(c);
      }
      w.appendChild(g);
      return s;
    },
    stats(t) {
      const s = el("section", "stats");
      const w = wrapIn(s);
      const g = el("div", "grid");
      for (let i = 1; i <= 6; i++) {
        if (!str(t["s" + i + "v"])) continue;
        const c = el("div", "stat");
        c.append(el("b", null, str(t["s" + i + "v"], 20)), el("span", null, str(t["s" + i + "l"], 60)));
        g.appendChild(c);
      }
      w.appendChild(g);
      return s;
    },
    faq(t) {
      const s = el("section");
      const w = wrapIn(s);
      if (str(t.title)) w.appendChild(el("h2", null, str(t.title, 120)));
      for (let i = 1; i <= 6; i++) {
        if (!str(t["q" + i])) continue;
        const d = el("details");
        d.append(el("summary", null, str(t["q" + i], 160)), el("p", null, str(t["a" + i], 400)));
        w.appendChild(d);
      }
      return s;
    },
    table(t, b) {
      const s = el("section");
      const w = wrapIn(s);
      if (str(t.title)) w.appendChild(el("h2", null, str(t.title, 120)));
      const cols = Math.max(2, Math.min(6, Number(b && b.cols) || 3)), rows = Math.max(1, Math.min(8, Number(b && b.rows) || 3));
      const scroll = el("div", "table-wrap");
      const table = el("table"), head = el("tr");
      for (let c = 1; c <= cols; c++) { const th = el("th", null, str(t["c" + c], 40) || "—"); th.scope = "col"; head.appendChild(th); }
      const thead = el("thead"); thead.appendChild(head);
      const tbody = el("tbody");
      for (let r = 0; r < rows; r++) { const tr = el("tr"); for (let c = 1; c <= cols; c++) tr.appendChild(el("td", null, str(t.cell, 20) || "—")); tbody.appendChild(tr); }
      table.append(thead, tbody); scroll.appendChild(table); w.appendChild(scroll);
      return s;
    },
    text(t) {
      const s = el("section");
      const w = wrapIn(s);
      if (str(t.title)) w.appendChild(el("h2", null, str(t.title, 120)));
      if (str(t.body)) w.appendChild(el("p", "lead", str(t.body, 600)));
      return s;
    },
    cta(t) {
      const s = el("section", "cta");
      s.id = "cta";
      const w = wrapIn(s);
      w.appendChild(el("h2", null, str(t.title, 120)));
      if (str(t.body)) w.appendChild(el("p", null, str(t.body, 300)));
      if (str(t.button)) w.appendChild(link(str(t.button, 40), "#top", "btn primary"));
      return s;
    },
    footer(t) {
      const f = el("footer");
      wrapIn(f).appendChild(el("p", null, str(t.text, 200)));
      return f;
    },
  };

  function render(site) {
    if (!site || typeof site !== "object" || !Array.isArray(site.blocks)) return;
    const lang = site.lang === "ar" ? "ar" : "en";
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === "ar" ? "rtl" : "ltr";
    const theme = site.theme || {};
    for (const [k, v] of Object.entries(VARS)) if (HEX.test(theme[k] || "")) root.style.setProperty(v, theme[k]);
    document.title = str(site.name, 80) || "Site";
    const body = document.body;
    body.id = "top";
    const keep = [...body.querySelectorAll("script")];
    body.replaceChildren(...keep);
    let n = 0, shown = 0;
    for (const b of site.blocks.slice(0, 20)) {
      if (!b || !TYPES.has(b.type) || !b.on) continue;
      const t = (b.t && b.t[lang]) || {};
      const node = BUILD[b.type](t, b);
      if (b.type !== "nav" && b.type !== "footer") node.id = node.id || "b" + (++n);
      body.insertBefore(node, keep[0] || null);
      shown++;
    }
    if (!shown) body.insertBefore(el("p", "empty", lang === "ar" ? "لا توجد أقسام مفعّلة." : "No sections switched on."), keep[0] || null);
  }

  const data = document.getElementById("site");
  try { render(JSON.parse(data ? data.textContent : "null")); } catch (e) { /* bad JSON: leave the page empty */ }
  // ADR-144: the Studio asks for the boxes of what the preview shows (actions, headings, text, images) to
  // compute Fitts, Hick, mirror symmetry and the heatmap. Only sizes and positions in the viewport go
  // back (what is on screen now); no text.
  function measure() {
    const out = [];
    const holders = Array.from(document.querySelectorAll("ul, .actions, header, section, footer"));
    const add = (n, kind, i, extra) => {
      const r = n.getBoundingClientRect();
      if (r.width && r.height) out.push(Object.assign({ id: kind.charAt(0) + i, kind, x: r.left, y: r.top, w: r.width, h: r.height }, extra));
    };
    document.querySelectorAll("a, button, summary").forEach((n, i) => {
      const g = n.closest("ul, .actions, header, section, footer");
      add(n, "action", i, { group: g ? "g" + holders.indexOf(g) + " " + (g.className || g.tagName.toLowerCase()) : null });
    });
    document.querySelectorAll("h1, h2, h3").forEach((n, i) => add(n, "heading", i, { level: Number(n.tagName.charAt(1)) }));
    document.querySelectorAll("p, td, th, dd").forEach((n, i) => add(n, "text", i));
    document.querySelectorAll("img").forEach((n, i) => add(n, "image", i));
    return out.slice(0, 400);
  }
  window.addEventListener("message", e => {
    if (e.source !== window.parent || window.parent === window) return;
    if (e.data && e.data.type === "jarvis-measure") {
      window.parent.postMessage({ type: "jarvis-boxes", req: Number(e.data.req) || 0, vw: window.innerWidth, vh: window.innerHeight, dir: document.documentElement.dir, boxes: measure() }, "*");
      return;
    }
    render(e.data);
  });
})();
