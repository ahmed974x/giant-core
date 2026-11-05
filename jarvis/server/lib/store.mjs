// Jarvis data layer on the database (ADR-134). Same operation names as the page's sample store, so the
// app swaps between them without screen changes. Every query is scoped to one workspace; the rules
// that matter (locked approvals, one active run, append-only log) live in the schema itself.
import { randomUUID } from "node:crypto";
import { classify } from "./db.mjs";

export const LOCKED = { money: "moves money", publish: "publishes to an outside domain", permissions: "changes repository permissions", install: "installs a skill into the repo", outbound: "sends a message outside" };
export const TOOLS = ["files.read", "notes.read", "notes.write", "runs.read", "git.log", "web.read"];
const iso = () => new Date().toISOString();

export class StoreError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg, status = 400) => { throw new StoreError(status, msg); };

function agentOut(a) {
  if (!a) return a;
  const limits = a.limits || {};
  return {
    id: a.id, name: a.name, model: a.model, rolePrompt: a.role_prompt, tools: a.tools || [], skills: a.skills || [],
    maxSteps: limits.max_steps ?? 20, permissions: { writeNotes: !!limits.write_notes, readWeb: !!limits.read_web },
    mode: limits.mode === "long_horizon" ? "long_horizon" : "single", capsuleEvery: limits.capsule_every ?? 1,
    status: a.status, createdAt: a.created_at, updatedAt: a.updated_at,
  };
}
function runOut(r) {
  return { id: r.id, agentId: r.agent_id, status: r.status, trigger: r.trigger, input: r.input || {}, log: r.log || [], createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, simulated: false };
}
function approvalOut(p) {
  return { id: p.id, category: p.category, runId: p.run_id, action: p.action, payload: p.payload || {}, status: p.status, decidedBy: p.decided_by, reason: p.reason, decidedAt: p.decided_at, createdAt: p.created_at, locked: !!LOCKED[p.category] };
}

export function createStore(db) {
  const wsId = async slug => {
    const w = await db.one("select id from workspaces where slug = $1", [slug]);
    if (!w) bad("No workspace called “" + slug + "”.", 404);
    return w.id;
  };
  const event = (wid, actor, kind, target, data) => db.run("insert into events (workspace_id, actor, kind, target, data, at) values ($1, $2, $3, $4, $5, $6)", [wid, actor, kind, target || null, JSON.stringify(data || {}), iso()]);
  const owner = async wid => (await db.one("select id from members where workspace_id = $1 and role = 'owner' order by created_at limit 1", [wid])).id;

  const api = {
    db,
    async listWorkspaces() {
      return (await db.all("select slug, name, created_at from workspaces order by created_at, name")).map(w => ({ slug: w.slug, name: w.name }));
    },
    async workspace(slug) {
      const w = await db.one("select slug, name from workspaces where slug = $1", [slug]);
      if (!w) bad("No workspace called “" + slug + "”.", 404);
      return w;
    },
    async renameWorkspace(slug, name) {
      const n = String(name || "").trim();
      if (!n || n.length > 80) bad("Use 1 to 80 characters.");
      const wid = await wsId(slug);
      await db.run("update workspaces set name = $1, updated_at = $2 where id = $3", [n, iso(), wid]);
      await event(wid, "member:owner", "workspace.renamed", n);
      return api.workspace(slug);
    },
    async members(slug) {
      const wid = await wsId(slug);
      return (await db.all("select id, email, role from members where workspace_id = $1 order by created_at", [wid]));
    },
    validateAgent(input, existing, exceptId) {
      const errs = {};
      const name = String(input.name || "").trim();
      if (!name) errs.name = "Give the agent a name.";
      else if (name.length > 60) errs.name = "Use 60 characters or fewer.";
      else if (existing.some(a => a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase())) errs.name = "Another agent already has this name.";
      if (String(input.rolePrompt || "").length > 2000) errs.rolePrompt = "Keep the role under 2,000 characters.";
      const ms = Number(input.maxSteps);
      if (!Number.isInteger(ms) || ms < 1 || ms > 200) errs.maxSteps = "Enter a whole number from 1 to 200.";
      const tools = Array.isArray(input.tools) ? input.tools : [];
      if (tools.some(t => !TOOLS.includes(t))) errs.tools = "Pick tools from the list.";
      if (input.mode !== undefined && !["single", "long_horizon"].includes(input.mode)) errs.mode = "Pick single run or long-horizon mission.";
      const ce = input.capsuleEvery === undefined ? 1 : Number(input.capsuleEvery);
      if (!Number.isInteger(ce) || ce < 1 || ce > 10) errs.capsuleEvery = "Save a capsule every 1 to 10 phases.";
      if (!Array.isArray(input.skills || []) || (input.skills || []).some(s => !/^[a-z0-9:-]{1,64}$/.test(s))) errs.skills = "Skill names are lower-case letters, digits and hyphens.";
      return errs;
    },
    async listAgents(slug, { status, q } = {}) {
      const wid = await wsId(slug);
      const rows = await db.all(`select a.*, (select count(*) from runs r where r.agent_id = a.id) as run_count,
        (select max(created_at) from runs r where r.agent_id = a.id) as last_run_at from agents a where a.workspace_id = $1 order by a.created_at`, [wid]);
      const query = String(q || "").trim().toLowerCase();
      return rows.map(a => ({ ...agentOut(a), runs: Number(a.run_count), lastRun: a.last_run_at || null }))
        .filter(a => (!status || a.status === status) && (!query || (a.name + " " + a.model + " " + a.tools.join(" ")).toLowerCase().includes(query)));
    },
    async getAgent(slug, id) {
      const wid = await wsId(slug);
      const a = await db.one("select * from agents where id = $1 and workspace_id = $2", [id, wid]);
      if (!a) bad("No agent with that id in this workspace.", 404);
      const runs = (await db.all("select * from runs where agent_id = $1 order by created_at desc limit 50", [id])).map(runOut);
      for (const r of runs) r.steps = await db.all("select idx, tool, status, ms, tries from steps where run_id = $1 order by idx", [r.id]);
      return { ...agentOut(a), runs, active: runs.some(r => r.status === "queued" || r.status === "running") };
    },
    async createAgent(slug, input) {
      const wid = await wsId(slug);
      const existing = await db.all("select id, name from agents where workspace_id = $1", [wid]);
      const errs = api.validateAgent(input, existing);
      if (Object.keys(errs).length) bad(Object.values(errs)[0]);
      const id = randomUUID(), t = iso();
      const limits = { max_steps: Number(input.maxSteps), write_notes: (input.tools || []).includes("notes.write"), read_web: (input.tools || []).includes("web.read"), mode: input.mode === "long_horizon" ? "long_horizon" : "single", capsule_every: Number(input.capsuleEvery ?? 1) };
      await db.run("insert into agents (id, workspace_id, name, role_prompt, model, tools, skills, limits, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, 'idle', $9, $9)",
        [id, wid, String(input.name).trim(), String(input.rolePrompt || "").trim(), String(input.model || "Local rules (no model)"), JSON.stringify(input.tools || []), JSON.stringify(input.skills || []), JSON.stringify(limits), t]);
      await event(wid, "member:owner", "agent.created", id);
      return agentOut(await db.one("select * from agents where id = $1", [id]));
    },
    async updateAgent(slug, id, input) {
      const wid = await wsId(slug);
      const cur = await db.one("select * from agents where id = $1 and workspace_id = $2", [id, wid]);
      if (!cur) bad("No agent with that id in this workspace.", 404);
      const existing = await db.all("select id, name from agents where workspace_id = $1", [wid]);
      const errs = api.validateAgent(input, existing, id);
      if (Object.keys(errs).length) bad(Object.values(errs)[0]);
      const limits = { ...(cur.limits || {}), max_steps: Number(input.maxSteps), write_notes: (input.tools || []).includes("notes.write"), read_web: (input.tools || []).includes("web.read"),
        mode: input.mode === undefined ? ((cur.limits || {}).mode || "single") : input.mode, capsule_every: Number(input.capsuleEvery ?? (cur.limits || {}).capsule_every ?? 1) };
      await db.run("update agents set name = $1, role_prompt = $2, model = $3, tools = $4, skills = $5, limits = $6, updated_at = $7 where id = $8",
        [String(input.name).trim(), String(input.rolePrompt || "").trim(), String(input.model || cur.model), JSON.stringify(input.tools || []), JSON.stringify(input.skills || []), JSON.stringify(limits), iso(), id]);
      await event(wid, "member:owner", "agent.updated", id);
      return agentOut(await db.one("select * from agents where id = $1", [id]));
    },
    async listRuns(slug) {
      const wid = await wsId(slug);
      const rows = await db.all("select r.*, a.name as agent_name, (select count(*) from steps s where s.run_id = r.id) as step_count from runs r left join agents a on a.id = r.agent_id where r.workspace_id = $1 order by r.created_at desc limit 200", [wid]);
      return rows.map(r => ({ ...runOut(r), agentName: r.agent_name || "Removed agent", steps: new Array(Number(r.step_count)).fill(0) }));
    },
    async getRun(slug, id) {
      const wid = await wsId(slug);
      const r = await db.one("select r.*, a.name as agent_name from runs r left join agents a on a.id = r.agent_id where r.id = $1 and r.workspace_id = $2", [id, wid]);
      if (!r) bad("No run with that id in this workspace.", 404);
      const steps = await db.all("select idx, tool, status, ms, tries, output from steps where run_id = $1 order by idx", [id]);
      const ap = await db.one("select * from approvals where run_id = $1 order by created_at limit 1", [id]);
      return { ...runOut(r), agentName: r.agent_name || "Removed agent", steps, approval: ap ? approvalOut(ap) : null };
    },
    // Create the run and its planned steps in one transaction. The partial unique index
    // runs_one_active_per_agent refuses a second active run for the same agent.
    async createRun(slug, agentId, input, plan, trigger = "manual") {
      const wid = await wsId(slug);
      const a = await db.one("select id from agents where id = $1 and workspace_id = $2", [agentId, wid]);
      if (!a) bad("No agent with that id in this workspace.", 404);
      const id = randomUUID(), t = iso();
      try {
        await db.tx(async tx => {
          await tx.run("insert into runs (id, workspace_id, agent_id, trigger, status, input, log, created_at, updated_at) values ($1, $2, $3, $6, 'queued', $4, '[]', $5, $5)", [id, wid, agentId, JSON.stringify(input || {}), t, trigger === "schedule" ? "schedule" : "manual"]);
          for (const [i, tool] of plan.entries()) await tx.run("insert into steps (id, run_id, idx, agent_id, tool, status, created_at, updated_at) values ($1, $2, $3, $4, $5, 'queued', $6, $6)", [randomUUID(), id, i, agentId, tool, t]);
          await tx.run("update agents set status = 'running', updated_at = $1 where id = $2", [t, agentId]);
        });
      } catch (e) {
        const c = classify(e);
        if (c && c.code === "unique") bad("This agent already has a run in progress. Wait for it or cancel it first.", 409);
        throw e;
      }
      await event(wid, "member:owner", "run.started", id);
      return { id, workspaceId: wid };
    },
    async runRecord(id) { return db.one("select * from runs where id = $1", [id]); },
    async setRun(id, fields) {
      const keys = Object.keys(fields);
      const sets = keys.map((k, i) => `${k} = $${i + 1}`);
      const vals = keys.map(k => (k === "log" || k === "input") ? JSON.stringify(fields[k]) : fields[k]);
      await db.run(`update runs set ${sets.join(", ")}, updated_at = $${keys.length + 1} where id = $${keys.length + 2}`, [...vals, iso(), id]);
    },
    async setStep(runId, idx, fields) {
      const keys = Object.keys(fields);
      const sets = keys.map((k, i) => `${k} = $${i + 1}`);
      const vals = keys.map(k => k === "output" ? JSON.stringify(fields[k]) : fields[k]);
      await db.run(`update steps set ${sets.join(", ")}, updated_at = $${keys.length + 1} where run_id = $${keys.length + 2} and idx = $${keys.length + 3}`, [...vals, iso(), runId, idx]);
    },
    async setAgentStatus(id, status) { await db.run("update agents set status = $1, updated_at = $2 where id = $3", [status, iso(), id]); },
    async cancelRun(slug, id) {
      const wid = await wsId(slug);
      const r = await db.one("select * from runs where id = $1 and workspace_id = $2", [id, wid]);
      if (!r || !(r.status === "running" || r.status === "queued")) bad("This run is not running.", 409);
      await db.run("update runs set status = 'cancelled', finished_at = $1, updated_at = $1 where id = $2 and status in ('queued', 'running')", [iso(), id]);
      await db.run("update steps set status = 'skipped', updated_at = $1 where run_id = $2 and status in ('queued', 'running')", [iso(), id]);
      await db.run("update agents set status = 'idle', updated_at = $1 where id = $2", [iso(), r.agent_id]);
      await event(wid, "member:owner", "run.cancelled", id);
      return runOut(await db.one("select * from runs where id = $1", [id]));
    },
    async createApproval(wid, { runId, category, action, payload, actor }) {
      const id = randomUUID(), t = iso();
      await db.run("insert into approvals (id, workspace_id, run_id, category, action, payload, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, 'pending', $7, $7)", [id, wid, runId || null, category, action, JSON.stringify(payload || {}), t]);
      await event(wid, actor, "approval.requested", id);
      return id;
    },
    async listApprovals(slug) {
      const wid = await wsId(slug);
      const rows = await db.all("select p.*, a.name as agent_name from approvals p left join runs r on r.id = p.run_id left join agents a on a.id = r.agent_id where p.workspace_id = $1 order by p.created_at desc", [wid]);
      return rows.map(p => ({ ...approvalOut(p), agentName: p.agent_name || (p.payload && p.payload.agent) || "Agent" }));
    },
    async approval(slug, id) {
      const wid = await wsId(slug);
      const p = await db.one("select * from approvals where id = $1 and workspace_id = $2", [id, wid]);
      if (!p) bad("No approval with that id in this workspace.", 404);
      return { ...approvalOut(p), workspaceId: wid };
    },
    // A person decides. The decider is the workspace owner's member row (agents have none), and the
    // database refuses approving a locked category whatever the caller sends.
    async decide(slug, id, decision, reason) {
      if (!["approved", "rejected"].includes(decision)) bad("Decision must be approved or rejected.");
      const wid = await wsId(slug);
      const p = await db.one("select * from approvals where id = $1 and workspace_id = $2", [id, wid]);
      if (!p) bad("No approval with that id in this workspace.", 404);
      if (p.status !== "pending") bad("Someone already decided this one.", 409);
      if (decision === "rejected" && !String(reason || "").trim()) bad("Say why, so the agent can do something else.");
      try {
        const r = await db.run("update approvals set status = $1, decided_by = $2, decided_at = $3, reason = $4, updated_at = $3 where id = $5 and status = 'pending'",
          [decision, await owner(wid), iso(), decision === "rejected" ? String(reason).trim() : null, id]);
        if (!r.changes) bad("Someone already decided this one.", 409);
      } catch (e) {
        const c = classify(e);
        if (c && c.name === "approvals_locked_never_approved") bad("Locked: this " + (LOCKED[p.category] || "action") + ". The database refuses it; it needs Director 00's separate approval outside Jarvis.", 403);
        throw e;
      }
      await event(wid, "member:owner", "approval." + decision, id);
      return approvalOut(await db.one("select * from approvals where id = $1", [id]));
    },
    async logEvent(wid, actor, kind, target, data) { await event(wid, actor, kind, target, data); },
    async listEvents(slug) {
      const wid = await wsId(slug);
      return (await db.all("select id, actor, kind, target, data, at from events where workspace_id = $1 order by at desc, id desc limit 500", [wid]));
    },
    async stats(slug) {
      const wid = await wsId(slug);
      const day = new Date(Date.now() - 86400000).toISOString();
      const one = async (sql, p) => Number(Object.values(await db.one(sql, p))[0]);
      const lockedList = Object.keys(LOCKED).map(k => `'${k}'`).join(", ");
      return {
        agents: await one("select count(*) from agents where workspace_id = $1 and status <> 'archived'", [wid]),
        runsToday: await one("select count(*) from runs where workspace_id = $1 and created_at > $2", [wid, day]),
        waiting: await one(`select count(*) from approvals where workspace_id = $1 and status = 'pending' and category not in (${lockedList})`, [wid]),
        locked: await one(`select count(*) from approvals where workspace_id = $1 and status = 'pending' and category in (${lockedList})`, [wid]),
        failed: await one("select count(*) from runs where workspace_id = $1 and status = 'failed' and created_at > $2", [wid, day]),
      };
    },
    async workspaceIdOf(slug) { return wsId(slug); },
    // A cheap change marker for the page's polling: it moves whenever an event, run, step, agent or
    // approval in this workspace changes.
    async version(slug) {
      const wid = await wsId(slug);
      const v = await db.one(`select (select max(id) from events where workspace_id = $1) as e,
        (select max(updated_at) from runs where workspace_id = $1) as r,
        (select max(s.updated_at) from steps s join runs r2 on r2.id = s.run_id where r2.workspace_id = $1) as s,
        (select max(updated_at) from agents where workspace_id = $1) as a,
        (select max(updated_at) from approvals where workspace_id = $1) as p,
        (select updated_at from workspaces where id = $1) as w,
        (select max(updated_at) from missions where workspace_id = $1) as m,
        (select max(ms.updated_at) from mission_steps ms join missions m2 on m2.id = ms.mission_id where m2.workspace_id = $1) as ms,
        (select count(*) from capsules c join missions m3 on m3.id = c.mission_id where m3.workspace_id = $1) as c,
        (select max(id) from token_ledger where workspace_id = $1) as l,
        (select count(*) from webhook_deliveries where workspace_id = $1) as d`, [wid]);
      return { v: [v.e, v.r, v.s, v.a, v.p, v.w, v.m, v.ms, v.c, v.l, v.d].map(x => x == null ? "-" : String(x)).join("|") };
    },
  };
  return api;
}

// First start: three workspaces with their own agents. Locked requests are seeded so the cards are
// visible; they carry sample: true and the page labels them as sample requests.
export async function seed(db) {
  const has = await db.one("select count(*) as n from workspaces");
  if (Number(has.n) > 0) return false;
  const t = iso();
  const WS = [
    { slug: "omega-prime", name: "OMEGA PRIME", agents: [
      { name: "Paper desk reviewer", tools: ["runs.read", "notes.write"], role: "Reads this workspace's runs and writes a short review note. Paper only: it never places, signs or sizes an order.", skills: ["omega-finance-chain"] },
      { name: "ADR reader", tools: ["files.read", "notes.write"], role: "Reads decision records under docs/adr and summarises what changed.", skills: ["omega-knowledge-domain"] },
    ], locked: [["money", "Move paper profit to a real account"], ["outbound", "Email the weekly desk summary"]] },
    { slug: "jarvis-studio", name: "Jarvis Studio", agents: [
      { name: "Design token auditor", tools: ["files.read", "notes.write"], role: "Reads jarvis/replica/design and reports which tokens changed.", skills: ["replica-design"] },
      { name: "Release notes writer", tools: ["git.log", "notes.write"], role: "Turns recent commits into release notes. Publishing them is Ahmad's call.", skills: ["replica-build"] },
    ], locked: [["publish", "Publish the Studio site to a public domain"], ["install", "Install a new skill into .claude/skills"]] },
    { slug: "giant-core", name: "giant-core", agents: [
      { name: "Commit summariser", tools: ["git.log", "notes.write"], role: "Summarises the latest commits on this branch.", skills: [] },
      { name: "Notes librarian", tools: ["notes.read", "files.read"], role: "Lists the notes this workspace has written and the docs they cite.", skills: [] },
    ], locked: [["permissions", "Give an agent push access to giant-core"]] },
  ];
  await db.tx(async tx => {
    for (const [order, w] of WS.entries()) {
      const wid = randomUUID();
      // A millisecond apart, so the switcher lists them in this order.
      await tx.run("insert into workspaces (id, name, slug, created_at, updated_at) values ($1, $2, $3, $4, $4)", [wid, w.name, w.slug, new Date(Date.parse(t) + order).toISOString()]);
      await tx.run("insert into members (id, workspace_id, email, role, created_at, updated_at) values ($1, $2, $3, 'owner', $4, $4)", [randomUUID(), wid, "owner (Director 00)", t]);
      for (const a of w.agents) {
        const limits = { max_steps: 12, write_notes: a.tools.includes("notes.write"), read_web: a.tools.includes("web.read") };
        await tx.run("insert into agents (id, workspace_id, name, role_prompt, model, tools, skills, limits, status, created_at, updated_at) values ($1, $2, $3, $4, 'Local rules (no model)', $5, $6, $7, 'idle', $8, $8)",
          [randomUUID(), wid, a.name, a.role, JSON.stringify(a.tools), JSON.stringify(a.skills), JSON.stringify(limits), t]);
      }
      for (const [category, action] of w.locked) {
        await tx.run("insert into approvals (id, workspace_id, category, action, payload, status, created_at, updated_at) values ($1, $2, $3, $4, $5, 'pending', $6, $6)",
          [randomUUID(), wid, category, action, JSON.stringify({ sample: true, agent: "Sample request", note: "Seeded so the locked card is visible. It can never be approved here." }), t]);
      }
      await tx.run("insert into events (workspace_id, actor, kind, target, data, at) values ($1, 'system', 'workspace.created', $2, '{}', $3)", [wid, w.name, t]);
    }
  });
  return true;
}
