// The council (ADR-144): three roles debate a plan or a design on the local model bridge (127.0.0.1 only),
// or on the fixed rules when no model runs. Every model answer is untrusted text.
//   1. Architect: proposes. A plan comes from the planner model (DeepSeek-R1 family by default); a design
//      from the designer model, through the clean-room extractor.
//   2. Red team and UX critic: fixed rules check the proposal. For a plan: steps the architect left unlocked
//      that the rules lock (AGENTS.md §1), private or loopback addresses in a step (SSRF), a publish step
//      with no test gate before it, too many steps. For a design: navigation and calls to action against
//      Hick's law, a missing title. When a model runs, its own critique is added as a note, labelled
//      untrusted; it changes nothing.
//   3. Synthesizer: repairs what the critic found (adds a test gate before publishing, trims choices) and,
//      when a model runs, may rewrite the plan (Qwen2.5-Coder family by default). Its answer is then passed
//      through enforceApprovalGates once more.
// Whatever the three agree on, the last word is the rule: a step that moves money, publishes, changes
// permissions, installs or sends outside is { kind: "approval", gate: "approval", locked: true,
// status: "pending_approval" }, and as a mission the database refuses to mark it done
// (mission_steps_locked_never_done).
import { enforceApprovalGates, parsePlanJson } from "./llm-plan.mjs";
import { isLocalModelEngine } from "./ollama-bridge.mjs";
import { isBlockedAddress } from "./fetch-public.mjs";
import net from "node:net";

const PRIVATE_HOST = /\b(localhost|0\.0\.0\.0|metadata\.google\.internal)\b|\[(::1?|::ffff:[0-9a-f:.]+|f[cd][0-9a-f:]*)\]/i;
const ip4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g;

export function privateTargets(text) {
  const s = String(text || "");
  const hits = new Set();
  if (PRIVATE_HOST.test(s)) hits.add((PRIVATE_HOST.exec(s) || [""])[0]);
  for (const m of s.matchAll(ip4)) if (net.isIPv4(m[1]) && isBlockedAddress(m[1])) hits.add(m[1]);
  return [...hits];
}

// Red team and UX critic for a plan: raw is what the architect proposed, final what the rules make of it.
export function critiquePlan(raw, final) {
  const findings = [];
  (raw || []).forEach((s, i) => {
    const f = final[i];
    if (f && f.locked && !(s && (s.locked === true || String(s.gate || "").toLowerCase() === "approval"))) findings.push({ severity: "high", rule: "LOCK", step: i, text: "“" + f.title + "” was proposed unlocked; it is " + (f.why || "locked by rule") + " (AGENTS.md §1)." });
    const pt = privateTargets([s && s.title, s && s.description].join(" "));
    if (pt.length) findings.push({ severity: "high", rule: "SSRF", step: i, text: "“" + (f ? f.title : "step " + (i + 1)) + "” points at a private or loopback address (" + pt.join(", ") + ")." });
  });
  const firstLocked = final.findIndex(s => s.locked && s.category === "publish");
  if (firstLocked >= 0 && !final.slice(0, firstLocked).some(s => s.kind === "gate" && /tdd|test/i.test(s.why + " " + s.title))) findings.push({ severity: "medium", rule: "GATE", step: firstLocked, text: "Publishing comes with no test gate before it." });
  if ((raw || []).length > 12) findings.push({ severity: "low", rule: "SIZE", step: null, text: "More than 12 steps; the plan was cut to 12." });
  return findings;
}

// Red team and UX critic for a design (blocks from the clean-room extractor).
export function critiqueDesign(blocks) {
  const findings = [];
  const nav = blocks.find(b => b.type === "nav");
  const links = nav ? String((nav.t && nav.t.en && nav.t.en.links) || "").split(/[,،]/).filter(x => x.trim()).length : 0;
  if (links > 7) findings.push({ severity: "medium", rule: "HICK", text: "The navigation offers " + links + " choices; Hick's law favours 7 or fewer." });
  const ctas = blocks.filter(b => b.type === "cta" || (b.type === "hero" && b.t && b.t.en && b.t.en.primary)).length;
  if (ctas > 3) findings.push({ severity: "low", rule: "HICK", text: ctas + " calls to action compete for the same click." });
  if (!blocks.some(b => b.type === "hero")) findings.push({ severity: "medium", rule: "TITLE", text: "No hero with a page title." });
  if (blocks.length > 10) findings.push({ severity: "low", rule: "LENGTH", text: blocks.length + " sections; long pages lose readers [INFERENCE]." });
  return findings;
}

// The synthesizer's fixed repairs; the model's rewrite (if any) is applied before these and re-locked after.
export function repairPlan(final) {
  const out = final.slice();
  const i = out.findIndex(s => s.locked && s.category === "publish");
  if (i >= 0 && !out.slice(0, i).some(s => s.kind === "gate" && /tdd|test/i.test(s.why + " " + s.title))) {
    // Insert a test gate before the first publish step; later steps' needs shift by one, and publishing needs the gate.
    const gate = { ...enforceApprovalGates([{ title: "Run the tests before publishing", gate: "tdd", phase: out[i].phase }])[0], depends: [] };
    for (let j = i; j < out.length; j++) out[j] = { ...out[j], depends: (out[j].depends || []).map(d => (d >= i ? d + 1 : d)) };
    out.splice(i, 0, gate);
    out[i + 1] = { ...out[i + 1], depends: [...new Set([...(out[i + 1].depends || []), i])] };
  }
  return out.slice(0, 12).map((s, k) => ({ ...s, depends: (s.depends || []).filter(d => d < k) })).map(s => (s.locked ? { ...s, gate: "approval", status: "pending_approval" } : s));
}

export async function runCouncil(llm, { mode = "plan", prompt, lang = "en" }) {
  const p = String(prompt || "").trim();
  if (!p) throw Object.assign(new Error("Write what the council should plan or design."), { status: 400 });
  if (p.length > 4000) throw Object.assign(new Error("Keep it under 4,000 characters."), { status: 400 });
  if (!["plan", "design"].includes(mode)) throw Object.assign(new Error("The council plans or designs."), { status: 400 });
  const st = await llm.status();
  const trace = [];
  // 1. Architect
  const a = await llm.run({ mode, prompt: p, lang, model: mode === "plan" ? st.planModel || undefined : st.designModel || undefined });
  const modelRan = isLocalModelEngine(a.engine);
  trace.push({ role: "architect", engine: a.engine, model: a.model, label: a.label, thinking: a.thinking || null,
    proposal: mode === "plan" ? (a.rawSteps || a.steps).map(s => ({ title: String(s.title || s).slice(0, 160), locked: s.locked === true, gate: s.gate || null })) : a.blocks.map(b => b.type) });
  if (mode === "design") {
    const findings = critiqueDesign(a.blocks);
    const blocks = a.blocks.map(b => b.type === "nav" && b.t && b.t.en && b.t.en.links ? { ...b, t: { ...b.t, en: { ...b.t.en, links: b.t.en.links.split(/[,،]/).slice(0, 7).join(",") } } } : b);
    trace.push({ role: "critic", engine: "rules", findings });
    trace.push({ role: "synthesizer", engine: "rules", changes: findings.filter(f => f.rule === "HICK").length ? ["Navigation trimmed to 7 choices."] : [] });
    return { mode, prompt: p, trace, final: { blocks, report: a.report }, locksHold: true, modelRan };
  }
  // 2. Red team and UX critic
  const final0 = a.steps;
  const findings = critiquePlan(a.rawSteps || a.steps, final0);
  let opinion = null;
  if (modelRan) {
    const c = await llm.run({ mode: "chat", lang, prompt: "Review this plan for risks in two or three short sentences. Plan:\n" + final0.map((s, i) => `${i + 1}. ${s.title}`).join("\n") });
    if (isLocalModelEngine(c.engine)) opinion = { model: c.model, text: String(c.text || "").slice(0, 1200), label: "[INFERENCE - local LLM] [UNTRUSTED_MODEL_OUTPUT]" };
  }
  trace.push({ role: "critic", engine: "rules" + (opinion ? " + " + opinion.model : ""), findings, opinion });
  // 3. Synthesizer
  let merged = final0, rewrite = null;
  if (modelRan && findings.length) {
    const s = await llm.run({ mode: "plan", lang, prompt: "Fix this plan for: " + findings.map(f => f.text).join(" ") + "\nGoal: " + p, model: st.designModel || undefined });
    const raw = s.rawSteps || parsePlanJson("");
    if (isLocalModelEngine(s.engine) && raw && raw.length) { merged = enforceApprovalGates(raw); rewrite = { model: s.model, steps: raw.length }; }
  }
  const final = repairPlan(merged);
  const changes = [];
  if (rewrite) changes.push("The model rewrote the plan (" + rewrite.steps + " steps); the rules locked it again.");
  if (final.length > merged.length) changes.push("Added a test gate before publishing.");
  const locked = final.filter(s => s.locked);
  if (locked.length) changes.push(locked.length + " step" + (locked.length > 1 ? "s wait" : " waits") + " for Director 00 (pending approval).");
  trace.push({ role: "synthesizer", engine: rewrite ? "rules + " + rewrite.model : "rules", changes });
  return { mode, prompt: p, trace, final: { steps: final }, locked: locked.map(s => ({ title: s.title, category: s.category, status: s.status })), locksHold: final.every(s => !s.category || !["money", "publish", "permissions", "install", "outbound"].includes(s.category) || (s.locked && s.status === "pending_approval")), modelRan };
}
