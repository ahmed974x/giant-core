// APEX council engine (ADR-127): pure functions shared by the APEX page (inlined between the OMEGA_APEX markers by
// scripts/build-apex-inline.mjs, because the page must work from file:// with no build step) and the Node tests
// (scripts/test-apex.mjs). No imports, no storage, no clock, no network.
//
// APEX is not a new model and holds no hidden secret. It is a lead that routes: one field helper sits on the
// council for each of the fifteen knowledge domains (ADR-126), each with the open sources that feed its field, the
// pages where it lives, the PRIME helpers that partner it, the open-source tools it would study (ideas only) and the
// one thing it may never do. A question is routed to the fields whose words it shares; the chosen helpers each write
// a short brief from fixed tables; PRIME's core helpers review the council with fixed rules (risk can only stop,
// the auditor checks that every source is keyless and that nothing is installed, the sentinel keeps OSINT passive);
// APEX then drafts a paper-only PRIME plan that the page checks again with OMEGA_CORE.checkPlan. The same router
// files the second brain's ideas into each helper's inbox. Every route, share, brief, inbox and plan is [INFERENCE]:
// fixed rules over words, nothing written by a language model.

const finite = v => typeof v === "number" && Number.isFinite(v);
const clean = (s, max = 400) => typeof s === "string" ? s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
const plainTokens = s => String(s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);

/* ---------- the fifteen field helpers ---------- */
// One seat per domain of scripts/lib/knowledge-domain.mjs (same ids). `oracle` is how the helper opens ORACLE for
// its field (mode and lens of ADR-114 / ADR-122); `guard` is the one rule the helper can never break.
const FIELD_HELPERS = Object.freeze([
  { domain: "markets", ar: "خبير الأسواق", en: "Markets expert", oracle: { mode: "scholar", field: "general" },
    role: { ar: "يقرأ السوق من بيانات Binance العامة ويحوّله لأسئلة بحث ورقية", en: "reads the market from Binance public data and turns it into paper research questions" },
    guard: { ar: "لا يرسل ولا يوقّع ولا يحجّم أي أمر؛ التداول ورقي فقط", en: "never sends, signs or sizes an order; trading is paper only" } },
  { domain: "risk", ar: "حارس المخاطر", en: "Risk guardian", oracle: { mode: "scholar", field: "general" },
    role: { ar: "يذكّر بوقف الخسارة والتراجع وحدود الحجم قبل أي قراءة للسوق", en: "puts the stop, drawdown and size limits before any market reading" },
    guard: { ar: "يستطيع الإيقاف فقط، لا يفتح شيئاً", en: "can only stop, never opens anything" } },
  { domain: "energy", ar: "خبير النفط والذهب", en: "Oil and gold expert", oracle: { mode: "scholar", field: "industry" },
    role: { ar: "يربط النفط والذهب بالمضائق والأخبار بمصادر مفتوحة", en: "links oil and gold to the straits and the news through open sources" },
    guard: { ar: "لا سعر بلا مصدر وتاريخ", en: "no price without a source and a date" } },
  { domain: "geo", ar: "رسّام الأرض", en: "Earth mapper", oracle: { mode: "intel", field: "general" },
    role: { ar: "يضع كل حدث على خريطة OSIRIS بمصدره الخام", en: "puts every event on the OSIRIS map with its raw source" },
    guard: { ar: "لا نقطة مخترعة: طبقة بلا مصدر تظهر OFFLINE", en: "no invented point: a layer without a source shows OFFLINE" } },
  { domain: "sea", ar: "حارس المضائق", en: "Straits watcher", oracle: { mode: "intel", field: "general" },
    role: { ar: "يراقب المضائق الخمسة والسفن والكابلات وحالة البحر", en: "watches the five straits, ships, cables and the sea state" },
    guard: { ar: "الكابلات ممرات تقريبية، والسفن المطفأة تظهر NO FREE SOURCE", en: "cables are approximate corridors; ships with AIS off show NO FREE SOURCE" } },
  { domain: "cyber", ar: "محلل التهديدات", en: "Threat analyst", oracle: { mode: "intel", field: "general" },
    role: { ar: "يقرأ الثغرات وKEV وEPSS ومسارات BGP من قوائم منشورة", en: "reads CVEs, KEV, EPSS and BGP routes from published feeds" },
    guard: { ar: "سلبي فقط: لا فحص منافذ ولا عنوان أو شخص أو حساب", en: "passive only: no port scans, no address, person or account" } },
  { domain: "space", ar: "راصد الفضاء", en: "Space watcher", oracle: { mode: "scholar", field: "science" },
    role: { ar: "يتابع الأقمار والعواصف الشمسية ومؤشر Kp", en: "follows satellites, solar storms and the Kp index" },
    guard: { ar: "المدارات ثنائية الجسم + J2 وليست SGP4، ويقول ذلك", en: "orbits are two-body + J2, not SGP4, and it says so" } },
  { domain: "news", ar: "قارئ الأحداث", en: "Events reader", oracle: { mode: "intel", field: "general" },
    role: { ar: "يقيس تغطية الأخبار ونبرتها من GDELT", en: "measures news coverage and tone from GDELT" },
    guard: { ar: "الاتجاه قاعدة ثابتة وليس تنبؤاً", en: "the trend is a fixed rule, never a forecast" } },
  { domain: "vision", ar: "عين الكاميرات", en: "Camera eye", oracle: { mode: "scholar", field: "algorithms" },
    role: { ar: "يعرض الكاميرات المفتوحة بمصدرها ووقت الإطار", en: "shows open cameras with their source and frame time" },
    guard: { ar: "كاميرات عامة فقط، بلا تعرّف على وجوه", en: "public cameras only, no face recognition" } },
  { domain: "ai", ar: "مهندس الوكلاء", en: "Agent engineer", oracle: { mode: "scholar", field: "algorithms" },
    role: { ar: "يصمم خطط PRIME ومهامه وذاكرته من أوراق منشورة", en: "designs PRIME's plans, missions and memory from published papers" },
    guard: { ar: "لا نسخ لنموذج مغلق، ولا أسرار خفية، ولا تثبيت بلا موافقة", en: "no copy of a closed model, no hidden secrets, no install without approval" } },
  { domain: "knowledge", ar: "أمين المعرفة", en: "Knowledge keeper", oracle: { mode: "scholar", field: "general" },
    role: { ar: "يرتب أفكارك ومصادرك وقراراتك في رسم واحد", en: "keeps your ideas, sources and decisions in one graph" },
    guard: { ar: "الاقتباس حرفي من المصدر مع رقمه", en: "quotes are verbatim from the source, with its number" } },
  { domain: "design", ar: "مصمم الواجهة", en: "Interface designer", oracle: { mode: "scholar", field: "algorithms" },
    role: { ar: "يحرس نظام التصميم: الألوان والتباين والمقاسات الثلاثة", en: "keeps the design system: colours, contrast and the three sizes" },
    guard: { ar: "كل لون يمر ببوابة التباين WCAG و APCA", en: "every colour passes the WCAG and APCA contrast gate" } },
  { domain: "security", ar: "حارس الأمان", en: "Security keeper", oracle: { mode: "intel", field: "general" },
    role: { ar: "يراجع CSP والخزنة والفواتير وكل أداة مقترحة", en: "reviews the CSP, the vault, the receipts and every proposed tool" },
    guard: { ar: "لا سر في الكود ولا في السجل ولا في المحادثة", en: "no secret in code, logs or chat" } },
  { domain: "medicine", ar: "باحث الطب", en: "Medical researcher", oracle: { mode: "scholar", field: "medicine" },
    role: { ar: "يجمع التجارب السريرية والأوراق من PubMed وClinicalTrials.gov", en: "gathers trials and papers from PubMed and ClinicalTrials.gov" },
    guard: { ar: "الموجز ليس نصيحة طبية، ويقول ذلك", en: "the brief is not medical advice, and says so" } },
  { domain: "science", ar: "باحث العلوم والصناعة", en: "Science and industry researcher", oracle: { mode: "scholar", field: "science" },
    role: { ar: "يقرأ التقارير والبيانات من Zenodo وOSTI وarXiv", en: "reads reports and datasets from Zenodo, OSTI and arXiv" },
    guard: { ar: "ورقة مسحوبة تُستبعد ويُذكر اسمها", en: "a retracted work is left out and named" } }
]);

/* ---------- open-source register (ideas only) ---------- */
// One tool per field that the library (ADR-125) and the knowledge-graph tools (ADR-126) do not already list, read on
// 2026-10-24 from the page named in `src`. Nothing here is installed: each needs Ahmad's approval and a written
// security review first (AGENTS.md §1), and OpenSSF Scorecard is the first look that review would take.
const REG_ASOF = "2026-10-24";
const REGISTER = Object.freeze([
  { domain: "markets", name: "Qlib", licence: "MIT", repo: "https://github.com/microsoft/qlib", src: "https://gitee.com/lightsp/qlib", ar: "منصة بحث كمي: بيانات وعوامل واختبار رجعي على الورق", en: "quant research platform: data, factors and paper backtests" },
  { domain: "risk", name: "PyPortfolioOpt", licence: "MIT", repo: "https://github.com/PyPortfolio/PyPortfolioOpt", src: "https://cdn.jsdelivr.net/gh/robertmartin8/pyportfolioopt@main/README.md", ar: "توزيع المحافظ وحدود المخاطرة (للتعلم على الورق)", en: "portfolio allocation and risk limits (to learn on paper)" },
  { domain: "energy", name: "PyPSA", licence: "MIT", repo: "https://github.com/PyPSA/PyPSA", src: "https://docs.pypsa.org/latest/home/license/", ar: "نمذجة أنظمة الطاقة والشبكات", en: "energy system and grid modelling" },
  { domain: "sea", name: "MovingPandas", licence: "BSD-3-Clause", repo: "https://github.com/movingpandas/movingpandas", src: "https://summary.ecosyste.ms/projects/74892", ar: "تحليل مسارات السفن والطائرات", en: "trajectory analysis for ships and aircraft" },
  { domain: "cyber", name: "Wazuh", licence: "GPL-2.0-only", repo: "https://github.com/wazuh/wazuh", src: "https://www.opentechhub.io/wazuh/", ar: "مراقبة أمنية دفاعية لأجهزتك أنت فقط", en: "defensive security monitoring of your own machines only" },
  { domain: "space", name: "Skyfield", licence: "MIT", repo: "https://github.com/skyfielders/python-skyfield", src: "https://pypi.org/project/skyfield/", ar: "مواقع دقيقة للكواكب والأقمار الصناعية", en: "research-grade positions of planets and Earth satellites" },
  { domain: "news", name: "Trafilatura", licence: "Apache-2.0 (from v1.8.0; GPLv3+ before)", repo: "https://github.com/adbar/trafilatura", src: "https://pypi.org/project/trafilatura/2.2.0/", ar: "استخراج نص المقال النظيف من صفحة خبر", en: "clean article text from a news page" },
  { domain: "vision", name: "supervision", licence: "MIT", repo: "https://github.com/roboflow/supervision", src: "https://supervision.roboflow.com/latest/about/", ar: "أدوات رؤية حاسوبية مستقلة عن النموذج", en: "model-agnostic computer vision tools" },
  { domain: "ai", name: "DSPy", licence: "MIT", repo: "https://github.com/stanfordnlp/dspy", src: "https://summary.ecosyste.ms/projects/371500", ar: "برمجة خطوات النموذج المحلي بدل كتابة الأوامر يدوياً", en: "program a local model's steps instead of hand-written prompts" },
  { domain: "ai", name: "Langfuse", licence: "MIT (outside the /ee folders)", repo: "https://github.com/langfuse/langfuse", src: "https://langfuse.com/docs/open-source", ar: "تتبع ومراجعة كل خطوة للوكيل محلياً", en: "trace and review every agent step, self-hosted" },
  { domain: "knowledge", name: "Zotero", licence: "AGPL-3.0", repo: "https://github.com/zotero/zotero", src: "https://en.wikipedia.org/wiki/Zotero", ar: "مكتبة مراجعك واقتباساتك", en: "a library for your references and citations" },
  { domain: "knowledge", name: "Paperless-ngx", licence: "GPL-3.0", repo: "https://github.com/paperless-ngx/paperless-ngx", src: "https://www.opentechhub.io/paperless-ngx/", ar: "أرشفة المستندات الممسوحة بنص قابل للبحث", en: "archive scanned documents as searchable text" },
  { domain: "design", name: "Open Props", licence: "MIT", repo: "https://github.com/argyleink/open-props", src: "https://npmjs.com/package/open-props", ar: "متغيرات CSS جاهزة للحركة والمسافات (مرجع فقط)", en: "ready CSS variables for motion and spacing (reference only)" },
  { domain: "security", name: "OpenSSF Scorecard", licence: "Apache-2.0", repo: "https://github.com/ossf/scorecard", src: "https://pkg.go.dev/github.com/ossf/scorecard", ar: "يقيّم أمان أي مشروع مفتوح قبل أن نقترحه", en: "scores the security posture of any open project before we propose it" },
  { domain: "medicine", name: "scispaCy", licence: "Apache-2.0", repo: "https://github.com/allenai/scispacy", src: "https://awesome.ecosyste.ms/projects/github.com%2Fallenai%2Fscispacy", ar: "قراءة النصوص الطبية والحيوية", en: "biomedical text processing" },
  { domain: "science", name: "SymPy", licence: "BSD-3-Clause", repo: "https://github.com/sympy/sympy", src: "https://github.com/sympy/sympy", ar: "رياضيات رمزية (مقترحة سابقاً لعقل نيوتن)", en: "symbolic maths (proposed before for the Newton brain)" }
]);

// PRIME tools by helper (scripts/lib/agent-core.mjs TOOLS). The paper executor has none: it acts only on the risk
// judge's OPEN, never from a plan.
const HELPER_TOOL = Object.freeze({ scout: "scout", analyst: "analyst", quant: "quant", sentinel: "sentinel", risk: "risk", exec: null, audit: "audit", research: "research", ops: "ops" });
const GEO = new Set(["geo", "sea", "cyber", "space", "news", "vision"]);
const SEAT_MIN = 0.12, SEATS = 5;

/* ---------- registry ---------- */
// reg (scripts/build-apex-inline.mjs): { domains: knowledge DOMAINS, pages: knowledge PAGES, sources: ORACLE
// SOURCES {id: {name, terms, kind, home}}, helpers: OMEGA_CORE.HELPERS, tools: OMEGA_CORE.TOOLS, library: [...] }
function fields(reg) {
  const doms = new Map((reg && Array.isArray(reg.domains) ? reg.domains : []).map(d => [d.id, d]));
  return FIELD_HELPERS.map(f => {
    const d = doms.get(f.domain) || { words: "", sources: [], helpers: [], pages: [], lib: [] };
    return {
      id: "f-" + f.domain, domain: f.domain, ar: f.ar, en: f.en, role: f.role, guard: f.guard, oracle: f.oracle,
      field: { ar: d.ar || f.domain, en: d.en || f.domain }, trade: !!d.trade, words: String(d.words || ""),
      sources: (d.sources || []).filter(s => reg.sources && reg.sources[s]), partners: (d.helpers || []).slice(), pages: (d.pages || []).slice(),
      tools: REGISTER.filter(t => t.domain === f.domain).map(t => t.name)
        .concat((reg.library || []).filter(t => (d.lib || []).includes(t.cat)).map(t => t.name))
    };
  });
}

/* ---------- routing ---------- */
function bagOf(tok, text) { const m = new Set(); for (const t of tok(text)) m.add(t); return m; }
// Each field scores the question by the words they share, divided by the square root of the question's size, plus
// a point for each of its sources named. Shares are the scores normalised to 1. With no shared word the knowledge
// keeper takes the question alone, and the result says so.
function route(reg, question, opts = {}) {
  const tok = typeof opts.tokens === "function" ? opts.tokens : plainTokens;
  const q = clean(question, 300), qb = bagOf(tok, q), size = Math.sqrt(Math.max(1, qb.size)), low = q.toLowerCase();
  const F = fields(reg);
  const rows = F.map(f => {
    const fb = bagOf(tok, `${f.words} ${f.field.en} ${f.field.ar}`);
    const hits = [...qb].filter(t => fb.has(t));
    const named = f.sources.filter(s => { const n = String(reg.sources[s].name || "").toLowerCase().replace(/\s*\(.*$/, ""); return n.length >= 4 && low.includes(n); });
    return { id: f.id, domain: f.domain, hits, named, score: hits.length / size + named.length };
  });
  const total = rows.reduce((s, r) => s + r.score, 0);
  const none = !(total > 0);
  for (const r of rows) r.share = none ? (r.domain === "knowledge" ? 1 : 0) : r.score / total;
  rows.sort((a, b) => b.share - a.share || F.findIndex(f => f.id === a.id) - F.findIndex(f => f.id === b.id));
  return { question: q, none, rows };
}

/* ---------- council ---------- */
function oracleQuery(f, q) { return { q: clean(q, 200), mode: f.oracle.mode, field: f.oracle.mode === "scholar" ? f.oracle.field : "general" }; }
function council(reg, question, opts = {}) {
  const r = route(reg, question, opts);
  if (!r.question) return { ok: false, why: { ar: "اكتب سؤالاً أو هدفاً أولاً.", en: "Write a question or goal first." } };
  const F = new Map(fields(reg).map(f => [f.id, f]));
  let seats = r.rows.filter(x => x.share >= SEAT_MIN).slice(0, SEATS);
  if (!seats.length) seats = r.rows.slice(0, 1);
  const briefs = seats.map(x => {
    const f = F.get(x.id);
    return {
      id: f.id, domain: f.domain, ar: f.ar, en: f.en, share: x.share, hits: x.hits, field: f.field, guard: f.guard, role: f.role,
      read: f.sources.map(s => ({ id: s, name: reg.sources[s].name, terms: reg.sources[s].terms, home: reg.sources[s].home })),
      oracle: oracleQuery(f, r.question), pages: f.pages, partners: f.partners, study: f.tools.slice(0, 4)
    };
  });
  const doms = new Set(briefs.map(b => b.domain));
  const trade = briefs.some(b => F.get(b.id).trade), geo = briefs.some(b => GEO.has(b.domain));
  // Core review: fixed rules, one line per helper that has something to say.
  const review = [];
  const say = (helper, verdict, ar, en) => review.push({ helper, verdict, ar, en });
  say("risk", trade ? "stop-only" : "ok", trade ? "سؤال يمس التداول: الخطة ورقية فقط، وبوابة المخاطر بعد كل قراءة تستطيع الإيقاف فقط" : "لا تداول في السؤال", trade ? "The question touches trading: the plan is paper only, and the risk gate after every reading can only stop" : "No trading in the question");
  const unknown = briefs.flatMap(b => b.read).filter(s => !reg.sources[s.id]);
  say("audit", unknown.length ? "fix" : "ok", `كل المصادر من قائمة العرّاف المفتوحة بلا مفاتيح (${briefs.reduce((n, b) => n + b.read.length, 0)})؛ كل أداة فكرة فقط وتحتاج موافقتك ومراجعة أمنية`, `Every source is from ORACLE's keyless list (${briefs.reduce((n, b) => n + b.read.length, 0)}); every tool is an idea only and needs your approval and a security review`);
  if (geo) say("sentinel", "passive", "استخبارات سلبية فقط: مواضيع عامة، لا عنوان ولا شخص ولا حساب", "Passive OSINT only: public topics, no address, person or account");
  if (doms.has("medicine")) say("research", "note", "الموجز الطبي ليس نصيحة طبية", "The medical brief is not medical advice");
  say("exec", "ok", "المنفذ الورقي لا يفتح صفقة من خطة؛ فقط على OPEN من حكم المخاطر", "The paper executor opens nothing from a plan; only on the risk judge's OPEN");
  // The plan: recall first, the partners' tools, research when sources answer, sentinel for the world, audit and
  // risk for trading, the note last waiting for every step. At most 12 steps.
  const steps = [{ id: "recall", tool: "recall", after: [], why: "recall what PRIME already learned on this" }];
  const has = t => steps.some(s => s.tool === t);
  const push = (tool, after, why) => { if (tool && !has(tool)) steps.push({ id: tool, tool, after, why }); };
  for (const b of briefs) for (const p of b.partners) if (p !== "risk" && p !== "audit") push(HELPER_TOOL[p], ["recall"], "a council seat asks this partner for a paper reading");
  if (briefs.some(b => b.read.length)) push("research", ["recall"], "prepare an ORACLE brief from the council's open sources");
  if (geo) push("sentinel", [], "read OSIRIS PWSI and the cyber and space index");
  if (trade) {
    push("audit", [], "re-verify the receipt chain before any reading of the desk");
    const before = steps.filter(s => ["scout", "analyst", "quant", "audit", "sentinel"].includes(s.tool)).map(s => s.id);
    push("risk", before, "check the risk gate and the court's veto line; it can only stop");
  }
  const body = steps.slice(0, 11);
  const ids = new Set(body.map(s => s.id));
  for (const s of body) s.after = s.after.filter(a => ids.has(a) && a !== s.id);
  body.push({ id: "note", tool: "note", after: body.map(s => s.id), why: "write the council's summary into the journal and memory" });
  say("ops", "ok", `الخطة ${body.length} خطوات، تبدأ بالتذكّر وتنتهي بالملاحظة`, `The plan has ${body.length} steps, starting with recall and ending with the note`);
  const lead = briefs[0];
  const verdict = {
    ar: `يقود ${lead.ar} (${Math.round(lead.share * 100)}%)` + (briefs.length > 1 ? ` ومعه ${briefs.slice(1).map(b => b.ar).join("، ")}` : "") + (r.none ? ". لم يطابق السؤال أي مجال، فأخذه أمين المعرفة." : "."),
    en: `${lead.en} leads (${Math.round(lead.share * 100)}%)` + (briefs.length > 1 ? `, with ${briefs.slice(1).map(b => b.en).join(", ")}` : "") + (r.none ? ". No field matched the question, so the knowledge keeper took it." : ".")
  };
  const plan = { id: "apex", en: "APEX council mission", ar: "مهمة مجلس القمة", goal: clean(`APEX: ${r.question}`, 200), steps: body.map(s => ({ id: s.id, tool: s.tool, after: s.after, why: clean(s.why, 160) })) };
  return { ok: true, question: r.question, none: r.none, rows: r.rows, briefs, review, trade, plan, verdict };
}

/* ---------- ideas into inboxes ---------- */
// ideas: [{ text, score, sources }] (the second brain's organise() output). Each idea goes to the field that would
// lead it as a question; ideas no field shares a word with stay in the open tray.
function inboxes(reg, ideas, opts = {}) {
  const box = Object.fromEntries(FIELD_HELPERS.map(f => ["f-" + f.domain, []])), open = [];
  for (const x of Array.isArray(ideas) ? ideas : []) {
    if (!x || typeof x.text !== "string" || !clean(x.text)) continue;
    const r = route(reg, x.text, opts);
    const item = { text: clean(x.text, 200), score: finite(x.score) ? x.score : 0, sources: Array.isArray(x.sources) ? x.sources.slice(0, 4) : [] };
    if (r.none) open.push(item); else box[r.rows[0].id].push({ ...item, share: r.rows[0].share, hits: r.rows[0].hits });
  }
  for (const k of Object.keys(box)) box[k].sort((a, b) => b.score - a.score || b.share - a.share);
  open.sort((a, b) => b.score - a.score);
  return { box, open, total: Object.values(box).reduce((n, v) => n + v.length, 0) + open.length };
}

/* ---------- the network ---------- */
// Nodes: APEX at the centre, PRIME's nine helpers, the fifteen field helpers, ORACLE's open sources. Links are only
// the ones the tables hold: APEX seats each field and leads each core helper, a core helper partners a field, a
// source feeds a field. `lit` is the share of the field in the last council (0 when none ran).
function network(reg, res) {
  const nodes = [], edges = [], at = new Map();
  const add = n => { at.set(n.id, nodes.length); nodes.push(n); };
  const link = (a, b, kind, w) => { if (at.has(a) && at.has(b)) edges.push({ a: at.get(a), b: at.get(b), kind, w: finite(w) ? w : 0 }); };
  const share = new Map(res && res.ok ? res.briefs.map(b => [b.id, b.share]) : []);
  add({ id: "apex", kind: "apex", ar: "القمة", en: "APEX" });
  for (const [id, en, ar] of reg.helpers || []) add({ id: "h-" + id, kind: "core", ar, en, tool: HELPER_TOOL[id] || null });
  const F = fields(reg);
  for (const f of F) add({ id: f.id, kind: "field", ar: f.ar, en: f.en, domain: f.domain, lit: share.get(f.id) || 0 });
  const used = new Set(F.flatMap(f => f.sources));
  for (const [id, s] of Object.entries(reg.sources || {})) if (used.has(id)) add({ id: "s-" + id, kind: "source", ar: s.name, en: s.name, url: s.home });
  for (const [id] of reg.helpers || []) link("apex", "h-" + id, "leads", 0);
  for (const f of F) {
    const w = share.get(f.id) || 0;
    link("apex", f.id, "seats", w);
    for (const p of f.partners) link("h-" + p, f.id, "partners", w);
    for (const s of f.sources) link(f.id, "s-" + s, "feeds", w);
  }
  return { nodes, edges };
}
// Rings around the centre. A phone (tall) gets ellipses taller than wide so labels fit above and below.
function layout(net, w, h) {
  const cx = w / 2, cy = h / 2, tall = h > w * 1.15;
  const R = Math.min(w, h) / 2;
  const ring = { apex: 0, core: 0.3, field: 0.62, source: 0.9 };
  const groups = {};
  net.nodes.forEach((n, i) => { (groups[n.kind] = groups[n.kind] || []).push(i); });
  const pos = net.nodes.map(() => [cx, cy]);
  for (const [kind, list] of Object.entries(groups)) {
    const r = ring[kind] || 0, k = list.length, turn = kind === "core" ? 0.5 : kind === "source" ? 0.25 : 0;
    list.forEach((i, j) => {
      if (!r) { pos[i] = [cx, cy]; return; }
      const a = -Math.PI / 2 + 2 * Math.PI * (j + turn) / k;
      const rx = R * r * (tall ? 0.86 : 1.18), ry = R * r * (tall ? 1.18 : 0.92);
      pos[i] = [cx + Math.min(rx, w / 2 - 14) * Math.cos(a), cy + Math.min(ry, h / 2 - 14) * Math.sin(a)];
    });
  }
  return pos;
}

/* ---------- export ---------- */
function toMarkdown(res, at) {
  if (!res || !res.ok) return "";
  const out = [`# APEX council · مجلس القمة`, "", `Question: ${res.question}`, `Read: ${at || ""} · every route, share, brief and plan is [INFERENCE] (fixed rules over words). Paper only.`, "", `## Verdict`, res.verdict.en, res.verdict.ar, "", "## Seats"];
  for (const b of res.briefs) {
    out.push(`### ${b.en} · ${b.ar} (${Math.round(b.share * 100)}%)`, `- Field: ${b.field.en}`, `- Matched words: ${b.hits.join(", ") || "none"}`,
      `- Read: ${b.read.map(s => `${s.name} (${s.terms})`).join("; ") || "none"}`, `- Pages: ${b.pages.join(", ")}`, `- Study (ideas only): ${b.study.join(", ") || "none"}`, `- Never: ${b.guard.en}`);
  }
  out.push("", "## Core review");
  for (const v of res.review) out.push(`- ${v.helper} [${v.verdict}]: ${v.en}`);
  out.push("", "## Paper plan for PRIME");
  for (const s of res.plan.steps) out.push(`- ${s.id} (${s.tool})${s.after.length ? ` after ${s.after.join(", ")}` : ""}: ${s.why}`);
  return out.join("\n") + "\n";
}

export const OMEGA_APEX = Object.freeze({
  VERSION: "omega-apex-v1", REG_ASOF, FIELD_HELPERS, REGISTER, HELPER_TOOL, SEAT_MIN, SEATS,
  clean, plainTokens, fields, route, council, inboxes, network, layout, toMarkdown
});
