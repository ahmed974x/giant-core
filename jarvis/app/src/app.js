// Jarvis app (ADR-133). One static page: hash router, an in-page data layer with the same
// function names as the phase 2 API (jarvis/replica/architecture.md), and no network
// (CSP connect-src 'none'). Text goes in with textContent only; no innerHTML, no eval.
(() => {
  "use strict";

  /* ── Data from the build: skills snapshot, SkillSpector rules, preview hashes ── */
  const DATA = (() => {
    try { return JSON.parse(document.getElementById("jarvis-data").textContent); }
    catch (e) { return { skills: [], scan: null, preview: {}, built: "" }; }
  })();
  // SkillSpector's rule set, inlined by the build between the scanner's data markers.
  const SPECTOR_RULES = /*@RULES@*/[];

  /* ── Small helpers ─────────────────────────────────────────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;
  const PROPS = new Set(["value", "checked", "disabled", "type", "hidden", "id", "htmlFor", "name", "placeholder",
    "autocomplete", "href", "tabIndex", "rows", "min", "max", "step", "maxLength", "readOnly", "open", "selected", "title", "spellcheck"]);
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "dataset") Object.assign(n.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) n[k] = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const SVG = "http://www.w3.org/2000/svg";
  function icon(id, cls) {
    const s = document.createElementNS(SVG, "svg");
    s.setAttribute("class", "i" + (cls ? " " + cls : ""));
    s.setAttribute("aria-hidden", "true");
    const u = document.createElementNS(SVG, "use");
    u.setAttribute("href", "#" + id);
    s.appendChild(u);
    return s;
  }
  const store$ = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage off: the page still works */ } },
  };
  const fmtN = new Intl.NumberFormat("en");
  const rel = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const fmtDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
  function ago(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    const a = Math.abs(s);
    if (a < 45) return "just now";
    if (a < 3600) return rel.format(Math.round(s / 60), "minute");
    if (a < 86400) return rel.format(Math.round(s / 3600), "hour");
    return rel.format(Math.round(s / 86400), "day");
  }
  const timeEl = ts => h("time", { class: "subtle t-caption", datetime: new Date(ts).toISOString(), title: fmtDate.format(ts), text: ago(ts) });
  const plural = (n, word) => fmtN.format(n) + " " + word + (n === 1 ? "" : "s");
  const dur = ms => (ms == null ? "—" : ms < 1000 ? fmtN.format(ms) + " ms" : (ms / 1000).toFixed(1) + " s");

  /* ── Data layer (phase 1: in-page sample data; phase 2 swaps in /api with the same names) ── */
  const LOCKED = { money: "moves money", publish: "publishes to an outside domain", permissions: "changes repository permissions", install: "installs a skill into the repo", outbound: "sends a message outside" };
  const TOOL_LIST = ["files.read", "notes.read", "notes.write", "runs.read", "git.log", "web.read"];
  const WORKSPACES = [["omega-prime", "OMEGA PRIME"], ["jarvis-studio", "Jarvis Studio"], ["giant-core", "giant-core"]];

  // Shared validation (the server runs the same rules and has the final say).
  function validateAgentInput(input, existing, exceptId) {
    const errs = {};
    const name = String(input.name || "").trim();
    if (!name) errs.name = "Give the agent a name.";
    else if (name.length > 60) errs.name = "Use 60 characters or fewer.";
    else if (existing.some(a => a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase())) errs.name = "Another agent already has this name.";
    if (String(input.rolePrompt || "").length > 2000) errs.rolePrompt = "Keep the role under 2,000 characters.";
    const ms = Number(input.maxSteps);
    if (!Number.isInteger(ms) || ms < 1 || ms > 200) errs.maxSteps = "Enter a whole number from 1 to 200.";
    return errs;
  }
  const permsOf = tools => ({ writeNotes: tools.includes("notes.write"), readWeb: tools.includes("web.read") });

  /* Sample store: opened from disk (file://). Labelled sample data, simulated runs, three workspaces. */
  function sampleStore() {
    const uid = p => p + "_" + Math.random().toString(36).slice(2, 9);
    let db, failMode = false;
    const subs = new Set();
    const MIN = 60000;
    function ev(actor, kind, target, at) { return { id: uid("ev"), actor, kind, target, at: at || Date.now() }; }
    function mkSteps(tools, status, n) { return tools.slice(0, n == null ? tools.length : n + 1).map((tool, i) => ({ idx: i, tool, status, ms: 400 + i * 350, tries: 1 })); }
    const agent = (id, name, model, rolePrompt, tools, maxSteps, status, createdAt, skills) => ({ id, name, model, rolePrompt, tools, skills: skills || [], maxSteps, permissions: permsOf(tools), status, createdAt });
    function seedPrime(t) {
      const agents = [
        agent("ag_research", "Research assistant", "Local model (loopback)", "Reads public pages on a topic and writes a short, sourced summary. Never acts outside the project folder.", ["web.read", "notes.write"], 20, "idle", t - 9 * 86400000, ["omega-deep-research-agent"]),
        agent("ag_inbox", "Inbox triage", "Local model (loopback)", "Sorts incoming notes into topics. Drafts replies but never sends them.", ["notes.read", "notes.write"], 12, "idle", t - 7 * 86400000),
        agent("ag_weekly", "Weekly report", "Local model (loopback)", "Collects the week's runs and writes a plain summary for Director 00.", ["runs.read", "notes.write"], 15, "idle", t - 5 * 86400000),
        agent("ag_docs", "Docs indexer", "Local model (loopback)", "Builds a searchable index of the docs folder.", ["files.read"], 30, "failed", t - 3 * 86400000),
        agent("ag_release", "Release notes writer", "Hosted model (key in vault)", "Turns merged changes into release notes. Publishing them is Ahmad's call.", ["git.log", "notes.write"], 10, "idle", t - 2 * 86400000, ["replica-build"]),
      ];
      const runs = [
        { id: "run_a1", agentId: "ag_research", status: "succeeded", trigger: "manual", createdAt: t - 26 * MIN, startedAt: t - 26 * MIN, finishedAt: t - 25 * MIN, steps: mkSteps(["plan", "web.read", "web.read", "notes.write"], "ok"), log: ["plan  3 steps, budget 20", "web.read  200", "web.read  200", "notes.write  approval requested"], simulated: true },
        { id: "run_a2", agentId: "ag_docs", status: "failed", trigger: "manual", createdAt: t - 70 * MIN, startedAt: t - 70 * MIN, finishedAt: t - 69 * MIN, steps: mkSteps(["plan", "files.read", "index.write"], "ok", 2), log: ["plan  2 steps", "files.read  42 files", "index.write  stopped: the index folder is outside the sandbox"], simulated: true },
        { id: "run_a3", agentId: "ag_inbox", status: "succeeded", trigger: "manual", createdAt: t - 5 * 60 * MIN, startedAt: t - 5 * 60 * MIN, finishedAt: t - 5 * 60 * MIN + 41000, steps: mkSteps(["plan", "notes.read", "notes.write"], "ok"), log: ["plan  2 steps", "notes.read  18 notes", "notes.write  topics saved"], simulated: true },
      ];
      runs[1].steps[2].status = "failed";
      const approvals = [
        { id: "ap_1", category: "file_write", runId: "run_a1", agentId: "ag_research", action: "Save the summary to notes/research-summary.md", payload: "+ notes/research-summary.md (2.1 KB)", status: "pending", createdAt: t - 25 * MIN },
        { id: "ap_2", category: "file_write", runId: null, agentId: "ag_inbox", action: "Delete three old draft notes", payload: "- notes/draft-1.md\n- notes/draft-2.md\n- notes/draft-3.md", status: "pending", createdAt: t - 50 * MIN },
        { id: "ap_3", category: "file_write", runId: "run_a3", agentId: "ag_inbox", action: "Write topic index to notes/topics.md", payload: "+ notes/topics.md (0.8 KB)", status: "approved", decidedBy: "member:owner", decidedAt: t - 4 * 60 * MIN, createdAt: t - 5 * 60 * MIN },
        { id: "ap_4", category: "money", agentId: "ag_weekly", action: "Pay a supplier invoice", payload: "No amount is shown: money actions never run from Jarvis.", status: "pending", createdAt: t - 3 * 60 * MIN },
        { id: "ap_5", category: "publish", agentId: "ag_release", action: "Publish the release notes site to a public domain", payload: "target: a public domain", status: "pending", createdAt: t - 2 * 60 * MIN },
        { id: "ap_6", category: "permissions", agentId: "ag_release", action: "Give this agent push access to giant-core", payload: "repository: ahmed974x/giant-core", status: "pending", createdAt: t - 100 * MIN },
        { id: "ap_7", category: "install", agentId: "ag_research", action: "Install a new skill into .claude/skills", payload: "skill: a third-party SKILL.md", status: "pending", createdAt: t - 90 * MIN },
        { id: "ap_8", category: "outbound", agentId: "ag_inbox", action: "Send a reply email", payload: "to: one contact", status: "pending", createdAt: t - 40 * MIN },
      ];
      const events = [ev("member:owner", "workspace.open", "OMEGA PRIME", t - 9 * 86400000), ev("agent:ag_inbox", "run.succeeded", "run_a3", t - 5 * 60 * MIN + 41000), ev("member:owner", "approval.approved", "ap_3", t - 4 * 60 * MIN), ev("agent:ag_docs", "run.failed", "run_a2", t - 69 * MIN), ev("agent:ag_research", "approval.requested", "ap_1", t - 25 * MIN), ev("agent:ag_research", "run.succeeded", "run_a1", t - 25 * MIN)];
      return { members: [{ id: "member:owner", email: "owner (Director 00)", role: "owner" }], agents, runs, approvals, events };
    }
    function seedSmall(t, list, locked) {
      return { members: [{ id: "member:owner", email: "owner (Director 00)", role: "owner" }],
        agents: list.map(([id, name, tools, role, skills], i) => agent(id, name, "Local rules (no model)", role, tools, 12, "idle", t - (i + 1) * 3600000, skills)),
        runs: [], events: [ev("system", "workspace.created", "", t - 86400000)],
        approvals: locked.map(([category, action], i) => ({ id: uid("ap"), category, agentId: null, action, payload: "Sample request: seeded so the locked card is visible.", status: "pending", createdAt: t - (i + 1) * 1800000 })) };
    }
    function seed() {
      const t = Date.now();
      return { v: 2, workspaces: WORKSPACES.map(([slug, name]) => ({ slug, name })), data: {
        "omega-prime": seedPrime(t),
        "jarvis-studio": seedSmall(t, [["ag_tokens", "Design token auditor", ["files.read", "notes.write"], "Reads jarvis/replica/design and reports which tokens changed.", ["replica-design"]], ["ag_notes", "Release notes writer", ["git.log", "notes.write"], "Turns recent commits into release notes.", ["replica-build"]]], [["publish", "Publish the Studio site to a public domain"], ["install", "Install a new skill into .claude/skills"]]),
        "giant-core": seedSmall(t, [["ag_commits", "Commit summariser", ["git.log", "notes.write"], "Summarises the latest commits on this branch.", []], ["ag_lib", "Notes librarian", ["notes.read", "files.read"], "Lists the notes this workspace has written.", []]], [["permissions", "Give an agent push access to giant-core"]]),
      } };
    }
    function load() {
      const saved = store$.get("jarvis-sample-v2");
      if (saved) { try { const d = JSON.parse(saved); if (d && d.v === 2 && d.data) return d; } catch (e) { /* reseed */ } }
      return seed();
    }
    let slug = store$.get("jarvis-ws") || "omega-prime";
    db = load();
    if (!db.data[slug]) slug = db.workspaces[0].slug;
    for (const w of Object.values(db.data)) {
      for (const r of w.runs) if (r.status === "running" || r.status === "queued") { r.status = "cancelled"; r.finishedAt = Date.now(); }
      for (const a of w.agents) if (a.status === "running") a.status = "idle";
    }
    const W = () => db.data[slug];
    const save = () => { store$.set("jarvis-sample-v2", JSON.stringify(db)); subs.forEach(fn => fn()); };
    const clone = v => JSON.parse(JSON.stringify(v));
    // A short delay stands in for the network of live mode, so loading states are real code paths.
    const ok = v => new Promise((res, rej) => setTimeout(() => (failMode ? rej(new Error("The data layer is set to fail on purpose (Settings → Test error states).")) : res(clone(v))), 60));
    const bad = msg => new Promise((res, rej) => setTimeout(() => rej(new Error(msg)), 60));
    const activeRun = id => W().runs.find(r => r.agentId === id && (r.status === "running" || r.status === "queued"));
    const api = {
      mode: "sample",
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
      setFail(on) { failMode = !!on; },
      get failMode() { return failMode; },
      get slug() { return slug; },
      reset() { db = seed(); save(); },
      listWorkspaces() { return ok(db.workspaces); },
      switchWorkspace(s) { if (!db.data[s]) return bad("No workspace called “" + s + "”."); slug = s; store$.set("jarvis-ws", s); subs.forEach(fn => fn()); return ok(db.workspaces.find(w => w.slug === s)); },
      workspace() { return ok(db.workspaces.find(w => w.slug === slug)); },
      renameWorkspace(name) {
        const n = String(name || "").trim();
        if (!n || n.length > 80) return bad("Use 1 to 80 characters.");
        db.workspaces.find(w => w.slug === slug).name = n; W().events.push(ev("member:owner", "workspace.renamed", n)); save(); return ok(db.workspaces.find(w => w.slug === slug));
      },
      members() { return ok(W().members); },
      listAgents({ status, q } = {}) {
        const query = String(q || "").trim().toLowerCase();
        return ok(W().agents.filter(a => (!status || a.status === status) && (!query || (a.name + " " + a.model + " " + a.tools.join(" ")).toLowerCase().includes(query)))
          .map(a => ({ ...a, runs: W().runs.filter(r => r.agentId === a.id).length, lastRun: Math.max(0, ...W().runs.filter(r => r.agentId === a.id).map(r => r.createdAt)) || null })));
      },
      getAgent(id) {
        const a = W().agents.find(x => x.id === id);
        if (!a) return bad("No agent with that id in this workspace.");
        return ok({ ...a, runs: W().runs.filter(r => r.agentId === id).sort((x, y) => y.createdAt - x.createdAt), active: !!activeRun(id) });
      },
      createAgent(input) {
        const errs = validateAgentInput(input, W().agents);
        if (Object.keys(errs).length) return bad(Object.values(errs)[0]);
        const tools = input.tools || [];
        const a = agent(uid("ag"), input.name.trim(), input.model, String(input.rolePrompt || "").trim(), tools, Number(input.maxSteps), "idle", Date.now(), input.skills || []);
        W().agents.push(a); W().events.push(ev("member:owner", "agent.created", a.id)); save(); return ok(a);
      },
      updateAgent(id, input) {
        const a = W().agents.find(x => x.id === id);
        if (!a) return bad("No agent with that id in this workspace.");
        const errs = validateAgentInput(input, W().agents, id);
        if (Object.keys(errs).length) return bad(Object.values(errs)[0]);
        Object.assign(a, { name: input.name.trim(), model: input.model, rolePrompt: String(input.rolePrompt || "").trim(), tools: input.tools || [], skills: input.skills || [], maxSteps: Number(input.maxSteps), permissions: permsOf(input.tools || []) });
        W().events.push(ev("member:owner", "agent.updated", id)); save(); return ok(a);
      },
      listRuns() { return ok(W().runs.slice().sort((x, y) => y.createdAt - x.createdAt).map(r => ({ ...r, agentName: (W().agents.find(a => a.id === r.agentId) || {}).name || "Removed agent" }))); },
      getRun(id) {
        const r = W().runs.find(x => x.id === id);
        if (!r) return bad("No run with that id in this workspace.");
        return ok({ ...r, agentName: (W().agents.find(a => a.id === r.agentId) || {}).name || "Removed agent", approval: W().approvals.find(p => p.runId === id) || null });
      },
      // Simulated: no model or tool is called. Live mode (the local server) runs real tools.
      startRun(agentId) {
        const ws = W();
        const a = ws.agents.find(x => x.id === agentId);
        if (!a) return bad("No agent with that id in this workspace.");
        if (activeRun(agentId)) return bad("This agent already has a run in progress. Wait for it or cancel it first.");
        const tools = ["plan", ...a.tools.filter(t => t !== "notes.write"), ...(a.tools.includes("notes.write") ? ["notes.write"] : [])];
        const r = { id: uid("run"), agentId, status: "queued", trigger: "manual", createdAt: Date.now(), startedAt: null, finishedAt: null, steps: tools.map((tool, idx) => ({ idx, tool, status: "queued", ms: null, tries: 0 })), log: [], simulated: true };
        ws.runs.push(r); a.status = "running"; ws.events.push(ev("member:owner", "run.started", r.id)); save();
        let i = -1;
        const tick = () => {
          const run = ws.runs.find(x => x.id === r.id);
          if (!run || run.status === "cancelled") return;
          if (i >= 0) {
            const s = run.steps[i];
            s.status = "ok"; s.ms = 300 + ((i * 397) % 900); s.tries = 1;
            if (s.tool === "notes.write") {
              const file = "notes/" + a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".md";
              const ap = { id: uid("ap"), category: "file_write", runId: run.id, agentId, action: "Save the result to " + file, payload: "+ " + file, status: "pending", createdAt: Date.now() };
              ws.approvals.push(ap); ws.events.push(ev("agent:" + agentId, "approval.requested", ap.id));
              run.log.push(s.tool + "  approval requested (" + ap.id + ")");
            } else run.log.push(s.tool + "  ok  " + s.ms + " ms (simulated)");
          } else { run.status = "running"; run.startedAt = Date.now(); run.log.push("plan  " + (run.steps.length - 1) + " steps, budget " + a.maxSteps + " (simulated)"); }
          i++;
          if (i < run.steps.length) { run.steps[i].status = "running"; save(); setTimeout(tick, 650); return; }
          run.status = "succeeded"; run.finishedAt = Date.now(); a.status = "idle";
          ws.events.push(ev("agent:" + agentId, "run.succeeded", run.id)); save();
        };
        setTimeout(tick, 400);
        return ok(r);
      },
      cancelRun(id) {
        const r = W().runs.find(x => x.id === id);
        if (!r || !(r.status === "running" || r.status === "queued")) return bad("This run is not running.");
        r.status = "cancelled"; r.finishedAt = Date.now(); r.steps.forEach(s => { if (s.status !== "ok") s.status = "skipped"; });
        const a = W().agents.find(x => x.id === r.agentId); if (a) a.status = "idle";
        W().events.push(ev("member:owner", "run.cancelled", id)); save(); return ok(r);
      },
      listApprovals() { return ok(W().approvals.slice().sort((x, y) => y.createdAt - x.createdAt).map(p => ({ ...p, locked: !!LOCKED[p.category], agentName: (W().agents.find(a => a.id === p.agentId) || {}).name || (p.agentId ? "Removed agent" : "Sample request") }))); },
      // Only a person decides; locked categories cannot be approved, as in schema.sql.
      decide(id, decision, reason) {
        const p = W().approvals.find(x => x.id === id);
        if (!p) return bad("No approval with that id in this workspace.");
        if (p.status !== "pending") return bad("Someone already decided this one.");
        if (LOCKED[p.category] && decision === "approved") return bad("Locked: this " + LOCKED[p.category] + ". It needs Director 00's separate approval outside Jarvis.");
        if (decision === "rejected" && !String(reason || "").trim()) return bad("Say why, so the agent can do something else.");
        p.status = decision; p.decidedBy = "member:owner"; p.decidedAt = Date.now(); p.reason = decision === "rejected" ? String(reason).trim() : null;
        W().events.push(ev("member:owner", "approval." + decision, id)); save(); return ok(p);
      },
      listEvents() { return ok(W().events.slice().sort((x, y) => y.at - x.at)); },
      stats() {
        const day = Date.now() - 86400000, w = W();
        return ok({ agents: w.agents.filter(a => a.status !== "archived").length, runsToday: w.runs.filter(r => r.createdAt > day).length,
          waiting: w.approvals.filter(p => p.status === "pending" && !LOCKED[p.category]).length, locked: w.approvals.filter(p => p.status === "pending" && LOCKED[p.category]).length,
          failed: w.runs.filter(r => r.status === "failed" && r.createdAt > day).length });
      },
      waitingCount() { return Promise.resolve(W().approvals.filter(p => p.status === "pending" && !LOCKED[p.category]).length); },
      cleanClone() { return bad("The clean-room cloner runs on the local server. Start it with: node jarvis/server/server.mjs, then open http://127.0.0.1:8798"); },
    };
    return api;
  }

  /* Live store: served by jarvis/server on 127.0.0.1. Real data, real runs, the database's rules. */
  function liveStore(info) {
    const subs = new Set();
    let slug = store$.get("jarvis-ws") || "omega-prime", version = null, timer = null, failMode = false;
    async function req(method, path, body) {
      if (failMode && method === "GET") throw new Error("The data layer is set to fail on purpose (Settings → Test error states).");
      const r = await fetch(path, { method, cache: "no-store", credentials: "same-origin", headers: body !== undefined ? { "content-type": "application/json", "x-jarvis": "1" } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
      let j = null;
      try { j = await r.json(); } catch (e) { /* not JSON */ }
      if (!r.ok) throw new Error((j && j.error) || "The server answered " + r.status + ".");
      return j;
    }
    const w = p => "/api/w/" + encodeURIComponent(slug) + p;
    const poll = async () => {
      try { const v = (await req("GET", w("/version"))).v; if (version !== null && v !== version) subs.forEach(fn => fn()); version = v; } catch (e) { /* keep the page; the next poll retries */ }
    };
    const startPolling = () => { if (!timer) timer = setInterval(() => { if (!document.hidden && subs.size) poll(); }, 1500); };
    const api = {
      mode: "live",
      info,
      subscribe(fn) { subs.add(fn); startPolling(); return () => subs.delete(fn); },
      setFail(on) { failMode = !!on; },
      get failMode() { return failMode; },
      get slug() { return slug; },
      reset() { return Promise.reject(new Error("Live data is not reset from the page. Stop the server and delete jarvis/server/.data to start over.")); },
      listWorkspaces: () => req("GET", "/api/workspaces"),
      async switchWorkspace(s) { const ws = await req("GET", "/api/w/" + encodeURIComponent(s)); slug = s; version = null; store$.set("jarvis-ws", s); subs.forEach(fn => fn()); return ws; },
      workspace: () => req("GET", w("")),
      renameWorkspace: name => req("PATCH", w(""), { name }),
      members: () => req("GET", w("/members")),
      listAgents: ({ status, q } = {}) => req("GET", w("/agents?status=" + encodeURIComponent(status || "") + "&q=" + encodeURIComponent(q || ""))),
      getAgent: id => req("GET", w("/agents/" + encodeURIComponent(id))),
      createAgent: input => req("POST", w("/agents"), input),
      updateAgent: (id, input) => req("PATCH", w("/agents/" + encodeURIComponent(id)), input),
      listRuns: () => req("GET", w("/runs")),
      getRun: id => req("GET", w("/runs/" + encodeURIComponent(id))),
      startRun: (agentId, input) => req("POST", w("/agents/" + encodeURIComponent(agentId) + "/runs"), input || {}),
      cancelRun: id => req("POST", w("/runs/" + encodeURIComponent(id) + "/cancel"), {}),
      listApprovals: () => req("GET", w("/approvals")),
      decide: (id, decision, reason) => req("POST", w("/approvals/" + encodeURIComponent(id) + "/decide"), { decision, reason }),
      listEvents: async () => (await req("GET", w("/events"))).map(e => ({ ...e, at: e.at })),
      stats: () => req("GET", w("/stats")),
      waitingCount: async () => (await req("GET", w("/stats"))).waiting,
      cleanClone: body => req("POST", "/api/studio/clean-clone", body),
    };
    return api;
  }

  // Live when served by the local server and it answers; the sample store otherwise.
  let store = sampleStore();
  const liveCheck = (location.protocol === "http:" && ["127.0.0.1", "localhost"].includes(location.hostname))
    ? fetch("/api/health", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(info => { if (info && info.ok) store = liveStore(info); }, () => {})
    : Promise.resolve();

  /* ── Contrast maths (WCAG 2 ratio and APCA-W3 0.0.98G-4g), same as the skill's contrast.py ── */
  const C = {
    rgb(hex) { const m = /^#([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; },
    lum(c) { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); },
    ratio(a, b) { const x = C.lum(a), y = C.lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); },
    apca(t, b) {
      const y = c => { const v = 0.2126729 * (c[0] / 255) ** 2.4 + 0.7151522 * (c[1] / 255) ** 2.4 + 0.0721750 * (c[2] / 255) ** 2.4; return v > 0.022 ? v : v + (0.022 - v) ** 1.414; };
      const yt = y(t), yb = y(b);
      if (Math.abs(yb - yt) < 0.0005) return 0;
      if (yb > yt) { const s = (yb ** 0.56 - yt ** 0.57) * 1.14; return s < 0.1 ? 0 : (s - 0.027) * 100; }
      const s = (yb ** 0.65 - yt ** 0.62) * 1.14; return s > -0.1 ? 0 : (s + 0.027) * 100;
    },
  };

  /* ── Shell: theme, direction, sidebar, toasts, dialogs ─────── */
  const themeBtn = $("#themeBtn"), themeIcon = $("#themeIcon"), dirBtn = $("#dirBtn");
  function applyTheme(t) {
    if (t === "light") root.setAttribute("data-theme", "light"); else root.removeAttribute("data-theme");
    themeBtn.setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme");
    themeIcon.setAttribute("href", t === "light" ? "#i-moon" : "#i-sun");
  }
  const theme = () => (root.getAttribute("data-theme") === "light" ? "light" : "dark");
  function setTheme(t) { applyTheme(t); store$.set("jarvis-theme", t); }
  applyTheme(store$.get("jarvis-theme") || store$.get("omega-theme") || "dark");
  themeBtn.addEventListener("click", () => setTheme(theme() === "light" ? "dark" : "light"));
  function applyDir(d) {
    root.dir = d === "rtl" ? "rtl" : "ltr";
    dirBtn.setAttribute("aria-label", d === "rtl" ? "Switch to left-to-right layout" : "Switch to right-to-left layout");
  }
  function setDir(d) { applyDir(d); store$.set("jarvis-dir", d); }
  applyDir(store$.get("jarvis-dir") || "ltr");
  dirBtn.addEventListener("click", () => setDir(root.dir === "rtl" ? "ltr" : "rtl"));

  const app = $("#app"), collapse = $("#collapse"), menu = $("#menu"), scrim = $("#scrim");
  if (store$.get("jarvis-rail") === "1") { app.classList.add("rail"); collapse.setAttribute("aria-expanded", "false"); collapse.querySelector(".nav-label").textContent = "Expand"; }
  collapse.addEventListener("click", () => {
    const rail = app.classList.toggle("rail");
    collapse.setAttribute("aria-expanded", String(!rail));
    collapse.querySelector(".nav-label").textContent = rail ? "Expand" : "Collapse";
    store$.set("jarvis-rail", rail ? "1" : "0");
  });
  function drawer(open) {
    app.classList.toggle("drawer-open", open);
    scrim.hidden = !open;
    menu.setAttribute("aria-expanded", String(open));
    if (open) $("#nav a").focus(); else menu.focus();
  }
  menu.addEventListener("click", () => drawer(true));
  scrim.addEventListener("click", () => drawer(false));
  $$(".nav a").forEach(a => a.addEventListener("click", () => { if (app.classList.contains("drawer-open")) drawer(false); }));

  function toast(kind, text) {
    const cls = { ok: "s-ok", info: "s-info", warn: "s-warn", error: "s-failed" }[kind] || "s-info";
    const t = h("div", { class: "toast glass", role: kind === "error" ? "alert" : null }, h("span", { class: "dot " + cls, "aria-hidden": "true" }), h("p", { text }));
    const close = h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Dismiss", onclick: () => t.remove() });
    t.appendChild(close);
    $("#toasts").appendChild(t);
    let timer = setTimeout(() => t.remove(), 5000);
    const pause = () => clearTimeout(timer), resume = () => { timer = setTimeout(() => t.remove(), 5000); };
    t.addEventListener("mouseenter", pause); t.addEventListener("mouseleave", resume);
    t.addEventListener("focusin", pause); t.addEventListener("focusout", resume);
  }

  const dlg = $("#dlg");
  let opener = null;
  dlg.addEventListener("close", () => { if (opener && opener.isConnected) opener.focus(); opener = null; });
  function openDialog(title, body, actions, from) {
    opener = from || document.activeElement;
    const head = h("h2", { id: "dlgTitle", text: title });
    dlg.replaceChildren(h("div", { class: "dlg" }, head, body, h("div", { class: "actions" }, actions)));
    dlg.showModal();
    const first = dlg.querySelector("input, textarea, select") || dlg.querySelector(".actions .btn:last-child");
    if (first) first.focus();
  }
  const closeDialog = () => dlg.close();

  /* ── Shared building blocks ─────────────────────────────────── */
  function pageHead(title, lede, ...actions) {
    return h("div", { class: "page-head" }, h("div", null, h("h1", { dir: "auto", text: title }), lede ? h("p", { class: "lede", dir: "auto", text: lede }) : null), actions.length ? h("div", { class: "row" }, actions) : null);
  }
  // Says where the data comes from: the labelled sample store (file://) or the local server (live).
  const sampleNote = text => (store.mode === "live" && !text)
    ? h("p", { class: "sample-note live-note", dir: "auto" }, icon("i-check", "sm"), "Live: real data from the local server (" + (store.info && store.info.mode === "postgres" ? "PostgreSQL" : "SQLite") + "). Runs use real tools; planning follows fixed rules, no model.")
    : h("p", { class: "sample-note", dir: "auto" }, icon("i-alert", "sm"), text || "Sample workspace: placeholder data. Start jarvis/server for live data and real runs.");
  // Approval payloads are text in the sample store and objects from the server.
  const payloadText = p => typeof p.payload === "string" ? p.payload : p.payload && p.payload.path ? "+ " + p.payload.path + " (" + fmtN.format(p.payload.bytes || 0) + " bytes)\n\n" + (p.payload.preview || "") : (p.payload && p.payload.note) || "";
  const isSampleRequest = p => (p.payload && p.payload.sample) || (typeof p.payload === "string" && /^Sample request/.test(p.payload));
  function badge(status, label) {
    return h("span", { class: "badge s-" + status }, h("span", { class: "dot", "aria-hidden": "true" }), label || ({ idle: "Idle", running: "Running", succeeded: "Succeeded", failed: "Failed", queued: "Queued", cancelled: "Cancelled", paused: "Paused", ok: "Done", skipped: "Skipped", pending: "Awaiting approval", approved: "Approved", rejected: "Rejected", expired: "Expired" }[status] || status));
  }
  function skeleton(lines) {
    const s = h("div", { class: "skel", "aria-busy": "true", "aria-label": "Loading" });
    ["w60", "w80", "w40", "w80"].slice(0, lines || 4).forEach(w => s.appendChild(h("div", { class: "sk " + w })));
    return s;
  }
  function emptyState(iconId, title, text, action) {
    return h("div", { class: "empty" }, icon(iconId), h("h3", { text: title }), h("p", { class: "muted t-sm", text }), action || null);
  }
  function errorBox(err, retry) {
    return h("div", { class: "error-box", role: "alert" }, h("b", { text: "This did not load." }), h("p", { class: "t-sm", text: (err && err.message) || "Something failed." }),
      h("div", null, h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Try again", onclick: retry })));
  }
  // Render a section that loads data: skeleton first, then content or an error with a retry.
  function loadInto(box, loader, render) {
    box.replaceChildren(skeleton());
    $("#main").setAttribute("aria-busy", "true");
    return loader().then(d => { box.replaceChildren(render(d)); }, e => { box.replaceChildren(errorBox(e, () => loadInto(box, loader, render))); })
      .finally(() => $("#main").setAttribute("aria-busy", "false"));
  }
  function lockedCard(p) {
    return h("article", { class: "approval locked", "aria-labelledby": "t-" + p.id },
      h("p", { class: "lock-line" }, icon("i-lock", "sm"), h("span", { lang: "ar", dir: "rtl", text: "قيد الموافقة" }), h("span", { class: "subtle t-caption", text: "· Pending human approval" })),
      h("h3", { id: "t-" + p.id, dir: "auto", text: p.action }),
      h("p", { class: "muted t-sm", text: "Locked: this " + (LOCKED[p.category] || "action") + ". No agent can approve it, and Jarvis has no approve button for it. It needs Director 00's separate approval outside Jarvis (AGENTS.md §1)." }),
      h("p", { class: "subtle t-caption" }, isSampleRequest(p) ? h("span", { class: "badge", text: "Sample request" }) : null, isSampleRequest(p) ? " " : null, (p.agentName && !isSampleRequest(p) ? "Asked by " + p.agentName + " · " : ""), timeEl(p.createdAt)));
  }

  /* ── Pages ──────────────────────────────────────────────────── */
  const pages = {};

  pages.overview = () => {
    const box = h("div", { class: "stack" });
    const feed = h("div");
    const wrap = h("div", { class: "stack" }, pageHead("Overview", "Agents, runs and approvals at a glance."), sampleNote(), box,
      h("section", { class: "block", "aria-labelledby": "h-act" }, h("h2", { id: "h-act", text: "Recent activity" }), feed));
    loadInto(box, () => store.stats(), s => h("div", { class: "stack" },
      s.waiting ? h("div", { class: "approval", role: "note" }, h("div", { class: "row" }, badge("pending", s.waiting + (s.waiting === 1 ? " action is" : " actions are") + " waiting for you"),
        h("a", { class: "btn btn-primary btn-sm", href: "#/approvals", text: "Review" }))) : null,
      h("div", { class: "stats" },
        h("a", { class: "stat", href: "#/agents" }, h("span", { class: "label", text: "Agents" }), h("span", { class: "value num", text: fmtN.format(s.agents) })),
        h("a", { class: "stat", href: "#/runs" }, h("span", { class: "label", text: "Runs in the last 24 h" }), h("span", { class: "value num", text: fmtN.format(s.runsToday) })),
        h("a", { class: "stat", href: "#/approvals" }, h("span", { class: "label", text: "Waiting for you" }), h("span", { class: "value num s-pending", text: fmtN.format(s.waiting) }), h("span", { class: "subtle t-caption" }, fmtN.format(s.locked) + " more locked ", h("bdi", { lang: "ar", dir: "rtl", text: "«قيد الموافقة»" }))),
        h("a", { class: "stat", href: "#/runs" }, h("span", { class: "label", text: "Failed runs (24 h)" }), h("span", { class: "value num" + (s.failed ? " s-failed" : ""), text: fmtN.format(s.failed) })))));
    loadInto(feed, () => store.listEvents(), evs => evs.length
      ? h("div", { class: "card" }, h("ul", { class: "feed" }, evs.slice(0, 8).map(e => h("li", null, h("span", { class: "mono t-caption subtle", text: e.actor }), h("span", { text: e.kind.replace(".", " ") + (e.target ? " · " + e.target : "") }), timeEl(e.at)))))
      : emptyState("i-inbox", "Nothing has happened yet", "Create an agent and run it. Every action shows up here."));
    return wrap;
  };

  // Create or edit an agent: name, model, role, limits, tools (which set its permissions) and linked
  // skills. Locked permissions are shown and can never be switched on (AGENTS.md §1).
  async function agentDialog(from, existingAgent) {
    let others = [];
    try { others = await store.listAgents(); } catch (e) { toast("error", e.message); return; }
    const editing = !!existingAgent;
    const a = existingAgent || { name: "", model: store.mode === "live" ? "Local rules (no model)" : "Local model (loopback)", rolePrompt: "", maxSteps: 20, tools: ["notes.write"], skills: [] };
    const f = {};
    const err = {};
    const field = (key, label, control, hint) => {
      err[key] = h("span", { class: "err", id: "e-" + key, hidden: true });
      control.id = "f-" + key;
      control.setAttribute("aria-describedby", (hint ? "h-" + key + " " : "") + "e-" + key);
      f[key] = control;
      return h("div", { class: "field" }, h("label", { htmlFor: "f-" + key, text: label }), control, hint ? h("span", { class: "hint", id: "h-" + key, text: hint }) : null, err[key]);
    };
    const models = store.mode === "live" ? ["Local rules (no model)"] : ["Local model (loopback)", "Hosted model (key in vault)"];
    if (!models.includes(a.model)) models.push(a.model);
    const TOOL_NOTES = { "files.read": "read docs/ and jarvis/replica/", "notes.read": "list this workspace's notes", "notes.write": "save a note, asks you first", "runs.read": "read this workspace's runs", "git.log": "read recent commits", "web.read": "read one public page" };
    const toolBoxes = TOOL_LIST.map(t => h("label", { class: "check" }, h("input", { type: "checkbox", name: "tool", value: t, checked: a.tools.includes(t) }), h("span", { class: "mono t-sm", text: t }), h("span", { class: "subtle t-caption", text: "— " + TOOL_NOTES[t] })));
    const skillNames = (DATA.skills || []).map(s => s.name).sort();
    const skillFilter = h("input", { class: "input", type: "search", id: "f-skillq", name: "skill-q", autocomplete: "off", placeholder: "Filter skills", "aria-label": "Filter skills" });
    const skillBox = h("div", { class: "skill-pick", role: "group", "aria-label": "Linked skills" }, skillNames.map(n => h("label", { class: "check", dataset: { skill: n } }, h("input", { type: "checkbox", name: "skill", value: n, checked: (a.skills || []).includes(n) }), h("span", { class: "mono t-sm", translate: "no", text: n }))));
    skillFilter.addEventListener("input", () => { const q = skillFilter.value.trim().toLowerCase(); $$("label", skillBox).forEach(l => { l.hidden = !!q && !l.dataset.skill.includes(q); }); });
    const lockedRows = Object.entries(LOCKED).map(([k, why]) => h("label", { class: "check locked-perm" }, h("input", { type: "checkbox", disabled: true, name: "locked-" + k, "aria-describedby": "h-locked" }), icon("i-lock", "sm"), h("span", { text: k[0].toUpperCase() + k.slice(1) + " — " + why })));
    const body = h("div", { class: "stack" },
      field("name", "Name", h("input", { class: "input", name: "agent-name", autocomplete: "off", maxLength: 80, value: a.name, placeholder: "Research assistant" }), "Shown in lists and run logs."),
      field("model", "Model", h("select", { class: "select", name: "model", autocomplete: "off" }, models.map(m => h("option", { text: m, selected: m === a.model })))),
      field("rolePrompt", "Role", h("textarea", { class: "textarea", name: "role", autocomplete: "off", value: a.rolePrompt || "", placeholder: "What this agent does, and what it must never do." })),
      field("maxSteps", "Max steps per run", h("input", { class: "input num", name: "max-steps", inputmode: "numeric", autocomplete: "off", value: String(a.maxSteps) })),
      h("fieldset", null, h("legend", { class: "legend", text: "Tools and permissions" }), toolBoxes),
      h("fieldset", null, h("legend", { class: "legend", text: "Linked skills" }), h("span", { class: "hint", text: "Skills this agent follows. They come from .claude/skills in this repo." }), skillFilter, skillBox),
      h("fieldset", null, h("legend", { class: "legend" }, "Locked ", h("bdi", { lang: "ar", dir: "rtl", text: "«قيد الموافقة»" })), lockedRows,
        h("p", { class: "hint", id: "h-locked", text: "No agent can be given these. They are Director 00's decisions outside Jarvis (AGENTS.md §1)." })));
    const save = h("button", { class: "btn btn-primary", type: "button", text: editing ? "Save changes" : "Create agent" });
    save.addEventListener("click", () => {
      const input = { name: f.name.value, model: f.model.value, rolePrompt: f.rolePrompt.value, maxSteps: f.maxSteps.value.trim() === "" ? NaN : Number(f.maxSteps.value),
        tools: $$("input[name=tool]:checked", body).map(x => x.value), skills: $$("input[name=skill]:checked", body).map(x => x.value) };
      const errs = validateAgentInput(input, others, editing ? a.id : undefined);
      for (const k of Object.keys(err)) {
        const msg = errs[k];
        err[k].hidden = !msg; err[k].replaceChildren(...(msg ? [icon("i-alert", "sm"), msg] : []));
        if (f[k]) f[k].setAttribute("aria-invalid", msg ? "true" : "false");
      }
      const firstBad = Object.keys(errs)[0];
      if (firstBad) { f[firstBad].focus(); return; }
      save.disabled = true; save.setAttribute("aria-busy", "true");
      (editing ? store.updateAgent(a.id, input) : store.createAgent(input)).then(saved => {
        closeDialog();
        toast("ok", editing ? "Saved “" + saved.name + "”." : "Agent “" + saved.name + "” created.");
        if (editing) route(); else location.hash = "#/agents/" + saved.id;
      }, e => { toast("error", e.message); save.disabled = false; save.removeAttribute("aria-busy"); });
    });
    openDialog(editing ? "Edit " + a.name : "New agent", body, [h("button", { class: "btn btn-secondary", type: "button", text: "Cancel", onclick: closeDialog }), save], from);
  }

  pages.agents = () => {
    const box = h("div");
    const q = h("input", { class: "input", id: "f-q", type: "search", name: "q", autocomplete: "off", placeholder: "Name, model or tool" });
    const st = h("select", { class: "select", id: "f-st", name: "status", autocomplete: "off" }, ["", "idle", "running", "failed", "paused", "archived"].map(v => h("option", { value: v, text: v ? v[0].toUpperCase() + v.slice(1) : "Any status" })));
    const load = () => loadInto(box, () => store.listAgents({ status: st.value, q: q.value }), list => {
      if (!list.length) {
        return (q.value || st.value)
          ? emptyState("i-search", "No agent matches", "Try another word or status.", h("button", { class: "btn btn-secondary", type: "button", text: "Clear filters", onclick: () => { q.value = ""; st.value = ""; load(); } }))
          : emptyState("i-agent", "No agents yet", "An agent has a role, a model and a set of tools.", h("button", { class: "btn btn-primary", type: "button", text: "New agent", onclick: e => agentDialog(e.currentTarget) }));
      }
      return h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Agents" }, h("table", null,
        h("thead", null, h("tr", null, ["Agent", "Status", "Model", "Runs", "Last run"].map((c, i) => h("th", { scope: "col", class: i === 3 ? "end" : null, text: c })))),
        h("tbody", null, list.map(a => h("tr", null,
          h("td", null, h("a", { href: "#/agents/" + a.id, class: "trunc", dir: "auto", text: a.name })),
          h("td", null, badge(a.status)), h("td", { class: "muted", text: a.model }),
          h("td", { class: "end num", text: fmtN.format(a.runs) }), h("td", null, a.lastRun ? timeEl(a.lastRun) : h("span", { class: "subtle", text: "Never" })))))));
    });
    let t;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 150); });
    st.addEventListener("change", load);
    load();
    return h("div", { class: "stack" },
      pageHead("Agents", "Each agent has a role, a model and the tools it may use.", h("button", { class: "btn btn-primary", type: "button", onclick: e => agentDialog(e.currentTarget) }, icon("i-plus", "sm"), "New agent")),
      sampleNote(),
      h("div", { class: "filters" }, h("div", { class: "field" }, h("label", { htmlFor: "f-q", text: "Search" }), q), h("div", { class: "field narrow" }, h("label", { htmlFor: "f-st", text: "Status" }), st)),
      box);
  };

  // Live mode asks for the run's input when a tool needs one (a path under docs/, or a public address).
  function runDialog(a, from) {
    const needsPath = a.tools.includes("files.read"), needsUrl = a.tools.includes("web.read");
    const go = input => store.startRun(a.id, input).then(r => {
      if (dlg.open) closeDialog();
      toast("info", store.mode === "live" ? "Run started." : "Run started (simulated).");
      location.hash = "#/runs/" + r.id;
    }, e => toast("error", e.message));
    if (store.mode !== "live" || (!needsPath && !needsUrl)) return go({});
    const path = needsPath ? h("input", { class: "input mono", id: "f-runpath", name: "run-path", autocomplete: "off", value: /token|design/i.test(a.name) ? "jarvis/replica/design" : "docs/adr/ADR-13*" }) : null;
    const url = needsUrl ? h("input", { class: "input mono", id: "f-runurl", name: "run-url", type: "url", autocomplete: "off", placeholder: "https://example.com/" }) : null;
    const start = h("button", { class: "btn btn-primary", type: "button", text: "Start run" });
    start.addEventListener("click", () => { start.disabled = true; go({ path: path ? path.value : undefined, url: url ? url.value : undefined }).finally(() => { start.disabled = false; }); });
    openDialog("Run " + a.name, h("div", { class: "stack" },
      path ? h("div", { class: "field" }, h("label", { htmlFor: "f-runpath", text: "Path to read" }), path, h("span", { class: "hint", text: "A file, a folder, or a folder/prefix* under docs/ or jarvis/replica/." })) : null,
      url ? h("div", { class: "field" }, h("label", { htmlFor: "f-runurl", text: "Public page to read" }), url, h("span", { class: "hint", text: "One request; robots.txt is respected; private addresses are refused." })) : null),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Cancel", onclick: closeDialog }), start], from);
  }

  pages.agent = id => {
    const box = h("div", { class: "stack" });
    const render = a => {
      const runBtn = h("button", { class: "btn btn-primary", type: "button", disabled: a.active }, icon("i-run", "sm"), a.active ? "Running…" : "Run once");
      runBtn.addEventListener("click", e => runDialog(a, e.currentTarget));
      const editBtn = h("button", { class: "btn btn-secondary", type: "button", text: "Edit", onclick: e => agentDialog(e.currentTarget, a) });
      const perms = a.permissions || { writeNotes: a.tools.includes("notes.write"), readWeb: a.tools.includes("web.read") };
      const tabs = [["Config", () => h("dl", { class: "stack t-sm" },
        h("div", null, h("dt", { class: "muted", text: "Role" }), h("dd", { dir: "auto", text: a.rolePrompt || "No role written yet." })),
        h("div", null, h("dt", { class: "muted", text: "Model" }), h("dd", { text: a.model + (a.model.includes("Hosted") ? " — the key lives in the Ops Room vault, never in Jarvis." : a.model.includes("no model") ? " — planning and summaries follow fixed rules." : "") })),
        h("div", null, h("dt", { class: "muted", text: "Max steps per run" }), h("dd", { class: "num", text: String(a.maxSteps) })),
        h("div", null, h("dt", { class: "muted", text: "Permissions" }), h("dd", { class: "row" },
          badge(perms.writeNotes ? "approved" : "idle", perms.writeNotes ? "Writes notes (asks first)" : "No note writing"),
          badge(perms.readWeb ? "approved" : "idle", perms.readWeb ? "Reads public pages" : "No web reading"),
          h("span", { class: "badge s-pending" }, icon("i-lock", "sm"), "Money, publish, permissions, install, outbound: locked"))),
        h("div", null, h("dt", { class: "muted", text: "Linked skills" }), h("dd", null, (a.skills || []).length ? h("ul", { class: "row" }, a.skills.map(s => h("li", { class: "badge mono", translate: "no", text: s }))) : h("span", { class: "subtle", text: "None" }))))],
      ["Tools", () => a.tools.length ? h("ul", { class: "row" }, a.tools.map(t => h("li", { class: "badge mono", text: t }))) : h("p", { class: "muted t-sm", text: "No tools. This agent can only think, not act." })],
      ["Runs", () => a.runs.length ? h("div", { class: "table-scroll" }, h("table", null, h("thead", null, h("tr", null, ["Run", "Status", "Started", "Steps"].map(c => h("th", { scope: "col", text: c })))),
        h("tbody", null, a.runs.map(r => h("tr", null, h("td", null, h("a", { class: "mono", href: "#/runs/" + r.id, text: String(r.id).slice(0, 12) })), h("td", null, badge(r.status)), h("td", null, timeEl(r.createdAt)), h("td", { class: "num", text: String((r.steps || []).length) })))))) : emptyState("i-run", "No runs yet", "Press Run once to try this agent.")]];
      return h("div", { class: "stack" },
        pageHead(a.name, null, badge(a.status), editBtn, runBtn),
        tabsWidget("agent", tabs));
    };
    loadInto(box, () => store.getAgent(id), render);
    const off = store.subscribe(() => { if (!box.isConnected) { off(); return; } if (dlg.open) return; store.getAgent(id).then(a => box.replaceChildren(render(a)), () => {}); });
    return h("div", { class: "stack" }, h("p", null, h("a", { href: "#/agents", text: "← Agents" })), sampleNote(), box);
  };

  function tabsWidget(key, tabs) {
    const list = h("div", { class: "tablist", role: "tablist", "aria-label": "Sections" });
    const panels = [];
    const btns = tabs.map(([label, make], i) => {
      const b = h("button", { class: "tab", role: "tab", type: "button", id: "tab-" + key + i, "aria-controls": "panel-" + key + i, "aria-selected": String(i === 0), tabIndex: i === 0 ? 0 : -1, text: label });
      const p = h("div", { class: "tabpanel", role: "tabpanel", id: "panel-" + key + i, "aria-labelledby": "tab-" + key + i, tabindex: "0", hidden: i !== 0 }, make());
      panels.push(p); list.appendChild(b); return b;
    });
    const select = b => { btns.forEach((x, i) => { const on = x === b; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; panels[i].hidden = !on; }); b.focus(); };
    btns.forEach((b, i) => {
      b.addEventListener("click", () => select(b));
      b.addEventListener("keydown", e => {
        const rtl = root.dir === "rtl";
        const d = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
        if (d) { e.preventDefault(); select(btns[(i + d + btns.length) % btns.length]); }
        else if (e.key === "Home") { e.preventDefault(); select(btns[0]); }
        else if (e.key === "End") { e.preventDefault(); select(btns[btns.length - 1]); }
      });
    });
    return h("div", { class: "card" }, h("div", { class: "card-in" }, list, panels));
  }

  pages.runs = () => {
    const box = h("div");
    loadInto(box, () => store.listRuns(), runs => runs.length
      ? h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Runs" }, h("table", null,
        h("thead", null, h("tr", null, ["Run", "Agent", "Status", "Started", "Duration", "Steps"].map((c, i) => h("th", { scope: "col", class: i >= 4 ? "end" : null, text: c })))),
        h("tbody", null, runs.map(r => h("tr", null, h("td", null, h("a", { class: "mono", href: "#/runs/" + r.id, text: r.id })), h("td", { dir: "auto" }, h("span", { class: "trunc", text: r.agentName })), h("td", null, badge(r.status)),
          h("td", null, timeEl(r.createdAt)), h("td", { class: "end num", text: dur(r.finishedAt && r.startedAt ? r.finishedAt - r.startedAt : null) }), h("td", { class: "end num", text: String(r.steps.length) }))))))
      : emptyState("i-run", "No runs yet", "Open an agent and press Run once.", h("a", { class: "btn btn-primary", href: "#/agents", text: "Go to agents" })));
    return h("div", { class: "stack" }, pageHead("Runs", "Every run, newest first."), sampleNote(), box);
  };

  // One line about what a real step produced (live mode), or its try count (sample mode).
  function stepSummary(s) {
    const o = s.output;
    if (!o) return s.tries ? "try " + s.tries : "waiting";
    if (o.error) return o.error;
    if (o.files) return o.files.length + " files: " + o.files.slice(0, 3).map(f => f.path.split("/").pop()).join(", ") + (o.files.length > 3 ? "…" : "");
    if (o.commits) return o.commits.length + " commits, latest: " + (o.commits[0] ? o.commits[0].message : "—");
    if (o.notes) return o.notes.length + " notes";
    if (o.byStatus) return o.total + " runs read";
    if (o.steps) return o.steps.length + " steps by " + o.by;
    if (o.markdown) return fmtN.format(o.markdown.length) + " characters of summary";
    if (o.approval) return "asked to save " + o.path;
    if (o.url) return o.title || o.url;
    return "done";
  }

  pages.run = id => {
    const box = h("div", { class: "stack" });
    const render = r => {
      const live = r.status === "running" || r.status === "queued";
      const cancel = live ? h("button", { class: "btn btn-secondary", type: "button", text: "Cancel run", onclick: e => { e.currentTarget.disabled = true; store.cancelRun(r.id).then(() => toast("warn", "Run cancelled."), err => toast("error", err.message)); } }) : null;
      return h("div", { class: "stack" },
        pageHead("Run · " + r.agentName, null, badge(r.status), cancel),
        r.simulated ? sampleNote("Simulated run: no model or tool was called. Start jarvis/server for real runs.") : sampleNote(),
        h("div", { class: "grid-2" },
          h("div", { class: "card" }, h("ol", { class: "timeline", "aria-label": "Steps" }, r.steps.map(s => h("li", { class: "step" },
            h("span", { class: "idx num", text: String(s.idx + 1) }),
            h("div", { class: "what" }, h("b", { class: "mono", text: s.tool }), h("span", { text: stepSummary(s) })),
            h("div", { class: "row" }, badge(s.status), h("span", { class: "num subtle t-caption", text: dur(s.ms) })))))),
          h("pre", { class: "log", tabindex: "0", "aria-label": "Run log", text: r.log.length ? r.log.map((l, i) => String(i + 1).padStart(2, "0") + "  " + l).join("\n") : "Waiting for the first step…" })),
        r.approval ? h("p", { class: "t-sm" }, "This run asked for approval: ", h("a", { href: "#/approvals", text: r.approval.action }), " — ", badge(r.approval.status)) : null);
    };
    loadInto(box, () => store.getRun(id), render);
    const off = store.subscribe(() => { if (!box.isConnected) { off(); return; } store.getRun(id).then(r => box.replaceChildren(render(r)), () => {}); });
    return h("div", { class: "stack" }, h("p", null, h("a", { href: "#/runs", text: "← Runs" })), box);
  };

  function rejectDialog(p, from) {
    const reason = h("textarea", { class: "textarea", id: "f-reason", name: "reason", autocomplete: "off", placeholder: "Tell the agent what to do instead.", "aria-describedby": "e-reason" });
    const err = h("span", { class: "err", id: "e-reason", hidden: true });
    const go = h("button", { class: "btn btn-primary", type: "button", text: "Reject" });
    go.addEventListener("click", () => {
      if (!reason.value.trim()) { err.hidden = false; err.replaceChildren(icon("i-alert", "sm"), "Say why, so the agent can do something else."); reason.setAttribute("aria-invalid", "true"); reason.focus(); return; }
      store.decide(p.id, "rejected", reason.value).then(() => { closeDialog(); toast("ok", "Rejected. The agent sees your reason."); }, e => toast("error", e.message));
    });
    openDialog("Reject: " + p.action, h("div", { class: "field" }, h("label", { htmlFor: "f-reason", text: "Reason" }), reason, err), [h("button", { class: "btn btn-secondary", type: "button", text: "Back", onclick: closeDialog }), go], from);
  }

  pages.approvals = () => {
    const box = h("div");
    const render = list => {
      const waiting = list.filter(p => p.status === "pending" && !p.locked);
      const locked = list.filter(p => p.status === "pending" && p.locked);
      const decided = list.filter(p => p.status !== "pending");
      const card = p => h("article", { class: "approval", "aria-labelledby": "t-" + p.id },
        h("div", { class: "row" }, badge("pending"), h("span", { class: "subtle t-caption" }, p.agentName + " · ", timeEl(p.createdAt))),
        h("h3", { id: "t-" + p.id, dir: "auto", text: p.action }),
        h("pre", { class: "diff", text: payloadText(p) }),
        h("div", { class: "row" },
          h("button", { class: "btn btn-primary", type: "button", text: "Approve", onclick: e => { e.currentTarget.disabled = true; store.decide(p.id, "approved").then(() => toast("ok", "Approved."), err => toast("error", err.message)); } }),
          h("button", { class: "btn btn-secondary", type: "button", text: "Reject…", onclick: e => rejectDialog(p, e.currentTarget) })));
      return tabsWidget("ap", [
        ["Waiting (" + waiting.length + ")", () => waiting.length ? h("div", { class: "grid-2" }, waiting.map(card)) : emptyState("i-check", "Nothing is waiting", "When an agent wants to act outside its sandbox, it asks here.")],
        ["Locked (" + locked.length + ")", () => locked.length ? h("div", { class: "stack" }, h("p", { class: "muted t-sm", text: "These actions are Director 00's decisions outside Jarvis. They stay here so nothing happens quietly." }), h("div", { class: "grid-2" }, locked.map(lockedCard))) : emptyState("i-lock", "No locked requests", "Money, publishing, permissions, installs and outbound messages would show here.")],
        ["Decided (" + decided.length + ")", () => decided.length ? h("div", { class: "table-scroll" }, h("table", null, h("thead", null, h("tr", null, ["Action", "Decision", "Reason", "When"].map(c => h("th", { scope: "col", text: c })))),
          h("tbody", null, decided.map(p => h("tr", null, h("td", { dir: "auto" }, h("span", { class: "trunc", text: p.action })), h("td", null, badge(p.status)), h("td", { class: "muted" }, h("span", { class: "trunc", text: p.reason || "—" })), h("td", null, timeEl(p.decidedAt || p.createdAt))))))) : emptyState("i-inbox", "No decisions yet", "Approved and rejected requests are listed here.")],
      ]);
    };
    loadInto(box, () => store.listApprovals(), render);
    const off = store.subscribe(() => { if (!box.isConnected) { off(); return; } store.listApprovals().then(l => { const sel = box.querySelector("[aria-selected=true]"); const idx = sel ? $$("[role=tab]", box).indexOf(sel) : 0; box.replaceChildren(render(l)); const t = $$("[role=tab]", box)[idx]; if (t && idx) t.click(); }, () => {}); });
    return h("div", { class: "stack" }, pageHead("Approvals", "Agents ask before they act outside their sandbox. Only a person decides."), sampleNote(), box);
  };

  pages.logs = () => {
    const box = h("div");
    const q = h("input", { class: "input", id: "f-lq", type: "search", name: "q", autocomplete: "off", placeholder: "Actor, action or target" });
    const kind = h("select", { class: "select", id: "f-lk", name: "kind", autocomplete: "off" }, h("option", { value: "", text: "Any kind" }), ["run", "approval", "agent", "workspace"].map(k => h("option", { value: k, text: k })));
    const load = () => loadInto(box, () => store.listEvents(), evs => {
      const qq = q.value.trim().toLowerCase();
      const list = evs.filter(e => (!kind.value || e.kind.startsWith(kind.value + ".")) && (!qq || (e.actor + " " + e.kind + " " + (e.target || "")).toLowerCase().includes(qq)));
      if (!list.length) return emptyState("i-logs", evs.length ? "No event matches" : "No events yet", evs.length ? "Try another word or kind." : "Every action is written here and never edited.");
      return h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Event log" }, h("table", null,
        h("thead", null, h("tr", null, ["When", "Actor", "Action", "Target"].map(c => h("th", { scope: "col", text: c })))),
        h("tbody", null, list.map(e => h("tr", null, h("td", null, timeEl(e.at)), h("td", { class: "mono t-caption", text: e.actor }), h("td", { text: e.kind }), h("td", { class: "mono t-caption", text: e.target || "—" }))))));
    });
    let t;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 150); });
    kind.addEventListener("change", load);
    load();
    return h("div", { class: "stack" }, pageHead("Logs", "The audit trail. Append-only: nothing here is edited or deleted."), sampleNote(),
      h("div", { class: "filters" }, h("div", { class: "field" }, h("label", { htmlFor: "f-lq", text: "Search" }), q), h("div", { class: "field narrow" }, h("label", { htmlFor: "f-lk", text: "Kind" }), kind)), box);
  };

  function seg(label, options, current, onPick) {
    const g = h("div", { class: "seg", role: "group", "aria-label": label });
    options.forEach(([value, text, extra]) => {
      const b = h("button", { type: "button", "aria-pressed": String(value === current), text, lang: extra && extra.lang, dir: extra && extra.dir });
      b.addEventListener("click", () => { $$("button", g).forEach(x => x.setAttribute("aria-pressed", String(x === b))); onPick(value); });
      g.appendChild(b);
    });
    return g;
  }

  pages.settings = () => {
    const box = h("div", { class: "stack" });
    const render = ws => {
      const name = h("input", { class: "input", id: "f-ws", name: "workspace", autocomplete: "off", value: ws.name, maxLength: 80 });
      const save = h("button", { class: "btn btn-primary", type: "button", text: "Save" });
      save.addEventListener("click", () => store.renameWorkspace(name.value).then(w => { $("#wsName").textContent = w.name; toast("ok", "Workspace renamed."); }, e => toast("error", e.message)));
      const fail = h("input", { class: "switch", type: "checkbox", role: "switch", id: "f-fail", name: "fail", checked: store.failMode });
      fail.addEventListener("change", () => { store.setFail(fail.checked); toast(fail.checked ? "warn" : "ok", fail.checked ? "Lists now fail on purpose. Open any page to see its error state." : "Error test off."); });
      const reset = h("button", { class: "btn btn-danger", type: "button", text: "Reset sample data…" });
      reset.addEventListener("click", e => openDialog("Reset the sample workspace?", h("p", { class: "muted t-sm", text: "Agents, runs, approvals and logs go back to the starting sample. Your theme and Studio draft stay." }),
        [h("button", { class: "btn btn-secondary", type: "button", text: "Keep data", onclick: closeDialog }), h("button", { class: "btn btn-danger", type: "button", text: "Reset", onclick: () => { Promise.resolve(store.reset()).then(() => { closeDialog(); toast("ok", "Sample data reset."); route(); }, err => { closeDialog(); toast("error", err.message); }); } })], e.currentTarget));
      return h("div", { class: "grid-2" },
        h("section", { class: "panel", "aria-labelledby": "h-ws" }, h("h2", { id: "h-ws", text: "Workspace" }), h("div", { class: "field" }, h("label", { htmlFor: "f-ws", text: "Name" }), name), h("div", null, save)),
        h("section", { class: "panel", "aria-labelledby": "h-keys" }, h("h2", { id: "h-keys", text: "Model keys" }),
          h("p", { class: "t-sm", text: "Keys are never typed or stored in Jarvis. They live only in the Ops Room vault (AES-GCM-256, PBKDF2 600,000 rounds) or in the encrypted env files." }),
          h("p", { class: "subtle t-caption", text: "AGENTS.md §4: secrets never live in code, git or plain localStorage." })),
        h("section", { class: "panel", "aria-labelledby": "h-look" }, h("h2", { id: "h-look", text: "Look" }),
          h("div", { class: "field" }, h("span", { class: "legend", text: "Theme" }), seg("Theme", [["dark", "Dark"], ["light", "Light"]], theme(), setTheme)),
          h("div", { class: "field" }, h("span", { class: "legend", text: "Direction" }), seg("Direction", [["ltr", "Left to right"], ["rtl", "Right to left"]], root.dir === "rtl" ? "rtl" : "ltr", setDir))),
        h("section", { class: "panel", "aria-labelledby": "h-test" }, h("h2", { id: "h-test", text: "Testing" }),
          h("label", { class: "check", htmlFor: "f-fail" }, fail, h("span", { text: "Test error states (make every list fail to load)" })),
          h("div", null, reset)));
    };
    const members = h("div");
    loadInto(box, () => store.workspace(), render);
    loadInto(members, () => store.members(), list => h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Members" }, h("table", null,
      h("thead", null, h("tr", null, ["Member", "Role"].map(c => h("th", { scope: "col", text: c })))),
      h("tbody", null, list.map(m => h("tr", null, h("td", { text: m.email }), h("td", null, h("span", { class: "badge", text: m.role }))))))));
    return h("div", { class: "stack" }, pageHead("Settings", "Workspace, members, keys and how Jarvis looks."), box,
      h("section", { class: "block", "aria-labelledby": "h-members" }, h("h2", { id: "h-members", text: "Members" }),
        h("p", { class: "muted t-sm", text: "Phase 1 has one local owner. Inviting people and changing roles come with the phase 2 service; changing repository permissions stays a locked approval." }), members));
  };

  /* ── Studio (S13): live builder in a sandboxed frame ─────────── */
  const PRESETS = {
    night: { label: "Night (Jarvis)", bg: "#090b10", surface: "#10141b", text: "#eef2f8", muted: "#b9c1cd", accent: "#77bcff", onAccent: "#04101f", border: "#242b37" },
    paper: { label: "Paper", bg: "#f7f7f5", surface: "#ffffff", text: "#16181d", muted: "#4a505c", accent: "#0b5ed7", onAccent: "#ffffff", border: "#e2e4e8" },
    sand: { label: "Sand", bg: "#f6f1e7", surface: "#fffaf0", text: "#2a2118", muted: "#5c4d3c", accent: "#8a4b0f", onAccent: "#fffaf0", border: "#e6dccb" },
  };
  const BLOCK_NAMES = { nav: "Navigation", hero: "Hero", features: "Features", stats: "Facts", faq: "Questions", table: "Table", text: "Text section", cta: "Call to action", footer: "Footer" };
  const six = (fn) => [1, 2, 3, 4, 5, 6].flatMap(fn);
  const FIELDS = {
    nav: [["brand", "Brand"], ["links", "Links (comma separated)"], ["cta", "Button"]],
    hero: [["kicker", "Small line above"], ["title", "Headline"], ["body", "Text", true], ["primary", "Main button"], ["secondary", "Second button"]],
    features: [["title", "Title"], ...six(i => [["f" + i + "t", "Feature " + i], ["f" + i + "b", "Feature " + i + " text", true]])],
    stats: six(i => [["s" + i + "v", "Fact " + i], ["s" + i + "l", "Fact " + i + " label"]]),
    faq: [["title", "Title"], ...six(i => [["q" + i, "Question " + i], ["a" + i, "Answer " + i, true]])],
    table: [["title", "Title"], ...six(i => [["c" + i, "Column " + i]]), ["cell", "Cell text"]],
    text: [["title", "Title"], ["body", "Text", true]],
    cta: [["title", "Title"], ["body", "Text", true], ["button", "Button"]],
    footer: [["text", "Text"]],
  };
  function defaultSite() {
    return {
      v: 1, name: "My product", lang: "en", width: 1440, preset: "night", theme: { ...PRESETS.night },
      blocks: [
        { id: "b-nav", type: "nav", on: true, t: { en: { brand: "My product", links: "Features, Questions", cta: "Get started" }, ar: { brand: "منتجي", links: "المزايا، الأسئلة", cta: "ابدأ الآن" } } },
        { id: "b-hero", type: "hero", on: true, t: { en: { kicker: "Built in Jarvis Studio", title: "Say what your product does in one line", body: "Replace this text with the problem you solve and who it is for. Keep it short and plain.", primary: "Get started", secondary: "See features" }, ar: { kicker: "صُمّم في استوديو جارفس", title: "قل ما يفعله منتجك في سطر واحد", body: "استبدل هذا النص بالمشكلة التي تحلّها ولمن هي. اجعله قصيراً وواضحاً.", primary: "ابدأ الآن", secondary: "شاهد المزايا" } } },
        { id: "b-features", type: "features", on: true, t: { en: { title: "What it does", f1t: "Works in two languages", f1b: "Arabic right to left and English left to right, from the same blocks.", f2t: "Readable by default", f2b: "Every colour pair is checked against WCAG and APCA while you edit.", f3t: "No trackers", f3b: "The page loads nothing from the network: no scripts, fonts or analytics from outside." }, ar: { title: "ماذا يفعل", f1t: "يعمل بلغتين", f1b: "العربية من اليمين إلى اليسار والإنجليزية من اليسار إلى اليمين، بالأقسام نفسها.", f2t: "مقروء من البداية", f2b: "كل زوج ألوان يُفحص بمعياري WCAG وAPCA أثناء التعديل.", f3t: "بلا تتبّع", f3b: "الصفحة لا تحمّل شيئاً من الشبكة: لا سكربتات ولا خطوط ولا تحليلات خارجية." } } },
        { id: "b-stats", type: "stats", on: false, t: { en: { s1v: "2", s1l: "languages", s2v: "3", s2l: "screen sizes checked", s3v: "0", s3l: "outside requests" }, ar: { s1v: "2", s1l: "لغتان", s2v: "3", s2l: "مقاسات شاشة مفحوصة", s3v: "0", s3l: "طلبات خارجية" } } },
        { id: "b-faq", type: "faq", on: true, t: { en: { title: "Questions", q1: "Does it work offline?", a1: "Yes. The downloaded file carries its fonts and needs no network.", q2: "Can I change the colours?", a2: "Yes. The Studio warns you when a pair becomes hard to read.", q3: "", a3: "" }, ar: { title: "أسئلة", q1: "هل يعمل دون اتصال؟", a1: "نعم. الملف المحمّل يحمل خطوطه ولا يحتاج إلى الشبكة.", q2: "هل أستطيع تغيير الألوان؟", a2: "نعم. ينبّهك الاستوديو حين يصبح زوج ألوان صعب القراءة.", q3: "", a3: "" } } },
        { id: "b-cta", type: "cta", on: true, t: { en: { title: "Ready to try it?", body: "Write the one next step you want a visitor to take.", button: "Get started" }, ar: { title: "جاهز للتجربة؟", body: "اكتب الخطوة التالية التي تريدها من الزائر.", button: "ابدأ الآن" } } },
        { id: "b-footer", type: "footer", on: true, t: { en: { text: "Made with Jarvis Studio." }, ar: { text: "صُنع باستوديو جارفس." } } },
      ],
    };
  }
  function loadSite() {
    try { const s = JSON.parse(store$.get("jarvis-studio-v1") || "null"); if (s && s.v === 1 && Array.isArray(s.blocks)) return s; } catch (e) { /* fall back */ }
    return defaultSite();
  }
  const pvTemplate = $("#pv").content;
  const PV_CSS = pvTemplate.querySelector("style").textContent;
  const PV_JS = pvTemplate.querySelector("script").textContent;
  const siteJson = site => JSON.stringify({ name: site.name, lang: site.lang, theme: site.theme, blocks: site.blocks }).replace(/</g, "\\u003c");
  function siteHtml(site, csp) {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const lang = site.lang === "ar" ? "ar" : "en";
    return "<!doctype html>\n<html lang=\"" + lang + "\" dir=\"" + (lang === "ar" ? "rtl" : "ltr") + "\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n" +
      (csp ? "<meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\" />\n" : "") +
      "<title>" + esc(site.name) + "</title>\n<style>" + PV_CSS + "</style>\n</head>\n<body>\n<script type=\"application/json\" id=\"site\">" + siteJson(site) + "<\/script>\n<script>" + PV_JS + "<\/script>\n</body>\n</html>\n";
  }

  pages.studio = () => {
    let site = loadSite();
    const save = () => store$.set("jarvis-studio-v1", JSON.stringify(site));
    const frame = h("iframe", { title: "Live preview of the site", sandbox: "allow-scripts", referrerpolicy: "no-referrer", loading: "eager" });
    const stage = h("div", { class: "stage" }, frame);
    const badges = h("div", { class: "cbadges", "aria-live": "polite" });
    let ready = false;
    const push = () => { if (ready && frame.contentWindow) frame.contentWindow.postMessage(JSON.parse(JSON.stringify({ name: site.name, lang: site.lang, theme: site.theme, blocks: site.blocks })), "*"); };
    frame.addEventListener("load", () => { ready = true; push(); });
    frame.srcdoc = siteHtml(site, null);
    const fit = () => {
      const w = stage.clientWidth, H = stage.clientHeight;
      if (!w) return;
      const s = Math.min(1, w / site.width);
      frame.style.width = site.width + "px";
      frame.style.height = Math.ceil(H / s) + "px";
      frame.style.transform = "translateX(" + Math.max(0, (w - site.width * s) / 2) + "px) scale(" + s + ")";
      widthNote.textContent = site.width + " px" + (s < 1 ? " · shown at " + Math.round(s * 100) + "%" : "");
    };
    const widthNote = h("span", { class: "subtle t-caption num" });
    if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(stage);

    const PAIRS = [["Body text on page", "text", "bg"], ["Muted text on page", "muted", "bg"], ["Text on cards", "text", "surface"], ["Muted text on cards", "muted", "surface"], ["Button text", "onAccent", "accent"], ["Links on page", "accent", "bg"]];
    const checkContrast = () => {
      let fails = 0;
      badges.replaceChildren(...PAIRS.map(([label, fg, bg]) => {
        const a = C.rgb(site.theme[fg]), b = C.rgb(site.theme[bg]);
        if (!a || !b) { fails++; return h("div", { class: "cb" }, h("span", { class: "pair", text: label }), h("span", { class: "badge s-failed", text: "Not a colour" })); }
        const r = C.ratio(a, b), lc = Math.abs(C.apca(a, b)), pass = r >= 4.5 && lc >= 60;
        if (!pass) fails++;
        return h("div", { class: "cb" }, h("span", { class: "pair", text: label }),
          h("span", { class: "badge " + (pass ? "s-ok" : "s-failed") }, h("span", { class: "dot", "aria-hidden": "true" }), pass ? "Pass" : "Fail"),
          h("span", { class: "num subtle", text: r.toFixed(2) + ":1 · Lc " + lc.toFixed(0) }));
      }));
      liveBadge.className = "badge " + (fails ? "s-failed" : "s-ok");
      liveBadge.replaceChildren(h("span", { class: "dot", "aria-hidden": "true" }), fails ? fails + " colour pair" + (fails > 1 ? "s" : "") + " below WCAG 4.5 / APCA 60" : "All pairs pass WCAG 4.5 and APCA 60");
    };
    const liveBadge = h("span", { class: "badge" });
    const changed = () => { save(); push(); checkContrast(); };

    const nameIn = h("input", { class: "input", id: "f-site", name: "site-name", autocomplete: "off", value: site.name, maxLength: 80 });
    nameIn.addEventListener("input", () => { site.name = nameIn.value; changed(); });
    const langSeg = seg("Preview language", [["en", "EN · LTR"], ["ar", "AR · RTL", { lang: "ar" }]], site.lang, v => { site.lang = v; changed(); renderBlocks(); });
    const widthSeg = seg("Preview width", [[375, "Phone 375"], [768, "Tablet 768"], [1440, "Laptop 1440"]], site.width, v => { site.width = v; save(); fit(); });
    const presetSel = h("select", { class: "select", id: "f-preset", name: "preset", autocomplete: "off" }, Object.entries(PRESETS).map(([k, p]) => h("option", { value: k, text: p.label, selected: site.preset === k })), h("option", { value: "custom", text: "Custom", selected: site.preset === "custom" }));
    const colorBox = h("div", { class: "stack" });
    const COLORS = [["bg", "Page"], ["surface", "Cards"], ["text", "Text"], ["muted", "Muted text"], ["accent", "Accent"], ["onAccent", "Text on accent"], ["border", "Lines"]];
    const renderColors = () => colorBox.replaceChildren(...COLORS.map(([k, label]) => {
      const pick = h("input", { type: "color", value: site.theme[k], "aria-label": label + " colour" });
      const hex = h("input", { class: "input mono", id: "f-c-" + k, name: "color-" + k, autocomplete: "off", value: site.theme[k], maxLength: 7, spellcheck: false });
      const set = v => { site.theme[k] = v; site.preset = "custom"; presetSel.value = "custom"; changed(); };
      pick.addEventListener("input", () => { hex.value = pick.value; hex.removeAttribute("aria-invalid"); set(pick.value); });
      hex.addEventListener("input", () => { const ok = /^#[0-9a-fA-F]{6}$/.test(hex.value); hex.setAttribute("aria-invalid", String(!ok)); if (ok) { pick.value = hex.value; set(hex.value.toLowerCase()); } });
      return h("div", { class: "field" }, h("label", { htmlFor: "f-c-" + k, text: label }), h("div", { class: "color-row" }, pick, hex));
    }));
    presetSel.addEventListener("change", () => { if (PRESETS[presetSel.value]) { site.theme = { ...PRESETS[presetSel.value] }; delete site.theme.label; site.preset = presetSel.value; renderColors(); changed(); } });

    const blockList = h("ul", { class: "blocks", "aria-label": "Sections" });
    function renderBlocks(focusId) {
      blockList.replaceChildren(...site.blocks.map((b, i) => {
        const on = h("input", { class: "switch", type: "checkbox", role: "switch", checked: b.on, "aria-label": "Show " + BLOCK_NAMES[b.type] });
        on.addEventListener("change", () => { b.on = on.checked; changed(); renderBlocks(); });
        const mv = (d, label, ic) => h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": label + " " + BLOCK_NAMES[b.type], disabled: i + d < 0 || i + d >= site.blocks.length, dataset: { move: b.id + ":" + d },
          onclick: () => { const j = i + d; [site.blocks[i], site.blocks[j]] = [site.blocks[j], site.blocks[i]]; changed(); renderBlocks(b.id + ":" + d); } }, icon(ic, "sm"));
        const t = b.t[site.lang] || (b.t[site.lang] = {});
        const editors = FIELDS[b.type].map(([key, label, long]) => {
          const id = "f-" + b.id + "-" + key;
          const ctl = h(long ? "textarea" : "input", { class: long ? "textarea" : "input", id, name: key, autocomplete: "off", value: t[key] || "", dir: "auto", rows: long ? 3 : null, maxLength: long ? 400 : 160 });
          ctl.addEventListener("input", () => { t[key] = ctl.value; changed(); });
          return h("div", { class: "field" }, h("label", { htmlFor: id, text: label }), ctl);
        });
        return h("li", { class: "blk" },
          h("div", { class: "blk-head" }, on, h("span", { class: "name" + (b.on ? "" : " off"), text: BLOCK_NAMES[b.type] + (b.on ? "" : " (hidden)") }), mv(-1, "Move up", "i-up"), mv(1, "Move down", "i-down")),
          h("details", null, h("summary", { text: "Edit text (" + (site.lang === "ar" ? "Arabic" : "English") + ")" }), h("div", { class: "stack", lang: site.lang, dir: site.lang === "ar" ? "rtl" : "ltr" }, editors)));
      }));
      if (focusId) { const b = blockList.querySelector("[data-move='" + focusId + "']"); if (b && !b.disabled) b.focus(); else { const o = blockList.querySelector("[data-move^='" + focusId.split(":")[0] + ":']:not([disabled])"); if (o) o.focus(); } }
    }

    const download = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-download", "sm"), "Download HTML");
    download.addEventListener("click", () => {
      const p = DATA.preview || {};
      const csp = p.cssHash && p.jsHash ? "default-src 'none'; script-src '" + p.jsHash + "'; style-src '" + p.cssHash + "'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'; object-src 'none'" : null;
      const blob = new Blob([siteHtml(site, csp)], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: (site.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site") + ".html", hidden: true });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("ok", "Saved a single HTML file with its fonts and a strict CSP. Nothing was published.");
    });
    const publish = h("button", { class: "btn btn-ghost", type: "button" }, icon("i-lock", "sm"), "Publish…");
    publish.addEventListener("click", e => openDialog("Publishing is locked", lockedCard({ id: "pub", category: "publish", action: "Publish “" + site.name + "” to an outside domain", createdAt: Date.now() }),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Close", onclick: closeDialog })], e.currentTarget));
    const resetBtn = h("button", { class: "btn btn-ghost", type: "button", text: "Start over…" });
    resetBtn.addEventListener("click", e => openDialog("Start the site over?", h("p", { class: "muted t-sm", text: "Sections, text and colours go back to the starting sample." }),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Keep my site", onclick: closeDialog }), h("button", { class: "btn btn-danger", type: "button", text: "Start over", onclick: () => { site = defaultSite(); save(); closeDialog(); route(); } })], e.currentTarget));

    // Clean-room clone: the local server reads one public page (or pasted HTML), keeps only its layout,
    // and returns blocks filled with our own copy. Publishing stays locked.
    const cloneUrl = h("input", { class: "input mono", id: "f-clone-url", name: "clone-url", type: "url", autocomplete: "off", placeholder: "https://example.com/", "aria-describedby": "h-clone" });
    const cloneHtml = h("textarea", { class: "textarea code", id: "f-clone-html", name: "clone-html", autocomplete: "off", spellcheck: false, rows: 5, placeholder: "<!doctype html>…" });
    const report = h("div", { class: "report", "aria-live": "polite" });
    const live = store.mode === "live";
    const cloneBtn = h("button", { class: "btn btn-primary", type: "button", disabled: !live }, icon("i-copy", "sm"), "Clean-room clone");
    cloneBtn.addEventListener("click", async () => {
      const body = cloneHtml.value.trim() ? { html: cloneHtml.value } : { url: cloneUrl.value.trim() };
      if (!body.html && !body.url) { toast("warn", "Paste an address or some HTML first."); cloneUrl.focus(); return; }
      cloneBtn.disabled = true; cloneBtn.setAttribute("aria-busy", "true");
      report.replaceChildren(h("p", { class: "muted", text: "Reading the structure…" }));
      try {
        const out = await store.cleanClone(body);
        site.blocks = out.blocks.map(b => ({ id: b.id, type: b.type, on: true, t: b.t, cols: b.cols || null, rows: b.rows || null }));
        site.name = "Clean template";
        nameIn.value = site.name;
        changed(); renderBlocks();
        const r = out.report, d = r.dropped;
        report.replaceChildren(h("dl", null,
          h("dt", { text: "Source" }), h("dd", { class: "mono", translate: "no", text: r.source + (r.fetch ? " · robots: " + r.fetch.robots : "") }),
          h("dt", { text: "Kept" }), h("dd", { text: r.kept }),
          h("dt", { text: "Sections" }), h("dd", { text: r.sections.join(" · ") }),
          h("dt", { text: "Dropped" }), h("dd", { text: [plural(d.scripts, "script") + " (" + plural(d.trackers, "tracker") + ")", plural(d.stylesheets, "stylesheet"), plural(d.images, "image"), plural(d.frames, "frame"), plural(d.textCharacters, "character") + " of their text"].join(", ") }),
          h("dt", { text: "Sweep" }), h("dd", null, r.sweep.leaks ? badge("failed", r.sweep.leaks + " possible leaks: " + r.sweep.leaked.join(", ")) : badge("ok", "0 leaks · " + plural(r.sweep.brandTermsChecked, "brand term") + " and " + plural(r.sweep.sourcePhrasesChecked, "phrase") + " checked"))));
        toast("ok", "Rebuilt " + out.blocks.length + " sections with your design and new copy. Nothing of the source was kept.");
      } catch (e) {
        report.replaceChildren(h("p", { class: "err" }, icon("i-alert", "sm"), e.message));
        toast("error", e.message);
      } finally { cloneBtn.disabled = !live; cloneBtn.removeAttribute("aria-busy"); }
    });
    const clonePanel = h("section", { class: "panel clone-bar", "aria-labelledby": "h-clone-t" }, h("h2", { id: "h-clone-t", text: "Clean-room clone" }),
      h("div", { class: "clone-row" }, h("div", { class: "field" }, h("label", { htmlFor: "f-clone-url", text: "Page address" }), cloneUrl), cloneBtn),
      h("details", null, h("summary", { text: "Or paste HTML" }), h("div", { class: "field" }, h("label", { htmlFor: "f-clone-html", text: "HTML" }), cloneHtml)),
      h("p", { class: "hint", id: "h-clone", text: live
        ? "Keeps only the layout (sections, card counts, table shapes). Text, images, colours, scripts and trackers are dropped and replaced with your design and our own copy. One request; robots.txt is respected."
        : "Runs on the local server. Start it with: node jarvis/server/server.mjs, then open http://127.0.0.1:8798." }),
      report);

    renderColors(); renderBlocks(); checkContrast();
    requestAnimationFrame(fit);
    return h("div", { class: "stack" },
      pageHead("Studio", "Design a page live. The preview runs in a sandbox with no network."),
      h("div", { class: "studio" },
        h("div", { class: "studio-controls" },
          clonePanel,
          h("section", { class: "panel", "aria-labelledby": "h-site" }, h("h2", { id: "h-site", text: "Site" }), h("div", { class: "field" }, h("label", { htmlFor: "f-site", text: "Name" }), nameIn),
            h("div", { class: "field" }, h("span", { class: "legend", text: "Language" }), langSeg)),
          h("section", { class: "panel", "aria-labelledby": "h-colors" }, h("h2", { id: "h-colors", text: "Colours" }), h("div", { class: "field" }, h("label", { htmlFor: "f-preset", text: "Preset" }), presetSel), colorBox,
            h("div", { class: "field" }, h("span", { class: "legend", text: "Contrast (live)" }), badges)),
          h("section", { class: "panel", "aria-labelledby": "h-blocks" }, h("h2", { id: "h-blocks", text: "Sections" }), blockList),
          h("section", { class: "panel", "aria-labelledby": "h-out" }, h("h2", { id: "h-out", text: "Output" }), h("div", { class: "row" }, download, publish, resetBtn))),
        h("div", { class: "preview-col" },
          h("div", { class: "preview-bar" }, widthSeg, h("div", { class: "row" }, liveBadge, widthNote)),
          stage)));
  };

  /* ── Skill Mixer (S14) ─────────────────────────────────────── */
  const SOURCE_LABEL = { project: "Project", reviewed: "Reviewed third-party", vendored: "Vendored reference" };
  function findingsBadge(f) {
    if (!f) return h("span", { class: "badge s-idle", text: "Not scanned" });
    if (f.critical || f.high) return h("span", { class: "badge s-failed" }, h("span", { class: "dot", "aria-hidden": "true" }), (f.critical ? f.critical + " critical " : "") + (f.high ? f.high + " high" : ""));
    if (f.medium || f.low) return h("span", { class: "badge s-warn" }, h("span", { class: "dot", "aria-hidden": "true" }), (f.medium + f.low) + " medium/low");
    return h("span", { class: "badge s-ok" }, h("span", { class: "dot", "aria-hidden": "true" }), "Clean");
  }
  function checkSkill(text) {
    const out = [];
    const add = (level, msg) => out.push({ level, msg });
    const src = String(text || "");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(src);
    if (!fm) { add("fail", "No frontmatter: the file must start with --- , then name: and description:, then ---."); }
    else {
      const name = (/^name:\s*(.+)$/m.exec(fm[1]) || [])[1];
      const descM = /^description:\s*(>-?|\|-?)?\s*\n?([\s\S]*?)(?=^\w[\w-]*:|$(?![\s\S]))/m.exec(fm[1]);
      const desc = descM ? descM[2].replace(/\s+/g, " ").trim() : "";
      if (!name) add("fail", "name: is missing.");
      else if (!/^[a-z0-9-]{1,64}$/.test(name.trim())) add("fail", "name: use lower-case letters, digits and hyphens, at most 64 characters.");
      else add("pass", "name: " + name.trim());
      if (!desc) add("fail", "description: is missing. It is how Claude decides when to use the skill.");
      else if (desc.length > 1024) add("fail", "description: " + desc.length + " characters; the limit is 1,024.");
      else if (desc.length > 200) add("warn", "description: " + desc.length + " characters. Some upload forms accept 200 at most.");
      else add("pass", "description: " + desc.length + " characters.");
    }
    const body = fm ? src.slice(fm[0].length) : src;
    if (!/^#\s+\S/m.test(body)) add("warn", "No # heading in the body.");
    if (body.trim().length < 80) add("warn", "The body is very short. Say what the skill does, step by step.");
    let hits = 0;
    for (const r of SPECTOR_RULES) {
      if (!r.re || !["*", "agent", "code"].includes(r.files)) continue;
      let re;
      try { re = new RegExp(r.re, (r.flags || "").replace("g", "") + "g"); } catch (e) { continue; }
      for (const m of src.matchAll(re)) {
        const line = src.slice(0, m.index).split("\n").length;
        hits++;
        add(r.sev === "critical" || r.sev === "high" ? "fail" : "warn", r.id + " (" + r.sev + ", line " + line + "): " + r.msg);
        if (hits > 30) break;
      }
    }
    if (!hits) add("pass", "SkillSpector rules: no finding (" + SPECTOR_RULES.filter(r => ["*", "agent", "code"].includes(r.files)).length + " rules checked in the browser).");
    return out;
  }
  const PLAN_STEPS = {
    "replica-recon": "map screens, flows and features into replica/recon.md",
    "replica-design": "measure and write tokens, contrast-check them (--apca 60)",
    "replica-architect": "plan the stack, schema.sql and API",
    "replica-build": "build the screens with every state",
    "replica-test": "write the test plan and flow tests",
    "replica-diff": "score parity from features.csv",
  };

  pages.skills = () => {
    const skills = (DATA.skills || []).slice();
    let mix = [];
    try { mix = JSON.parse(store$.get("jarvis-mix-v1") || "[]").filter(n => skills.some(s => s.name === n)); } catch (e) { mix = []; }
    const saveMix = () => store$.set("jarvis-mix-v1", JSON.stringify(mix));
    const q = h("input", { class: "input", id: "f-sq", type: "search", name: "q", autocomplete: "off", placeholder: "Name or words in the description" });
    const src = h("select", { class: "select", id: "f-src", name: "source", autocomplete: "off" }, h("option", { value: "", text: "Any source" }), Object.entries(SOURCE_LABEL).map(([k, v]) => h("option", { value: k, text: v })));
    const list = h("ul", { class: "skills", "aria-label": "Installed skills" });
    const mixList = h("ol", { class: "mixlist", "aria-label": "Mix order" });
    const plan = h("textarea", { class: "textarea code", id: "f-plan", name: "plan", readOnly: true, rows: 8, autocomplete: "off", spellcheck: false });
    const renderList = () => {
      const qq = q.value.trim().toLowerCase();
      const shown = skills.filter(s => (!src.value || s.source === src.value) && (!qq || (s.name + " " + s.description).toLowerCase().includes(qq)));
      if (!skills.length) { list.replaceChildren(h("li", null, emptyState("i-mix", "No skills found", "The build did not find any SKILL.md under .claude/skills."))); return; }
      if (!shown.length) { list.replaceChildren(h("li", null, emptyState("i-search", "No skill matches", "Try another word or source."))); return; }
      list.replaceChildren(...shown.map(s => {
        const on = mix.includes(s.name);
        const sw = h("input", { class: "switch", type: "checkbox", role: "switch", checked: on, "aria-label": "Add " + s.name + " to the mix" });
        sw.addEventListener("change", () => { if (sw.checked) { if (!mix.includes(s.name)) mix.push(s.name); } else mix = mix.filter(n => n !== s.name); saveMix(); renderList(); renderMix(); });
        return h("li", { class: "skill" + (on ? " on" : "") },
          h("div", { class: "skill-head" }, sw, h("b", { class: "mono", translate: "no", text: s.name })),
          h("p", { text: s.description || "No description." }),
          h("div", { class: "row" }, h("span", { class: "badge", text: SOURCE_LABEL[s.source] || s.source }), findingsBadge(s.findings), s.review ? h("span", { class: "subtle t-caption mono", text: s.review }) : null));
      }));
    };
    const renderMix = () => {
      if (!mix.length) {
        mixList.replaceChildren(h("li", { class: "placeholder" }, h("span", { class: "nm muted", text: "Switch skills on to build a plan." })));
        plan.value = "";
      } else {
        mixList.replaceChildren(...mix.map((n, i) => h("li", null, h("span", { class: "nm mono", translate: "no", text: n }),
          h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Move " + n + " up", disabled: i === 0, onclick: () => { [mix[i - 1], mix[i]] = [mix[i], mix[i - 1]]; saveMix(); renderMix(); } }, icon("i-up", "sm")),
          h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Move " + n + " down", disabled: i === mix.length - 1, onclick: () => { [mix[i + 1], mix[i]] = [mix[i], mix[i + 1]]; saveMix(); renderMix(); } }, icon("i-down", "sm")),
          h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Remove " + n, onclick: () => { mix = mix.filter(x => x !== n); saveMix(); renderList(); renderMix(); } }, icon("i-x", "sm")))));
        const risky = mix.filter(n => { const s = skills.find(x => x.name === n); return s && s.findings && (s.findings.critical || s.findings.high); });
        plan.value = "In Claude Code, inside giant-core, run these skills in order:\n" + mix.map((n, i) => (i + 1) + ". /" + n + (PLAN_STEPS[n] ? " — " + PLAN_STEPS[n] : "")).join("\n") +
          "\n\nRules: AGENTS.md and DESIGN.md win over every skill. Run SkillSpector --strict and the three-size check before a PR." + (risky.length ? "\nCheck first: " + risky.join(", ") + " has open SkillSpector findings." : "");
      }
      copyBtn.disabled = !mix.length;
    };
    const copyBtn = h("button", { class: "btn btn-primary", type: "button" }, icon("i-copy", "sm"), "Copy plan");
    copyBtn.addEventListener("click", () => {
      const done = () => toast("ok", "Plan copied. Paste it into Claude Code.");
      const fallback = () => { plan.focus(); plan.select(); toast("info", "Select-all is done: press Ctrl+C (⌘C) to copy."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(plan.value).then(done, fallback); else fallback();
    });
    const pipeline = h("button", { class: "btn btn-secondary", type: "button", text: "Use the Replica pipeline" });
    pipeline.addEventListener("click", () => { mix = Object.keys(PLAN_STEPS).filter(n => skills.some(s => s.name === n)); saveMix(); renderList(); renderMix(); toast("info", "Mix set to the installed Replica skills, in pipeline order."); });

    const editor = h("textarea", { class: "textarea code", id: "f-skillmd", name: "skill-md", autocomplete: "off", spellcheck: false, placeholder: "---\nname: my-skill\ndescription: What it does and when to use it.\n---\n\n# my-skill\n\nSteps…" });
    const results = h("ul", { class: "checks", "aria-live": "polite" });
    const runCheck = () => {
      const r = editor.value.trim() ? checkSkill(editor.value) : [];
      results.replaceChildren(...r.map(x => h("li", { class: x.level }, h("span", { class: "mark", "aria-hidden": "true", text: x.level === "pass" ? "✓" : x.level === "warn" ? "!" : "✕" }), h("span", null, h("span", { class: "vh", text: x.level + ": " }), x.msg))));
      const fails = r.filter(x => x.level === "fail").length;
      verdict.className = "badge " + (!r.length ? "s-idle" : fails ? "s-failed" : "s-ok");
      verdict.textContent = !r.length ? "Paste a SKILL.md to check it" : fails ? fails + " problem" + (fails > 1 ? "s" : "") + " to fix" : "Passes the browser checks";
    };
    const verdict = h("span", { class: "badge s-idle", text: "Paste a SKILL.md to check it" });
    let ct;
    editor.addEventListener("input", () => { clearTimeout(ct); ct = setTimeout(runCheck, 200); });
    const dl = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-download", "sm"), "Download SKILL.md");
    dl.addEventListener("click", () => {
      if (!editor.value.trim()) { toast("warn", "Write or paste a SKILL.md first."); editor.focus(); return; }
      const url = URL.createObjectURL(new Blob([editor.value], { type: "text/markdown" }));
      const a = h("a", { href: url, download: "SKILL.md", hidden: true }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("ok", "Saved SKILL.md. Nothing was installed.");
    });
    const install = h("button", { class: "btn btn-ghost", type: "button" }, icon("i-lock", "sm"), "Install into the repo…");
    install.addEventListener("click", e => openDialog("Installing a skill is locked", lockedCard({ id: "inst", category: "install", action: "Install this SKILL.md into .claude/skills", createdAt: Date.now() }),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Close", onclick: closeDialog })], e.currentTarget));

    q.addEventListener("input", renderList);
    src.addEventListener("change", renderList);
    renderList(); renderMix(); runCheck();
    const scan = DATA.scan;
    return h("div", { class: "stack" },
      pageHead("Skill Mixer", "The skills installed in this repo, with their SkillSpector status. Mix them into a plan for Claude Code."),
      h("p", { class: "sample-note" }, icon("i-alert", "sm"), scan ? "Real data from the repo, scanned " + fmtDate.format(new Date(scan.generated)) + " at build time (" + skills.length + " skills, " + scan.summary.critical + " critical, " + scan.summary.high + " high)." : "No scan in this build."),
      h("div", { class: "mixer" },
        h("div", { class: "stack" },
          h("div", { class: "filters" }, h("div", { class: "field" }, h("label", { htmlFor: "f-sq", text: "Search" }), q), h("div", { class: "field narrow" }, h("label", { htmlFor: "f-src", text: "Source" }), src)),
          list),
        h("div", { class: "stack mix-side" },
          h("section", { class: "panel", "aria-labelledby": "h-mix" }, h("h2", { id: "h-mix", text: "Mix" }), mixList, h("div", { class: "row" }, pipeline),
            h("div", { class: "field" }, h("label", { htmlFor: "f-plan", text: "Plan" }), plan), h("div", { class: "row" }, copyBtn)),
          h("section", { class: "panel", "aria-labelledby": "h-check" }, h("h2", { id: "h-check", text: "Check a SKILL.md" }),
            h("div", { class: "field" }, h("label", { htmlFor: "f-skillmd", text: "SKILL.md" }), editor), h("div", null, verdict), results, h("div", { class: "row" }, dl, install)))));
  };

  /* ── Router ─────────────────────────────────────────────────── */
  const TITLES = { overview: "Overview", agents: "Agents", agent: "Agent", runs: "Runs", run: "Run", approvals: "Approvals", logs: "Logs", settings: "Settings", studio: "Studio", skills: "Skill Mixer" };
  let first = true;
  function route() {
    const parts = (location.hash.replace(/^#\/?/, "") || "overview").split("/");
    let key = parts[0], arg = parts[1];
    let make;
    if (key === "agents" && arg) { make = () => pages.agent(decodeURIComponent(arg)); key = "agent"; }
    else if (key === "runs" && arg) { make = () => pages.run(decodeURIComponent(arg)); key = "run"; }
    else if (pages[key] && key !== "agent" && key !== "run") make = pages[key];
    const main = $("#main");
    const navKey = { agent: "agents", run: "runs" }[key] || key;
    $$(".nav a[data-route]").forEach(a => (a.dataset.route === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    if (!make) {
      main.replaceChildren(emptyState("i-search", "This page does not exist", "Check the address, or go back to the overview.", h("a", { class: "btn btn-primary", href: "#/overview", text: "Overview" })));
      document.title = "Not found · Jarvis";
    } else {
      main.replaceChildren(make());
      document.title = TITLES[key] + " · Jarvis";
    }
    if (!first) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    first = false;
  }
  window.addEventListener("hashchange", route);
  const updateCount = () => store.waitingCount().then(n => { const c = $("#approvalCount"); c.hidden = !n; c.textContent = String(n); c.setAttribute("aria-label", n + " waiting"); }, () => {});

  /* ── Workspace switcher (APG menu button). Switching reloads every screen's data. ── */
  const wsBtn = $("#wsBtn"), wsMenu = $("#wsMenu");
  function wsOpen(open, focusIdx) {
    wsMenu.hidden = !open; wsBtn.setAttribute("aria-expanded", String(open));
    const items = $$("[role=menuitemradio]", wsMenu);
    if (open && items.length) items[Math.max(0, Math.min(items.length - 1, focusIdx || 0))].focus();
  }
  async function buildWsMenu() {
    let list = [];
    try { list = await store.listWorkspaces(); } catch (e) { return; }
    const cur = store.slug;
    const curWs = list.find(w => w.slug === cur) || list[0];
    if (curWs) $("#wsName").textContent = curWs.name;
    wsMenu.replaceChildren(...list.map((w, i) => {
      const li = h("li", { role: "menuitemradio", "aria-checked": String(w.slug === cur), tabindex: "-1", dataset: { slug: w.slug }, translate: "no", text: w.name });
      const pick = async () => {
        wsOpen(false); wsBtn.focus();
        if (w.slug === store.slug) return;
        try {
          await store.switchWorkspace(w.slug);
          await buildWsMenu();
          updateCount();
          toast("info", "Switched to " + w.name + ".");
          const parts = (location.hash.replace(/^#\/?/, "") || "overview").split("/");
          if (parts.length > 1) location.hash = "#/" + parts[0]; else route();
        } catch (e) { toast("error", e.message); }
      };
      li.addEventListener("click", pick);
      li.addEventListener("keydown", e => {
        const items = $$("[role=menuitemradio]", wsMenu);
        if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
        else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
        else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
        else if (e.key === "Escape" || e.key === "Tab") { wsOpen(false); wsBtn.focus(); }
      });
      return li;
    }));
  }
  wsBtn.addEventListener("click", () => wsOpen(wsMenu.hidden, Math.max(0, $$("[role=menuitemradio]", wsMenu).findIndex(x => x.getAttribute("aria-checked") === "true"))));
  wsBtn.addEventListener("keydown", e => { if (e.key === "ArrowDown") { e.preventDefault(); wsOpen(true, 0); } });
  document.addEventListener("click", e => { if (!wsMenu.hidden && !e.target.closest(".ws")) wsOpen(false); });

  /* ── Command palette (APG combobox in a modal dialog) ────────── */
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  $("#kbdHint").textContent = isMac ? "⌘ K" : "Ctrl K";
  $("#searchBtn").setAttribute("aria-label", isMac ? "Search (⌘K)" : "Search (Ctrl+K)");
  const pal = $("#palette"), palIn = $("#palInput"), palList = $("#palList"), palNone = $("#palNone");
  let palOpener = null, shown = [], active = 0, cmds = [];
  const baseCmds = () => [
    ...Object.entries({ overview: "Overview", agents: "Agents", runs: "Runs", approvals: "Approvals", logs: "Logs", studio: "Studio", skills: "Skill Mixer", settings: "Settings" }).map(([k, v]) => [v, "Page", () => { location.hash = "#/" + k; }]),
    ["New agent", "Action", () => { location.hash = "#/agents"; setTimeout(() => agentDialog($("#searchBtn")), 0); }],
    ["Switch theme", "Action", () => setTheme(theme() === "light" ? "dark" : "light")],
    ["Switch direction", "Action", () => setDir(root.dir === "rtl" ? "ltr" : "rtl")],
    ["Switch workspace", "Action", () => wsOpen(true, 0)],
  ];
  function renderPal() {
    const words = palIn.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    shown = cmds.filter(c => words.every(w => c[0].toLowerCase().split(/\s+/).some(n => n.startsWith(w))));
    active = Math.min(active, Math.max(0, shown.length - 1));
    palList.replaceChildren(...shown.map((c, i) => {
      const li = h("li", { id: "cmd-" + i, role: "option", "aria-selected": String(i === active) }, h("span", { dir: "auto", text: c[0] }), h("span", { class: "kind", text: c[1] }));
      li.addEventListener("click", () => runCmd(c));
      li.addEventListener("mousemove", () => { if (active !== i) { active = i; renderPal(); } });
      return li;
    }));
    palNone.hidden = shown.length > 0;
    if (shown.length) palIn.setAttribute("aria-activedescendant", "cmd-" + active); else palIn.removeAttribute("aria-activedescendant");
  }
  function runCmd(c) { pal.close(); c[2](); }
  function openPal(from) {
    palOpener = from || document.activeElement;
    cmds = baseCmds();
    store.listAgents().then(list => { cmds = cmds.concat(list.map(a => [a.name, "Agent", () => { location.hash = "#/agents/" + a.id; }])); if (pal.open) renderPal(); }, () => {});
    palIn.value = ""; active = 0; renderPal(); pal.showModal(); palIn.focus();
  }
  pal.addEventListener("close", () => { if (palOpener && palOpener.isConnected) palOpener.focus(); });
  pal.addEventListener("click", e => { if (e.target === pal) pal.close(); });
  palIn.addEventListener("input", () => { active = 0; renderPal(); });
  palIn.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" && shown.length) { e.preventDefault(); active = (active + 1) % shown.length; renderPal(); $("#cmd-" + active).scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp" && shown.length) { e.preventDefault(); active = (active - 1 + shown.length) % shown.length; renderPal(); $("#cmd-" + active).scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter" && shown[active]) { e.preventDefault(); runCmd(shown[active]); }
  });
  $("#searchBtn").addEventListener("click", e => openPal(e.currentTarget));
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (!pal.open && !dlg.open) openPal(document.activeElement); }
    else if (e.key === "Escape" && app.classList.contains("drawer-open")) drawer(false);
  });

  // Boot once we know whether the local server answers (live) or not (sample).
  liveCheck.then(() => {
    store.subscribe(updateCount);
    buildWsMenu();
    updateCount();
    route();
  });
})();
