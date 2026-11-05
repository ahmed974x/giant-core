// The memory bank and the Skill Forge for jarvis/server (ADR-138).
//
// Memory: episodes (plans, designs, answers, lessons, notes, later search results) kept per
// workspace in agent_memory_episodes and ranked with BM25 (bm25.mjs). Episodes that passed their
// gates rank higher. The best few are handed to the local model as examples, marked as data, so the
// workspace's own good work shapes the next plan or design: retrieval, not training. A self-check
// session asks questions whose answers Jarvis computes itself (contrast, locks, spacing); with a model
// it grades the model's answers, and every correct answer is stored as a lesson either way.
// Nothing with a key-shaped value is stored.
//
// Forge: skills written by forge.mjs (or pasted) and scanned with SkillSpector's rules are "mounted"
// in forged_skills: usable in this workspace's Skill Mixer and agent editor at once. Writing one into
// .claude/skills is an install: a locked approval, never done here (AGENTS.md §1).
import { randomUUID } from "node:crypto";
import { StoreError } from "./store.mjs";
import { bm25 } from "./bm25.mjs";
import { forgeSkill, readSkillMd, scanFiles } from "./forge.mjs";
import { selfCheckItem } from "./selfcheck.mjs";
export { selfCheckItem } from "./selfcheck.mjs";
import { RULES } from "../../../scripts/skillspector-audit.mjs";

const iso = () => new Date().toISOString();
const bad = (msg, status = 400) => { throw new StoreError(status, msg); };
export const KINDS = ["plan", "design", "answer", "lesson", "note", "search", "skill"];
const KEY_RULE = RULES.find(r => r.id === "SEC-KEY-LITERAL");
const looksSecret = s => KEY_RULE && new RegExp(KEY_RULE.re, KEY_RULE.flags || "").test(String(s));

function grade(item, text) {
  const t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim().toLowerCase();
  if (item.category === "spacing") return ((/\d+/.exec(t) || [])[0] || "") === item.expect;
  const first = (/\b(yes|no|نعم|لا)\b/.exec(t) || [])[1];
  return first ? ({ "نعم": "yes", "لا": "no" }[first] || first) === item.expect : false;
}

export function createMemory({ db, store, llm }) {
  const wsId = slug => store.workspaceIdOf(slug);
  const out = e => ({ id: e.id, kind: e.kind, title: e.title, body: e.body, tags: e.tags || [], outcome: e.outcome || {}, source: e.source, createdAt: e.created_at });
  const passed = o => o && typeof o === "object" ? Object.values(o).filter(v => v === true).length : 0;

  const api = {
    async add(slug, { kind, title, body, tags, outcome, source }) {
      const wid = await wsId(slug);
      if (!KINDS.includes(kind)) bad("Kind is one of " + KINDS.join(", ") + ".");
      const t = String(title || "").replace(/\s+/g, " ").trim().slice(0, 160), b = String(body || "").trim().slice(0, 8000);
      if (!t || !b) bad("A memory needs a title and some text.");
      if (looksSecret(t + "\n" + b)) bad("That text holds a key-shaped value. Keys belong in the vault, never in memory.");
      const tg = (Array.isArray(tags) ? tags : []).map(x => String(x).toLowerCase().replace(/[^a-z0-9؀-ۿ-]/g, "").slice(0, 24)).filter(Boolean).slice(0, 8);
      const id = randomUUID();
      await db.run("insert into agent_memory_episodes (id, workspace_id, kind, title, body, tags, outcome, source, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [id, wid, kind, t, b, JSON.stringify(tg), JSON.stringify(outcome && typeof outcome === "object" ? outcome : {}), String(source || "person").slice(0, 80), iso()]);
      return out(await db.one("select * from agent_memory_episodes where id = $1", [id]));
    },
    async search(slug, { q = "", kind = "", limit = 20 } = {}) {
      const wid = await wsId(slug);
      const rows = await db.all("select * from agent_memory_episodes where workspace_id = $1 order by created_at desc limit 5000", [wid]);
      const pool = rows.filter(r => !kind || r.kind === kind);
      const total = pool.length;
      if (!String(q).trim()) return { total, hits: pool.slice(0, limit).map(r => ({ ...out(r), score: null, terms: [] })) };
      const byId = new Map(pool.map(r => [r.id, r]));
      const ranked = bm25(pool.map(r => ({ id: r.id, text: r.title + "\n" + r.body + "\n" + (r.tags || []).join(" "), boost: 1 + 0.25 * passed(r.outcome) })), q, { limit });
      return { total, hits: ranked.map(h => ({ ...out(byId.get(h.id)), score: h.score, terms: h.terms })) };
    },
    async remove(slug, id) {
      const wid = await wsId(slug);
      const r = await db.run("delete from agent_memory_episodes where id = $1 and workspace_id = $2", [id, wid]);
      if (!r.changes) bad("No memory with that id in this workspace.", 404);
      return { ok: true };
    },
    // The best few episodes for a prompt, as plain examples for the local model (data, not instructions).
    async examples(slug, prompt, k = 3) {
      if (!slug) return [];
      const { hits } = await api.search(slug, { q: prompt, limit: 12 });
      return hits.filter(h => ["plan", "design", "lesson", "answer", "search", "note"].includes(h.kind)).slice(0, k).map(h => ({ id: h.id, kind: h.kind, title: h.title, text: h.body.slice(0, 1500) }));
    },
    async exportJsonl(slug) {
      const wid = await wsId(slug);
      const rows = await db.all("select * from agent_memory_episodes where workspace_id = $1 order by created_at", [wid]);
      return rows.map(r => JSON.stringify({ id: r.id, kind: r.kind, outcome: r.outcome || {}, messages: [{ role: "user", content: r.title }, { role: "assistant", content: r.body }] })).join("\n") + (rows.length ? "\n" : "");
    },
    async selfCheck(slug, { n = 9, start } = {}) {
      const count = Math.max(3, Math.min(30, Number(n) || 9));
      const from = Number.isInteger(start) ? start : Math.floor(Date.now() / 60000) % 997;
      const items = [...Array(count)].map((_, k) => selfCheckItem(from + k));
      const status = await llm.status();
      const results = [];
      for (const it of items) {
        let reply = null, ok = null;
        if (status.online) {
          const r = await llm.run({ mode: "chat", prompt: it.question });
          reply = r.text || "";
          ok = r.engine === "ollama-local-loopback" ? grade(it, reply) : null;
        }
        results.push({ ...it, reply: reply ? reply.slice(0, 400) : null, correct: ok });
        // Every computed answer becomes a lesson; a model's wrong answer is kept next to it.
        await api.add(slug, { kind: "lesson", title: it.question, body: it.answer + (ok === false ? "\n\nThe local model answered differently: " + String(reply).slice(0, 300) : ""), tags: ["self-check", it.category], outcome: { computed: true, modelCorrect: ok }, source: "self-check" });
      }
      const graded = results.filter(r => r.correct !== null);
      return { engine: status.online ? "ollama-local-loopback" : "deterministic-rules", asked: results.length, graded: graded.length, correct: graded.filter(r => r.correct).length, items: results,
        note: status.online ? "Graded against answers Jarvis computed itself." : "No model running: the computed answers were stored as lessons for later." };
    },

    // ---- Skill Forge ----
    async forgeList(slug) {
      const wid = await wsId(slug);
      const rows = await db.all("select f.*, p.status as approval_status from forged_skills f left join approvals p on p.id = f.approval_id where f.workspace_id = $1 and f.status = 'mounted' order by f.created_at desc", [wid]);
      return rows.map(r => ({ id: r.id, name: r.name, description: r.description, kind: r.kind, files: r.files, scan: r.scan, status: r.status, approvalId: r.approval_id, approvalStatus: r.approval_status, createdAt: r.created_at }));
    },
    async forge(slug, body) {
      const wid = await wsId(slug);
      const skill = body.skillMd ? readSkillMd(body.skillMd) : forgeSkill(body);
      const scan = scanFiles(skill.files, RULES);
      const taken = await db.one("select id from forged_skills where workspace_id = $1 and name = $2 and status = 'mounted'", [wid, skill.name]);
      if (taken) bad("A mounted skill already has this name in this workspace.", 409);
      if (!scan.ok) return { mounted: false, skill: { name: skill.name, files: skill.files }, scan };
      const id = randomUUID();
      await db.run("insert into forged_skills (id, workspace_id, name, description, kind, files, scan, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, 'mounted', $8, $8)",
        [id, wid, skill.name, skill.description, skill.kind, JSON.stringify(skill.files), JSON.stringify(scan), iso()]);
      await store.logEvent(wid, "member:owner", "skill.forged", skill.name, { files: Object.keys(skill.files), high: scan.high, critical: scan.critical });
      await api.add(slug, { kind: "skill", title: "Skill " + skill.name, body: skill.description + "\n\n" + Object.keys(skill.files).join(", "), tags: ["forge"], outcome: { scanned: true }, source: "forge" });
      return { mounted: true, skill: (await api.forgeList(slug)).find(s => s.id === id), scan };
    },
    async unmount(slug, id) {
      const wid = await wsId(slug);
      const r = await db.run("update forged_skills set status = 'removed', updated_at = $1 where id = $2 and workspace_id = $3 and status = 'mounted'", [iso(), id, wid]);
      if (!r.changes) bad("No mounted skill with that id.", 404);
      return { ok: true };
    },
    // Writing a skill into the repository is an install: a locked approval, never done here.
    async requestInstall(slug, id) {
      const wid = await wsId(slug);
      const f = await db.one("select * from forged_skills where id = $1 and workspace_id = $2 and status = 'mounted'", [id, wid]);
      if (!f) bad("No mounted skill with that id.", 404);
      if (f.approval_id) return { locked: true, approvalId: f.approval_id };
      const apId = await store.createApproval(wid, { category: "install", action: "Install the forged skill “" + f.name + "” into .claude/skills", payload: { skill: f.name, files: Object.keys(f.files || {}), scan: f.scan, note: "Needs Director 00's approval and a written security review (AGENTS.md §1)." }, actor: "member:owner" });
      await db.run("update forged_skills set approval_id = $1, updated_at = $2 where id = $3", [apId, iso(), id]);
      return { locked: true, approvalId: apId };
    },
  };
  return api;
}
