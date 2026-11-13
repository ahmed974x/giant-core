// Fixed rules around the local model (ADR-136). Everything a model says is untrusted data
// ([UNTRUSTED_MODEL_OUTPUT]): this file turns it into mission steps that Jarvis's own engine runs,
// and it never lets the model decide whether a step is locked. A step that mentions money,
// publishing, permissions, installing or an outbound message becomes a locked approval step whatever
// the model wrote ("locked": false included); the database rule mission_steps_locked_never_done is the
// last line behind it. Pure functions: no network, no files.

export const LOCKED_CATEGORIES = ["money", "publish", "permissions", "install", "outbound"];
const MAX_STEPS = 20, MAX_TITLE = 140;

// Words that lock a step, English and Arabic. Over-locking is the safe direction.
const LOCK_RULES = [
  ["money", /\b(pay|payment|billing|bill|invoice|price|pricing|subscription|refund|transfer|wallet|money|charge|stripe)\b|دفع|ادفع|فاتور|مال|سعر|أسعار|اشتراك|تحويل|محفظ/i],
  ["publish", /\b(publish|deploy|go live|production|release to|public site|launch)\b|نشر|انشر|إطلاق|اطلاق/i],
  ["permissions", /\b(permission|permissions|access|role|grant|admin|sudo|collaborator)\b|صلاحي/i],
  ["install", /\b(install|plugin|dependency|dependencies|npm i|pip install|add (a |the )?skill)\b|تثبيت|ثبت|ثبّت/i],
  ["outbound", /\b(e-?mail|send|message|webhook|tweet|slack|notify|outbound|external|post to)\b|أرسل|ارسل|إرسال|ارسال|بريد|رسالة|خارجي/i],
];
const GATE_RULES = [
  ["tests", /\b(tdd|test|tests|unit|e2e|spec)\b|اختبار/i],
  ["lint", /\b(lint|ruff|biome|eslint|format)\b/i],
  ["contrast", /\b(contrast|wcag|apca)\b|تباين/i],
  ["security", /\b(security|skillspector|audit|secret|cve|xss)\b|أمان|أمني/i],
];
const GATE_ALIASES = { tdd: "tests", tests: "tests", test: "tests", lint: "lint", contrast: "contrast", security: "security" };
const NOTE_RULE = /\b(save|write) (a |the )?(note|summary|report)\b|احفظ|ملخص/i;
const TOOL_RULES = [
  ["git.log", /\b(git|commit|commits|branch|history)\b|كومت|سجل التغيير/i],
  ["notes.read", /\bnotes?\b|ملاحظ/i],
  ["runs.read", /\b(past runs|run history|runs)\b/i],
];
// The saved evidence each gate reads (same files as the mission templates).
export const GATE_EVIDENCE = {
  tests: [{ check: "tests", evidence: "jarvis/replica/evidence/tests-server.log" }],
  lint: [{ check: "lint", evidence: "jarvis/replica/evidence/lint-long-horizon.log" }],
  contrast: [{ check: "contrast", evidence: "jarvis/replica/design/contrast-report.txt" }],
  security: [{ check: "security", evidence: "jarvis/app/data/skills-scan.json" }],
};

const clean = s => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

// <think>…</think> is the model's reasoning; it is shown apart from the answer and never parsed.
export function splitThinking(raw) {
  const text = String(raw || "");
  const parts = [...text.matchAll(/<think>([\s\S]*?)<\/think>/gi)].map(m => m[1].trim());
  const open = /<think>([\s\S]*)$/i.exec(text.replace(/<think>[\s\S]*?<\/think>/gi, ""));
  if (open) parts.push(open[1].trim());
  const content = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();
  return { thinking: parts.length ? parts.join("\n\n").slice(0, 16000) : null, content: content.slice(0, 64000) };
}

// The first JSON object in the answer that has a steps array (models often wrap it in ``` fences).
export function parsePlanJson(content) {
  const text = String(content || "");
  const candidates = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(text))) candidates.push(m[1]);
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try { const j = JSON.parse(c); if (j && Array.isArray(j.steps)) return j.steps; } catch (e) { /* try the next */ }
  }
  return null;
}

export function lockCategory(text) {
  for (const [cat, re] of LOCK_RULES) if (re.test(text)) return cat;
  return null;
}

// Turn raw steps (from a model or from the fixed-rule fallback) into the engine's step shape.
// Whatever a step claims about itself (locked, status, kind, category), the rules decide.
export function enforceApprovalGates(rawSteps) {
  const list = (Array.isArray(rawSteps) ? rawSteps : []).slice(0, MAX_STEPS);
  const out = list.map((s, i) => {
    const o = s && typeof s === "object" ? s : { title: s };
    const title = clean(o.title || o.name || o.description || "Step " + (i + 1)).slice(0, MAX_TITLE) || "Step " + (i + 1);
    const text = [title, clean(o.description), clean(o.kind), clean(o.category), clean(o.tool)].join(" ");
    const phase = Math.max(1, Math.min(10, Number.isInteger(Number(o.phase)) ? Number(o.phase) : 1));
    const declaredLocked = o.locked === true || String(o.gate || "").toLowerCase() === "approval";
    let cat = lockCategory(text) || (LOCKED_CATEGORIES.includes(String(o.category)) ? String(o.category) : null);
    if (!cat && declaredLocked) cat = "outbound"; // the model asked for a lock without saying why: keep it locked
    if (cat) return { phase, kind: "approval", title, category: cat, locked: true, why: "locked by rule: " + cat };
    if (NOTE_RULE.test(text)) return { phase, kind: "approval", title, category: "file_write", locked: false, why: "a note is written only after a person approves" };
    const gate = GATE_ALIASES[String(o.gate || "").toLowerCase()] || (GATE_RULES.find(([, re]) => re.test(text)) || [])[0];
    if (gate) return { phase, kind: "gate", title, criteria: GATE_EVIDENCE[gate], locked: false, why: "gate: " + gate };
    const tool = (TOOL_RULES.find(([, re]) => re.test(text)) || ["files.read"])[0];
    return { phase, kind: "tool", title, tool, input: tool === "files.read" ? { path: "docs/adr/ADR-13*" } : {}, locked: false, why: "read tool: " + tool };
  });
  // Needs: only earlier steps in the same or an earlier phase, so a plan can never deadlock.
  out.forEach((s, i) => {
    const raw = list[i] && Array.isArray(list[i].depends) ? list[i].depends : list[i] && Array.isArray(list[i].depends_on) ? list[i].depends_on : [];
    s.depends = [...new Set(raw.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d < i && out[d].phase <= s.phase))];
  });
  return out;
}

// No model: split the goal into clauses and run the same rules. Reads first, gates next, approvals last.
export function fallbackPlan(goal) {
  const clauses = clean(goal).split(/[.;\n،؛]|\bthen\b|\band then\b|ثم/i).map(clean).filter(c => c.length > 2).slice(0, 12);
  const steps = enforceApprovalGates(clauses.map(c => ({ title: c })));
  const order = { tool: 1, gate: 2, approval: 3 };
  steps.forEach(s => { s.phase = order[s.kind]; s.depends = []; });
  if (!steps.some(s => s.kind === "gate")) steps.push({ phase: 2, kind: "gate", title: "Security gate (SkillSpector)", criteria: GATE_EVIDENCE.security, locked: false, why: "every plan gets a security gate", depends: [] });
  if (!steps.some(s => s.kind === "tool")) steps.unshift({ phase: 1, kind: "tool", title: "Read the recent decision records", tool: "files.read", input: { path: "docs/adr/ADR-13*" }, locked: false, why: "every plan starts by reading", depends: [] });
  steps.sort((a, b) => a.phase - b.phase);
  return steps;
}
