// Prompt meta-codes (ADR-156), pure: used by the server (POST /api/w/:slug/metacodes/compile) and inlined into
// the page. Five codes change what Jarvis answers with, and it always answers (no refusal): a request is never
// turned away, but a money, publishing, permissions, install or outbound step is always a locked approval that
// waits for Director 00 (AGENTS.md §1), in every option.
//   ALT3       three plans: the fastest slice, the most careful (tests first, mutation, contrast), self-hosted
//   KILLCRITIC findings against the repository's gates, each with its fix
//   X10THINK   four stages: assumptions, model, reverse check, edge cases
//   EL10       one plain sentence per plan
//   /HUMAN     the answer as a short paragraph
// One pass over the words finds the codes; the plans are fixed rules [INFERENCE], and every plan is proved by
// proveOption. The same engine is in .claude/skills/replica-prompt-metacodes/prompt_metacodes.py, and for the
// same request both give the same SHA-256.
import { healOklchContrast } from "./contrast-heal.mjs";
import { sha256Hex } from "./snapshot.mjs";

export const METACODES = ["/HUMAN", "EL10", "X10THINK", "KILLCRITIC", "ALT3"];
export const MC_LIMITS = { chars: 4000, urls: 20 };
export const MC_SENSITIVE = ["money", "publish", "permissions", "install", "outbound"];
// The lock words of llm-plan.mjs, English and Arabic, in the same order.
const MC_LOCK_RULES = [
  ["money", /\b(pay|payment|billing|bill|invoice|price|pricing|subscription|refund|transfer|wallet|money|charge|stripe)\b|دفع|ادفع|فاتور|مال|سعر|أسعار|اشتراك|تحويل|محفظ/i],
  ["publish", /\b(publish|deploy|go live|production|release to|public site|launch)\b|نشر|انشر|إطلاق|اطلاق/i],
  ["permissions", /\b(permission|permissions|access|role|grant|admin|sudo|collaborator)\b|صلاحي/i],
  ["install", /\b(install|plugin|dependency|dependencies|npm i|pip install|add (a |the )?skill)\b|تثبيت|ثبت|ثبّت/i],
  ["outbound", /\b(e-?mail|send|message|webhook|tweet|slack|notify|outbound|external|post to)\b|أرسل|ارسل|إرسال|ارسال|بريد|رسالة|خارجي/i],
];
const MC_SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,200}|ghp_[A-Za-z0-9]{20,200}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,200})\b/g;
const MC_URL = /https?:\/\/[!#-&(-;=?-~]{1,200}/gi;
const MC_HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;

// Every sentence the engine writes, in English and Arabic. {n} and {list} are filled in.
export const MC_TEXT = {
  "opt.speed": ["The fastest slice", "أسرع شريحة عاملة"],
  "opt.proof": ["The most careful: tests and proof first", "الأكثر حرصاً: الاختبارات والبرهان أولاً"],
  "opt.selfhost": ["Self-hosted on this computer", "مستضاف ذاتياً على هذا الجهاز"],
  "step.read": ["Read the request and the decision records", "اقرأ الطلب وسجلات القرارات"],
  "step.slice": ["Build the smallest working slice", "ابنِ أصغر شريحة تعمل"],
  "step.testsFirst": ["Write the tests and the oracle first", "اكتب الاختبارات والمرجع أولاً"],
  "step.build": ["Build until every test passes", "ابنِ حتى تنجح كل الاختبارات"],
  "step.local": ["Build it on 127.0.0.1 with no hosted service", "ابنِه على 127.0.0.1 دون أي خدمة مستضافة"],
  "step.tests": ["Run the server and flow tests", "شغّل اختبارات الخادم والمسارات"],
  "step.mutation": ["Run the mutation harness to 100%", "شغّل اختبار الطفرات حتى 100%"],
  "step.contrast": ["Check contrast: WCAG 4.5 and APCA 60", "افحص التباين: WCAG 4.5 و APCA 60"],
  "step.security": ["Run SkillSpector: 0 critical, 0 high", "شغّل SkillSpector: 0 حرج و 0 عالٍ"],
  "step.export": ["Export it as files you keep", "صدّره ملفاتٍ تحتفظ بها"],
  "step.approval": ["Wait for Director 00: {list}", "انتظر موافقة المدير 00: {list}"],
  "el10.speed": ["Do the smallest thing that works, test it, and stop.", "افعل أصغر شيء يعمل، واختبره، ثم توقّف."],
  "el10.proof": ["Write the checks first, then build until every check passes.", "اكتب الفحوص أولاً، ثم ابنِ حتى تنجح كلها."],
  "el10.selfhost": ["Run everything on this computer, check it, and keep the files yourself.", "شغّل كل شيء على هذا الجهاز، وافحصه، واحتفظ بالملفات بنفسك."],
  "cat.money": ["money", "المال"], "cat.publish": ["publishing", "النشر"], "cat.permissions": ["permissions", "الصلاحيات"], "cat.install": ["installing", "التثبيت"], "cat.outbound": ["outbound messages", "الرسائل الخارجية"],
  "crit.locks": ["Steps that need a person: they stay locked approvals in every plan.", "خطوات تحتاج إلى شخص: تبقى موافقات مقفلة في كل خطة."],
  "crit.nolocks": ["No money, publishing, permission, install or outbound step.", "لا خطوة مال أو نشر أو صلاحيات أو تثبيت أو رسائل خارجية."],
  "crit.secret": ["Secret-shaped text was pasted. It was removed from the copy; revoke it.", "لُصق نص يشبه مفتاحاً سرياً. حُذف من النسخة؛ ألغِ المفتاح."],
  "crit.private": ["Private addresses are refused by the SSRF shield.", "العناوين الخاصة يرفضها درع SSRF."],
  "crit.public": ["Public addresses are read only through the SSRF shield: one GET, robots.txt obeyed.", "العناوين العامة تُقرأ فقط عبر درع SSRF: طلب GET واحد مع احترام robots.txt."],
  "crit.gradient": ["DESIGN.md allows one solid accent: no blue to purple gradient.", "DESIGN.md يسمح بلون مميز واحد: لا تدرج من الأزرق إلى البنفسجي."],
  "crit.contrastOk": ["The first two colours pass WCAG 4.5 and APCA 60.", "اللونان الأولان يجتازان WCAG 4.5 و APCA 60."],
  "crit.contrastHeal": ["The first two colours miss WCAG 4.5 or APCA 60; the healed text colour keeps the hue.", "اللونان الأولان لا يبلغان WCAG 4.5 أو APCA 60؛ لون النص المعالَج يحفظ درجة اللون."],
  "crit.contrastNo": ["No lightness of this text colour passes on that background; change the background.", "لا سطوع لهذا اللون يجتاز على تلك الخلفية؛ غيّر الخلفية."],
  "crit.manual": ["Not checked from text: the three screen sizes and the 27 UI states. Run them before a commit.", "لا يُفحص من النص: المقاسات الثلاثة وحالات الواجهة السبع والعشرون. شغّلها قبل أي كومِت."],
  "x10.assume": ["Assumptions: what the request says", "الفرضيات: ما يقوله الطلب"],
  "x10.model": ["Model: the plans built from it", "النموذج: الخطط المبنية منه"],
  "x10.check": ["Reverse check: every sensitive step is a locked approval", "التحقق العكسي: كل خطوة حساسة موافقة مقفلة"],
  "x10.edge": ["Edge cases: what was cut, refused or removed", "الحالات الحدية: ما قُطع أو رُفض أو حُذف"],
  "human.asked": ["Parts in the request: {n}.", "عدد أجزاء الطلب: {n}."],
  "human.locks": ["{n} of them need Director 00 first: {list}.", "{n} منها تحتاج إلى المدير 00 أولاً: {list}."],
  "human.nolocks": ["None of them needs an approval.", "لا شيء منها يحتاج إلى موافقة."],
  "human.plans": ["The plans have {list} steps.", "عدد خطوات الخطط: {list}."],
  "human.end": ["Nothing that moves money, publishes, changes access, installs or sends runs without a person.", "لا شيء يحرّك المال أو ينشر أو يغيّر الصلاحيات أو يثبّت أو يرسل يعمل دون شخص."],
  "empty": ["No request text: these are the default plans.", "لا نص للطلب: هذه هي الخطط الافتراضية."],
  "err.prompt": ["The request must be text.", "يجب أن يكون الطلب نصاً."],
};
export const mcText = (key, lang, vars = {}) => {
  const pair = MC_TEXT[key];
  let s = pair ? pair[lang === "ar" ? 1 : 0] : key;
  for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
};
const joinList = (items, lang) => items.join(lang === "ar" ? "، " : ", ");

// One pass over the words: the codes come out, the rest is the request. Trailing punctuation is ignored.
export function parseMetacodes(text) {
  const all = Array.from(typeof text === "string" ? text : "");
  const src = all.slice(0, MC_LIMITS.chars);
  const codes = [], words = [];
  let w = "";
  const flush = () => {
    if (!w) return;
    const bare = w.replace(/[.,;:!?،؛]+$/, "").toUpperCase();
    const code = METACODES.includes(bare) ? bare : null;
    if (code) { if (!codes.includes(code)) codes.push(code); } else words.push(w);
    w = "";
  };
  for (const c of src) {
    if (c === " " || c === "\n" || c === "\t" || c === "\r") flush(); else w += c;
  }
  flush();
  return { codes, prompt: words.join(" "), truncated: all.length > MC_LIMITS.chars };
}

// A host is private when it is localhost, an IPv6 literal, or an IPv4 literal in a private or local range.
export function privateHost(url) {
  const after = url.replace(/^https?:\/\//i, "");
  let host = "";
  for (const c of after) { if (c === "/" || c === "?" || c === "#") break; host += c; }
  host = host.replace(/^[^@]*@/, "").toLowerCase();
  if (host.startsWith("[")) return true;
  host = host.split(":")[0];
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// The words that make a step need a person, in the order of the lock rules.
export function sensitiveCategories(text) { return MC_LOCK_RULES.filter(([, re]) => re.test(text)).map(([cat]) => cat); }

// A plan is proved when every approval step is a locked approval waiting for a person, no other step carries a
// sensitive category, and every step depends only on the step before it.
export function proveOption(steps) {
  return steps.every((s, i) => (s.kind === "approval"
    ? s.gate === "approval" && s.locked === true && s.status === "pending_approval" && MC_SENSITIVE.includes(s.category)
    : s.locked === false && !MC_SENSITIVE.includes(s.category)) && (i === 0 ? s.after === null : s.after === i - 1));
}

const OPTION_STEPS = {
  speed: [["tool", "step.read"], ["build", "step.slice"], ["gate", "step.tests"]],
  proof: [["tool", "step.read"], ["gate", "step.testsFirst"], ["build", "step.build"], ["gate", "step.tests"], ["gate", "step.mutation"], ["gate", "step.contrast"]],
  selfhost: [["tool", "step.read"], ["build", "step.local"], ["gate", "step.tests"], ["gate", "step.security"], ["tool", "step.export"]],
};
export function buildOption(id, cats, lang) {
  const steps = OPTION_STEPS[id].map(([kind, key]) => ({ kind, title: mcText(key, lang), category: null, gate: kind === "gate" ? "check" : null, locked: false, status: "ready" }));
  for (const cat of cats) steps.push({ kind: "approval", title: mcText("step.approval", lang, { list: mcText("cat." + cat, lang) }), category: cat, gate: "approval", locked: true, status: "pending_approval" });
  steps.forEach((s, i) => { s.after = i === 0 ? null : i - 1; });
  return { id, title: mcText("opt." + id, lang), tag: "[INFERENCE]", steps, counts: { steps: steps.length, gates: steps.filter(s => s.kind === "gate").length, approvals: steps.filter(s => s.kind === "approval").length }, proved: proveOption(steps) };
}

export function compileMetacodes(req) {
  const r = req && typeof req === "object" ? req : {};
  const lang = r.lang === "ar" ? "ar" : "en";
  const parsed = parseMetacodes(r.prompt);
  const pressed = Array.isArray(r.codes) ? r.codes.filter(c => typeof c === "string").map(c => c.toUpperCase()).filter(c => METACODES.includes(c)) : [];
  const active = METACODES.filter(c => parsed.codes.includes(c) || pressed.includes(c));
  const codes = active.length ? active : ["ALT3"];
  let secrets = 0;
  const prompt = parsed.prompt.replace(MC_SECRET, () => { secrets++; return "[redacted]"; });
  const words = prompt ? prompt.split(" ").length : 0;
  const clauses = prompt ? prompt.split(/[.;!?،؛]|\bthen\b|ثم/i).filter(c => c.split(" ").join("").length > 0).length : 0;
  const cats = sensitiveCategories(prompt);
  const urls = (prompt.match(MC_URL) || []).slice(0, MC_LIMITS.urls);
  const refused = urls.filter(privateHost), allowed = urls.filter(u => !privateHost(u));
  const colours = (prompt.match(MC_HEX) || []).slice(0, 2);
  const options = (codes.includes("ALT3") ? ["speed", "proof", "selfhost"] : ["selfhost"]).map(id => buildOption(id, cats, lang));
  const catNames = cats.map(c => mcText("cat." + c, lang));
  const out = { codes, lang, prompt, options };
  if (codes.includes("KILLCRITIC")) {
    const f = [];
    f.push(cats.length ? { level: "high", text: mcText("crit.locks", lang), data: catNames } : { level: "ok", text: mcText("crit.nolocks", lang), data: [] });
    if (secrets) f.push({ level: "high", text: mcText("crit.secret", lang), data: [String(secrets)] });
    if (refused.length) f.push({ level: "high", text: mcText("crit.private", lang), data: refused });
    if (allowed.length) f.push({ level: "low", text: mcText("crit.public", lang), data: allowed });
    if (/gradient|تدرج/i.test(prompt)) f.push({ level: "medium", text: mcText("crit.gradient", lang), data: [] });
    if (colours.length === 2) {
      const h = healOklchContrast(colours[0], colours[1]);
      if (!h.ok) f.push({ level: "high", text: mcText("crit.contrastNo", lang), data: [colours[0] + " / " + colours[1]] });
      else if (!h.changed) f.push({ level: "ok", text: mcText("crit.contrastOk", lang), data: [colours[0] + " / " + colours[1], "WCAG " + h.before.ratio, "APCA Lc " + h.before.lc] });
      else f.push({ level: "high", text: mcText("crit.contrastHeal", lang), data: [colours[0] + " → " + h.after.hex, "WCAG " + h.before.ratio + " → " + h.after.ratio, "APCA Lc " + h.before.lc + " → " + h.after.lc] });
    }
    f.push({ level: "manual", text: mcText("crit.manual", lang), data: [] });
    out.critic = f;
  }
  if (codes.includes("X10THINK")) {
    out.stages = [
      { text: mcText("x10.assume", lang), data: ["words " + words, "clauses " + clauses, "urls " + urls.length, "colours " + colours.length].concat(catNames) },
      { text: mcText("x10.model", lang), data: options.map(o => o.id + " " + o.counts.steps) },
      { text: mcText("x10.check", lang), data: options.map(o => o.id + " " + (o.proved ? "proved" : "not proved")) },
      { text: mcText("x10.edge", lang), data: [parsed.truncated ? "cut at " + MC_LIMITS.chars : "not cut", "refused " + refused.length, "secrets removed " + secrets].concat(prompt ? [] : [mcText("empty", lang)]) },
    ];
  }
  if (codes.includes("EL10")) out.plain = options.map(o => mcText("el10." + o.id, lang));
  if (codes.includes("/HUMAN")) {
    out.human = [prompt ? mcText("human.asked", lang, { n: Math.max(1, clauses) }) : mcText("empty", lang),
      cats.length ? mcText("human.locks", lang, { n: cats.length, list: joinList(catNames, lang) }) : mcText("human.nolocks", lang),
      mcText("human.plans", lang, { list: joinList(options.map(o => String(o.counts.steps)), lang) }), mcText("human.end", lang)].join(" ");
  }
  out.verified = options.every(o => o.proved);
  out.sha256 = sha256Hex(JSON.stringify(out));
  return out;
}
