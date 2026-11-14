// ADR-162: the skill tree. The repository's skills drawn as one tree, from a snapshot that
// .claude/skills/replica-skill-tree/skill_tree.py reads out of the repository (jarvis/app/data/skill-tree-input.json):
//   roots    the rules and the core engines everything stands on (AGENTS.md, DESIGN.md, the locks, the prover,
//            the Merkle log, the privacy shield, the contrast healer)
//   trunk    the engines that join the others (the workbench, the polymath engine, the universal agent)
//   branches three families: Jarvis skills (replica-*), OMEGA skills and vendored references
//   leaves   each skill's tools, with their function counts
// Each skill's state comes from facts in the snapshot only: its scan, its tests, its golden file and its mutation
// run. composeSkills joins chosen skills: their path to the roots, the commands that test them, and the trunk engine
// that already runs them together. Pure: no network, no process, no file. Same answers in Python (tests/golden.json).

export const ST_ROOTS = [
  { id: "root:agents", label: "AGENTS.md", note: "Who decides, honesty, security and the checks before a commit", file: "AGENTS.md" },
  { id: "root:design", label: "DESIGN.md", note: "OKLCH tokens, contrast, three sizes, no gradients", file: "DESIGN.md" },
  { id: "root:locks", label: "Approval locks", note: "Money, publishing, permissions, installs and outbound calls wait for Director 00", file: "AGENTS.md" },
  { id: "root:prover", label: "State prover", note: "No deadlock and no effect without a locked approval", adr: "ADR-145", skill: "replica-formal-verify" },
  { id: "root:merkle", label: "Merkle audit", note: "RFC 6962 log of sensitive events", adr: "ADR-147", skill: null },
  { id: "root:shield", label: "Privacy shield", note: "Keys and personal data replaced before anything reads them", adr: "ADR-158", skill: "replica-foss-atlas" },
  { id: "root:contrast", label: "Contrast healer", note: "WCAG 4.5 and APCA Lc 60 by OKLCH bisection", adr: "ADR-153", skill: "replica-reversal-engine" },
];
export const ST_TRUNK = [
  { id: "trunk:workbench", label: "Workbench", adr: "ADR-160", route: "#/workbench", skill: "replica-unified-workbench",
    joins: ["replica-foss-atlas", "replica-prompt-metacodes", "replica-universal-agent", "replica-reversal-engine", "replica-universal-math"] },
  { id: "trunk:polymath", label: "Polymath", adr: "ADR-161", route: "#/polymath", skill: "replica-polymath-engine",
    joins: ["replica-foss-atlas", "replica-universal-math", "replica-timeseries-math", "replica-hyper-studio", "replica-universal-agent", "replica-reversal-engine"] },
  { id: "trunk:universal", label: "Universal agent", adr: "ADR-159", route: "#/universal", skill: "replica-universal-agent",
    joins: ["replica-reversal-engine", "replica-formal-verify"] },
];
export const ST_OMEGA = ["omega-design", "omega-finance-chain", "omega-extend", "omega-apex-council", "omega-deep-research-agent", "omega-knowledge-domain", "apple-liquid-glass-hig",
  "osint-bgp-cables", "quant-microstructure-gex", "synaptic-spiderweb-viz", "safe-vault-cryptographic-ratchet", "neural-flow-decision-viz", "supreme-software-ui-architect",
  "cyber-space-osint-grid", "liquid-neural-139-flow", "autonomous-24-selftest-gate", "stablecoin-cyber-vuln-intel", "neural-139-inputs-heads", "local-glm-agent-windows-mcp"];
export const ST_FAMILIES = [
  { id: "family:vendored", label: "Vendored references", angle: -58 },
  { id: "family:jarvis", label: "Jarvis skills", angle: 0 },
  { id: "family:omega", label: "OMEGA skills", angle: 58 },
];
export const ST_ROUTES = { "replica-universal-math": "#/math", "replica-hyper-studio": "#/hyper", "replica-foss-atlas": "#/atlas", "replica-universal-agent": "#/universal",
  "replica-unified-workbench": "#/workbench", "replica-polymath-engine": "#/polymath", "replica-passive-recon": "#/recon", "replica-prompt-metacodes": "#/missions",
  "replica-reversal-engine": "#/studio", "replica-formal-verify": "#/missions", "replica-graphify": "#/governance", "replica-impeccable": "#/governance",
  "replica-timeseries-math": "#/diagnostics", "replica-design": "#/studio" };
export class TreeError extends Error { constructor(message, detail) { super(message); this.status = 400; if (detail !== undefined) this.detail = String(detail).slice(0, 80); } }
const stFail = (m, d) => { throw new TreeError(m, d); };
function stR(v) { return Math.round(v * 10) / 10; }

export function familyOf(name) { return name.startsWith("replica-") ? "family:jarvis" : ST_OMEGA.includes(name) ? "family:omega" : "family:vendored"; }
// The state of one skill, from facts only.
export function statusOf(s, family) {
  if (s.scan.critical + s.scan.high > 0) return "attention";
  if (s.mutation && s.mutation.killed === s.mutation.mutants && s.golden) return "proved";
  if (s.tests) return "tested";
  return family === "family:vendored" ? "reference" : "rules";
}

function checkInput(input) {
  const r = input && typeof input === "object" && !Array.isArray(input) ? input : stFail("Send the snapshot object.", "");
  const skills = Array.isArray(r.skills) && r.skills.length <= 200 ? r.skills : stFail("skills is a list of at most 200.", "skills");
  const seen = new Set();
  for (const [i, s] of skills.entries()) {
    if (!s || typeof s.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.name)) stFail("Each skill needs a name of lower-case letters, digits and hyphens.", "skills[" + i + "]");
    if (seen.has(s.name)) stFail("Each skill appears once.", s.name);
    seen.add(s.name);
    if (!Array.isArray(s.tools) || s.tools.length > 40 || !s.tools.every(t => t && typeof t.name === "string" && Number.isInteger(t.functions) && t.functions >= 0)) stFail("tools is a list of at most 40 {name, functions}.", s.name);
    if (!s.scan || !["critical", "high", "medium", "low"].every(k => Number.isInteger(s.scan[k]) && s.scan[k] >= 0)) stFail("scan counts critical, high, medium and low.", s.name);
    if (s.mutation !== null && !(s.mutation && Number.isInteger(s.mutation.killed) && Number.isInteger(s.mutation.mutants) && s.mutation.killed >= 0 && s.mutation.killed <= s.mutation.mutants)) stFail("mutation is null or {killed, mutants} with killed at most mutants.", s.name);
  }
  return skills;
}

export function buildTree(input) {
  const skills = checkInput(input).slice().sort((a, b) => (a.name < b.name ? -1 : 1));
  const nodes = [], edges = [];
  const W = 1400, CX = 700, GROUND = 640;
  ST_ROOTS.forEach((r, i) => {
    const t = i / (ST_ROOTS.length - 1);
    nodes.push({ ...r, kind: "root", x: stR(120 + t * (W - 240)), y: stR(GROUND + 70 + 60 * Math.sin(Math.PI * t)) });
    edges.push({ from: r.id, to: ST_TRUNK[0].id, kind: "feeds" });
  });
  ST_TRUNK.forEach((t, i) => {
    nodes.push({ ...t, kind: "trunk", x: CX, y: GROUND - 40 - i * 80 });
    if (i) edges.push({ from: ST_TRUNK[i - 1].id, to: t.id, kind: "trunk" });
  });
  const crown = { x: CX, y: GROUND - 40 - (ST_TRUNK.length - 1) * 80 };
  const counts = { skills: skills.length, tools: 0, status: { proved: 0, tested: 0, rules: 0, reference: 0, attention: 0 }, family: {} };
  const mutation = { killed: 0, mutants: 0 };
  for (const f of ST_FAMILIES) {
    const a = f.angle * Math.PI / 180;
    const fx = stR(crown.x + 150 * Math.sin(a)), fy = stR(crown.y - 110 * Math.cos(a));
    nodes.push({ id: f.id, kind: "family", label: f.label, x: fx, y: fy });
    edges.push({ from: ST_TRUNK[ST_TRUNK.length - 1].id, to: f.id, kind: "branch" });
    const mine = skills.filter(s => familyOf(s.name) === f.id);
    counts.family[f.id] = mine.length;
    mine.forEach((s, i) => {
      const spread = mine.length === 1 ? 0 : (i / (mine.length - 1) - 0.5) * 54;
      const b = (f.angle + spread) * Math.PI / 180, radius = 250 + (i % 4) * 55;
      const x = stR(crown.x + radius * Math.sin(b)), y = stR(crown.y - radius * 0.86 * Math.cos(b));
      const status = statusOf(s, f.id);
      counts.status[status] += 1;
      if (s.mutation) { mutation.killed += s.mutation.killed; mutation.mutants += s.mutation.mutants; }
      nodes.push({ id: "skill:" + s.name, kind: "skill", label: s.name, family: f.id, status, x, y, description: typeof s.description === "string" ? s.description.slice(0, 200) : "",
        tools: s.tools.length, scan: s.scan, tests: s.tests === true, golden: s.golden === true, mutation: s.mutation, review: typeof s.review === "string" ? s.review : null, route: ST_ROUTES[s.name] ?? null });
      edges.push({ from: f.id, to: "skill:" + s.name, kind: "branch" });
      s.tools.forEach((t, k) => {
        const c = (k + 1) * 2 * Math.PI / (s.tools.length + 1) + b;
        nodes.push({ id: "tool:" + s.name + "/" + t.name, kind: "tool", label: t.name, skill: s.name, functions: t.functions, x: stR(x + 22 * Math.sin(c)), y: stR(y - 22 * Math.cos(c)) });
        edges.push({ from: "skill:" + s.name, to: "tool:" + s.name + "/" + t.name, kind: "leaf" });
        counts.tools += 1;
      });
    });
  }
  return { nodes, edges, counts, mutation, view: { width: W, height: 860, ground: GROUND } };
}

// Chosen skills joined: each one's path down to the roots, the commands that test it, and the trunk engine that
// already runs all of them together, if there is one.
export function composeSkills(input, names) {
  const tree = buildTree(input);
  const pick = Array.isArray(names) && names.length >= 1 && names.length <= 12 ? names : stFail("Choose 1 to 12 skills.", "names");
  const byName = new Map(tree.nodes.filter(n => n.kind === "skill").map(n => [n.label, n]));
  const chosen = [...new Set(pick)].map(n => byName.get(n) || stFail("That skill is not in the tree.", typeof n === "string" ? n : ""));
  const steps = chosen.map(n => ({
    skill: n.label, status: n.status,
    path: [n.id, n.family, ...ST_TRUNK.slice().reverse().map(t => t.id), "root:locks"],
    command: n.family === "family:vendored" ? null : n.tests ? "python3 -m unittest discover -s .claude/skills/" + n.label + "/tests" : null,
    note: n.family === "family:vendored" ? "Reference only: its scripts are not run on Ahmad's machine without a review." : n.tests ? null : "Text rules only: read its SKILL.md.",
  }));
  const names2 = chosen.map(n => n.label);
  const joined = ST_TRUNK.filter(t => names2.every(n => t.joins.includes(n) || t.skill === n)).map(t => ({ id: t.id, label: t.label, route: t.route }));
  return { chosen: names2, steps, joined_by: joined, attention: chosen.filter(n => n.status === "attention").map(n => n.label),
    ready: chosen.every(n => n.status === "proved" || n.status === "tested") };
}

export function skillTree(req) {
  const r = req && typeof req === "object" && !Array.isArray(req) ? req : stFail("Send an object.", "");
  if (r.mode === "compose") return { mode: "compose", ...composeSkills(r.input, r.names) };
  if (r.mode === "tree") return { mode: "tree", ...buildTree(r.input) };
  return stFail("Choose a mode: tree or compose.", typeof r.mode === "string" ? r.mode : "");
}
