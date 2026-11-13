// The live skill loader for jarvis/server (ADR-142). Skills reach a workspace four ways and are usable
// at once (Skill Mixer, agent editor, Ctrl+K), without a restart:
//   - discover: GitHub's official repository search API (keyless, fixed host, through the same SSRF
//     shield as the open-web search: fixed URL template, DNS answers checked in the socket, no redirects);
//   - import: one SKILL.md (text only) from a public GitHub repository through the contents API; scripts
//     and any other file are never fetched, and the skill's origin, licence and commit are recorded;
//   - synthesize: a SKILL.md written by the local model on 127.0.0.1 from the person's request, or by the
//     fixed forge template when no model runs;
//   - evolve: FIX (a new version of a mounted skill), DERIVED (a new skill grown from one), CAPTURED (a
//     skill written from a finished mission, its locked steps turned into stops).
// Every one passes the in-memory audit (SkillSpector's rules + the eleven loader rules); a critical or high
// finding refuses it, and the database repeats the rule (runtime_skills_scan_clean). Mounting means a row in
// runtime_skills: nothing is written to disk and nothing runs. Writing a skill into .claude/skills is an
// install, a locked approval (AGENTS.md §1). Each change is logged, append-only, in skill_evolution_log.
import { randomUUID } from "node:crypto";
import { StoreError } from "./store.mjs";
import { requestJson, SearchError } from "./open-web-search.mjs";
import { forgeSkill, readSkillMd, scanFiles, NAME_RE } from "./forge.mjs";
import { auditSkill, slugName, stepsFromMission } from "./skill-audit.mjs";
import { isLocalModelEngine } from "./ollama-bridge.mjs";
import { RULES } from "../../../scripts/skillspector-audit.mjs";

const iso = () => new Date().toISOString();
const bad = (msg, status = 400) => { throw new StoreError(status, msg); };
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const PATH_RE = /^(?:[A-Za-z0-9._-]{1,100}\/){0,6}SKILL\.md$/;
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export function createSkillLoader({ db, store, llm, request = requestJson }) {
  const wsId = slug => store.workspaceIdOf(slug);
  const out = r => ({ id: r.id, name: r.name, description: r.description, origin: r.origin, sourceUrl: r.source_url, licence: r.licence, version: r.version, parentId: r.parent_id, files: r.files, scan: r.scan, status: r.status, approvalId: r.approval_id, approvalStatus: r.approval_status || null, createdAt: r.created_at, updatedAt: r.updated_at });

  async function nameFree(wid, name) {
    const a = await db.one("select id from runtime_skills where workspace_id = $1 and name = $2 and status = 'mounted'", [wid, name]);
    const b = await db.one("select id from forged_skills where workspace_id = $1 and name = $2 and status = 'mounted'", [wid, name]);
    return !a && !b;
  }
  async function uniqueName(wid, name) {
    if (await nameFree(wid, name)) return name;
    for (let i = 2; i < 50; i++) { const n = (name.slice(0, 37) + "-v" + i).replace(/--+/g, "-"); if (await nameFree(wid, n)) return n; }
    bad("Too many skills share this name.", 409);
  }
  async function log(wid, skillId, type, parentId, note, scan) {
    await db.run("insert into skill_evolution_log (id, workspace_id, skill_id, evolution_type, parent_id, note, scan, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [randomUUID(), wid, skillId, type, parentId || null, String(note || "").slice(0, 300), JSON.stringify(scan), iso()]);
  }
  // Audit, then mount (or refuse). Returns { mounted, skill, scan }.
  async function mount(slug, { skill, origin, sourceUrl = null, licence = null, parentId = null, version = 1, evolution = null, note = "" }) {
    const wid = await wsId(slug);
    const scan = auditSkill(skill.files, RULES, scanFiles);
    if (!scan.ok) return { mounted: false, skill: { name: skill.name, description: skill.description, files: skill.files }, scan };
    const name = await uniqueName(wid, skill.name);
    if (name !== skill.name) skill = { ...skill, name, files: Object.fromEntries(Object.entries(skill.files).map(([p, t]) => [p, p === "SKILL.md" ? String(t).replace(/^name:\s*.+$/m, "name: " + name) : t])) };
    const id = randomUUID(), t = iso();
    await db.run("insert into runtime_skills (id, workspace_id, name, description, origin, source_url, licence, version, parent_id, files, scan, status, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'mounted', $12, $12)",
      [id, wid, skill.name, String(skill.description).slice(0, 300), origin, sourceUrl, licence, version, parentId, JSON.stringify(skill.files), JSON.stringify(scan), t]);
    if (evolution) await log(wid, id, evolution, parentId, note, scan);
    await store.logEvent(wid, "member:owner", "skill.mounted", skill.name, { origin, version, high: scan.high, critical: scan.critical });
    return { mounted: true, skill: (await api.list(slug)).find(s => s.id === id), scan };
  }
  async function getMounted(wid, id) {
    const r = await db.one("select * from runtime_skills where id = $1 and workspace_id = $2 and status = 'mounted'", [id, wid]);
    if (!r) bad("No mounted skill with that id.", 404);
    return r;
  }

  const api = {
    async list(slug) {
      const wid = await wsId(slug);
      const rows = await db.all("select r.*, p.status as approval_status from runtime_skills r left join approvals p on p.id = r.approval_id where r.workspace_id = $1 and r.status = 'mounted' order by r.updated_at desc", [wid]);
      return rows.map(out);
    },
    async evolutionLog(slug) {
      const wid = await wsId(slug);
      const rows = await db.all("select l.*, r.name as skill_name from skill_evolution_log l left join runtime_skills r on r.id = l.skill_id where l.workspace_id = $1 order by l.created_at desc limit 100", [wid]);
      return rows.map(l => ({ id: l.id, skillId: l.skill_id, skillName: l.skill_name, type: l.evolution_type, parentId: l.parent_id, note: l.note, scan: l.scan, createdAt: l.created_at }));
    },

    // GitHub repository search for agent skills; results are pointers to read, never installed.
    async discover(slug, { q }) {
      await wsId(slug);
      const query = clean(q, 120);
      if (query.length < 2) bad("Write at least two characters to search for.");
      let j;
      try { j = await request("https://api.github.com/search/repositories?per_page=10&q=" + encodeURIComponent(query + " SKILL.md in:readme,description"), {}); }
      catch (e) { return { q: query, offline: true, results: [], note: (e instanceof SearchError ? e.message : "GitHub did not answer.") + " Synthesize the skill locally instead." }; }
      const results = ((j && j.items) || []).map(r => ({ repo: clean(r.full_name, 140), url: /^https:\/\/github\.com\//.test(String(r.html_url)) ? r.html_url : null, description: clean(r.description, 300), stars: Number(r.stargazers_count) || 0, licence: clean(r.license && r.license.spdx_id, 40) || null, branch: clean(r.default_branch, 100) || "main", updated: clean(r.pushed_at, 30) })).filter(r => REPO_RE.test(r.repo) && r.url);
      return { q: query, offline: false, results, source: "GitHub REST API (keyless, 10 searches a minute)" };
    },

    // One SKILL.md from a public repository, through GitHub's contents API (JSON, base64), text only.
    async importFromGithub(slug, { repo, path = "SKILL.md" }) {
      const r = String(repo || "").trim(), p = String(path || "SKILL.md").trim().replace(/^\/+/, "");
      if (!REPO_RE.test(r)) bad("Write the repository as owner/name.");
      if (!PATH_RE.test(p) || p.split("/").some(x => x === "." || x === "..")) bad("Only a file named SKILL.md is imported; scripts and other files never are.");
      let meta, file;
      try {
        meta = await request("https://api.github.com/repos/" + r, {});
        file = await request("https://api.github.com/repos/" + r + "/contents/" + p.split("/").map(encodeURIComponent).join("/"), {});
      } catch (e) { bad((e instanceof SearchError ? e.message : "GitHub did not answer.") + " Nothing was imported.", 502); }
      if (!meta || !file) bad("That repository or SKILL.md was not found.", 404);
      if (meta.private) bad("Only public repositories are read.");
      if (file.type !== "file" || file.encoding !== "base64" || !(file.size > 0 && file.size <= 64 * 1024)) bad("SKILL.md must be a file of at most 64 KB.");
      const text = Buffer.from(String(file.content || "").replace(/\s+/g, ""), "base64").toString("utf8");
      const skill = readSkillMd(text);
      const licence = clean(meta.license && meta.license.spdx_id, 40) || "none stated";
      const sourceUrl = /^https:\/\/github\.com\//.test(String(file.html_url)) ? file.html_url : "https://github.com/" + r;
      return mount(slug, { skill: { ...skill, kind: "pasted" }, origin: "github", sourceUrl, licence, evolution: "CAPTURED", note: "Imported text from " + r + " (" + p + ", " + String(file.sha || "").slice(0, 12) + ")" });
    },

    // A SKILL.md from the person's request: the local model writes it when one runs, else the fixed template.
    async synthesize(slug, { request: ask, name, kind }) {
      await wsId(slug);
      const want = clean(ask, 400);
      if (want.length < 10) bad("Describe the skill or tool in a sentence (10+ characters).");
      const n = name && NAME_RE.test(String(name)) ? String(name) : slugName(want);
      let skill = null, engine = "fixed rules", warning = null;
      const st = await llm.status();
      if (st.online) {
        const r = await llm.run({ mode: "chat", prompt: "Write one SKILL.md for an agent skill. Start with front matter (--- name: " + n + " / description: one sentence ---), then '# " + n + "', a short purpose paragraph and a numbered list of at most 8 plain steps. No code, no shell commands, no URLs. Money, publishing, permissions, installs and outbound messages must be stops for a person. The skill: " + want });
        if (isLocalModelEngine(r.engine)) {
          try {
            const t = String(r.text || "").replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
            const parsed = readSkillMd(t);
            skill = { ...parsed, name: NAME_RE.test(parsed.name) ? parsed.name : n, kind: "pasted" };
            engine = r.model + " [INFERENCE - local LLM]";
          } catch (e) { warning = "The model's SKILL.md could not be read (" + e.message + "); used the fixed template."; }
        }
      }
      if (!skill) skill = forgeSkill({ name: n, description: want, kind: kind === "python-tool" ? "python-tool" : "checklist" });
      const res = await mount(slug, { skill, origin: "synthesized", evolution: "CAPTURED", note: "Synthesized by " + engine + " from: " + want });
      return { ...res, engine, warning };
    },

    // FIX: a new version of a mounted skill. DERIVED: a new skill grown from one. CAPTURED: from a mission.
    async evolve(slug, body, missions) {
      const wid = await wsId(slug);
      const type = String(body.type || "");
      if (type === "FIX") {
        const cur = await getMounted(wid, body.skillId);
        const text = String(body.skillMd || "");
        if (!text.trim()) bad("Write the corrected SKILL.md.");
        const skill = { ...readSkillMd(text), name: cur.name };
        const files = { ...(cur.files || {}), "SKILL.md": text.replace(/^name:\s*.+$/m, "name: " + cur.name) };
        const scan = auditSkill(files, RULES, scanFiles);
        if (!scan.ok) return { mounted: false, skill: { name: cur.name, files }, scan };
        await db.run("update runtime_skills set description = $1, files = $2, scan = $3, version = version + 1, updated_at = $4 where id = $5", [skill.description, JSON.stringify(files), JSON.stringify(scan), iso(), cur.id]);
        await log(wid, cur.id, "FIX", cur.id, clean(body.note, 300) || "Fixed by the founder", scan);
        await store.logEvent(wid, "member:owner", "skill.fixed", cur.name, { version: cur.version + 1 });
        return { mounted: true, skill: (await api.list(slug)).find(s => s.id === cur.id), scan };
      }
      if (type === "DERIVED") {
        const cur = await getMounted(wid, body.skillId);
        const parent = readSkillMd(cur.files["SKILL.md"]);
        const add = (Array.isArray(body.steps) ? body.steps : []).map(s => clean(s, 160)).filter(Boolean).slice(0, 6);
        const name = body.name && NAME_RE.test(String(body.name)) ? String(body.name) : (cur.name.slice(0, 36) + "-plus");
        const steps = [...String(cur.files["SKILL.md"]).split("\n").filter(l => /^\d+\.\s/.test(l)).map(l => l.replace(/^\d+\.\s*/, "")), ...add].slice(0, 10);
        const skill = forgeSkill({ name, description: clean(body.description, 300) || parent.description + " (derived)", steps });
        return mount(slug, { skill, origin: "derived", parentId: cur.id, evolution: "DERIVED", note: "Derived from " + cur.name + (add.length ? " with " + add.length + " new steps" : "") });
      }
      if (type === "CAPTURED") {
        if (!body.missionId) bad("Pick the finished mission to capture.");
        const m = await missions.detail(slug, String(body.missionId));
        if (!["succeeded", "awaiting_approval"].includes(m.status)) bad("Only a mission that finished (or waits only on locked steps) can be captured.");
        const skill = forgeSkill({ name: body.name && NAME_RE.test(String(body.name)) ? String(body.name) : slugName(m.title, "captured-mission"), description: "Repeat the mission “" + clean(m.title, 120) + "” the way it worked.", steps: stepsFromMission(m) });
        return mount(slug, { skill, origin: "captured", evolution: "CAPTURED", note: "Captured from mission " + clean(m.title, 120) });
      }
      bad("Evolution type is FIX, DERIVED or CAPTURED.");
    },

    async unmount(slug, id) {
      const wid = await wsId(slug);
      const r = await db.run("update runtime_skills set status = 'removed', updated_at = $1 where id = $2 and workspace_id = $3 and status = 'mounted'", [iso(), id, wid]);
      if (!r.changes) bad("No mounted skill with that id.", 404);
      await store.logEvent(wid, "member:owner", "skill.unmounted", id);
      return { ok: true };
    },
    // Writing the skill into .claude/skills is an install: a locked approval, never done here.
    async requestInstall(slug, id) {
      const wid = await wsId(slug);
      const r = await getMounted(wid, id);
      if (r.approval_id) return { locked: true, approvalId: r.approval_id };
      const apId = await store.createApproval(wid, { category: "install", action: "Install the skill “" + r.name + "” into .claude/skills", payload: { skill: r.name, origin: r.origin, source: r.source_url, licence: r.licence, files: Object.keys(r.files || {}), note: "Needs Director 00's approval and a written security review (AGENTS.md §1)." }, actor: "member:owner" });
      await db.run("update runtime_skills set approval_id = $1, updated_at = $2 where id = $3", [apId, iso(), id]);
      return { locked: true, approvalId: apId };
    },
  };
  return api;
}
