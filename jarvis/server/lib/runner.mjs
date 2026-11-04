// Real runs for jarvis/server (ADR-134). Each step runs a real tool against real files, the real
// database or one public page; nothing is simulated. Planning and summarising use fixed rules, and
// every run says so, because no model is wired in yet (the local model bridge is a later step).
// Writing a note never happens inside the run: it becomes a file_write approval, and the file is
// written only after a person approves it. Locked categories are never created by a run.
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve, relative, sep, basename } from "node:path";
import { fetchPublicPage } from "./fetch-public.mjs";

const STEP_TIMEOUT_MS = 15000;
const MAX_FILES = 20, MAX_FILE_BYTES = 200 * 1024;

export function createRunner({ store, repoRoot, dataDir }) {
  const READ_ROOTS = ["docs", "jarvis/replica", "jarvis/README.md"].map(p => resolve(repoRoot, p));
  const notesDir = slug => join(dataDir, "workspaces", slug, "notes");

  // Resolve a path the agent asked for and refuse anything outside the read roots (after symlinks).
  function safeReadPath(p, slug) {
    const raw = String(p || "").trim().replace(/^\/+/, "");
    if (!raw) throw new Error("Give a path under docs/ or jarvis/replica/.");
    const roots = [...READ_ROOTS, resolve(notesDir(slug))];
    const isNotes = raw.startsWith("notes/");
    const abs = isNotes ? resolve(notesDir(slug), raw.slice(6)) : resolve(repoRoot, raw);
    const inside = r => abs === r || abs.startsWith(r + sep);
    if (!roots.some(inside)) throw new Error("Only docs/, jarvis/replica/ and this workspace's notes/ can be read.");
    return abs;
  }
  // Files matching a path (a file, a folder, or a folder/prefix*), re-checked after resolving symlinks.
  function listMatches(abs, slug) {
    const dir = abs.endsWith("*") ? abs.slice(0, abs.lastIndexOf(sep)) : abs;
    const prefix = abs.endsWith("*") ? basename(abs).slice(0, -1) : null;
    if (!existsSync(dir)) throw new Error("Nothing at " + relative(repoRoot, dir).split(sep).join("/") + ".");
    const real = realpathSync(dir);
    const notes = existsSync(notesDir(slug)) ? realpathSync(notesDir(slug)) : null;
    const roots = [...READ_ROOTS.filter(existsSync).map(r => realpathSync(r)), ...(notes ? [notes] : [])];
    if (!roots.some(r => real === r || real.startsWith(r + sep))) throw new Error("That path leaves the allowed folders.");
    if (statSync(real).isFile()) return [real];
    return readdirSync(real).filter(f => /\.(md|txt|csv|json|sql)$/i.test(f) && (!prefix || f.startsWith(prefix))).sort().slice(0, MAX_FILES).map(f => join(real, f)).filter(f => statSync(f).isFile());
  }
  const firstHeading = text => (/^#\s+(.+)$/m.exec(text) || [])[1] || null;

  const TOOLS = {
    async "files.read"(ctx) {
      const abs = safeReadPath(ctx.input.path || ctx.defaultPath, ctx.slug);
      const files = listMatches(abs, ctx.slug);
      if (!files.length) throw new Error("No readable files matched.");
      return { files: files.map(f => { const st = statSync(f); const text = st.size <= MAX_FILE_BYTES ? readFileSync(f, "utf8") : ""; return { path: relative(repoRoot, f).split(sep).join("/"), bytes: st.size, heading: firstHeading(text), lines: text ? text.split("\n").length : null }; }) };
    },
    async "notes.read"(ctx) {
      const dir = notesDir(ctx.slug);
      if (!existsSync(dir)) return { notes: [] };
      return { notes: readdirSync(dir).filter(f => f.endsWith(".md")).sort().map(f => { const t = readFileSync(join(dir, f), "utf8"); return { name: f, bytes: Buffer.byteLength(t), heading: firstHeading(t) }; }) };
    },
    async "runs.read"(ctx) {
      const runs = await store.listRuns(ctx.slug);
      const by = {};
      for (const r of runs) by[r.status] = (by[r.status] || 0) + 1;
      return { total: runs.length, byStatus: by, latest: runs.slice(0, 5).map(r => ({ id: r.id, agent: r.agentName, status: r.status })) };
    },
    async "git.log"() {
      const head = join(repoRoot, ".git", "logs", "HEAD");
      if (!existsSync(head)) throw new Error("No git history file at .git/logs/HEAD.");
      const lines = readFileSync(head, "utf8").trim().split("\n").slice(-10).reverse();
      return { commits: lines.map(l => { const m = /^(\w+) (\w+) (.+?) <[^>]*> (\d+) [+-]\d{4}\t(.*)$/.exec(l); return m ? { sha: m[2].slice(0, 7), author: m[3], at: new Date(Number(m[4]) * 1000).toISOString(), message: m[5].replace(/^(commit|merge|checkout)(\s\(\w+\))?:\s*/, "") } : null; }).filter(Boolean) };
    },
    async "web.read"(ctx) {
      if (!ctx.input.url) throw new Error("Give a public https:// address for web.read.");
      const page = await fetchPublicPage(ctx.input.url);
      const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page.html) || [])[1] || "";
      return { url: page.url, bytes: page.bytes, robots: page.robots, title: title.replace(/\s+/g, " ").trim().slice(0, 160), headings: (page.html.match(/<h[1-3][\s>]/gi) || []).length };
    },
  };

  function plan(agent) {
    const tools = agent.tools.filter(t => t !== "notes.write" && TOOLS[t]);
    return ["plan", ...tools, "summarise", ...(agent.tools.includes("notes.write") ? ["notes.write"] : [])];
  }

  function summarise(agent, outputs) {
    const lines = ["# " + agent.name + " · " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", "", "Made by fixed rules from this run's tool output; no model was used.", ""];
    for (const [tool, out] of outputs) {
      lines.push("## " + tool);
      if (out.files) out.files.forEach(f => lines.push("- `" + f.path + "` — " + (f.heading || "no heading") + " (" + f.bytes + " bytes)"));
      else if (out.notes) lines.push(out.notes.length ? out.notes.map(n => "- " + n.name + " — " + (n.heading || "no heading")).join("\n") : "- No notes yet.");
      else if (out.commits) out.commits.forEach(c => lines.push("- " + c.sha + " " + c.message));
      else if (out.byStatus) lines.push("- " + out.total + " runs: " + Object.entries(out.byStatus).map(([k, v]) => v + " " + k).join(", "));
      else if (out.url) lines.push("- " + out.url + " — " + (out.title || "no title") + ", " + out.headings + " headings, robots " + out.robots);
      lines.push("");
    }
    return lines.join("\n");
  }

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("The step took longer than " + ms / 1000 + " s.")), ms))]);

  async function start(slug, agentId, input) {
    const agent = await store.getAgent(slug, agentId);
    const steps = plan(agent);
    if (steps.length > agent.maxSteps) throw Object.assign(new Error("This plan has " + steps.length + " steps; the agent's limit is " + agent.maxSteps + "."), { status: 400 });
    const runInput = { ...(input || {}) };
    if (agent.tools.includes("files.read") && !runInput.path) runInput.path = defaultPathFor(agent);
    const { id, workspaceId } = await store.createRun(slug, agentId, runInput, steps);
    // Run in the background; the page polls the run. A crash still ends the run as failed.
    setImmediate(() => execute(slug, workspaceId, agent, id, steps, runInput).catch(async e => {
      await store.setRun(id, { status: "failed", finished_at: new Date().toISOString() }).catch(() => {});
      await store.setAgentStatus(agent.id, "failed").catch(() => {});
      await store.logEvent(workspaceId, "system", "run.crashed", id, { error: String(e && e.message) }).catch(() => {});
    }));
    return id;
  }

  function defaultPathFor(agent) {
    if (/token|design/i.test(agent.name)) return "jarvis/replica/design";
    return "docs/adr/ADR-13*";
  }

  async function execute(slug, wid, agent, runId, steps, input) {
    const log = [];
    const push = async line => { log.push(line); await store.setRun(runId, { log }); };
    const outputs = [];
    await store.setRun(runId, { status: "running", started_at: new Date().toISOString() });
    for (const [idx, tool] of steps.entries()) {
      const run = await store.runRecord(runId);
      if (!run || run.status === "cancelled") return;
      await store.setStep(runId, idx, { status: "running", tries: 1 });
      const t0 = Date.now();
      try {
        let out;
        if (tool === "plan") out = { steps, by: "fixed rules (no model)" };
        else if (tool === "summarise") out = { markdown: summarise(agent, outputs) };
        else if (tool === "notes.write") {
          const md = (outputs.find(o => o[0] === "summarise") || [null, { markdown: "" }])[1].markdown;
          const name = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".md";
          const apId = await store.createApproval(wid, { runId, category: "file_write", action: "Save the run summary to notes/" + name, payload: { path: "notes/" + name, bytes: Buffer.byteLength(md), preview: md.slice(0, 600), content: md, agent: agent.name }, actor: "agent:" + agent.id });
          out = { approval: apId, path: "notes/" + name };
        } else out = await withTimeout(TOOLS[tool]({ slug, input, defaultPath: defaultPathFor(agent) }), STEP_TIMEOUT_MS);
        outputs.push([tool, out]);
        const ms = Date.now() - t0;
        await store.setStep(runId, idx, { status: "ok", ms, output: out });
        await push(tool + "  ok  " + ms + " ms" + (tool === "notes.write" ? "  approval requested" : tool === "plan" ? "  " + (steps.length - 1) + " steps, fixed rules" : out.files ? "  " + out.files.length + " files" : out.commits ? "  " + out.commits.length + " commits" : ""));
      } catch (e) {
        await store.setStep(runId, idx, { status: "failed", ms: Date.now() - t0, output: { error: e.message } });
        await push(tool + "  failed: " + e.message);
        for (let j = idx + 1; j < steps.length; j++) await store.setStep(runId, j, { status: "skipped" });
        await store.setRun(runId, { status: "failed", finished_at: new Date().toISOString() });
        await store.setAgentStatus(agent.id, "failed");
        await store.logEvent(wid, "agent:" + agent.id, "run.failed", runId, { step: tool, error: e.message });
        return;
      }
    }
    await store.setRun(runId, { status: "succeeded", finished_at: new Date().toISOString() });
    await store.setAgentStatus(agent.id, "idle");
    await store.logEvent(wid, "agent:" + agent.id, "run.succeeded", runId);
  }

  // Runs after a person approves a file_write: write the note inside this workspace's notes folder.
  function applyApproval(slug, approval) {
    if (approval.category !== "file_write" || approval.status !== "approved") return null;
    const p = approval.payload || {};
    if (typeof p.path !== "string" || !p.path.startsWith("notes/") || typeof p.content !== "string") return null;
    const dir = resolve(notesDir(slug));
    const abs = resolve(dir, p.path.slice(6));
    if (!abs.startsWith(dir + sep) || !abs.endsWith(".md")) throw new Error("The note path leaves the workspace's notes folder.");
    mkdirSync(dir, { recursive: true });
    writeFileSync(abs, p.content, { flag: "wx" });
    return relative(dataDir, abs).split(sep).join("/");
  }

  return { start, plan, applyApproval, notesDir, TOOLS };
}
