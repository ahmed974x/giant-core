// The architect's campaigns on the server (ADR-172). Each save is a row in architect_campaigns, append-only in SQLite
// and PostgreSQL: the request without the architect's code, the campaign's hash, where to resume and the counts. The
// latest row for a campaign is where it stands, so a long task can stop and resume on another day. Nothing runs here.
import { randomUUID } from "node:crypto";

export function createCampaignLog({ db, store }) {
  const view = r => ({ id: r.id, campaign: r.campaign_sha256, request: typeof r.request === "string" ? JSON.parse(r.request) : r.request, resume: r.resume, done: Number(r.done_count), receipts: Number(r.receipts), createdAt: r.created_at });
  return {
    // The request is stored without the code; the database refuses a row that still has one.
    async save(slug, request, result) {
      const wid = await store.workspaceIdOf(slug);
      const { passcode, save, ...kept } = request;
      const id = randomUUID();
      await db.run("insert into architect_campaigns (id, workspace_id, campaign_sha256, request, resume, done_count, receipts, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [id, wid, result.campaign_sha256, JSON.stringify(kept), result.resume, result.counts.done, result.steps.filter(s => s.receipt).length, new Date().toISOString()]);
      return view(await db.one("select * from architect_campaigns where id = $1", [id]));
    },
    async list(slug, limit = 20) {
      const wid = await store.workspaceIdOf(slug);
      const n = Math.max(1, Math.min(100, Number(limit) || 20));
      return (await db.all("select * from architect_campaigns where workspace_id = $1 order by created_at desc limit " + n, [wid])).map(view);
    },
  };
}
