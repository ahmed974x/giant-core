// Studio time machine on the server (ADR-144): every saved state of a Studio site is a row in
// studio_snapshots, with the SHA-256 of its canonical JSON chained to the previous row's hash
// (snapshot.mjs), so an edit to history shows on verify. Rows are append-only; a fork is a new row whose
// parent is the snapshot it came from. Diffs are computed from two rows: JSON lines and blocks.
import { randomUUID } from "node:crypto";
import { StoreError } from "./store.mjs";
import { canonical, snapshotOf, snapshotHash, lineDiff, prettyLines, blockDiff } from "./snapshot.mjs";

const iso = () => new Date().toISOString();
const bad = (msg, status = 400) => { throw new StoreError(status, msg); };

export function createStudio({ db, store }) {
  const wsId = slug => store.workspaceIdOf(slug);
  const summary = r => ({ id: r.id, seq: r.seq, label: r.label, hash: r.hash, prevHash: r.prev_hash, parentId: r.parent_id, blocks: (r.site && r.site.blocks || []).length, name: r.site && r.site.name, createdAt: r.created_at });
  async function getRow(wid, id) {
    const r = await db.one("select * from studio_snapshots where id = $1 and workspace_id = $2", [id, wid]);
    if (!r) bad("No snapshot with that id.", 404);
    return r;
  }
  const api = {
    async list(slug) {
      const wid = await wsId(slug);
      return (await db.all("select * from studio_snapshots where workspace_id = $1 order by seq desc limit 200", [wid])).map(summary);
    },
    async get(slug, id) {
      const wid = await wsId(slug);
      const r = await getRow(wid, id);
      return { ...summary(r), site: r.site };
    },
    async save(slug, { site, label, parentId }) {
      const wid = await wsId(slug);
      if (!site || typeof site !== "object" || !Array.isArray(site.blocks)) bad("Send the Studio site with its blocks.");
      const snap = snapshotOf(site);
      if (JSON.stringify(snap).length > 256 * 1024) bad("The site is larger than 256 KB.");
      const last = await db.one("select * from studio_snapshots where workspace_id = $1 order by seq desc limit 1", [wid]);
      // Saving the same site twice in a row adds nothing (a fork always adds a row).
      if (last && !parentId && canonical(snapshotOf(last.site)) === canonical(snap)) return { ...summary(last), unchanged: true };
      if (parentId) await getRow(wid, parentId);
      const seq = last ? Number(last.seq) + 1 : 1, prev = last ? last.hash : "0".repeat(64);
      const id = randomUUID();
      await db.run("insert into studio_snapshots (id, workspace_id, seq, label, site, hash, prev_hash, parent_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [id, wid, seq, String(label || "Saved").replace(/\s+/g, " ").trim().slice(0, 80) || "Saved", JSON.stringify(snap), snapshotHash(snap, prev), prev, parentId || null, iso()]);
      await store.logEvent(wid, "member:owner", "studio.snapshot", "#" + seq);
      return summary(await getRow(wid, id));
    },
    // Fork: a new snapshot at the end of the chain, with the old one's site and the old one as parent.
    async fork(slug, id) {
      const wid = await wsId(slug);
      const r = await getRow(wid, id);
      const s = await api.save(slug, { site: r.site, label: "Fork of #" + r.seq, parentId: r.id });
      return { ...s, site: r.site };
    },
    async diff(slug, a, b) {
      const wid = await wsId(slug);
      const A = await getRow(wid, a), B = await getRow(wid, b);
      const lines = lineDiff(prettyLines(A.site), prettyLines(B.site));
      return { a: summary(A), b: summary(B), blocks: blockDiff(A.site, B.site), lines, added: lines.filter(l => l.op === "add").length, removed: lines.filter(l => l.op === "del").length };
    },
    async verify(slug) {
      const wid = await wsId(slug);
      const rows = await db.all("select * from studio_snapshots where workspace_id = $1 order by seq", [wid]);
      let prev = "0".repeat(64);
      for (const r of rows) {
        if (r.prev_hash !== prev) return { ok: false, count: rows.length, brokenAt: r.seq, reason: "prev_hash does not match the snapshot before" };
        if (r.hash !== snapshotHash(r.site, r.prev_hash)) return { ok: false, count: rows.length, brokenAt: r.seq, reason: "hash does not match the site" };
        prev = r.hash;
      }
      return { ok: true, count: rows.length, head: prev };
    },
  };
  return api;
}
