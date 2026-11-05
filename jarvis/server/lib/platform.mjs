// Workspace platform features for jarvis/server (ADR-137): workflows (graphs that run as missions),
// members and roles, scheduled runs, webhooks signed with HMAC-SHA256, creator mode with the future
// subscriber plans and a token ledger, and the analytics numbers. Every rule that matters is also a
// database constraint: one owner per workspace, billing can never be switched on here, a plan stays a
// draft, the creator's usage costs 0, an outgoing webhook may be active only towards 127.0.0.1, and
// the ledger and webhook deliveries are append-only (AGENTS.md §1).
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { classify } from "./db.mjs";
import { LOCKED, StoreError } from "./store.mjs";
import { lockCategory } from "./llm-plan.mjs";
import { checkGraph, graphToSteps, starterGraph, WF_CHECKS } from "./workflow-graph.mjs";
export { checkGraph, topoLevels, graphToSteps, starterGraph } from "./workflow-graph.mjs";

const iso = () => new Date().toISOString();
const bad = (msg, status = 400) => { throw new StoreError(status, msg); };
const ROLES = ["admin", "operator", "viewer"];

// ---------- webhook signatures (pure) ----------
export const signBody = (secret, body) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
export function verifySignature(secret, body, header) {
  const want = Buffer.from(signBody(secret, body)), got = Buffer.from(String(header || ""));
  return want.length === got.length && timingSafeEqual(want, got);
}
// http(s) URL; an outgoing webhook can only be activated towards http://127.0.0.1:<port>/…
export function checkHookUrl(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch (e) { bad("Give a full http:// or https:// address."); }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) bad("Give an http:// or https:// address without a user name.");
  return { url: u.toString(), loopback: u.protocol === "http:" && u.hostname === "127.0.0.1" && !!u.port };
}

export function createPlatform({ db, store, runner, missions, dataDir, fetchImpl = fetch, now = () => Date.now() }) {
  const wsId = slug => store.workspaceIdOf(slug);
  const event = (wid, kind, target, data) => store.logEvent(wid, "member:owner", kind, target, data);

  // ---- workflows ----
  const wfOut = w => ({ id: w.id, name: w.name, graph: w.graph, version: w.version, createdAt: w.created_at, updatedAt: w.updated_at });
  const api = {
    async listWorkflows(slug) {
      const wid = await wsId(slug);
      return (await db.all("select * from workflows where workspace_id = $1 order by created_at", [wid])).map(w => {
        const o = wfOut(w); const nodes = (w.graph && w.graph.nodes) || [];
        return { ...o, steps: nodes.length, locked: nodes.filter(n => (n.kind === "approval" && LOCKED[n.category]) || lockCategory(n.title || "")).length };
      });
    },
    async getWorkflow(slug, id) {
      const wid = await wsId(slug);
      const w = await db.one("select * from workflows where id = $1 and workspace_id = $2", [id, wid]);
      if (!w) bad("No workflow with that id in this workspace.", 404);
      const mlist = await db.all("select id, status, created_at, planner from missions where workspace_id = $1 and template = 'workflow' order by created_at desc", [wid]);
      const runs = mlist.filter(m => m.planner && m.planner.workflowId === id).map(m => ({ id: m.id, status: m.status, createdAt: m.created_at }));
      let steps = [];
      try { steps = graphToSteps(checkGraph(w.graph)); } catch (e) { /* an empty draft has no steps yet */ }
      return { ...wfOut(w), steps, runs: runs.slice(0, 10) };
    },
    async createWorkflow(slug, { name, graph }) {
      const wid = await wsId(slug);
      const n = String(name || "").trim();
      if (!n || n.length > 80) bad("Use 1 to 80 characters for the name.");
      const g = checkGraph(graph || starterGraph());
      const id = randomUUID(), t = iso();
      await db.run("insert into workflows (id, workspace_id, name, graph, version, created_at, updated_at) values ($1, $2, $3, $4, 1, $5, $5)", [id, wid, n, JSON.stringify({ nodes: g.nodes, edges: g.edges }), t]);
      await event(wid, "workflow.created", id);
      return api.getWorkflow(slug, id);
    },
    async saveWorkflow(slug, id, { name, graph }) {
      const wid = await wsId(slug);
      const w = await db.one("select * from workflows where id = $1 and workspace_id = $2", [id, wid]);
      if (!w) bad("No workflow with that id in this workspace.", 404);
      const n = String(name == null ? w.name : name).trim();
      if (!n || n.length > 80) bad("Use 1 to 80 characters for the name.");
      const g = checkGraph(graph);
      await db.run("update workflows set name = $1, graph = $2, version = version + 1, updated_at = $3 where id = $4", [n, JSON.stringify({ nodes: g.nodes, edges: g.edges }), iso(), id]);
      await event(wid, "workflow.saved", id);
      return api.getWorkflow(slug, id);
    },
    async deleteWorkflow(slug, id) {
      const wid = await wsId(slug);
      const r = await db.run("delete from workflows where id = $1 and workspace_id = $2", [id, wid]);
      if (!r.changes) bad("No workflow with that id in this workspace.", 404);
      await event(wid, "workflow.deleted", id);
      return { ok: true };
    },
    // Run = a mission built from the graph, run by the mission engine (gates, capsules, locks).
    async runWorkflow(slug, id) {
      const w = await api.getWorkflow(slug, id);
      const g = checkGraph(w.graph);
      const steps = graphToSteps(g);
      const m = await missions.createFromPlan(slug, { goal: "Workflow: " + w.name, steps, template: "workflow",
        planner: { engine: "workflow", model: null, thinking: null, planFrom: "workflow graph v" + w.version, workflowId: id, label: "workflow graph (no model)", at: iso() } });
      await missions.run(slug, m.id);
      return { mission: m.id };
    },

    // ---- members and roles ----
    async addMember(slug, { email, role }) {
      const wid = await wsId(slug);
      const e = String(email || "").trim().toLowerCase();
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(e)) bad("Give an email address.");
      if (!ROLES.includes(role)) bad("Pick admin, operator or viewer. There is one owner.");
      try { await db.run("insert into members (id, workspace_id, email, role, created_at, updated_at) values ($1, $2, $3, $4, $5, $5)", [randomUUID(), wid, e, role, iso()]); }
      catch (x) { const c = classify(x); if (c && c.code === "unique") bad("That person is already a member.", 409); throw x; }
      await event(wid, "member.added", e, { role, invited: false });
      return store.members(slug);
    },
    async setRole(slug, memberId, role) {
      const wid = await wsId(slug);
      const m = await db.one("select * from members where id = $1 and workspace_id = $2", [memberId, wid]);
      if (!m) bad("No member with that id.", 404);
      if (m.role === "owner") bad("The owner's role does not change here.", 409);
      if (!ROLES.includes(role)) bad("Pick admin, operator or viewer.");
      await db.run("update members set role = $1, updated_at = $2 where id = $3", [role, iso(), memberId]);
      await event(wid, "member.role", m.email, { role });
      return store.members(slug);
    },
    async removeMember(slug, memberId) {
      const wid = await wsId(slug);
      const m = await db.one("select * from members where id = $1 and workspace_id = $2", [memberId, wid]);
      if (!m) bad("No member with that id.", 404);
      if (m.role === "owner") bad("The owner cannot be removed.", 409);
      await db.run("delete from members where id = $1", [memberId]);
      await event(wid, "member.removed", m.email);
      return store.members(slug);
    },

    // ---- scheduled runs ----
    async listSchedules(slug) {
      const wid = await wsId(slug);
      return (await db.all("select s.*, a.name as agent_name from schedules s join agents a on a.id = s.agent_id where s.workspace_id = $1 order by s.created_at", [wid]))
        .map(s => ({ id: s.id, agentId: s.agent_id, agentName: s.agent_name, everyMinutes: s.every_minutes, enabled: !!s.enabled, nextAt: s.next_at, lastRunId: s.last_run_id, lastError: s.last_error }));
    },
    async setSchedule(slug, agentId, { everyMinutes, enabled }) {
      const wid = await wsId(slug);
      if (!(await db.one("select id from agents where id = $1 and workspace_id = $2", [agentId, wid]))) bad("No agent with that id in this workspace.", 404);
      const every = Number(everyMinutes);
      if (!Number.isInteger(every) || every < 5 || every > 10080) bad("Run every 5 minutes to 7 days (10,080 minutes).");
      const next = new Date(now() + every * 60000).toISOString(), t = iso(), on = enabled === false ? false : true;
      const cur = await db.one("select id from schedules where agent_id = $1", [agentId]);
      if (cur) await db.run("update schedules set every_minutes = $1, enabled = $2, next_at = $3, updated_at = $4 where id = $5", [every, db.kind === "sqlite" ? (on ? 1 : 0) : on, next, t, cur.id]);
      else await db.run("insert into schedules (id, workspace_id, agent_id, every_minutes, enabled, next_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $7)", [randomUUID(), wid, agentId, every, db.kind === "sqlite" ? (on ? 1 : 0) : on, next, t]);
      await event(wid, "schedule.set", agentId, { everyMinutes: every, enabled: on });
      return api.listSchedules(slug);
    },
    async deleteSchedule(slug, agentId) {
      const wid = await wsId(slug);
      await db.run("delete from schedules where agent_id = $1 and workspace_id = $2", [agentId, wid]);
      await event(wid, "schedule.removed", agentId);
      return api.listSchedules(slug);
    },
    // Start every due run. A run that cannot start (the agent is busy) waits for its next turn.
    async tick() {
      const due = await db.all("select s.*, w.slug from schedules s join workspaces w on w.id = s.workspace_id where s.enabled = $1 and s.next_at <= $2", [db.kind === "sqlite" ? 1 : true, new Date(now()).toISOString()]);
      const started = [];
      for (const s of due) {
        const next = new Date(now() + s.every_minutes * 60000).toISOString();
        try {
          const runId = await runner.start(s.slug, s.agent_id, {}, "schedule");
          await db.run("update schedules set next_at = $1, last_run_id = $2, last_error = null, updated_at = $3 where id = $4", [next, runId, iso(), s.id]);
          started.push(runId);
        } catch (e) {
          await db.run("update schedules set next_at = $1, last_error = $2, updated_at = $3 where id = $4", [next, String(e.message).slice(0, 300), iso(), s.id]);
        }
      }
      return started;
    },

    // ---- webhooks ----
    secretFor(id) { return createHmac("sha256", masterKey()).update("webhook:" + id).digest("hex"); },
    async listWebhooks(slug) {
      const wid = await wsId(slug);
      const hooks = await db.all("select * from webhooks where workspace_id = $1 order by created_at", [wid]);
      const out = [];
      for (const h of hooks) {
        const deliveries = await db.all("select direction, status, detail, body_sha256, at from webhook_deliveries where webhook_id = $1 order by at desc limit 10", [h.id]);
        const ap = h.approval_id ? await db.one("select id, status, category from approvals where id = $1", [h.approval_id]) : null;
        out.push({ id: h.id, name: h.name, direction: h.direction, url: h.url, events: h.events, status: h.status, external: h.direction === "out" && !checkHookUrl(h.url).loopback, approval: ap, deliveries, endpoint: h.direction === "in" ? "/api/hooks/" + h.id : null, createdAt: h.created_at });
      }
      return out;
    },
    async createWebhook(slug, { name, direction, url }) {
      const wid = await wsId(slug);
      const n = String(name || "").trim();
      if (!n || n.length > 80) bad("Use 1 to 80 characters for the name.");
      if (!["in", "out"].includes(direction)) bad("Pick incoming or outgoing.");
      const u = direction === "out" ? checkHookUrl(url).url : null;
      const id = randomUUID(), t = iso();
      await db.run("insert into webhooks (id, workspace_id, name, direction, url, status, created_at, updated_at) values ($1, $2, $3, $4, $5, 'draft', $6, $6)", [id, wid, n, direction, u, t]);
      await event(wid, "webhook.created", id, { direction });
      return { ...(await api.listWebhooks(slug)).find(h => h.id === id), secret: api.secretFor(id) };
    },
    // Incoming and loopback outgoing hooks switch on here. An outgoing hook to any other address is an
    // outbound message: it becomes a locked approval, and the database refuses status 'active' anyway.
    async activateWebhook(slug, id) {
      const wid = await wsId(slug);
      const h = await db.one("select * from webhooks where id = $1 and workspace_id = $2", [id, wid]);
      if (!h) bad("No webhook with that id in this workspace.", 404);
      if (h.direction === "out" && !checkHookUrl(h.url).loopback) {
        const apId = h.approval_id || await store.createApproval(wid, { category: "outbound", action: "Send webhook “" + h.name + "” to " + new URL(h.url).host, payload: { webhook: id, url: h.url, note: "Outbound messages are Director 00's decision outside Jarvis (AGENTS.md §1)." }, actor: "member:owner" });
        await db.run("update webhooks set approval_id = $1, updated_at = $2 where id = $3", [apId, iso(), id]);
        return { locked: true, approvalId: apId, webhook: (await api.listWebhooks(slug)).find(x => x.id === id) };
      }
      await db.run("update webhooks set status = 'active', updated_at = $1 where id = $2", [iso(), id]);
      await event(wid, "webhook.activated", id);
      return { locked: false, webhook: (await api.listWebhooks(slug)).find(x => x.id === id) };
    },
    async pauseWebhook(slug, id) {
      const wid = await wsId(slug);
      const r = await db.run("update webhooks set status = 'paused', updated_at = $1 where id = $2 and workspace_id = $3", [iso(), id, wid]);
      if (!r.changes) bad("No webhook with that id in this workspace.", 404);
      await event(wid, "webhook.paused", id);
      return (await api.listWebhooks(slug)).find(x => x.id === id);
    },
    async deleteWebhook(slug, id) {
      const wid = await wsId(slug);
      const r = await db.run("delete from webhooks where id = $1 and workspace_id = $2", [id, wid]);
      if (!r.changes) bad("No webhook with that id in this workspace.", 404);
      await event(wid, "webhook.deleted", id);
      return { ok: true };
    },
    // POST /api/hooks/:id from a local tool, signed with the hook's secret.
    async receive(id, rawBody, signature) {
      const h = await db.one("select * from webhooks where id = $1", [id]);
      if (!h || h.direction !== "in") bad("No incoming webhook with that id.", 404);
      const body = Buffer.from(rawBody || "");
      const sha = createHash("sha256").update(body).digest("hex");
      const ok = h.status === "active" && verifySignature(api.secretFor(id), body, signature);
      const detail = h.status !== "active" ? "the webhook is not active" : ok ? "signature verified" : "bad or missing X-Jarvis-Signature";
      await db.run("insert into webhook_deliveries (id, webhook_id, workspace_id, direction, status, detail, body_sha256, at) values ($1, $2, $3, 'in', $4, $5, $6, $7)", [randomUUID(), id, h.workspace_id, ok ? "verified" : "rejected", detail, sha, iso()]);
      await store.logEvent(h.workspace_id, "webhook:" + id, ok ? "webhook.received" : "webhook.rejected", h.name, { sha256: sha.slice(0, 16) });
      if (!ok) bad("Refused: " + detail + ".", 401);
      return { ok: true, sha256: sha };
    },
    // Send one signed event to every active loopback outgoing hook of the workspace that wants it.
    async dispatch(slug, kind, data) {
      const wid = await wsId(slug);
      const hooks = await db.all("select * from webhooks where workspace_id = $1 and direction = 'out' and status = 'active'", [wid]);
      const results = [];
      for (const h of hooks) {
        if (!(h.events || []).includes(kind) && kind !== "webhook.test") continue;
        const u = checkHookUrl(h.url);
        if (!u.loopback) continue; // the database already refuses this; never send outside
        const body = JSON.stringify({ event: kind, workspace: slug, data: data || {}, at: iso() });
        let status = "sent", detail = "";
        try {
          const r = await fetchImpl(u.url, { method: "POST", headers: { "content-type": "application/json", "x-jarvis-signature": signBody(api.secretFor(h.id), body), "x-jarvis-event": kind }, body, redirect: "error", signal: AbortSignal.timeout(5000) });
          detail = "HTTP " + r.status; if (!r.ok) status = "failed";
        } catch (e) { status = "failed"; detail = String(e && e.message || e).slice(0, 200); }
        await db.run("insert into webhook_deliveries (id, webhook_id, workspace_id, direction, status, detail, body_sha256, at) values ($1, $2, $3, 'out', $4, $5, $6, $7)", [randomUUID(), h.id, wid, status, detail, createHash("sha256").update(body).digest("hex"), iso()]);
        results.push({ webhook: h.id, status, detail });
      }
      return results;
    },
    async testWebhook(slug, id) {
      const wid = await wsId(slug);
      const h = await db.one("select * from webhooks where id = $1 and workspace_id = $2", [id, wid]);
      if (!h || h.direction !== "out") bad("No outgoing webhook with that id.", 404);
      if (h.status !== "active") bad("Switch the webhook on first.", 409);
      return (await api.dispatch(slug, "webhook.test", { webhook: id })).find(r => r.webhook === id) || { status: "failed", detail: "not sent" };
    },

    // ---- creator mode, plans and the token ledger ----
    async billing(slug) {
      const wid = await wsId(slug);
      let b = await db.one("select * from billing_settings where workspace_id = $1", [wid]);
      if (!b) { await db.run("insert into billing_settings (workspace_id, updated_at) values ($1, $2)", [wid, iso()]); b = await db.one("select * from billing_settings where workspace_id = $1", [wid]); }
      const tiers = (await db.all("select * from subscriber_tiers where workspace_id = $1 order by monthly_tokens", [wid])).map(t => ({ id: t.id, name: t.name, monthlyTokens: Number(t.monthly_tokens), priceMinor: Number(t.price_minor), currency: t.currency, status: t.status }));
      const totals = await db.all("select engine, count(*) as n, sum(tokens) as tokens, sum(cost_micro_usd) as cost from token_ledger where workspace_id = $1 group by engine order by engine", [wid]);
      const recent = await db.all("select actor, engine, model, tokens, cost_micro_usd, ref, at from token_ledger where workspace_id = $1 order by id desc limit 20", [wid]);
      const pending = await db.all("select id, action, status from approvals where workspace_id = $1 and category = 'money' and payload is not null and status = 'pending' order by created_at desc", [wid]);
      return {
        creatorZeroToken: !!b.creator_zero_token, billingEnabled: !!b.billing_enabled, tiers,
        ledger: { totals: totals.map(t => ({ engine: t.engine, entries: Number(t.n), tokens: Number(t.tokens || 0), costMicroUsd: Number(t.cost || 0) })), recent: recent.map(r => ({ ...r, tokens: Number(r.tokens), cost_micro_usd: Number(r.cost_micro_usd) })) },
        moneyRequests: pending,
      };
    },
    async saveTier(slug, { id, name, monthlyTokens, priceMinor, currency }) {
      const wid = await wsId(slug);
      const n = String(name || "").trim(), mt = Number(monthlyTokens), pm = Number(priceMinor || 0), cur = String(currency || "USD").toUpperCase();
      if (!n || n.length > 40) bad("Use 1 to 40 characters for the plan name.");
      if (!Number.isInteger(mt) || mt < 0 || mt > 1e12) bad("Monthly tokens is a whole number.");
      if (!Number.isInteger(pm) || pm < 0 || pm > 1e9) bad("The draft price is a whole number of cents.");
      if (!/^[A-Z]{3}$/.test(cur)) bad("Currency is a three-letter code.");
      try {
        if (id) {
          const r = await db.run("update subscriber_tiers set name = $1, monthly_tokens = $2, price_minor = $3, currency = $4, updated_at = $5 where id = $6 and workspace_id = $7", [n, mt, pm, cur, iso(), id, wid]);
          if (!r.changes) bad("No plan with that id.", 404);
        } else await db.run("insert into subscriber_tiers (id, workspace_id, name, monthly_tokens, price_minor, currency, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, 'draft', $7, $7)", [randomUUID(), wid, n, mt, pm, cur, iso()]);
      } catch (x) { const c = classify(x); if (c && c.code === "unique") bad("Another plan has this name.", 409); throw x; }
      await event(wid, "tier.saved", n, { draft: true });
      return api.billing(slug);
    },
    async deleteTier(slug, id) {
      const wid = await wsId(slug);
      await db.run("delete from subscriber_tiers where id = $1 and workspace_id = $2", [id, wid]);
      return api.billing(slug);
    },
    // Charging anyone is a money decision: it becomes a locked request; the database keeps billing off.
    async requestMoney(slug, what) {
      const wid = await wsId(slug);
      const action = what === "billing" ? "Turn on billing and token plans for subscribers" : "Activate the subscriber plan “" + String(what).slice(0, 40) + "”";
      const apId = await store.createApproval(wid, { category: "money", action, payload: { note: "Charging people is Director 00's decision outside Jarvis, after a legal review (AGENTS.md §1). The database keeps billing off and every plan a draft." }, actor: "member:owner" });
      return { locked: true, approvalId: apId, billing: await api.billing(slug) };
    },
    async recordUsage(slug, { engine, model, tokens, ref }) {
      const wid = await wsId(slug);
      await db.run("insert into token_ledger (workspace_id, actor, engine, model, tokens, cost_micro_usd, ref, at) values ($1, 'creator', $2, $3, $4, 0, $5, $6)", [wid, String(engine).slice(0, 40), model ? String(model).slice(0, 80) : null, Math.max(0, Math.round(Number(tokens) || 0)), ref ? String(ref).slice(0, 80) : null, iso()]);
    },

    // ---- analytics ----
    async analytics(slug) {
      const wid = await wsId(slug);
      const n = v => Number(v || 0);
      const group = async (sql, p) => (await db.all(sql, p)).map(r => ({ key: r.k, count: n(r.c) }));
      const since = new Date(now() - 14 * 86400000).toISOString();
      const runsByDay = {};
      for (const r of await db.all("select created_at from runs where workspace_id = $1 and created_at >= $2", [wid, since])) { const d = new Date(r.created_at).toISOString().slice(0, 10); runsByDay[d] = (runsByDay[d] || 0) + 1; }
      const days = [...Array(14)].map((_, i) => new Date(now() - (13 - i) * 86400000).toISOString().slice(0, 10)).map(d => ({ day: d, runs: runsByDay[d] || 0 }));
      const gates = await db.all("select g.check_name as k, g.status as s, count(*) as c from gate_results g join missions m on m.id = g.mission_id where m.workspace_id = $1 group by g.check_name, g.status", [wid]);
      const gateRates = WF_CHECKS.map(c => { const pass = n((gates.find(g => g.k === c && g.s === "pass") || {}).c), fail = n((gates.find(g => g.k === c && g.s === "fail") || {}).c); return { check: c, pass, fail, rate: pass + fail ? Math.round(pass / (pass + fail) * 1000) / 10 : null }; });
      const agents = (await db.all("select a.name as k, sum(case when r.status = 'succeeded' then 1 else 0 end) as ok, sum(case when r.status = 'failed' then 1 else 0 end) as bad, count(r.id) as c from agents a left join runs r on r.agent_id = a.id where a.workspace_id = $1 group by a.name order by a.name", [wid]))
        .map(r => ({ agent: r.k, runs: n(r.c), succeeded: n(r.ok), failed: n(r.bad) }));
      const b = await api.billing(slug);
      return {
        runsByStatus: await group("select status as k, count(*) as c from runs where workspace_id = $1 group by status", [wid]),
        runsByDay: days, agents, gateRates,
        missionsByStatus: await group("select status as k, count(*) as c from missions where workspace_id = $1 group by status", [wid]),
        capsules: n((await db.one("select count(*) as c from capsules c join missions m on m.id = c.mission_id where m.workspace_id = $1", [wid])).c),
        approvals: await group("select case when category in ('money', 'publish', 'permissions', 'install', 'outbound') then 'locked-' || status else status end as k, count(*) as c from approvals where workspace_id = $1 group by 1", [wid]),
        webhooks: await group("select d.status as k, count(*) as c from webhook_deliveries d where d.workspace_id = $1 group by d.status", [wid]),
        tokens: b.ledger.totals, creatorZeroToken: b.creatorZeroToken, costMicroUsd: b.ledger.totals.reduce((s, t) => s + t.costMicroUsd, 0),
      };
    },

    // First start: a starter workflow in each workspace.
    async seed() {
      const has = await db.one("select count(*) as n from workflows");
      if (Number(has.n) > 0) return false;
      for (const w of await db.all("select slug from workspaces order by created_at")) await api.createWorkflow(w.slug, { name: "Review and release", graph: starterGraph() });
      return true;
    },
  };

  let key = null;
  function masterKey() {
    if (key) return key;
    const p = join(dataDir, "webhook-master.key");
    if (!existsSync(p)) { mkdirSync(dataDir, { recursive: true }); writeFileSync(p, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" }); }
    try { chmodSync(p, 0o600); } catch (e) { /* not every file system has modes */ }
    key = Buffer.from(readFileSync(p, "utf8").trim(), "hex");
    if (key.length !== 32) throw new Error("jarvis/server/.data/webhook-master.key is damaged; delete it to make a new one (old webhook secrets stop working).");
    return key;
  }
  return api;
}
