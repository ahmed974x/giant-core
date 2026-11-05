// Long-horizon missions for jarvis/server (ADR-135). A mission is ordered phases of steps:
//   tool      runs one of the runner's real tools (files.read, git.log, notes.read, runs.read)
//   gate      reads saved evidence (test logs, the contrast report, the SkillSpector scan) and passes
//             only when every check passes; it never runs a program
//   approval  asks a person; money, publish, permissions, install and outbound stay blocked for good
//             (the database refuses both approving them and marking their step done), while steps that
//             do not depend on them carry on
// Phases run in order, the steps of one phase in parallel. After each phase (every capsule_every
// phases) the mission saves a state capsule: SHA-256 over canonical JSON, chained by prev_hash, kept
// in an append-only table. Restore checks the whole chain first and refuses a broken one.
// Each mission also keeps the replica-long-horizon files (task_plan.md, findings.md, progress.md)
// under the workspace's data folder, so the skill's gate.py and capsule.py can read the same record.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { classify } from "./db.mjs";
import { LOCKED, StoreError } from "./store.mjs";

const ZERO = "0".repeat(64);
const iso = () => new Date().toISOString();
const bad = (msg, status = 400) => { throw new StoreError(status, msg); };
export const CHECKS = ["tests", "contrast", "security", "lint"];
const MISSION_TOOLS = ["files.read", "git.log", "notes.read", "runs.read"];
const TERMINAL = new Set(["done", "failed", "skipped"]);

// Stable JSON for hashing: keys sorted at every level, no spaces (same as lhcommon.canonical).
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
export const sha256 = s => createHash("sha256").update(s).digest("hex");
export function sealCapsule(c) {
  return sha256(canonical({ mission_id: c.mission_id, seq: c.seq, label: c.label, state: c.state, prev_hash: c.prev_hash, created_at: c.created_at }));
}

// Check a mission's whole capsule chain: sequence, prev_hash links and every hash.
export function verifyChain(list, missionId) {
  const problems = [];
  let prev = ZERO;
  list.forEach((c, i) => {
    if (c.seq !== i + 1) problems.push("#" + c.seq + ": sequence gap (expected #" + (i + 1) + ")");
    if (c.prev_hash !== prev) problems.push("#" + c.seq + ": prev_hash does not match the capsule before it");
    const again = sealCapsule({ mission_id: missionId, seq: c.seq, label: c.label, state: c.state, prev_hash: c.prev_hash, created_at: new Date(c.created_at).toISOString() });
    if (again !== c.hash) problems.push("#" + c.seq + ": hash does not match its content");
    prev = c.hash;
  });
  return { ok: problems.length === 0, count: list.length, problems, head: list.length ? list[list.length - 1].hash : ZERO };
}

// One evidence file judged by the same rules as replica-long-horizon/gate.py.
export function judge(check, text) {
  if (check === "tests") {
    const node = [...text.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
    if (node) { const p = Number(node[1]), f = Number(node[2]); return { ok: f === 0 && p > 0, detail: p + " passed, " + f + " failed" }; }
    const unit = /^Ran (\d+) tests? in/m.exec(text);
    if (unit) { const good = /^OK\b/m.test(text) && !/^FAILED/m.test(text); return { ok: good && Number(unit[1]) > 0, detail: "Ran " + unit[1] + " tests, " + (good ? "OK" : "FAILED") }; }
    return { ok: false, detail: "no test summary found" };
  }
  if (check === "contrast") {
    const fail = /^\s*FAIL\b/m.test(text);
    const sum = /(\d+) checks, (\d+) failing/.exec(text);
    const good = text.includes("All pairs pass") || /\b0 failing\b/.test(text);
    return { ok: good && !fail, detail: sum ? sum[1] + " checks, " + sum[2] + " failing" : good && !fail ? "all pairs pass" : "a pair fails or no summary line" };
  }
  if (check === "security") {
    let s;
    try { s = JSON.parse(text).summary; } catch (e) { return { ok: false, detail: "not a SkillSpector --json report" }; }
    if (!s) return { ok: false, detail: "not a SkillSpector --json report" };
    const c = Number(s.critical ?? -1), h = Number(s.high ?? -1);
    return { ok: c === 0 && h === 0, detail: "critical " + c + ", high " + h + (s.scanned != null ? ", " + s.scanned + " files" : "") };
  }
  if (check === "lint") {
    const errs = /^\s*(error|ERROR)\b/m.test(text);
    const good = /\b0 errors?\b|All checks passed!/.test(text);
    return { ok: good && !errs, detail: good && !errs ? "clean" : "errors found or no summary line" };
  }
  return { ok: false, detail: "unknown check" };
}

// Templates: fixed plans, one per kind of long task. Steps name their phase and the steps they need.
export const TEMPLATES = {
  "release-readiness": {
    title: "Release readiness for this branch", goal: "Prove the branch is ready for Director 00's review: commits read, gates green, note saved.",
    steps: [
      { phase: 1, kind: "tool", title: "Read the latest commits", tool: "git.log" },
      { phase: 1, kind: "tool", title: "Read the recent decision records", tool: "files.read", input: { path: "docs/adr/ADR-13*" } },
      { phase: 2, kind: "gate", title: "Security gate (SkillSpector)", criteria: [{ check: "security", evidence: "jarvis/app/data/skills-scan.json" }] },
      { phase: 2, kind: "gate", title: "Contrast gate (WCAG and APCA)", criteria: [{ check: "contrast", evidence: "jarvis/replica/design/contrast-report.txt" }] },
      { phase: 2, kind: "gate", title: "Tests gate (server, app, live, skill)", criteria: [{ check: "tests", evidence: "jarvis/replica/evidence/tests-server.log" }, { check: "tests", evidence: "jarvis/replica/evidence/tests-app.log" }, { check: "tests", evidence: "jarvis/replica/evidence/tests-live.log" }, { check: "tests", evidence: "jarvis/replica/evidence/tests-long-horizon.log" }] },
      { phase: 2, kind: "gate", title: "Lint gate (ruff on the skill)", criteria: [{ check: "lint", evidence: "jarvis/replica/evidence/lint-long-horizon.log" }] },
      { phase: 3, kind: "approval", title: "Publish the release notes on a public site", category: "publish", depends: [0, 1] },
      { phase: 3, kind: "approval", title: "Save the release-readiness note", category: "file_write", depends: [0, 1, 2, 3, 4, 5] },
      { phase: 4, kind: "tool", title: "List the saved notes", tool: "notes.read", depends: [7] },
      { phase: 4, kind: "tool", title: "Count this workspace's runs", tool: "runs.read", depends: [2, 3, 4, 5] },
    ],
  },
  "design-audit": {
    title: "Design system audit", goal: "Check the Jarvis tokens and their gates before any page changes.",
    steps: [
      { phase: 1, kind: "tool", title: "Read the design tokens and reports", tool: "files.read", input: { path: "jarvis/replica/design" } },
      { phase: 2, kind: "gate", title: "Contrast gate (WCAG and APCA)", criteria: [{ check: "contrast", evidence: "jarvis/replica/design/contrast-report.txt" }] },
      { phase: 2, kind: "gate", title: "Security gate (SkillSpector)", criteria: [{ check: "security", evidence: "jarvis/app/data/skills-scan.json" }] },
      { phase: 3, kind: "approval", title: "Install the reviewed skill into .claude/skills", category: "install", depends: [2] },
      { phase: 3, kind: "approval", title: "Save the design audit note", category: "file_write", depends: [0, 1, 2] },
      { phase: 4, kind: "tool", title: "List the saved notes", tool: "notes.read", depends: [4] },
    ],
  },
  "adr-digest": {
    title: "Weekly decision digest", goal: "Summarise the latest decision records and the desk's runs. Paper only.",
    steps: [
      { phase: 1, kind: "tool", title: "Read the recent decision records", tool: "files.read", input: { path: "docs/adr/ADR-13*" } },
      { phase: 1, kind: "tool", title: "Count this workspace's runs", tool: "runs.read" },
      { phase: 2, kind: "gate", title: "Tests gate (server)", criteria: [{ check: "tests", evidence: "jarvis/replica/evidence/tests-server.log" }] },
      { phase: 3, kind: "approval", title: "Email the digest to the desk", category: "outbound", depends: [0, 1] },
      { phase: 3, kind: "approval", title: "Save the digest note", category: "file_write", depends: [0, 1, 2] },
    ],
  },
};
// The long-horizon mode of an agent turns its own tools into a mission of this shape.
export function agentTemplate(agent) {
  const tools = agent.tools.filter(t => MISSION_TOOLS.includes(t));
  const steps = tools.map(t => ({ phase: 1, kind: "tool", title: "Run " + t, tool: t }));
  const reads = steps.map((_, i) => i);
  steps.push({ phase: 2, kind: "gate", title: "Security gate (SkillSpector)", criteria: [{ check: "security", evidence: "jarvis/app/data/skills-scan.json" }] });
  if (agent.tools.includes("notes.write")) steps.push({ phase: 3, kind: "approval", title: "Save the mission note", category: "file_write", depends: [...reads, steps.length - 1] });
  return { title: agent.name + " · long run", goal: agent.rolePrompt || "Run this agent's tools with gates and capsules.", steps };
}

export function createMissions({ store, runner, db, repoRoot, dataDir }) {
  const EVIDENCE_ROOTS = ["jarvis/app/data", "jarvis/replica"].map(p => resolve(repoRoot, p));
  const missionDir = (slug, id) => join(dataDir, "workspaces", slug, "missions", id);
  const active = new Set();

  const wsId = slug => store.workspaceIdOf(slug);
  async function row(slug, id) {
    const wid = await wsId(slug);
    const m = await db.one("select * from missions where id = $1 and workspace_id = $2", [id, wid]);
    if (!m) bad("No mission with that id in this workspace.", 404);
    return { m, wid };
  }
  const stepsOf = id => db.all("select * from mission_steps where mission_id = $1 order by idx", [id]);
  async function setStep(id, fields) {
    const keys = Object.keys(fields);
    const vals = keys.map(k => (k === "output" ? (fields[k] == null ? null : JSON.stringify(fields[k])) : fields[k]));
    await db.run(`update mission_steps set ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${keys.length + 1} where id = $${keys.length + 2}`, [...vals, iso(), id]);
  }
  async function setMission(id, fields) {
    const keys = Object.keys(fields);
    await db.run(`update missions set ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = $${keys.length + 1} where id = $${keys.length + 2}`, [...keys.map(k => fields[k]), iso(), id]);
  }

  // ---- evidence and gates ----
  function readEvidence(rel) {
    const abs = resolve(repoRoot, String(rel || ""));
    if (!EVIDENCE_ROOTS.some(r => abs === r || abs.startsWith(r + sep))) return { error: "Evidence must live under jarvis/replica or jarvis/app/data." };
    if (!existsSync(abs)) return { error: "No evidence file at " + rel + ". Run the check and save its output there." };
    const real = realpathSync(abs);
    if (!EVIDENCE_ROOTS.some(r => real.startsWith(r + sep))) return { error: "That evidence path leaves the allowed folders." };
    const st = statSync(real);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return { error: "The evidence file is missing or larger than 2 MB." };
    const buf = readFileSync(real);
    return { text: buf.toString("utf8"), sha256: sha256(buf), bytes: st.size, mtime: st.mtime.toISOString() };
  }
  async function runGate(m, step) {
    const results = [];
    for (const c of step.criteria || []) {
      const ev = readEvidence(c.evidence);
      const j = ev.error ? { ok: false, detail: ev.error } : CHECKS.includes(c.check) ? judge(c.check, ev.text) : { ok: false, detail: "unknown check " + c.check };
      const r = { check: c.check, evidence: c.evidence, ok: j.ok, detail: j.detail, sha256: ev.sha256 ? ev.sha256.slice(0, 16) : null, savedAt: ev.mtime || null };
      results.push(r);
      await db.run("insert into gate_results (id, mission_id, step_id, check_name, status, detail, evidence, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [randomUUID(), m.id, step.id, c.check, r.ok ? "pass" : "fail", r.detail, c.evidence + (r.sha256 ? " sha256:" + r.sha256 : ""), iso()]);
    }
    return { pass: results.length > 0 && results.every(r => r.ok), results };
  }

  // ---- capsules ----
  async function capsules(missionId) { return db.all("select * from capsules where mission_id = $1 order by seq", [missionId]); }
  const capsuleOut = c => ({ id: c.id, seq: c.seq, label: c.label, hash: c.hash, prevHash: c.prev_hash, createdAt: c.created_at, state: c.state });
  function stateOf(m, steps) {
    return {
      mission: { status: m.status, title: m.title },
      steps: steps.map(s => ({ idx: s.idx, status: s.status, gate: s.gate_status, approval: s.approval_id || null, output: s.output == null ? null : s.output })),
    };
  }
  async function saveCapsule(m, label) {
    const fresh = await db.one("select * from missions where id = $1", [m.id]);
    fresh._slug = m._slug;
    const steps = await stepsOf(m.id);
    const prev = await db.one("select seq, hash from capsules where mission_id = $1 order by seq desc limit 1", [m.id]);
    const c = { mission_id: m.id, seq: prev ? prev.seq + 1 : 1, label, state: stateOf(fresh, steps), prev_hash: prev ? prev.hash : ZERO, created_at: iso() };
    c.hash = sealCapsule(c);
    await db.run("insert into capsules (id, mission_id, seq, label, state, prev_hash, hash, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [randomUUID(), m.id, c.seq, label, JSON.stringify(c.state), c.prev_hash, c.hash, c.created_at]);
    progress(fresh, "Capsule #" + c.seq + " " + label + " saved (" + c.hash.slice(0, 12) + "…).");
    return c;
  }
  // ---- the three plan files ----
  function planFiles(m, steps, slug) {
    const dir = missionDir(slug || m._slug, m.id);
    mkdirSync(join(dir, "evidence"), { recursive: true });
    const lines = ["# Task plan: " + m.goal.replace(/\n/g, " "), "", "Mission: " + m.title, "Status: " + (m.status === "succeeded" ? "complete" : "in progress"), "", "## Acceptance criteria", "",
      "- [" + (steps.filter(s => s.kind === "gate").every(s => s.gate_status === "pass") ? "x" : " ") + "] AC1: Every gate step passes on saved evidence.",
      "- [" + (steps.filter(s => s.kind === "approval" && LOCKED[s.category]).length ? " " : "x") + "] AC2: No locked action is done here; each waits for Director 00.", "", "## Phases"];
    let phase = 0;
    for (const s of steps) {
      if (s.phase !== phase) { phase = s.phase; lines.push("", "### Phase " + phase); }
      const gate = s.kind === "gate" ? (s.criteria || []).map(c => c.check).filter((v, i, a) => a.indexOf(v) === i).join(", ") : s.kind === "approval" ? "approval" : "";
      lines.push("- [" + (s.status === "done" ? "x" : " ") + "] T" + (s.idx + 1) + ": " + s.title + " (" + s.status + ") {gate: " + gate + "; ac: " + (s.kind === "gate" ? "AC1" : s.kind === "approval" && LOCKED[s.category] ? "AC2" : "") + "}");
    }
    writeFileSync(join(dir, "task_plan.md"), lines.join("\n") + "\n");
    const f = ["# Findings: " + m.title, "", "## Facts", ""];
    for (const s of steps.filter(x => x.output && x.status === "done" && x.kind === "tool")) f.push("- T" + (s.idx + 1) + " " + s.title + ": " + summaryLine(s.output));
    f.push("", "## Evidence", "");
    for (const s of steps.filter(x => x.kind === "gate" && x.gate_status === "pass")) for (const r of (s.output && s.output.results) || []) f.push("- AC1: `" + r.evidence + "` " + r.check + " " + r.detail);
    writeFileSync(join(dir, "findings.md"), f.join("\n") + "\n");
    if (!existsSync(join(dir, "progress.md"))) writeFileSync(join(dir, "progress.md"), "# Progress: " + m.title + "\n\nAppend-only. One line per step.\n\n- " + iso().replace(/\.\d+Z$/, "Z") + " Plan created from template " + m.template + ".\n");
  }
  function progress(m, text) {
    if (!m._slug) return;
    const p = join(missionDir(m._slug, m.id), "progress.md");
    if (existsSync(p)) appendFileSync(p, "- " + iso().replace(/\.\d+Z$/, "Z") + " " + text + "\n");
  }
  function summaryLine(out) {
    if (out.files) return out.files.length + " files (" + out.files.slice(0, 3).map(f => f.path).join(", ") + (out.files.length > 3 ? ", …" : "") + ")";
    if (out.commits) return out.commits.length + " commits, latest " + (out.commits[0] ? out.commits[0].sha + " " + out.commits[0].message : "none");
    if (out.notes) return out.notes.length + " notes";
    if (out.byStatus) return out.total + " runs";
    return "done";
  }
  function noteMarkdown(m, steps) {
    const L = ["# " + m.title + " · " + iso().slice(0, 16).replace("T", " ") + " UTC", "", "Made by fixed rules from this mission's tool output and gate evidence; no model was used.", "", "## Steps", ""];
    for (const s of steps) L.push("- T" + (s.idx + 1) + " " + s.title + " — " + s.status + (s.kind === "gate" ? " (gate " + s.gate_status + ")" : "") + (s.output && s.kind === "tool" && s.status === "done" ? ": " + summaryLine(s.output) : ""));
    const gates = steps.filter(s => s.kind === "gate");
    if (gates.length) {
      L.push("", "## Gate evidence", "");
      for (const s of gates) for (const r of (s.output && s.output.results) || []) L.push("- " + r.check + ": `" + r.evidence + "` " + (r.ok ? "pass" : "FAIL") + ", " + r.detail + (r.sha256 ? " (sha256 " + r.sha256 + ")" : ""));
    }
    const locked = steps.filter(s => s.kind === "approval" && LOCKED[s.category]);
    if (locked.length) L.push("", "## Waiting for Director 00", "", ...locked.map(s => "- " + s.title + " (" + s.category + "): locked, decided outside Jarvis."));
    return L.join("\n") + "\n";
  }

  // ---- context health [INFERENCE] ----
  function health(m, steps, caps) {
    const last = caps[caps.length - 1];
    const lastAt = last ? new Date(last.created_at).getTime() : null;
    const since = steps.filter(s => s.updated_at && (lastAt == null || s.updated_at > lastAt) && (TERMINAL.has(s.status) || s.status === "blocked")).length;
    const bytes = steps.reduce((n, s) => n + (s.output ? Buffer.byteLength(JSON.stringify(s.output)) : 0), 0);
    const tokens = Math.round(bytes / 4);
    const score = Math.max(0, Math.min(100, 100 - since * 12 - Math.max(0, Math.round((tokens - 4000) / 400))));
    return {
      score, label: score >= 70 ? "good" : score >= 40 ? "save a capsule soon" : "save a capsule now",
      stepsSinceCapsule: since, outputTokens: tokens, capsules: caps.length,
      basis: "[INFERENCE] fixed rule: 100 − 12 per step since the last capsule − 1 per 400 output tokens over 4,000 (tokens ≈ bytes ÷ 4).",
    };
  }

  const stepOut = s => ({ id: s.id, idx: s.idx, phase: s.phase, title: s.title, kind: s.kind, tool: s.tool, category: s.category, input: s.input || {}, dependsOn: s.depends_on || [], criteria: s.criteria || [], approvalId: s.approval_id, status: s.status, gateStatus: s.gate_status, output: s.output, ms: s.ms, locked: s.kind === "approval" && !!LOCKED[s.category], updatedAt: s.updated_at });
  const missionOut = m => ({ id: m.id, planner: m.planner || null, title: m.title, goal: m.goal, template: m.template, agentId: m.agent_id, status: m.status, capsuleEvery: m.capsule_every, startedAt: m.started_at, finishedAt: m.finished_at, createdAt: m.created_at, updatedAt: m.updated_at });

  // ---- create ----
  async function insertMission(wid, tpl, { template, title, agentId, capsuleEvery, planner }) {
    const ce = Number(capsuleEvery ?? 1);
    if (!Number.isInteger(ce) || ce < 1 || ce > 10) bad("Save a capsule every 1 to 10 phases.");
    const t = String(title || tpl.title).trim();
    if (!t || t.length > 120) bad("Use 1 to 120 characters for the title.");
    const id = randomUUID(), now = iso();
    await db.tx(async tx => {
      await tx.run("insert into missions (id, workspace_id, agent_id, title, goal, template, status, capsule_every, planner, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $9)",
        [id, wid, agentId || null, t, tpl.goal, template, ce, planner ? JSON.stringify(planner) : null, now]);
      for (const [idx, s] of tpl.steps.entries()) {
        await tx.run("insert into mission_steps (id, mission_id, idx, phase, title, kind, tool, category, input, depends_on, criteria, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'queued', $12, $12)",
          [randomUUID(), id, idx, s.phase, s.title, s.kind, s.tool || null, s.category || null, JSON.stringify(s.input || {}), JSON.stringify(s.depends || []), JSON.stringify(s.criteria || []), now]);
      }
    });
    await store.logEvent(wid, "member:owner", "mission.created", id, { template });
    return id;
  }
  async function create(slug, body = {}) {
    const wid = await wsId(slug);
    const tpl = TEMPLATES[body.template];
    if (!tpl) bad("Pick a template: " + Object.keys(TEMPLATES).join(", ") + ".");
    if (body.agentId && !(await db.one("select id from agents where id = $1 and workspace_id = $2", [body.agentId, wid]))) bad("No agent with that id in this workspace.", 404);
    const id = await insertMission(wid, tpl, body);
    const m = await db.one("select * from missions where id = $1", [id]);
    m._slug = slug;
    planFiles(m, await stepsOf(id), slug);
    return detail(slug, id);
  }
  // A plan from the local model (or the fixed-rule fallback), already passed through llm-plan.mjs's
  // enforceApprovalGates. The steps are re-checked here: kinds, tools and categories come only from
  // Jarvis's own lists, so nothing a model writes can create a step the engine would not create itself.
  async function createFromPlan(slug, { goal, steps, planner, capsuleEvery }) {
    const wid = await wsId(slug);
    const g = String(goal || "").trim();
    if (!g) bad("Write the goal first.");
    if (!Array.isArray(steps) || !steps.length || steps.length > 20) bad("A plan has 1 to 20 steps.");
    const safe = steps.map((s, i) => {
      const kind = ["tool", "gate", "approval"].includes(s.kind) ? s.kind : "tool";
      const step = { phase: Math.max(1, Math.min(10, Number(s.phase) || 1)), kind, title: String(s.title || "Step " + (i + 1)).slice(0, 140), depends: (s.depends || []).filter(d => Number.isInteger(d) && d < i) };
      if (kind === "tool") { step.tool = MISSION_TOOLS.includes(s.tool) ? s.tool : "files.read"; step.input = step.tool === "files.read" ? { path: String((s.input && s.input.path) || "docs/adr/ADR-13*").slice(0, 300) } : {}; }
      if (kind === "gate") step.criteria = (s.criteria || []).filter(c => CHECKS.includes(c.check)).slice(0, 6);
      if (kind === "approval") step.category = [...Object.keys(LOCKED), "file_write"].includes(s.category) ? s.category : "outbound";
      return step;
    });
    const tpl = { title: g.slice(0, 120), goal: g.slice(0, 2000), steps: safe };
    const id = await insertMission(wid, tpl, { template: "llm-plan", title: tpl.title, capsuleEvery: capsuleEvery || 1, planner });
    const m = await db.one("select * from missions where id = $1", [id]);
    m._slug = slug;
    planFiles(m, await stepsOf(id), slug);
    progress(m, "Planned by " + (planner && planner.engine === "ollama-local-loopback" ? "the local model " + planner.model + " [INFERENCE - local LLM]" : "the fixed rules") + "; locks decided by rule.");
    return detail(slug, id);
  }
  async function fromAgent(slug, agent, input) {
    const wid = await wsId(slug);
    const tpl = agentTemplate(agent);
    if (tpl.steps.length > agent.maxSteps) bad("This mission has " + tpl.steps.length + " steps; the agent's limit is " + agent.maxSteps + ".");
    if (input && input.path) tpl.steps.forEach(s => { if (s.tool === "files.read") s.input = { path: input.path }; });
    const id = await insertMission(wid, tpl, { template: "agent", title: tpl.title, agentId: agent.id, capsuleEvery: agent.capsuleEvery || 1 });
    const m = await db.one("select * from missions where id = $1", [id]);
    m._slug = slug;
    planFiles(m, await stepsOf(id), slug);
    await run(slug, id);
    return id;
  }

  // ---- read ----
  async function list(slug) {
    const wid = await wsId(slug);
    const ms = await db.all("select * from missions where workspace_id = $1 order by created_at desc", [wid]);
    const out = [];
    for (const m of ms) {
      const steps = await stepsOf(m.id);
      const caps = await capsules(m.id);
      out.push({ ...missionOut(m), steps: steps.length, done: steps.filter(s => s.status === "done").length, blocked: steps.filter(s => s.status === "blocked").length, failed: steps.filter(s => s.status === "failed").length, phases: new Set(steps.map(s => s.phase)).size, capsules: caps.length, health: health(m, steps, caps) });
    }
    return out;
  }
  async function detail(slug, id) {
    const { m } = await row(slug, id);
    const steps = await stepsOf(id);
    const caps = await capsules(id);
    const gates = await db.all("select step_id, check_name, status, detail, evidence, created_at from gate_results where mission_id = $1 order by created_at", [id]);
    const approvals = {};
    for (const s of steps.filter(x => x.approval_id)) { const p = await db.one("select id, status, reason, category, action from approvals where id = $1", [s.approval_id]); if (p) approvals[s.id] = p; }
    return {
      ...missionOut(m),
      steps: steps.map(s => ({ ...stepOut(s), approval: approvals[s.id] || null, gates: gates.filter(g => g.step_id === s.id).slice(-((s.criteria || []).length || 1)) })),
      capsules: caps.map(capsuleOut), chain: verifyChain(caps, id), health: health(m, steps, caps),
      files: { dir: "workspaces/" + slug + "/missions/" + id, names: ["task_plan.md", "findings.md", "progress.md"] },
      templates: Object.keys(TEMPLATES),
    };
  }

  // ---- run ----
  async function run(slug, id) {
    const { m, wid } = await row(slug, id);
    if (["succeeded", "failed"].includes(m.status)) bad("This mission has finished. Restore a capsule to run part of it again.", 409);
    if (active.has(id)) return detail(slug, id);
    await setMission(id, { status: "running", started_at: m.started_at ? new Date(m.started_at).toISOString() : iso(), finished_at: null });
    await store.logEvent(wid, "member:owner", "mission.started", id);
    active.add(id);
    setImmediate(() => loop(slug, wid, id).catch(async e => {
      await setMission(id, { status: "failed", finished_at: iso() }).catch(() => {});
      await store.logEvent(wid, "system", "mission.crashed", id, { error: String(e && e.message) }).catch(() => {});
    }).finally(() => active.delete(id)));
    return detail(slug, id);
  }
  async function pause(slug, id) {
    const { m, wid } = await row(slug, id);
    if (!["running", "awaiting_approval"].includes(m.status)) bad("Only a running mission can be paused.", 409);
    await setMission(id, { status: "paused" });
    await store.logEvent(wid, "member:owner", "mission.paused", id);
    const fresh = await db.one("select * from missions where id = $1", [id]);
    fresh._slug = slug;
    await saveCapsule(fresh, "paused");
    return detail(slug, id);
  }

  async function loop(slug, wid, id) {
    let phasesSinceCapsule = 0;
    for (;;) {
      const m = await db.one("select * from missions where id = $1", [id]);
      if (!m || m.status !== "running") return;
      m._slug = slug;
      const steps = await stepsOf(id);
      const byIdx = new Map(steps.map(s => [s.idx, s]));
      // A step whose need failed or was skipped is skipped too.
      let changed = false;
      for (const s of steps.filter(x => x.status === "queued")) {
        if ((s.depends_on || []).some(d => ["failed", "skipped"].includes((byIdx.get(d) || {}).status))) {
          await setStep(s.id, { status: "skipped", output: { reason: "A step it needs did not finish." } });
          progress(m, "T" + (s.idx + 1) + " skipped: a step it needs did not finish.");
          changed = true;
        }
      }
      if (changed) continue;
      // Phases in order: a step may start once every earlier phase has nothing queued or running.
      const ready = steps.filter(s => s.status === "queued"
        && (s.depends_on || []).every(d => (byIdx.get(d) || {}).status === "done")
        && steps.every(o => o.phase >= s.phase || !["queued", "running"].includes(o.status)));
      if (!ready.length) {
        const blocked = steps.filter(s => s.status === "blocked");
        const open = steps.filter(s => !TERMINAL.has(s.status));
        if (!open.length) {
          const failed = steps.some(s => s.status === "failed");
          await setMission(id, { status: failed ? "failed" : "succeeded", finished_at: iso() });
          m.status = failed ? "failed" : "succeeded";
          planFiles(m, await stepsOf(id), slug);
          await saveCapsule(m, failed ? "finished with a failed step" : "finished");
          await store.logEvent(wid, "system", failed ? "mission.failed" : "mission.succeeded", id);
        } else if (!blocked.length && !steps.some(s => s.status === "running")) {
          // Nothing runs, nothing waits, yet steps are open: their needs can never finish. Skip them
          // so the mission ends instead of hanging (a model's plan cannot deadlock the engine).
          for (const s of steps.filter(x => x.status === "queued")) await setStep(s.id, { status: "skipped", output: { reason: "It could not start: a step it needs never finished." } });
          continue;
        } else if (blocked.length) {
          await setMission(id, { status: "awaiting_approval" });
          m.status = "awaiting_approval";
          planFiles(m, await stepsOf(id), slug);
          await saveCapsule(m, "waiting for approval (" + blocked.length + ")");
          await store.logEvent(wid, "system", "mission.waiting", id, { blocked: blocked.map(s => s.idx) });
        }
        return;
      }
      const phase = Math.min(...ready.map(s => s.phase));
      await Promise.all(ready.filter(s => s.phase === phase).map(s => runStep(slug, wid, m, s, steps)));
      const after = await stepsOf(id);
      const phaseOpen = after.some(s => s.phase === phase && ["queued", "running"].includes(s.status));
      if (!phaseOpen) {
        phasesSinceCapsule++;
        planFiles(m, after, slug);
        if (phasesSinceCapsule >= m.capsule_every) { await saveCapsule(m, "phase " + phase + " done"); phasesSinceCapsule = 0; }
      }
    }
  }

  async function runStep(slug, wid, m, s, steps) {
    const t0 = Date.now();
    await setStep(s.id, { status: "running" });
    try {
      if (s.kind === "tool") {
        if (!MISSION_TOOLS.includes(s.tool)) throw new Error("Missions may use " + MISSION_TOOLS.join(", ") + ".");
        const out = await runner.TOOLS[s.tool]({ slug, input: s.input || {}, defaultPath: "docs/adr/ADR-13*" });
        await setStep(s.id, { status: "done", output: out, ms: Date.now() - t0 });
        progress(m, "T" + (s.idx + 1) + " " + s.title + ": done (" + summaryLine(out) + ").");
      } else if (s.kind === "gate") {
        const g = await runGate(m, s);
        // gate_status first: the database refuses a done gate step that has not passed.
        await setStep(s.id, { gate_status: g.pass ? "pass" : "fail" });
        await setStep(s.id, { status: g.pass ? "done" : "failed", output: g, ms: Date.now() - t0 });
        progress(m, "T" + (s.idx + 1) + " " + s.title + ": gate " + (g.pass ? "passed" : "FAILED") + " (" + g.results.map(r => r.check + " " + r.detail).join("; ") + ").");
      } else if (s.kind === "approval") {
        const locked = !!LOCKED[s.category];
        let apId = s.approval_id;
        const existing = apId ? await db.one("select id, status from approvals where id = $1", [apId]) : null;
        if (!existing || existing.status !== "pending") {
          const payload = { agent: "Mission: " + m.title, mission: m.id, step: s.idx, locked, note: locked ? "Locked in Jarvis: " + LOCKED[s.category] + ". Director 00 decides outside Jarvis; the mission carries on with steps that do not need it." : "The mission waits for this step; other steps carry on." };
          if (s.category === "file_write") {
            const md = noteMarkdown(m, steps);
            const name = "mission-" + m.template + "-" + iso().slice(0, 16).replace(/[:T]/g, "-") + "-" + s.id.slice(0, 6) + ".md";
            Object.assign(payload, { path: "notes/" + name, bytes: Buffer.byteLength(md), preview: md.slice(0, 600), content: md });
          }
          apId = await store.createApproval(wid, { runId: null, category: s.category, action: s.title, payload, actor: "mission:" + m.id });
        }
        await setStep(s.id, { status: "blocked", approval_id: apId, output: { approval: apId, locked }, ms: Date.now() - t0 });
        progress(m, "T" + (s.idx + 1) + " " + s.title + ": waiting for " + (locked ? "Director 00 (locked: " + s.category + ")" : "a person to approve") + ".");
      }
    } catch (e) {
      await setStep(s.id, { status: "failed", output: { error: e.message }, ms: Date.now() - t0 });
      progress(m, "T" + (s.idx + 1) + " " + s.title + ": failed: " + e.message);
      await store.logEvent(wid, "system", "mission.step_failed", m.id, { step: s.idx, error: e.message });
    }
  }

  // A person decided an approval. If it belongs to a mission step, finish that step and carry on.
  async function onDecision(slug, approval, written) {
    const s = await db.one("select * from mission_steps where approval_id = $1", [approval.id]);
    if (!s || s.status !== "blocked") return null;
    if (approval.status === "approved") {
      try { await setStep(s.id, { status: "done", output: { approval: approval.id, written: written || null } }); }
      catch (e) { const c = classify(e); if (c && c.name === "mission_steps_locked_never_done") bad("Locked: the database refuses to mark this step done.", 403); throw e; }
    } else {
      await setStep(s.id, { status: "failed", output: { approval: approval.id, rejected: approval.reason || "" } });
    }
    const m = await db.one("select * from missions where id = $1", [s.mission_id]);
    m._slug = slug;
    progress(m, "T" + (s.idx + 1) + " " + s.title + ": " + approval.status + (written ? " and written to " + written : "") + ".");
    if (["awaiting_approval", "running"].includes(m.status)) {
      if (m.status === "awaiting_approval") await setMission(m.id, { status: "running" });
      if (!active.has(m.id)) await run(slug, m.id).catch(() => {});
    }
    return s.mission_id;
  }

  // A person chooses to carry on without a blocked step: it and the steps that need it are skipped.
  async function skipStep(slug, id, idx) {
    const { m, wid } = await row(slug, id);
    const s = await db.one("select * from mission_steps where mission_id = $1 and idx = $2", [id, Number(idx)]);
    if (!s) bad("No step with that number.", 404);
    if (s.status !== "blocked") bad("Only a step that waits for approval can be skipped.", 409);
    await setStep(s.id, { status: "skipped", output: { approval: s.approval_id, skipped: "A person chose to carry on without it. The request stays in the inbox." } });
    await store.logEvent(wid, "member:owner", "mission.step_skipped", id, { step: s.idx });
    m._slug = slug;
    progress(m, "T" + (s.idx + 1) + " skipped by a person; the request stays in the inbox.");
    if (m.status !== "paused") { await setMission(id, { status: "running" }); if (!active.has(id)) await run(slug, id); }
    return detail(slug, id);
  }

  async function verify(slug, id) {
    await row(slug, id);
    return verifyChain(await capsules(id), id);
  }
  async function capsule(slug, id, seq) {
    await row(slug, id);
    const c = await db.one("select * from capsules where mission_id = $1 and seq = $2", [id, Number(seq)]);
    if (!c) bad("No capsule with that number.", 404);
    const again = sealCapsule({ mission_id: id, seq: c.seq, label: c.label, state: c.state, prev_hash: c.prev_hash, created_at: new Date(c.created_at).toISOString() });
    return { ...capsuleOut(c), hashOk: again === c.hash, canonicalBytes: Buffer.byteLength(canonical(c.state)) };
  }
  // Restore: verify the chain, put every step back to its saved state, pause, and save a new capsule.
  async function restore(slug, id, seq) {
    const { m, wid } = await row(slug, id);
    if (active.has(id) || m.status === "running") bad("Pause the mission before you restore a capsule.", 409);
    const caps = await capsules(id);
    const chain = verifyChain(caps, id);
    if (!chain.ok) bad("The capsule chain is broken, so nothing was restored: " + chain.problems.join("; "), 409);
    const c = caps.find(x => x.seq === Number(seq));
    if (!c) bad("No capsule with that number.", 404);
    const steps = await stepsOf(id);
    await db.tx(async tx => {
      for (const saved of c.state.steps) {
        const s = steps.find(x => x.idx === saved.idx);
        if (!s) continue;
        let status = saved.status === "running" ? "queued" : saved.status, approvalId = saved.approval || null;
        // A request decided after this capsule is asked again rather than left waiting for nothing.
        if (approvalId && status === "blocked") {
          const p = await tx.one("select status from approvals where id = $1", [approvalId]);
          if (!p || p.status !== "pending") { status = "queued"; approvalId = null; }
        }
        // Order matters for mission_steps_gate_before_done: clear status before gate_status, set gate_status before status.
        await tx.run("update mission_steps set status = 'queued', updated_at = $1 where id = $2", [iso(), s.id]);
        await tx.run("update mission_steps set gate_status = $1, approval_id = $2, output = $3, updated_at = $4 where id = $5",
          [saved.gate || "none", approvalId, saved.output == null ? null : JSON.stringify(saved.output), iso(), s.id]);
        await tx.run("update mission_steps set status = $1, updated_at = $2 where id = $3", [status, iso(), s.id]);
      }
      await tx.run("update missions set status = 'paused', finished_at = null, updated_at = $1 where id = $2", [iso(), id]);
    });
    await store.logEvent(wid, "member:owner", "mission.restored", id, { seq: c.seq, hash: c.hash });
    const fresh = await db.one("select * from missions where id = $1", [id]);
    fresh._slug = slug;
    planFiles(fresh, await stepsOf(id), slug);
    await saveCapsule(fresh, "restored from #" + c.seq);
    return detail(slug, id);
  }

  // First start: one draft mission per workspace, so Mission Control has something real to run.
  async function seedMissions() {
    const n = await db.one("select count(*) as n from missions");
    if (Number(n.n) > 0) return false;
    const plan = { "giant-core": "release-readiness", "jarvis-studio": "design-audit", "omega-prime": "adr-digest" };
    for (const [slug, template] of Object.entries(plan)) {
      const w = await db.one("select id from workspaces where slug = $1", [slug]);
      if (w) await create(slug, { template, capsuleEvery: 1 });
    }
    return true;
  }

  return { create, createFromPlan, fromAgent, list, detail, run, pause, onDecision, skipStep, verify, capsule, restore, seedMissions, missionDir, TEMPLATES };
}
