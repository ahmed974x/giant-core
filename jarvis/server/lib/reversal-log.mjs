// The reversal log on the server (ADR-150). Each correction the reversal engine (reversal.mjs) makes is a
// row in reversal_log, append-only in SQLite and PostgreSQL, with the hashes of before, after and the
// corrections. The row's event (reversal.plan or reversal.template) becomes a leaf of the Merkle audit
// tree, and a lesson goes into the BM25 memory, so the local model sees the correction next time as an
// example (data, not instructions). Output with nothing to correct is not logged.
import { randomUUID } from "node:crypto";
import { StoreError } from "./store.mjs";
import { reversePlan, reverseTemplate, describeCorrection } from "./reversal.mjs";

const iso = () => new Date().toISOString();

export function createReversalLog({ db, store, memory }) {
  const view = r => ({ id: r.id, kind: r.kind, source: r.source, before: r.before_hash, after: r.after_hash, proofHash: r.proof_hash, corrections: r.corrections, vector: r.vector, verified: r.verified === true || r.verified === 1, createdAt: r.created_at });
  async function record(slug, result, source) {
    if (!result.changed) return null;
    const wid = await store.workspaceIdOf(slug);
    const id = randomUUID(), src = String(source || "person").replace(/\s+/g, " ").trim().slice(0, 80) || "person";
    const verified = result.kind === "plan" ? result.proof.verified : true;
    await db.run("insert into reversal_log (id, workspace_id, kind, source, before_hash, after_hash, proof_hash, corrections, vector, verified, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [id, wid, result.kind, src, result.before, result.after, result.proofHash, JSON.stringify(result.corrections), JSON.stringify(result.vector), db.kind === "postgres" ? verified : verified ? 1 : 0, iso()]);
    await store.logEvent(wid, src === "person" ? "member:owner" : "agent:reversal", "reversal." + result.kind, id);
    if (memory) await memory.add(slug, { kind: "lesson", title: `Reversal: ${result.corrections.length} correction${result.corrections.length === 1 ? "" : "s"} in a ${result.kind} from ${src}`,
      body: result.corrections.map(describeCorrection).join("\n"), tags: ["reversal", result.kind], outcome: { corrected: true, verified }, source: "reversal" }).catch(() => {});
    return view(await db.one("select * from reversal_log where id = $1", [id]));
  }
  return {
    async plan(slug, steps, source) {
      if (!Array.isArray(steps) || !steps.length) throw new StoreError(400, "Send the plan's steps.");
      const r = reversePlan(steps);
      return { ...r, log: await record(slug, r, source) };
    },
    async template(slug, text, source) {
      const t = String(text == null ? "" : text);
      if (!t.trim()) throw new StoreError(400, "Paste the HTML or CSS first.");
      if (t.length > 200000) throw new StoreError(400, "Keep it under 200,000 characters.");
      const r = reverseTemplate(t);
      return { ...r, log: await record(slug, r, source) };
    },
    async list(slug, limit = 20) {
      const wid = await store.workspaceIdOf(slug);
      const n = Math.max(1, Math.min(100, Number(limit) || 20));
      const rows = await db.all("select * from reversal_log where workspace_id = $1 order by created_at desc limit " + n, [wid]);
      const all = await db.one("select count(*) as c from reversal_log where workspace_id = $1", [wid]);
      return { total: Number(all.c), entries: rows.map(view) };
    },
  };
}
