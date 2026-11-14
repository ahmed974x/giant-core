// ADR-161: the polymath engine. One question across the repository's own deterministic engines, in five stages:
//   1 decompose  the privacy shield (ADR-158) cleans the question; fixed word rules [INFERENCE] and the person's
//                own choice name the domains; each domain runs its engine when its input is given:
//                math (ADR-154 solve), timeseries (ADR-147 analyse), optics (ADR-155 optics),
//                design (ADR-150 reversal with ADR-153 contrast), security (ADR-159 verdicts, ADR-158 atlas)
//   2 inversion  for each domain named, the fixed ways it fails and the gate in this repository that closes each
//   3 decision   a weighted decision matrix from the person's own options, criteria, scores and weights only
//   4 grounding  every claim names the domain that backs it; a claim whose domain did not run is not grounded,
//                and with no domain run at all the answer abstains (VeritasGraph's rule, taken as text)
//   5 merkle     an RFC 6962 Merkle root over the stages' records (ADR-147's tree)
// Pure: no network, no process, no file, no model. The same answers come from
// .claude/skills/replica-polymath-engine/polymath_engine.py (tests/golden.json).
import { leafHash, merkleRoot } from "./merkle-audit.mjs";
import { scrubPrivate, planFossStack } from "./foss-atlas.mjs";
import { solve as solveMath } from "./universal-math.mjs";
import { analyse } from "./timeseries.mjs";
import { optics } from "./hyper-studio.mjs";
import { universalAgent } from "./universal-agent.mjs";

export const PM_DOMAINS = ["math", "timeseries", "optics", "design", "security"];
export const PM_SOURCES = {
  math: { adr: "ADR-154", engine: "universal-math solve", route: "#/math" },
  timeseries: { adr: "ADR-147", engine: "timeseries analyse", route: "#/diagnostics" },
  optics: { adr: "ADR-155", engine: "hyper-studio optics", route: "#/hyper" },
  design: { adr: "ADR-150", engine: "reversal engine and contrast healer", route: "#/studio" },
  security: { adr: "ADR-159", engine: "security verdicts and FOSS atlas", route: "#/universal" },
};
// Fixed word rules: a domain is named when one of its words is in the cleaned question. [INFERENCE]
export const PM_WORDS = {
  math: /\b(equation|integral|derivative|root|matrix|prime|solve|calculus|bayes)\b|معادلة|تكامل|مشتقة|مصفوفة/i,
  timeseries: /\b(series|telemetry|welford|ewma|vpin|variance|anomal\w*|latency)\b|سلسلة زمنية|قياس/i,
  optics: /\b(lens|optics|focal|aperture|depth of field|camera|exposure)\b|عدسة|بصريات|كاميرا/i,
  design: /\b(css|colou?r|contrast|gradient|layout|design)\b|تصميم|تباين|لون/i,
  security: /\b(secret|key|token|vulnerab\w*|attack|install|audit|privacy|security)\b|أمن|ثغرة|سر|خصوصية/i,
};
// For each domain, the ways it fails and the gate here that closes each. Text rules, not measurements.
export const PM_INVERSION = {
  math: [["A root is reported where the function only changes sign at a pole.", "The solver names a pole when |f| stays large at the sign change (ADR-154)."],
    ["An answer is given without being checked.", "Every answer carries its own checks and [VERIFIED] only when all pass (ADR-154)."]],
  timeseries: [["Variance loses precision by cancellation on long series.", "Welford's running update (ADR-147)."],
    ["An early reading is flagged before there is a baseline.", "No z-score before 30 readings (ADR-147)."]],
  optics: [["The subject is placed inside the focal length.", "The optics engine refuses it (ADR-155)."],
    ["Depth of field is reported without a check.", "Near and far limits are checked against the harmonic mean (ADR-155)."]],
  design: [["A gradient or low-contrast text ships.", "The reversal engine makes one colour and the healer reaches WCAG 4.5 and APCA Lc 60 (ADR-150, ADR-153)."],
    ["A long word breaks the layout on a phone.", "overflow-wrap is added and three sizes are checked (ADR-150)."]],
  security: [["A secret reaches a model or a log.", "The privacy shield runs first, and logs keep counts only (ADR-158)."],
    ["A tool is installed or an outside service is called without review.", "Every install and outbound step is a locked approval (AGENTS.md section 1, ADR-141)."],
    ["A finding is confirmed by the person who found it.", "A finding needs an independent verifier (ADR-159)."]],
};
export class PolymathError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const pmFail = (m, d) => { throw new PolymathError(m, d); };
function pmR(v) { return Math.round(v * 10000) / 10000; }

function runDomain(id, input) {
  if (id === "math") { const m = solveMath(input); return { task: m.task, checks: m.checks.length, passed: m.checks.filter(c => c.ok).length, verified: m.verified }; }
  if (id === "timeseries") {
    if (!Array.isArray(input) || input.length < 2 || input.length > 5000 || !input.every(p => p && typeof p.t === "number" && typeof p.v === "number" && Number.isFinite(p.v))) pmFail("A series is 2 to 5000 points of numbers {t, v}.", "series");
    const a = analyse(input); return { n: a.n, mean: a.mean, sd: a.sd, ewma: a.ewma, anomalies: a.anomalies.length, vpin: a.vpin };
  }
  if (id === "optics") { const o = optics(input && typeof input === "object" ? input : {}); return { verified: o.verified, hyperfocal_m: o.depth_of_field.hyperfocal_m, near_m: o.depth_of_field.near_m, far_m: o.depth_of_field.far_m }; }
  if (id === "design") { const d = universalAgent({ mode: "design", css: input }); return { rules: d.rules, after_sha256: d.after_sha256, verified: d.verified }; }
  const out = {};
  if (input.candidates !== undefined) out.verdicts = universalAgent({ mode: "security", candidates: input.candidates }).counts;
  if (input.atlas !== undefined) { const a = planFossStack(input.atlas); out.atlas = { picks: a.picks.length, usd_per_year: a.savings ? a.savings.usd_per_year : null, verified: a.verified }; }
  return out;
}

// The weighted decision matrix: only the person's numbers. Weights are made to sum to 1; scores are 0 to 10.
export function decide(options, weights) {
  if (options === undefined && weights === undefined) return null;
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) pmFail("Weights are an object of criterion to a number of at least 0.", "weights");
  const crit = Object.keys(weights).sort();
  if (!crit.length || crit.length > 12 || !crit.every(c => typeof weights[c] === "number" && weights[c] >= 0 && Number.isFinite(weights[c]))) pmFail("Give 1 to 12 criteria, each with a weight of at least 0.", "weights");
  const total = crit.reduce((s, c) => s + weights[c], 0);
  if (!(total > 0)) pmFail("At least one weight must be above 0.", "weights");
  if (!Array.isArray(options) || options.length < 2 || options.length > 12) pmFail("Give 2 to 12 options to compare.", "options");
  const names = new Set();
  const rows = options.map((o, i) => {
    if (!o || typeof o.name !== "string" || !o.name || o.name.length > 80) pmFail("Each option needs a name of 1 to 80 characters.", "options[" + i + "]");
    if (names.has(o.name)) pmFail("Each option name appears once.", o.name);
    names.add(o.name);
    const s = o.scores && typeof o.scores === "object" ? o.scores : {};
    for (const c of crit) if (!(typeof s[c] === "number" && s[c] >= 0 && s[c] <= 10)) pmFail("Each option scores every criterion from 0 to 10.", o.name + "." + c);
    return { name: o.name, score: pmR(crit.reduce((sum, c) => sum + weights[c] * s[c], 0) / total) };
  });
  rows.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
  return { criteria: crit, weights: Object.fromEntries(crit.map(c => [c, pmR(weights[c] / total)])), ranked: rows, chosen: rows[0].score > rows[1].score ? rows[0].name : null, tag: "[INFERENCE]" };
}

export function runPolymath(req) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : pmFail("Send an object with a question.", "");
  const q = typeof r.question === "string" && r.question.trim() && r.question.length <= 4000 ? r.question : pmFail("The question is text of 1 to 4000 characters.", "question");
  const asked = r.domains === undefined ? [] : Array.isArray(r.domains) && r.domains.every(d => PM_DOMAINS.includes(d)) ? r.domains : pmFail("Domains are " + PM_DOMAINS.join(", ") + ".", "domains");
  const shield = scrubPrivate(q);
  const inputs = { math: r.math, timeseries: r.series, optics: r.optics, design: r.css, security: r.candidates === undefined && r.atlas === undefined ? undefined : { candidates: r.candidates, atlas: r.atlas } };
  const domains = PM_DOMAINS.map(id => {
    const why = asked.includes(id) ? "asked" : PM_WORDS[id].test(shield.text) ? "words" : inputs[id] !== undefined ? "input" : null;
    if (!why) return { id, status: "not_named", why: null, summary: null, source: PM_SOURCES[id] };
    if (inputs[id] === undefined) return { id, status: "needs_input", why, summary: null, source: PM_SOURCES[id] };
    try { return { id, status: "ok", why, summary: runDomain(id, inputs[id]), source: PM_SOURCES[id] }; } catch (e) {
      if (e.status !== 400) throw e;
      return { id, status: "error", why, summary: { error: e.message, detail: e.detail ?? null }, source: PM_SOURCES[id] };
    }
  });
  const named = domains.filter(d => d.status !== "not_named");
  const inversion = named.flatMap(d => PM_INVERSION[d.id].map(([failure, gate]) => ({ domain: d.id, failure, gate })));
  const decision = decide(r.options, r.weights);
  const ran = new Set(domains.filter(d => d.status === "ok").map(d => d.id));
  const claims = (r.claims === undefined ? [] : Array.isArray(r.claims) && r.claims.length <= 20 ? r.claims : pmFail("Give at most 20 claims.", "claims")).map((c, i) => {
    if (!c || typeof c.text !== "string" || !c.text || c.text.length > 300) pmFail("Each claim is text of 1 to 300 characters.", "claims[" + i + "]");
    const by = typeof c.source === "string" ? c.source : null;
    return { text: scrubPrivate(c.text).text, source: by, grounded: by !== null && ran.has(by) };
  });
  const grounding = { grounded: ran.size > 0 && claims.every(c => c.grounded), abstained: ran.size === 0, unknown_citations: claims.filter(c => !c.grounded).map(c => c.source),
    reason: ran.size === 0 ? "No domain engine ran on the person's input, so nothing here can answer the question." : claims.some(c => !c.grounded) ? "Some claims name a domain that did not run." : null };
  const records = [["shield", shield.total, shield.redactions.map(x => x.rule)], ...domains.map(d => [d.id, d.status, d.summary]), ["inversion", inversion.length], ["decision", decision], ["grounding", grounding]];
  const leaves = records.map(x => leafHash(JSON.stringify(x)));
  return { question: shield.text, replaced: shield.total, domains, inversion, decision, claims, grounding, merkle: { leaves: leaves.length, root: merkleRoot(leaves) }, sent: false };
}
