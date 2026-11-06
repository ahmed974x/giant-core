// Access mode and hosted model endpoints (ADR-141). Both are locks, not settings:
//   - The platform's access mode is "founder_private". Opening it to the public is a publish action
//     (AGENTS.md §1): the request becomes a locked approval, the API answers 403, and the database
//     refuses any other mode (access_settings_founder_private_locked).
//   - A hosted model endpoint (api.deepseek.com, DashScope, any cloud) would send workspace text outside
//     this computer. It can be recorded as a draft so Director 00 sees exactly what is asked, with a
//     locked outbound approval; the database refuses any status but "draft"
//     (model_endpoints_external_locked), and no code path reads this table to send anything.
import { randomUUID } from "node:crypto";
import net from "node:net";
import { StoreError } from "./store.mjs";
import { isBlockedAddress } from "./fetch-public.mjs";

const iso = () => new Date().toISOString();
const bad = (msg, status = 400) => { throw new StoreError(status, msg); };

export function checkEndpointUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (e) { bad("Write the endpoint as a full https:// address."); }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (u.protocol !== "https:") bad("A hosted endpoint must use https://.");
  if (u.username || u.password) bad("Addresses with a user name or password are refused; keys never go in a URL.");
  if (u.search || u.hash) bad("Leave out the query and fragment.");
  if (net.isIP(host) ? isBlockedAddress(host) : (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host))) bad("Private and local addresses are not hosted endpoints; local models use the OpenAI-compatible engine on 127.0.0.1.");
  return { url: u.origin + u.pathname.replace(/\/+$/, ""), host };
}

export function createAccess({ db, store }) {
  const wsId = slug => store.workspaceIdOf(slug);
  const out = e => ({ id: e.id, name: e.name, url: e.url, host: e.host, status: e.status, approvalId: e.approval_id, approvalStatus: e.approval_status || null, createdAt: e.created_at });
  const api = {
    async ensure() {
      const row = await db.one("select mode from access_settings where id = 'global'");
      if (!row) await db.run("insert into access_settings (id, mode, updated_at) values ('global', 'founder_private', $1)", [iso()]);
    },
    async status() {
      await api.ensure();
      const row = await db.one("select mode, updated_at from access_settings where id = 'global'");
      return { mode: row.mode, updatedAt: row.updated_at, publicLocked: true };
    },
    // Asking to open Jarvis to the public: a locked publish approval, and a 403 for the caller.
    async requestPublic(slug) {
      const wid = await wsId(slug);
      const apId = await store.createApproval(wid, { category: "publish", action: "Open Jarvis to the public (founder_private → public_subscribers)", payload: { note: "Anyone could then reach Jarvis. This is a publish action for Director 00 outside Jarvis (AGENTS.md §1); the database keeps the access mode founder_private." }, actor: "member:owner" });
      return { locked: true, approvalId: apId, mode: "founder_private" };
    },
    async listEndpoints(slug) {
      const wid = await wsId(slug);
      const rows = await db.all("select e.*, p.status as approval_status from model_endpoints e left join approvals p on p.id = e.approval_id where e.workspace_id = $1 order by e.created_at desc", [wid]);
      return rows.map(out);
    },
    // Recording a hosted endpoint: a draft row plus a locked outbound approval. Never activated here.
    async requestEndpoint(slug, { name, url }) {
      const wid = await wsId(slug);
      const n = String(name || "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!n) bad("Name the endpoint, e.g. DeepSeek API.");
      const ep = checkEndpointUrl(url);
      const apId = await store.createApproval(wid, { category: "outbound", action: "Send workspace text to the hosted model endpoint " + ep.host, payload: { url: ep.url, note: "Prompts, memory examples and plans would leave this computer, and the provider would need a key (AGENTS.md §1, §3, §4). Until Director 00 approves outside Jarvis, the server talks to 127.0.0.1 only." }, actor: "member:owner" });
      const id = randomUUID();
      await db.run("insert into model_endpoints (id, workspace_id, name, url, host, status, approval_id, created_at) values ($1, $2, $3, $4, $5, 'draft', $6, $7)", [id, wid, n, ep.url, ep.host, apId, iso()]);
      await store.logEvent(wid, "member:owner", "endpoint.requested", ep.host, { approval: apId });
      return { locked: true, approvalId: apId, endpoint: (await api.listEndpoints(slug)).find(e => e.id === id) };
    },
    async activateEndpoint(slug, id) {
      const wid = await wsId(slug);
      const e = await db.one("select * from model_endpoints where id = $1 and workspace_id = $2", [id, wid]);
      if (!e) bad("No endpoint with that id.", 404);
      throw Object.assign(new StoreError(403, "Hosted endpoints stay drafts. Sending text outside this computer waits for Director 00."), { approvalId: e.approval_id, locked: true });
    },
    async removeEndpoint(slug, id) {
      const wid = await wsId(slug);
      const r = await db.run("delete from model_endpoints where id = $1 and workspace_id = $2", [id, wid]);
      if (!r.changes) bad("No endpoint with that id.", 404);
      return { ok: true };
    },
  };
  return api;
}
