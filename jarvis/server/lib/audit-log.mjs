// The Merkle audit log on the server (ADR-147). The store calls onEvent after every event; the sensitive
// kinds become leaves of a per-workspace RFC 6962 tree (merkle-audit.mjs) in audit_leaves, each row with
// the tree head after it. Appends are serialised per workspace and use the frontier, so each costs
// O(log n) hashes. Rows are append-only in SQLite and PostgreSQL; verify recomputes every leaf and head.
import { StoreError } from "./store.mjs";
import { leafHash, frontierPush, frontierRoot, inclusionPath, verifyInclusion, auditEntry, EMPTY_ROOT, AUDITED } from "./merkle-audit.mjs";
export const EXPORT_KINDS = ["export.html", "export.mjs", "export.tokens", "export.sql", "export.spec"];
const iso = () => new Date().toISOString();

export function createAuditLog({ db, store }) {
  const chains = new Map(), frontiers = new Map();
  const rowsOf = wid => db.all("select * from audit_leaves where workspace_id = $1 order by seq", [wid]);
  async function frontierOf(wid) {
    if (!frontiers.has(wid)) {
      let peaks = [];
      const rows = await db.all("select leaf_hash from audit_leaves where workspace_id = $1 order by seq", [wid]);
      for (const r of rows) peaks = frontierPush(peaks, r.leaf_hash);
      frontiers.set(wid, { peaks, size: rows.length });
    }
    return frontiers.get(wid);
  }
  function append(wid, actor, kind, target) {
    if (!AUDITED.test(String(kind))) return Promise.resolve(null);
    const run = async () => {
      const fr = await frontierOf(wid);
      const seq = fr.size, at = iso();
      const leaf = leafHash(auditEntry({ seq, kind, actor, target, at }));
      const peaks = frontierPush(fr.peaks, leaf), root = frontierRoot(peaks);
      await db.run("insert into audit_leaves (workspace_id, seq, kind, actor, target, logged, leaf_hash, root_hash) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [wid, seq, String(kind).slice(0, 80), String(actor), target == null ? null : String(target), at, leaf, root]);
      fr.peaks = peaks; fr.size = seq + 1;
      return { seq, leaf, root };
    };
    const p = (chains.get(wid) || Promise.resolve()).then(run, run);
    chains.set(wid, p.catch(() => {}));
    return p;
  }
  const view = r => ({ seq: Number(r.seq), kind: r.kind, actor: r.actor, target: r.target, at: r.logged, leafHash: r.leaf_hash, rootHash: r.root_hash, entry: auditEntry({ seq: Number(r.seq), kind: r.kind, actor: r.actor, target: r.target, at: r.logged }) });
  const api = {
    AUDITED,
    append,
    async head(slug) {
      const wid = await store.workspaceIdOf(slug);
      const last = await db.one("select seq, root_hash, logged from audit_leaves where workspace_id = $1 order by seq desc limit 1", [wid]);
      return last ? { size: Number(last.seq) + 1, root: last.root_hash, at: last.logged } : { size: 0, root: EMPTY_ROOT, at: null };
    },
    async leaves(slug, limit = 20) {
      const wid = await store.workspaceIdOf(slug);
      const n = Math.max(1, Math.min(200, Number(limit) || 20));
      return (await db.all("select * from audit_leaves where workspace_id = $1 order by seq desc limit " + n, [wid])).map(view);
    },
    // The audit path of one leaf against the current head, checked here too before it is sent.
    async proof(slug, seq) {
      const wid = await store.workspaceIdOf(slug);
      const rows = await rowsOf(wid);
      const m = Number(seq);
      if (!Number.isInteger(m) || m < 0 || m >= rows.length) throw new StoreError(404, "No audit entry with that number.");
      const leaves = rows.map(r => r.leaf_hash), size = rows.length, root = rows[size - 1].root_hash;
      const path = inclusionPath(m, leaves);
      return { ...view(rows[m]), size, root, path, verified: verifyInclusion(leaves[m], m, size, path, root) && leafHash(view(rows[m]).entry) === leaves[m] };
    },
    // Every leaf recomputed from its fields, the order checked and every stored head recomputed.
    async verify(slug) {
      const wid = await store.workspaceIdOf(slug);
      const rows = await rowsOf(wid);
      let peaks = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (Number(r.seq) !== i) return { ok: false, size: rows.length, brokenAt: i, reason: "an entry is missing before this one" };
        if (leafHash(view(r).entry) !== r.leaf_hash) return { ok: false, size: rows.length, brokenAt: i, reason: "the entry does not match its leaf hash" };
        peaks = frontierPush(peaks, r.leaf_hash);
        if (frontierRoot(peaks) !== r.root_hash) return { ok: false, size: rows.length, brokenAt: i, reason: "the stored tree head does not match" };
      }
      return { ok: true, size: rows.length, root: frontierRoot(peaks) };
    },
    async record(slug, kind, target) {
      if (!EXPORT_KINDS.includes(kind)) throw new StoreError(400, "Only Studio exports are recorded this way.");
      const wid = await store.workspaceIdOf(slug);
      await store.logEvent(wid, "member:owner", kind, String(target || "").slice(0, 120));
      return api.head(slug);
    },
  };
  return api;
}
