// ADR-170: the architect studio. Four deterministic tools over engines that already exist:
//   seal     a domain-separated SHA-256 of the architect's code, NFC-normalised:
//            SHA-256("aether-prime:architect-seal:v1:" + code). It is compared with the seal the server holds
//            (JARVIS_ARCHITECT_SEAL) or, in the file page, the one this browser saved; a seal in the request is never
//            used. Only the first five characters are shown. With no seal set up, the full hash is returned once so
//            the person can save it. The code itself is never stored.
//   ui       the studio's preview scale: body text from 90 to 120 percent with a 12 px floor (DESIGN.md), spacing
//            on the 4/8 scale with concentric radii, and tabular or proportional numerals in the preview only.
//            Colours do not change, so the contrast gate's result stands. Needs the seal.
//   compose  a composite skill draft: Kahn's order of the chosen skills (plan order, ADR-163) and the release
//            bundle (ADR-169) through impact analysis (ADR-168), written as a SKILL.md draft. Writing it to disk
//            stays a locked approval. Needs the seal.
//   radar    the skills still in "text rules" or "tested", most depended on first, with what each needs next,
//            and the catalog families whose documented licence allows serving them to others.
// The engines called here keep their own checks. Pure: no network, no process, no file. The same answers come
// from .claude/skills/replica-architect-studio/architect_studio.py (tests/golden.json).
import { sha256Hex } from "./snapshot.mjs";
import { skillOrder } from "./plan-order.mjs";
import { buildTree } from "./skill-tree.mjs";
import { dependentsOf, licenceRule } from "./impact-analysis.mjs";
import { releaseGate } from "./release-gate.mjs";

export const AS_MODES = ["seal", "ui", "compose", "radar"];
export const AS_SEAL_DOMAIN = "aether-prime:architect-seal:v1:";
export const AS_DENSITY = { compact: 4, balanced: 8, spacious: 12 };
export const AS_NUMERALS = { tabular: "tabular-nums slashed-zero", proportional: "proportional-nums slashed-zero" };
// DESIGN.md's type scale in px; nothing goes below 12 px.
export const AS_TYPE = { body: 15, headline: 17, footnote: 13, caption: 12 };
export const AS_LOCKS = ["install", "outbound", "model", "publish"];
export class ArchitectError extends Error { constructor(message, detail, status) { super(message); this.status = status ?? 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const asFail = (m, d, s) => { throw new ArchitectError(m, d, s); };
function asR(v) { return Math.round(v * 100) / 100; }

export function sealHash(code) {
  return sha256Hex(AS_SEAL_DOMAIN + code.normalize("NFC"));
}

// The seal's state. The expected seal comes from the server or this browser, never from the request.
export function checkSeal(r, expected) {
  const code = r.passcode === undefined ? "" : typeof r.passcode === "string" && r.passcode.length <= 200 && r.passcode.isWellFormed() ? r.passcode : asFail("The architect code is well-formed text of at most 200 characters.", "passcode");
  const configured = typeof expected === "string" && /^[0-9a-f]{64}$/.test(expected);
  const hash = code ? sealHash(code) : null;
  const unlocked = configured && hash === expected;
  return { configured, unlocked, state: !configured ? "not_configured" : unlocked ? "unlocked" : "locked", audit_prefix: hash && hash.slice(0, 5), hash };
}

function locks() { return AS_LOCKS.map(action => ({ action, gate: "approval", locked: true, status: "pending_approval" })); }
function needSeal(s) { if (!s.unlocked) asFail("The architect seal is needed: the studio is read only.", "seal", 403); }

export function uiTokens(r) {
  const scale = Number.isInteger(r.font_scale) && r.font_scale >= 90 && r.font_scale <= 120 ? r.font_scale : asFail("The font scale is a whole number from 90 to 120.", "font_scale");
  const unit = Object.hasOwn(AS_DENSITY, r.density) ? AS_DENSITY[r.density] : asFail("The density is compact, balanced or spacious.", "density");
  const numerals = Object.hasOwn(AS_NUMERALS, r.numerals) ? AS_NUMERALS[r.numerals] : asFail("The numerals are tabular or proportional.", "numerals");
  const px = Object.fromEntries(Object.entries(AS_TYPE).map(([k, v]) => [k, Math.max(12, asR(v * scale / 100))]));
  const pad = unit * 2, inner = 12;
  const css = { "--as-body": px.body + "px", "--as-headline": px.headline + "px", "--as-footnote": px.footnote + "px", "--as-caption": px.caption + "px",
    "--as-gap": unit + "px", "--as-pad": pad + "px", "--as-radius-inner": inner + "px", "--as-radius-outer": inner + pad + "px", "--as-numerals": numerals };
  return { font_scale: scale, density: r.density, numerals: r.numerals, px, css, colours_changed: false, config_sha256: sha256Hex(JSON.stringify(css)) };
}

// A composite skill's SKILL.md draft, from the facts the engines gave.
export function skillDraft(name, description, order, bundle) {
  const lines = ["---", "name: " + name, "description: " + description, "---", "", "# " + name, "",
    "A composite of " + order.chosen.length + " skills, drafted by the architect studio (ADR-170). Review it before it is written anywhere.", "", "## Skills in order (Kahn's layers)"];
  order.layers.forEach((l, i) => lines.push("- Layer " + (i + 1) + ": " + l.join(", ")));
  if (order.cycle.length) lines.push("", "## On a cycle, left out of the order", "- " + order.cycle.join(", "));
  lines.push("", "## Tests to run", "", "```bash", ...bundle.tests, ...bundle.shared_tests, "```", "", "## Pages it touches", ...(bundle.pages.length ? bundle.pages.map(p => "- " + p) : ["- none"]));
  if (bundle.model) lines.push("", "## Model", "- " + (bundle.model.family ? bundle.model.family.family : bundle.model.model) + ": " + bundle.model.verdict);
  return lines.join("\n") + "\n";
}

export function composeSkill(r, ctx) {
  const name = typeof r.name === "string" && /^[a-z0-9][a-z0-9-]{1,47}$/.test(r.name) ? r.name : asFail("The name is 2 to 48 lower-case letters, digits and hyphens.", "name");
  const description = typeof r.description === "string" && r.description.trim() && r.description.length <= 300 && !/[\r\n]/.test(r.description) ? r.description.trim() : asFail("The description is one line of 1 to 300 characters.", "description");
  const skills = Array.isArray(r.skills) && r.skills.length >= 2 ? r.skills : asFail("A composite joins 2 or more skills.", "skills");
  const bundle = releaseGate({ mode: "bundle", skills, ...Object.fromEntries(["model", "use", "bits", "memory_gb", "context_tokens", "batch_size", "kv_bits", "notes"].filter(k => r[k] !== undefined).map(k => [k, r[k]])) }, ctx);
  const order = skillOrder(ctx.deps, skills);
  const draft = skillDraft(name, description, order, bundle);
  return { name, order: { layers: order.layers, added: order.added, cycle: order.cycle, verified: order.verified }, bundle, draft, draft_sha256: sha256Hex(draft),
    steps: [{ action: "install", target: ".claude/skills/" + name + "/SKILL.md", gate: "approval", locked: true, status: "pending_approval" }, ...bundle.steps] };
}

// Skills still in "text rules" or "tested", most depended on first, then by name.
export function upgradeRadar(ctx) {
  const t = buildTree(ctx.tree);
  const deps = ctx.deps && typeof ctx.deps === "object" && !Array.isArray(ctx.deps) ? ctx.deps : {};
  const skills = t.nodes.filter(n => n.kind === "skill" && (n.status === "rules" || n.status === "tested"))
    .map(n => ({ skill: n.label, status: n.status, downstream: dependentsOf(deps, n.label).length, next: n.status === "tested" ? "golden_and_mutation" : "tests" }))
    .sort((a, b) => b.downstream - a.downstream || (a.skill < b.skill ? -1 : 1));
  const catalog = Array.isArray(ctx.catalog) ? ctx.catalog : [];
  const models = catalog.filter(f => ["allowed", "allowed_note"].includes(licenceRule(f.licence, "service", f.terms).verdict)).map(f => f.family).sort();
  return { skills, counts: { rules: skills.filter(s => s.status === "rules").length, tested: skills.filter(s => s.status === "tested").length }, models_for_service: models };
}

export function architectStudio(req, ctx) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : asFail("Send an object with a mode.", "");
  const c = ctx ?? {};
  const mode = AS_MODES.includes(r.mode) ? r.mode : asFail("The mode is seal, ui, compose or radar.", "mode");
  const s = checkSeal(r, c.seal);
  const seal = { configured: s.configured, unlocked: s.unlocked, state: s.state, audit_prefix: s.audit_prefix };
  const out = { mode, seal, locks: locks() };
  if (mode === "seal") out.setup = s.configured || !s.hash ? null : { seal_hash: s.hash, note: "Save this hash as the seal; the code itself is not kept." };
  if (mode === "ui" || mode === "compose") needSeal(s);
  if (mode === "ui") out.ui = uiTokens(r);
  if (mode === "compose") out.compose = composeSkill(r, c);
  if (mode === "radar") out.radar = upgradeRadar(c);
  const sections = [seal, out.setup ?? null, out.ui ?? null, out.compose ? out.compose.draft_sha256 : null, out.compose ? out.compose.bundle.chain_sha256 : null, out.radar ?? null, out.locks];
  return { ...out, chain_sha256: sections.reduce((h, x) => sha256Hex(h + sha256Hex(JSON.stringify(x))), "0".repeat(64)), sent: false };
}
