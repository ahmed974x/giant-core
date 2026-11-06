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
  // Dates follow the interface language (Arabic with Latin digits, like every number in Jarvis).
  let rel = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let fmtDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
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
    if (input.mode !== undefined && !["single", "long_horizon"].includes(input.mode)) errs.mode = "Pick single run or long-horizon mission.";
    const ce = input.capsuleEvery === undefined ? 1 : Number(input.capsuleEvery);
    if (!Number.isInteger(ce) || ce < 1 || ce > 10) errs.capsuleEvery = "Enter a whole number from 1 to 10.";
    return errs;
  }
  const permsOf = tools => ({ writeNotes: tools.includes("notes.write"), readWeb: tools.includes("web.read") });

  /* ── Missions (ADR-135): shared helpers for both stores ─────── */
  // SHA-256 in plain JS (FIPS 180-4), so capsules hash the same way from file:// and from the server.
  const sha256hex = (() => {
    const K = [], H0 = [], primes = [];
    for (let n = 2; primes.length < 64; n++) if (primes.every(p => n % p)) primes.push(n);
    const frac = x => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    primes.forEach((p, i) => { K[i] = frac(Math.cbrt(p)); if (i < 8) H0[i] = frac(Math.sqrt(p)); });
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    return str => {
      const bytes = new TextEncoder().encode(str);
      const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6;
      const m = new Uint8Array(n);
      m.set(bytes); m[l] = 0x80;
      const dv = new DataView(m.buffer);
      dv.setUint32(n - 4, (l * 8) >>> 0); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
      const H = H0.slice(), W = new Uint32Array(64);
      for (let o = 0; o < n; o += 64) {
        for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
          W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = H;
        for (let i = 0; i < 64; i++) {
          const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
          const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
          hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        [a, b, c, d, e, f, g, hh].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
      }
      return H.map(x => x.toString(16).padStart(8, "0")).join("");
    };
  })();
  // Keys sorted at every level, no spaces: the same canonical form as the server and lhcommon.py.
  const canonical = v => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}"
    : JSON.stringify(v === undefined ? null : v);
  const ZERO64 = "0".repeat(64);
  const sealCapsule = c => sha256hex(canonical({ mission_id: c.mission_id, seq: c.seq, label: c.label, state: c.state, prev_hash: c.prev_hash, created_at: c.created_at }));
  function verifyChain(list, missionId) {
    const problems = [];
    let prev = ZERO64;
    list.forEach((c, i) => {
      if (c.seq !== i + 1) problems.push("#" + c.seq + ": sequence gap");
      if (c.prevHash !== prev) problems.push("#" + c.seq + ": prev_hash does not match the capsule before it");
      if (sealCapsule({ mission_id: missionId, seq: c.seq, label: c.label, state: c.state, prev_hash: c.prevHash, created_at: new Date(c.createdAt).toISOString() }) !== c.hash) problems.push("#" + c.seq + ": hash does not match its content");
      prev = c.hash;
    });
    return { ok: !problems.length, count: list.length, problems, head: list.length ? list[list.length - 1].hash : ZERO64 };
  }
  const HEALTH_BASIS = "[INFERENCE] fixed rule: 100 − 12 per step since the last capsule − 1 per 400 output tokens over 4,000 (tokens ≈ bytes ÷ 4).";
  function missionHealth(m) {
    const last = m.capsules[m.capsules.length - 1];
    const lastAt = last ? last.createdAt : null;
    const since = m.steps.filter(s => s.updatedAt && (lastAt == null || s.updatedAt > lastAt) && ["done", "failed", "skipped", "blocked"].includes(s.status)).length;
    const tokens = Math.round(m.steps.reduce((n, s) => n + (s.output ? JSON.stringify(s.output).length : 0), 0) / 4);
    const score = Math.max(0, Math.min(100, 100 - since * 12 - Math.max(0, Math.round((tokens - 4000) / 400))));
    return { score, label: score >= 70 ? "good" : score >= 40 ? "save a capsule soon" : "save a capsule now", stepsSinceCapsule: since, outputTokens: tokens, capsules: m.capsules.length, basis: HEALTH_BASIS };
  }
  const GATE_LABEL = { tests: "TDD", lint: "Lint", contrast: "Contrast", security: "Security" };
  const MISSION_TOOLS = ["files.read", "git.log", "notes.read", "runs.read"];
  // The long-horizon mode of an agent: its read tools in phase 1, a security gate, then the note approval.
  function agentMissionTemplate(a) {
    const steps = a.tools.filter(t => MISSION_TOOLS.includes(t)).map(t => ({ phase: 1, kind: "tool", title: "Run " + t, tool: t }));
    const reads = steps.map((_, i) => i);
    steps.push({ phase: 2, kind: "gate", title: "Security gate (SkillSpector)", criteria: [{ check: "security", evidence: "jarvis/app/data/skills-scan.json" }] });
    if (a.tools.includes("notes.write")) steps.push({ phase: 3, kind: "approval", title: "Save the mission note", category: "file_write", depends: [...reads, steps.length - 1] });
    return { title: a.name + " · long run", goal: a.rolePrompt || "Run this agent's tools with gates and capsules.", steps };
  }

  /* Sample store: opened from disk (file://). Labelled sample data, simulated runs, three workspaces. */
  function sampleStore() {
    const uid = p => p + "_" + Math.random().toString(36).slice(2, 9);
    // A teaching series for sample mode: 5,000 made-up build times with four planted spikes (seeded, so the
    // same every time).
    const sampleSeries = () => {
      let x = 147;
      const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
      const pts = Array.from({ length: 5000 }, (_, i) => ({ t: 1793000000000 + i * 60000, v: Math.round((120 + 14 * Math.sin(i / 160) + (rnd() * 2 - 1) * 8) * 10) / 10 }));
      [[900, 260], [2100, 34], [3300, 290], [4400, 250]].forEach(([i, v]) => { pts[i].v = v; });
      return pts;
    };
    const sampleAudit = () => {
      const evs = W().events.filter(e => LlmPlan.AUDITED.test(e.kind)).slice().sort((a, b) => a.at - b.at);
      let peaks = [];
      return evs.map((e, seq) => {
        const at = new Date(e.at).toISOString(), entry = LlmPlan.auditEntry({ seq, kind: e.kind, actor: e.actor, target: e.target, at });
        const leafHash = LlmPlan.leafHash(entry);
        peaks = LlmPlan.frontierPush(peaks, leafHash);
        return { seq, kind: e.kind, actor: e.actor, target: e.target == null ? null : String(e.target), at, entry, leafHash, rootHash: LlmPlan.frontierRoot(peaks) };
      });
    };
    const snapSummary = r => ({ id: r.id, seq: r.seq, label: r.label, hash: r.hash, prevHash: r.prevHash, parentId: r.parentId, blocks: (r.site.blocks || []).length, name: r.site.name, createdAt: r.createdAt });
    let db, failMode = false;
    const subs = new Set();
    const MIN = 60000;
    function ev(actor, kind, target, at) { return { id: uid("ev"), actor, kind, target, at: at || Date.now() }; }
    function mkSteps(tools, status, n) { return tools.slice(0, n == null ? tools.length : n + 1).map((tool, i) => ({ idx: i, tool, status, ms: 400 + i * 350, tries: 1 })); }
    const agent = (id, name, model, rolePrompt, tools, maxSteps, status, createdAt, skills) => ({ id, name, model, rolePrompt, tools, skills: skills || [], maxSteps, permissions: permsOf(tools), status, createdAt, mode: "single", capsuleEvery: 1 });
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
        a.mode = input.mode === "long_horizon" ? "long_horizon" : "single"; a.capsuleEvery = Number(input.capsuleEvery || 1);
        W().agents.push(a); W().events.push(ev("member:owner", "agent.created", a.id)); save(); return ok(a);
      },
      updateAgent(id, input) {
        const a = W().agents.find(x => x.id === id);
        if (!a) return bad("No agent with that id in this workspace.");
        const errs = validateAgentInput(input, W().agents, id);
        if (Object.keys(errs).length) return bad(Object.values(errs)[0]);
        Object.assign(a, { name: input.name.trim(), model: input.model, rolePrompt: String(input.rolePrompt || "").trim(), tools: input.tools || [], skills: input.skills || [], maxSteps: Number(input.maxSteps), permissions: permsOf(input.tools || []),
          mode: input.mode === "long_horizon" ? "long_horizon" : (input.mode === undefined ? a.mode || "single" : "single"), capsuleEvery: Number(input.capsuleEvery || a.capsuleEvery || 1) });
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
        if (a.mode === "long_horizon") {
          const tpl = agentMissionTemplate(a);
          if (tpl.steps.length > a.maxSteps) return bad("This mission has " + tpl.steps.length + " steps; the agent's limit is " + a.maxSteps + ".");
          const m = newMission(tpl, "agent", { title: tpl.title, capsuleEvery: a.capsuleEvery, agentId: a.id });
          MS().push(m); ws.events.push(ev("member:owner", "mission.created", m.id));
          return startSample(m).then(() => ({ mission: m.id }));
        }
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
      listApprovals() { return ok(W().approvals.slice().sort((x, y) => y.createdAt - x.createdAt).map(p => ({ ...p, locked: !!LOCKED[p.category], agentName: p.agentLabel || (W().agents.find(a => a.id === p.agentId) || {}).name || (p.agentId ? "Removed agent" : "Sample request") }))); },
      // Only a person decides; locked categories cannot be approved, as in schema.sql.
      decide(id, decision, reason) {
        const p = W().approvals.find(x => x.id === id);
        if (!p) return bad("No approval with that id in this workspace.");
        if (p.status !== "pending") return bad("Someone already decided this one.");
        if (LOCKED[p.category] && decision === "approved") return bad("Locked: this " + LOCKED[p.category] + ". It needs Director 00's separate approval outside Jarvis.");
        if (decision === "rejected" && !String(reason || "").trim()) return bad("Say why, so the agent can do something else.");
        p.status = decision; p.decidedBy = "member:owner"; p.decidedAt = Date.now(); p.reason = decision === "rejected" ? String(reason).trim() : null;
        W().events.push(ev("member:owner", "approval." + decision, id));
        if (p.missionId) onDecisionSample(p);
        save(); return ok(p);
      },
      listEvents() { return ok(W().events.slice().sort((x, y) => y.at - x.at)); },
      stats() {
        const day = Date.now() - 86400000, w = W();
        return ok({ agents: w.agents.filter(a => a.status !== "archived").length, runsToday: w.runs.filter(r => r.createdAt > day).length,
          waiting: w.approvals.filter(p => p.status === "pending" && !LOCKED[p.category]).length, locked: w.approvals.filter(p => p.status === "pending" && LOCKED[p.category]).length,
          failed: w.runs.filter(r => r.status === "failed" && r.createdAt > day).length });
      },
      waitingCount() { return Promise.resolve(W().approvals.filter(p => p.status === "pending" && !LOCKED[p.category]).length); },
      // Pasted HTML is extracted in the page by the server's own module (inlined at build); an address needs the server.
      cleanClone(body) {
        if (!body || !body.html) return bad("Reading an address needs the local server. Start it with: node jarvis/server/server.mjs, then open http://127.0.0.1:8798. Or paste the HTML.");
        const out = CleanRoom.cleanClone(String(body.html));
        out.report.fetch = null;
        return ok(out);
      },
    };

    /* Missions in the sample store: the same engine rules as jarvis/server/lib/missions.mjs, on this
       browser's data. Tool steps are simulated; gate steps judge the evidence snapshot taken at build
       time (real files from the repo); capsules are real SHA-256 chains over this browser's state. */
    const WFS = () => {
      const w = W();
      if (!w.workflows) { const g = LlmPlan.starterGraph(); w.workflows = [{ id: uid("wf"), name: "Review and release", version: 1, graph: g, createdAt: Date.now(), updatedAt: Date.now() }]; }
      return w.workflows;
    };
    const MS = () => {
      const w = W();
      if (!w.missions) {
        w.missions = [];
        const tpl = { "omega-prime": "adr-digest", "jarvis-studio": "design-audit", "giant-core": "release-readiness" }[slug];
        if (tpl && (DATA.templates || {})[tpl]) w.missions.push(newMission(DATA.templates[tpl], tpl, {}));
      }
      return w.missions;
    };
    function newMission(tpl, template, { title, capsuleEvery, agentId }) {
      const t = Date.now();
      return { id: uid("ms"), title: String(title || tpl.title).trim(), goal: tpl.goal, template, agentId: agentId || null, status: "draft", capsuleEvery: Number(capsuleEvery || 1), startedAt: null, finishedAt: null, createdAt: t, updatedAt: t,
        steps: tpl.steps.map((s, idx) => ({ id: uid("st"), idx, phase: s.phase, title: s.title, kind: s.kind, tool: s.tool || null, category: s.category || null, input: s.input || {}, dependsOn: s.depends || [], criteria: s.criteria || [], approvalId: null, status: "queued", gateStatus: "none", output: null, ms: null, updatedAt: t, gates: [] })),
        capsules: [], progress: [t + " Plan created from template " + template + "."], timer: null };
    }
    const findMission = id => MS().find(x => x.id === id);
    // ADR-142: audit, then mount (or refuse), on this browser's data.
    function sampleMount(skill, origin, parentId, type, note) {
      const scan = LlmPlan.auditSkill(skill.files, SPECTOR_RULES, LlmPlan.scanFiles);
      if (!scan.ok) return { mounted: false, skill: { name: skill.name, description: skill.description, files: skill.files }, scan };
      const list = W().runtime || (W().runtime = []);
      const taken = n => list.some(r => r.status === "mounted" && r.name === n) || (W().forged || []).some(f => f.status === "mounted" && f.name === n);
      let name = skill.name; for (let i = 2; taken(name) && i < 50; i++) name = skill.name.slice(0, 37) + "-v" + i;
      const r = { id: uid("rs"), name, description: skill.description, origin, sourceUrl: null, licence: null, version: 1, parentId, files: skill.files, scan, status: "mounted", approvalId: null, createdAt: Date.now(), updatedAt: Date.now() };
      list.push(r);
      (W().evolution || (W().evolution = [])).push({ id: uid("evo"), skillId: r.id, skillName: name, type, parentId, note, scan, createdAt: Date.now() });
      W().events.push(ev("member:owner", "skill.mounted", name)); save();
      return { mounted: true, skill: r, scan };
    }
    const stepState = m => ({ mission: { status: m.status, title: m.title }, steps: m.steps.map(s => ({ idx: s.idx, status: s.status, gate: s.gateStatus, approval: s.approvalId || null, output: s.output == null ? null : s.output })) });
    function capsule(m, label) {
      const prev = m.capsules[m.capsules.length - 1];
      const c = { mission_id: m.id, seq: prev ? prev.seq + 1 : 1, label, state: JSON.parse(JSON.stringify(stepState(m))), prev_hash: prev ? prev.hash : ZERO64, created_at: new Date(Date.now()).toISOString() };
      const hash = sealCapsule(c);
      m.capsules.push({ id: uid("cap"), seq: c.seq, label, hash, prevHash: c.prev_hash, createdAt: Date.parse(c.created_at), state: c.state });
      m.progress.push(Date.now() + " Capsule #" + c.seq + " " + label + " saved (" + hash.slice(0, 12) + "…).");
    }
    const setS = (m, s, f) => { Object.assign(s, f, { updatedAt: Date.now() }); m.updatedAt = Date.now(); };
    function evidenceFor(c) {
      const e = (DATA.evidence || []).find(x => x.path === c.evidence && x.check === c.check);
      return e ? { check: c.check, evidence: c.evidence, ok: e.ok, detail: e.detail, sha256: e.sha256, savedAt: e.savedAt, snapshot: true } : { check: c.check, evidence: c.evidence, ok: false, detail: "No evidence file at " + c.evidence + " in this build.", sha256: null, snapshot: true };
    }
    function runSampleStep(ws, m, s) {
      if (s.kind === "tool") setS(m, s, { status: "done", ms: 120 + s.idx * 37, output: { simulated: true, tool: s.tool, note: "Simulated in sample mode: no tool ran. Start jarvis/server for real tools." } });
      else if (s.kind === "gate") {
        const results = s.criteria.map(evidenceFor), pass = results.length > 0 && results.every(r => r.ok);
        s.gates = results.map(r => ({ check_name: r.check, status: r.ok ? "pass" : "fail", detail: r.detail, evidence: r.evidence }));
        setS(m, s, { gateStatus: pass ? "pass" : "fail", status: pass ? "done" : "failed", ms: 8, output: { pass, results } });
      } else {
        const locked = !!LOCKED[s.category];
        const ap = { id: uid("ap"), category: s.category, runId: null, agentId: null, missionId: m.id, missionStep: s.idx, agentLabel: "Mission: " + m.title, action: s.title,
          payload: locked ? "Mission step: locked in Jarvis (" + LOCKED[s.category] + "). The mission carries on with steps that do not need it." : "+ notes/mission-" + m.template + ".md (sample: nothing is written from the browser)", status: "pending", createdAt: Date.now() };
        ws.approvals.push(ap); ws.events.push(ev("mission:" + m.id, "approval.requested", ap.id));
        setS(m, s, { status: "blocked", approvalId: ap.id, ms: 4, output: { approval: ap.id, locked } });
      }
      m.progress.push(Date.now() + " T" + (s.idx + 1) + " " + s.title + ": " + s.status + ".");
    }
    // One beat of the engine: skip what can no longer run, start the next phase's ready steps, or settle.
    function advance(ws, m, phasesSince) {
      m.timer = null;
      if (m.status !== "running") return;
      const by = new Map(m.steps.map(s => [s.idx, s]));
      for (const s of m.steps.filter(x => x.status === "queued")) if (s.dependsOn.some(d => ["failed", "skipped"].includes(by.get(d).status))) setS(m, s, { status: "skipped", output: { reason: "A step it needs did not finish." } });
      const running = m.steps.filter(s => s.status === "running");
      if (running.length) {
        running.forEach(s => runSampleStep(ws, m, s));
        const phase = running[0].phase;
        if (!m.steps.some(s => s.phase === phase && ["queued", "running"].includes(s.status)) && ++phasesSince >= m.capsuleEvery) { capsule(m, "phase " + phase + " done"); phasesSince = 0; }
        save(); m.timer = setTimeout(() => advance(ws, m, phasesSince), 450); return;
      }
      const ready = m.steps.filter(s => s.status === "queued" && s.dependsOn.every(d => by.get(d).status === "done") && m.steps.every(o => o.phase >= s.phase || !["queued", "running"].includes(o.status)));
      if (!ready.length) {
        const open = m.steps.filter(s => !["done", "failed", "skipped"].includes(s.status));
        if (!open.length) {
          const failed = m.steps.some(s => s.status === "failed");
          m.status = failed ? "failed" : "succeeded"; m.finishedAt = Date.now();
          capsule(m, failed ? "finished with a failed step" : "finished");
          ws.events.push(ev("system", "mission." + m.status, m.id));
        } else if (m.steps.some(s => s.status === "blocked")) {
          m.status = "awaiting_approval";
          capsule(m, "waiting for approval (" + m.steps.filter(s => s.status === "blocked").length + ")");
          ws.events.push(ev("system", "mission.waiting", m.id));
        }
        save(); return;
      }
      const phase = Math.min(...ready.map(s => s.phase));
      ready.filter(s => s.phase === phase).forEach(s => setS(m, s, { status: "running" }));
      save(); m.timer = setTimeout(() => advance(ws, m, phasesSince), 450);
    }
    const missionOut = m => { const { timer, progress, ...rest } = m; return { ...rest, steps: m.steps.map(s => ({ ...s, locked: s.kind === "approval" && !!LOCKED[s.category], approval: s.approvalId ? (W().approvals.find(p => p.id === s.approvalId) || null) : null })), chain: verifyChain(m.capsules, m.id), health: missionHealth(m), files: { dir: "this browser (sample)", names: ["task_plan.md", "findings.md", "progress.md"] }, progressLines: progress.length, simulated: true }; };
    function startSample(m) {
      if (["succeeded", "failed"].includes(m.status)) return bad("This mission has finished. Restore a capsule to run part of it again.");
      if (m.status === "running" && m.timer) return ok(missionOut(m));
      m.status = "running"; m.startedAt = m.startedAt || Date.now(); m.finishedAt = null;
      W().events.push(ev("member:owner", "mission.started", m.id)); save();
      const ws = W();
      m.timer = setTimeout(() => advance(ws, m, 0), 300);
      return ok(missionOut(m));
    }
    function onDecisionSample(p) {
      for (const w of Object.values(db.data)) {
        const m = (w.missions || []).find(x => x.id === p.missionId);
        if (!m) continue;
        const s = m.steps.find(x => x.approvalId === p.id);
        if (!s || s.status !== "blocked") return;
        setS(m, s, p.status === "approved" ? { status: "done", output: { approval: p.id, written: null, note: "Sample mode writes no file." } } : { status: "failed", output: { approval: p.id, rejected: p.reason } });
        if (m.status === "awaiting_approval" || m.status === "running") { m.status = "running"; if (!m.timer) m.timer = setTimeout(() => advance(w, m, 0), 300); }
      }
    }
    // After a reload no timer survives: a running sample mission picks up where its steps stand.
    for (const w of Object.values(db.data)) for (const m of w.missions || []) { m.timer = null; for (const s of m.steps) if (s.status === "running") s.status = "queued"; if (m.status === "running") m.timer = setTimeout(() => advance(w, m, 0), 300); }
    Object.assign(api, {
      llmStatus() { return ok({ online: false, engine: "deterministic-rules", models: [], creatorZeroTokenMode: true, sample: true }); },
      llmRun({ mode, prompt }) {
        const p = String(prompt || "").trim();
        if (!p) return bad("Write what you want first.");
        const base = { mode, engine: "deterministic-rules", zeroTokenCost: true, thinking: null, label: "fixed rules (no model)", warning: "Sample mode: no model. The local server talks to Ollama on 127.0.0.1." };
        const b = W().billing || (W().billing = { tiers: [], ledger: [] });
        b.ledger.push({ actor: "creator", engine: "deterministic-rules", model: null, tokens: Math.ceil(p.length / 4), cost_micro_usd: 0, ref: "llm." + mode, at: Date.now() }); save();
        if (mode === "design") { const out = CleanRoom.cleanClone("<h1>" + p.replace(/[<>&]/g, " ") + "</h1><p>.</p>"); out.report.source = "fixed rules"; return ok({ ...base, blocks: out.blocks, report: out.report }); }
        if (mode === "plan") return ok({ ...base, steps: LlmPlan.fallbackPlan(p), planFrom: "fixed rules" });
        return ok({ ...base, text: "Sample mode has no model. Start jarvis/server and Ollama for answers." });
      },
      planMission({ goal, capsuleEvery }) {
        const g = String(goal || "").trim();
        if (!g) return bad("Write the goal first.");
        const steps = LlmPlan.fallbackPlan(g).map(x => ({ ...x, depends: x.depends || [] }));
        const m = newMission({ title: g.slice(0, 120), goal: g, steps }, "llm-plan", { title: g.slice(0, 120), capsuleEvery: capsuleEvery || 1 });
        m.planner = { engine: "deterministic-rules", model: null, thinking: null, planFrom: "fixed rules", warning: "Sample mode: no model. Locks are decided by rule.", label: "fixed rules (no model)", at: new Date().toISOString() };
        MS().push(m); W().events.push(ev("member:owner", "mission.created", m.id)); save(); return ok(missionOut(m));
      },
      // ADR-144 in sample mode: the council runs the same rules with no model (the architect is the fixed
      // planner), and the time machine keeps its SHA-256 chain in this browser.
      council({ mode, prompt, createMission }) {
        const fixed = { status: async () => ({}), run: async ({ mode: m, prompt: q }) => {
          if (m === "design") { const out = CleanRoom.cleanClone("<h1>" + String(q).replace(/[<>&]/g, " ") + "</h1><p>.</p>"); out.report.source = "fixed rules"; return { engine: "deterministic-rules", label: "fixed rules (no model)", blocks: out.blocks, report: out.report }; }
          return { engine: "deterministic-rules", label: "fixed rules (no model)", steps: LlmPlan.fallbackPlan(q) };
        } };
        return LlmPlan.runCouncil(fixed, { mode, prompt }).then(out => {
          if (createMission && out.mode === "plan") {
            const m = newMission({ title: out.prompt.slice(0, 120), goal: out.prompt, steps: out.final.steps.map(x => ({ ...x, depends: x.depends || [] })) }, "llm-plan", { title: out.prompt.slice(0, 120), capsuleEvery: 1 });
            m.planner = { engine: "council", model: null, thinking: null, planFrom: "council", warning: "Sample mode: no model. Locks are decided by rule.", label: "fixed rules (no model)", at: new Date().toISOString() };
            MS().push(m); W().events.push(ev("member:owner", "mission.created", m.id)); save();
            out.mission = missionOut(m);
          }
          return out;
        }, e => bad(e.message));
      },
      // ADR-147 in sample mode: a teaching series (made-up numbers, seeded) and a Merkle tree built from this
      // browser's sensitive events with the same RFC 6962 code as the server.
      telemetryMetrics() { const a = LlmPlan.analyse(sampleSeries()); return ok([{ metric: "sample.build_ms", n: a.n, mean: a.mean, sd: a.sd, ewma: a.ewma, anomalies: a.anomalies.length, lastT: null }]); },
      telemetrySeries(metric, threshold) {
        const pts = sampleSeries(), a = LlmPlan.analyse(pts), th = Math.max(3, Math.min(1000, Number(threshold) || 120));
        return ok({ metric, raw: pts.length, threshold: th, points: LlmPlan.lttb(pts, th), stats: { n: a.n, mean: a.mean, sd: a.sd, ewma: a.ewma, vpin: a.vpin, buckets: a.buckets }, anomalies: a.anomalies });
      },
      auditHead() { const l = sampleAudit(); return ok(l.length ? { size: l.length, root: l[l.length - 1].rootHash, at: l[l.length - 1].at } : { size: 0, root: LlmPlan.EMPTY_ROOT, at: null }); },
      auditLeaves(limit) { return ok(sampleAudit().reverse().slice(0, Number(limit) || 20)); },
      auditProof(seq) {
        const l = sampleAudit(), m = Number(seq);
        if (!l[m]) return bad("No audit entry with that number.");
        const hashes = l.map(x => x.leafHash), path = LlmPlan.inclusionPath(m, hashes), root = l[l.length - 1].rootHash;
        return ok({ ...l[m], size: l.length, root, path, verified: LlmPlan.verifyInclusion(hashes[m], m, l.length, path, root) });
      },
      auditVerify() { const l = sampleAudit(); return ok({ ok: true, size: l.length, root: l.length ? l[l.length - 1].rootHash : LlmPlan.EMPTY_ROOT }); },
      auditRecord(kind, target) { W().events.push(ev("member:owner", kind, String(target || "").slice(0, 120))); save(); return api.auditHead(); },
      // ADR-148 in sample mode: the layers this browser can check itself (the build's evidence, the prover, the
      // SSRF list, the Merkle tree of its events); the database and the model bridge need the local server.
      diagnostics() {
        const m = DATA.mutation, u = DATA.uiStates, sc = DATA.scan.summary, l = sampleAudit();
        const proof = LlmPlan.provePlan(LlmPlan.fallbackPlan("read the commits then run the tests then publish the site then pay the invoice"));
        const leaks = LlmPlan.SSRF_PROBES.filter(a => !LlmPlan.isBlockedAddress(a));
        const server = { ok: false, detail: "needs the local server" };
        return ok({ at: new Date().toISOString(), layers: [
          LlmPlan.layer("memory", "Memory", [{ name: "Memory episodes (BM25)", ok: true, detail: (W().memory || []).length + " in this browser" }, { name: "State capsules (SHA-256 chained)", ok: true, detail: MS().reduce((n, x) => n + (x.capsules || []).length, 0) + " in this browser" }]),
          LlmPlan.layer("proof", "Development and proof", [
            ...DATA.evidence.filter(e => e.check === "tests").slice(0, 2).map(e => ({ name: "Tests: " + e.path.split("/").pop(), ok: e.ok, detail: e.detail })),
            { name: "UI-state gate", ok: true, detail: u.covered + "/" + u.total },
            { name: "Mutation testing", ok: !!m && m.verified, detail: m ? m.killed + "/" + m.total + " killed" + (m.verified ? " [VERIFIED]" : "") : "no evidence" },
            { name: "Formal proof of a plan with locks", ok: proof.verified, detail: proof.states + " states, " + proof.effects + " effects behind a lock" }]),
          LlmPlan.layer("search", "Open search and SSRF shield", [{ name: "Private addresses refused", ok: !leaks.length, detail: (LlmPlan.SSRF_PROBES.length - leaks.length) + " of " + LlmPlan.SSRF_PROBES.length + " refused, IPv6 spellings included" }, { name: "Official keyless APIs", ...server }]),
          LlmPlan.layer("security", "Security", [{ name: "SkillSpector on the skills", ok: sc.critical === 0 && sc.high === 0, detail: "critical " + sc.critical + ", high " + sc.high }, { name: "Merkle audit log verifies", ok: true, detail: l.length + " entries" }, { name: "Lock constraints in the database", ...server }]),
          LlmPlan.layer("bridge", "Local model bridge", [{ name: "Model engine on 127.0.0.1", ...server }, { name: "Server bound to 127.0.0.1", ...server }]),
        ] });
      },
      diagnosticsBundle() {
        return api.diagnostics().then(d => {
          const l = sampleAudit();
          const raw = { format: "jarvis-diagnostics-v1", generatedAt: d.at, workspace: slug, sample: true, layers: d.layers, merkle: { size: l.length, root: l.length ? l[l.length - 1].rootHash : LlmPlan.EMPTY_ROOT },
            events: W().events.slice(-50).map(e => ({ kind: e.kind, actor: e.actor, target: e.target, at: new Date(e.at).toISOString() })) };
          const s = LlmPlan.scrub(raw);
          return { ...s.value, scrubbed: { redactions: s.redactions.length, rules: [...new Set(s.redactions.map(r => r.rule))], paths: s.redactions.map(r => r.path).slice(0, 50) } };
        });
      },
      // ADR-145: a Ctrl+K macro, with the same rules and prover as the server.
      macroMission({ text }) {
        const g = String(text || "").trim();
        if (!g || g.length > 2000) return bad("Write the macro's steps, at most 2,000 characters.");
        const steps = LlmPlan.fallbackPlan(g).map(x => ({ ...x, depends: x.depends || [] }));
        const proof = LlmPlan.provePlan(steps);
        if (!proof.verified) return bad("The macro did not pass the formal proof; nothing was made.");
        const m = newMission({ title: g.slice(0, 120), goal: g, steps }, "llm-plan", { title: g.slice(0, 120), capsuleEvery: 1 });
        m.planner = { engine: "macro", model: null, planFrom: "Ctrl+K macro", label: "fixed rules (no model)", proof: { verified: true, states: proof.states, transitions: proof.transitions, effects: proof.effects, lockedStates: proof.lockedStates }, at: new Date().toISOString() };
        MS().push(m); W().events.push(ev("member:owner", "mission.created", m.id)); save(); return ok(missionOut(m));
      },
      studioSnapshots() { return ok((W().snapshots || []).slice().reverse().map(snapSummary)); },
      studioGet(id) { const r = (W().snapshots || []).find(x => x.id === id); return r ? ok({ ...snapSummary(r), site: r.site }) : bad("No snapshot with that id."); },
      studioSave({ site, label, parentId }) {
        if (!site || !Array.isArray(site.blocks)) return bad("Send the Studio site with its blocks.");
        const list = W().snapshots || (W().snapshots = []);
        const snap = LlmPlan.snapshotOf(site), last = list[list.length - 1];
        if (last && !parentId && LlmPlan.canonical(LlmPlan.snapshotOf(last.site)) === LlmPlan.canonical(snap)) return ok({ ...snapSummary(last), unchanged: true });
        const prev = last ? last.hash : "0".repeat(64);
        const r = { id: uid("snap"), seq: last ? last.seq + 1 : 1, label: String(label || "Saved").replace(/\s+/g, " ").trim().slice(0, 80) || "Saved", site: snap, hash: LlmPlan.snapshotHash(snap, prev), prevHash: prev, parentId: parentId || null, createdAt: new Date().toISOString() };
        list.push(r); W().events.push(ev("member:owner", "studio.snapshot", "#" + r.seq)); save();
        return ok(snapSummary(r));
      },
      studioFork(id) {
        const r = (W().snapshots || []).find(x => x.id === id);
        if (!r) return bad("No snapshot with that id.");
        return api.studioSave({ site: r.site, label: "Fork of #" + r.seq, parentId: r.id }).then(x => ({ ...x, site: r.site }));
      },
      studioDiff(a, b) {
        const A = (W().snapshots || []).find(x => x.id === a), B = (W().snapshots || []).find(x => x.id === b);
        if (!A || !B) return bad("No snapshot with that id.");
        const lines = LlmPlan.lineDiff(LlmPlan.prettyLines(A.site), LlmPlan.prettyLines(B.site));
        return ok({ a: snapSummary(A), b: snapSummary(B), blocks: LlmPlan.blockDiff(A.site, B.site), lines, added: lines.filter(l => l.op === "add").length, removed: lines.filter(l => l.op === "del").length });
      },
      studioVerify() {
        const rows = W().snapshots || [];
        let prev = "0".repeat(64);
        for (const r of rows) {
          if (r.prevHash !== prev) return ok({ ok: false, count: rows.length, brokenAt: r.seq, reason: "prev_hash does not match the snapshot before" });
          if (r.hash !== LlmPlan.snapshotHash(r.site, r.prevHash)) return ok({ ok: false, count: rows.length, brokenAt: r.seq, reason: "hash does not match the site" });
          prev = r.hash;
        }
        return ok({ ok: true, count: rows.length, head: prev });
      },
      // ADR-137 in sample mode: the same rules on this browser's data. Webhooks need the local server
      // (their HMAC secrets never live in the browser), and schedules run only there.
      listWorkflows() { return ok(WFS().map(w => ({ id: w.id, name: w.name, version: w.version, updatedAt: w.updatedAt, steps: w.graph.nodes.length, locked: w.graph.nodes.filter(LlmPlan.nodeLocked).length }))); },
      getWorkflow(id) {
        const w = WFS().find(x => x.id === id);
        if (!w) return bad("No workflow with that id in this workspace.");
        let steps = []; try { steps = LlmPlan.graphToSteps(LlmPlan.checkGraph(w.graph)); } catch (e) { /* draft */ }
        return ok({ ...w, steps, runs: MS().filter(m => m.planner && m.planner.workflowId === id).map(m => ({ id: m.id, status: m.status, createdAt: m.createdAt })) });
      },
      createWorkflow({ name, graph }) {
        const n = String(name || "").trim();
        if (!n || n.length > 80) return bad("Use 1 to 80 characters for the name.");
        let g; try { g = LlmPlan.checkGraph(graph || LlmPlan.starterGraph()); } catch (e) { return bad(e.message); }
        const w = { id: uid("wf"), name: n, version: 1, graph: { nodes: g.nodes, edges: g.edges }, createdAt: Date.now(), updatedAt: Date.now() };
        WFS().push(w); W().events.push(ev("member:owner", "workflow.created", w.id)); save(); return api.getWorkflow(w.id);
      },
      saveWorkflow(id, { name, graph }) {
        const w = WFS().find(x => x.id === id);
        if (!w) return bad("No workflow with that id in this workspace.");
        let g; try { g = LlmPlan.checkGraph(graph); } catch (e) { return bad(e.message); }
        const n = String(name == null ? w.name : name).trim();
        if (!n || n.length > 80) return bad("Use 1 to 80 characters for the name.");
        Object.assign(w, { name: n, graph: { nodes: g.nodes, edges: g.edges }, version: w.version + 1, updatedAt: Date.now() });
        W().events.push(ev("member:owner", "workflow.saved", id)); save(); return api.getWorkflow(id);
      },
      deleteWorkflow(id) { W().workflows = WFS().filter(x => x.id !== id); save(); return ok({ ok: true }); },
      runWorkflow(id) {
        const w = WFS().find(x => x.id === id);
        if (!w) return bad("No workflow with that id in this workspace.");
        let steps; try { steps = LlmPlan.graphToSteps(LlmPlan.checkGraph(w.graph)); } catch (e) { return bad(e.message); }
        const m = newMission({ title: "Workflow: " + w.name, goal: "Workflow: " + w.name, steps }, "workflow", { title: "Workflow: " + w.name, capsuleEvery: 1 });
        m.planner = { engine: "workflow", model: null, thinking: null, planFrom: "workflow graph v" + w.version, workflowId: id, label: "workflow graph (no model)", at: new Date().toISOString() };
        MS().push(m); W().events.push(ev("member:owner", "mission.created", m.id)); save();
        return startSample(m).then(() => ({ mission: m.id }));
      },
      addMember({ email, role }) {
        const e = String(email || "").trim().toLowerCase();
        if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(e)) return bad("Give an email address.");
        if (!["admin", "operator", "viewer"].includes(role)) return bad("Pick admin, operator or viewer. There is one owner.");
        if (W().members.some(m => m.email === e)) return bad("That person is already a member.");
        W().members.push({ id: uid("mb"), email: e, role }); W().events.push(ev("member:owner", "member.added", e)); save(); return ok(W().members);
      },
      setRole(id, role) {
        const m = W().members.find(x => x.id === id);
        if (!m) return bad("No member with that id.");
        if (m.role === "owner") return bad("The owner's role does not change here.");
        if (!["admin", "operator", "viewer"].includes(role)) return bad("Pick admin, operator or viewer.");
        m.role = role; save(); return ok(W().members);
      },
      removeMember(id) {
        const m = W().members.find(x => x.id === id);
        if (!m) return bad("No member with that id.");
        if (m.role === "owner") return bad("The owner cannot be removed.");
        W().members = W().members.filter(x => x.id !== id); save(); return ok(W().members);
      },
      listSchedules() { return ok((W().schedules || []).map(x => ({ ...x, agentName: (W().agents.find(a => a.id === x.agentId) || {}).name || "Removed agent" }))); },
      setSchedule(agentId, { everyMinutes, enabled }) {
        const every = Number(everyMinutes);
        if (!Number.isInteger(every) || every < 5 || every > 10080) return bad("Run every 5 minutes to 7 days (10,080 minutes).");
        const list = W().schedules || (W().schedules = []);
        const cur = list.find(x => x.agentId === agentId) || (list.push({ id: uid("sc"), agentId }), list[list.length - 1]);
        Object.assign(cur, { everyMinutes: every, enabled: enabled !== false, nextAt: Date.now() + every * 60000, lastRunId: null, lastError: null });
        save(); return api.listSchedules();
      },
      deleteSchedule(agentId) { W().schedules = (W().schedules || []).filter(x => x.agentId !== agentId); save(); return api.listSchedules(); },
      listWebhooks() { return ok([]); },
      createWebhook() { return bad("Webhooks run on the local server, where their HMAC secrets are kept. Start it with: node jarvis/server/server.mjs"); },
      billing() {
        const b = W().billing || (W().billing = { tiers: [], ledger: [] });
        const totals = {};
        for (const l of b.ledger) { const t = totals[l.engine] || (totals[l.engine] = { engine: l.engine, entries: 0, tokens: 0, costMicroUsd: 0 }); t.entries++; t.tokens += l.tokens; }
        return ok({ creatorZeroToken: true, billingEnabled: false, tiers: b.tiers, ledger: { totals: Object.values(totals), recent: b.ledger.slice(-20).reverse() }, moneyRequests: [] });
      },
      saveTier({ id, name, monthlyTokens, priceMinor, currency }) {
        const b = W().billing || (W().billing = { tiers: [], ledger: [] });
        const n = String(name || "").trim(), mt = Number(monthlyTokens), pm = Number(priceMinor || 0), cur = String(currency || "USD").toUpperCase();
        if (!n || n.length > 40) return bad("Use 1 to 40 characters for the plan name.");
        if (!Number.isInteger(mt) || mt < 0) return bad("Monthly tokens is a whole number.");
        if (!Number.isInteger(pm) || pm < 0) return bad("The draft price is a whole number of cents.");
        if (!/^[A-Z]{3}$/.test(cur)) return bad("Currency is a three-letter code.");
        if (b.tiers.some(t => t.name === n && t.id !== id)) return bad("Another plan has this name.");
        const t = id ? b.tiers.find(x => x.id === id) : null;
        if (t) Object.assign(t, { name: n, monthlyTokens: mt, priceMinor: pm, currency: cur }); else b.tiers.push({ id: uid("tier"), name: n, monthlyTokens: mt, priceMinor: pm, currency: cur, status: "draft" });
        save(); return api.billing();
      },
      deleteTier(id) { const b = W().billing || { tiers: [] }; b.tiers = b.tiers.filter(t => t.id !== id); save(); return api.billing(); },
      requestMoney(what) {
        const ap = { id: uid("ap"), category: "money", agentId: null, action: what === "billing" ? "Turn on billing and token plans for subscribers" : "Activate the subscriber plan “" + what + "”", payload: "Charging people is Director 00's decision outside Jarvis, after a legal review.", status: "pending", createdAt: Date.now() };
        W().approvals.push(ap); save(); return api.billing().then(b => ({ locked: true, approvalId: ap.id, billing: b }));
      },
      analytics() {
        const w = W(), day = 86400000, now = Date.now();
        const count = (list, key) => { const o = {}; list.forEach(x => { o[x[key]] = (o[x[key]] || 0) + 1; }); return Object.entries(o).map(([k, c]) => ({ key: k, count: c })); };
        const gates = {};
        for (const m of MS()) for (const st of m.steps) for (const g of st.gates || []) { const r = gates[g.check_name] || (gates[g.check_name] = { pass: 0, fail: 0 }); r[g.status]++; }
        const b = W().billing || { ledger: [] };
        const tok = {}; b.ledger.forEach(l => { tok[l.engine] = tok[l.engine] || { engine: l.engine, entries: 0, tokens: 0, costMicroUsd: 0 }; tok[l.engine].entries++; tok[l.engine].tokens += l.tokens; });
        return ok({
          runsByStatus: count(w.runs, "status"),
          runsByDay: [...Array(14)].map((_, i) => { const d = new Date(now - (13 - i) * day).toISOString().slice(0, 10); return { day: d, runs: w.runs.filter(r => new Date(r.createdAt).toISOString().slice(0, 10) === d).length }; }),
          agents: w.agents.map(a => ({ agent: a.name, runs: w.runs.filter(r => r.agentId === a.id).length, succeeded: w.runs.filter(r => r.agentId === a.id && r.status === "succeeded").length, failed: w.runs.filter(r => r.agentId === a.id && r.status === "failed").length })),
          gateRates: ["tests", "lint", "contrast", "security"].map(c => { const r = gates[c] || { pass: 0, fail: 0 }; return { check: c, pass: r.pass, fail: r.fail, rate: r.pass + r.fail ? Math.round(r.pass / (r.pass + r.fail) * 1000) / 10 : null }; }),
          missionsByStatus: count(MS(), "status"), capsules: MS().reduce((n, m) => n + m.capsules.length, 0),
          approvals: count(w.approvals.map(p => ({ k: (LOCKED[p.category] ? "locked-" : "") + p.status })), "k"),
          webhooks: [], tokens: Object.values(tok), creatorZeroToken: true, costMicroUsd: 0,
        });
      },
      // ADR-139 in sample mode: the page has no network (connect-src 'self', or file://), so a search
      // answers from this browser's memory and says that live search runs on the local server.
      liveSearch({ q, mode }) {
        const qq = String(q || "").trim();
        if (!["web", "packages", "osv"].includes(mode)) return bad("Mode is web, packages or osv.");
        if (qq.length < 2) return bad("Write at least two characters to search for.");
        const ids = { web: ["wikipedia-en", "wikipedia-ar", "openalex", "hn", "github", "searxng"], packages: ["npm", "pypi", "github"], osv: ["osv"] }[mode];
        const pool = W().memory || [];
        const hits = LlmPlan.bm25(pool.map(e => ({ id: e.id, text: e.title + "\n" + e.body })), qq, { limit: 8 }).map(hh => ({ ...pool.find(e => e.id === hh.id), score: hh.score, terms: hh.terms }));
        return ok({ q: qq, mode, results: [], offline: true, at: new Date().toISOString(), sources: ids.map(id => ({ source: id, label: SEARCH_LABEL[id], ok: false, count: 0, ms: 0, error: "Needs the local server" })),
          fallback: { from: "memory", note: "Live search runs on the local server (node jarvis/server/server.mjs). This sample page has no network, so these come from this browser's memory.", hits } });
      },
      searchStatus() { return ok({ sources: [], searxng: null }); },
      llmStream() { return bad("Streaming answers come from a local model through the local server. Start jarvis/server and Ollama, vLLM or llama.cpp on this computer."); },
      // ADR-141 in sample mode: the same locks, on this browser's data. There is no gate without a server.
      accessStatus() { return ok({ mode: "founder_private", publicLocked: true, gate: false, signedIn: true, publicHost: null, sample: true }); },
      requestPublic() {
        const ap = { id: uid("ap"), category: "publish", agentId: null, action: "Open Jarvis to the public (founder_private → public_subscribers)", payload: "Anyone could then reach Jarvis. This is a publish action for Director 00 outside Jarvis.", status: "pending", createdAt: Date.now() };
        W().approvals.push(ap); save(); return ok({ locked: true, approvalId: ap.id });
      },
      listEndpoints() { return ok((W().endpoints || []).slice().reverse()); },
      requestEndpoint({ name, url }) {
        const n = String(name || "").trim().slice(0, 60);
        if (!n) return bad("Name the endpoint, e.g. DeepSeek API.");
        let u; try { u = new URL(String(url || "").trim()); } catch (e) { return bad("Write the endpoint as a full https:// address."); }
        if (u.protocol !== "https:" || u.username || u.password) return bad("A hosted endpoint must use https:// without a user name or password.");
        if (!u.hostname.includes(".") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|localhost/.test(u.hostname)) return bad("Private and local addresses are not hosted endpoints; local models use the OpenAI-compatible engine on 127.0.0.1.");
        const ap = { id: uid("ap"), category: "outbound", agentId: null, action: "Send workspace text to the hosted model endpoint " + u.hostname, payload: "Prompts, memory examples and plans would leave this computer.", status: "pending", createdAt: Date.now() };
        W().approvals.push(ap);
        const e = { id: uid("ep"), name: n, url: u.origin + u.pathname.replace(/\/+$/, ""), host: u.hostname, status: "draft", approvalId: ap.id, approvalStatus: "pending", createdAt: Date.now() };
        (W().endpoints || (W().endpoints = [])).push(e); save();
        return ok({ locked: true, approvalId: ap.id, endpoint: e });
      },
      removeEndpoint(id) { W().endpoints = (W().endpoints || []).filter(e => e.id !== id); save(); return ok({ ok: true }); },
      signOut() { return ok({ ok: true }); },
      // ADR-142 in sample mode: synthesis and evolution run on this browser's data with the same audit;
      // GitHub discovery and import need the local server (the page itself has no network).
      listRuntime() { return ok((W().runtime || []).filter(r => r.status === "mounted").slice().sort((a, b) => b.updatedAt - a.updatedAt)); },
      evolutionLog() { return ok((W().evolution || []).slice().reverse()); },
      discoverSkills() { return bad("Searching GitHub needs the local server (node jarvis/server/server.mjs). Synthesize the skill here instead."); },
      importSkill() { return bad("Importing from GitHub needs the local server (node jarvis/server/server.mjs)."); },
      synthesizeSkill({ request, kind }) {
        const want = String(request || "").trim();
        if (want.length < 10) return bad("Describe the skill or tool in a sentence (10+ characters).");
        let skill; try { skill = LlmPlan.forgeSkill({ name: LlmPlan.slugName(want), description: want, kind: kind === "python-tool" ? "python-tool" : "checklist" }); } catch (e) { return bad(e.message); }
        return ok({ ...sampleMount(skill, "synthesized", null, "CAPTURED", "Synthesized by the fixed template from: " + want.slice(0, 200)), engine: "fixed rules", warning: null });
      },
      evolveSkill(body) {
        const list = W().runtime || [];
        if (body.type === "FIX") {
          const cur = list.find(r => r.id === body.skillId && r.status === "mounted");
          if (!cur) return bad("No mounted skill with that id.");
          let parsed; try { parsed = LlmPlan.readSkillMd(String(body.skillMd || "")); } catch (e) { return bad(e.message); }
          const files = { ...cur.files, "SKILL.md": String(body.skillMd).replace(/^name:\s*.+$/m, "name: " + cur.name) };
          const scan = LlmPlan.auditSkill(files, SPECTOR_RULES, LlmPlan.scanFiles);
          if (!scan.ok) return ok({ mounted: false, skill: { name: cur.name, files }, scan });
          Object.assign(cur, { description: parsed.description, files, scan, version: cur.version + 1, updatedAt: Date.now() });
          (W().evolution || (W().evolution = [])).push({ id: uid("evo"), skillId: cur.id, skillName: cur.name, type: "FIX", parentId: cur.id, note: String(body.note || "Fixed by the founder"), scan, createdAt: Date.now() });
          save(); return ok({ mounted: true, skill: cur, scan });
        }
        if (body.type === "DERIVED") {
          const cur = list.find(r => r.id === body.skillId && r.status === "mounted");
          if (!cur) return bad("No mounted skill with that id.");
          const steps = [...String(cur.files["SKILL.md"]).split("\n").filter(l => /^\d+\.\s/.test(l)).map(l => l.replace(/^\d+\.\s*/, "")), ...(body.steps || [])].slice(0, 10);
          let skill; try { skill = LlmPlan.forgeSkill({ name: cur.name.slice(0, 36) + "-plus", description: cur.description + " (derived)", steps }); } catch (e) { return bad(e.message); }
          return ok(sampleMount(skill, "derived", cur.id, "DERIVED", "Derived from " + cur.name));
        }
        if (body.type === "CAPTURED") {
          const m = MS().find(x => x.id === body.missionId);
          if (!m) return bad("Pick the finished mission to capture.");
          let skill; try { skill = LlmPlan.forgeSkill({ name: LlmPlan.slugName(m.title, "captured-mission"), description: "Repeat the mission “" + m.title.slice(0, 120) + "” the way it worked.", steps: LlmPlan.stepsFromMission(m) }); } catch (e) { return bad(e.message); }
          return ok(sampleMount(skill, "captured", null, "CAPTURED", "Captured from mission " + m.title.slice(0, 120)));
        }
        return bad("Evolution type is FIX, DERIVED or CAPTURED.");
      },
      unmountRuntime(id) { const r = (W().runtime || []).find(x => x.id === id); if (r) r.status = "removed"; save(); return ok({ ok: true }); },
      installRuntime(id) {
        const r = (W().runtime || []).find(x => x.id === id && x.status === "mounted");
        if (!r) return bad("No mounted skill with that id.");
        if (!r.approvalId) { const ap = { id: uid("ap"), category: "install", agentId: null, action: "Install the skill “" + r.name + "” into .claude/skills", payload: "Needs Director 00's approval and a written security review.", status: "pending", createdAt: Date.now() }; W().approvals.push(ap); r.approvalId = ap.id; save(); }
        return ok({ locked: true, approvalId: r.approvalId });
      },
      // ADR-138 in sample mode: the same BM25, forge scan and computed self-check, on this browser's data.
      searchMemory({ q, kind } = {}) {
        const pool = (W().memory || []).filter(e => !kind || e.kind === kind).slice().reverse();
        if (!String(q || "").trim()) return ok({ total: pool.length, hits: pool.slice(0, 20).map(e => ({ ...e, score: null, terms: [] })) });
        const byId = new Map(pool.map(e => [e.id, e]));
        const passed = o => Object.values(o || {}).filter(v => v === true).length;
        return ok({ total: pool.length, hits: LlmPlan.bm25(pool.map(e => ({ id: e.id, text: e.title + "\n" + e.body + "\n" + (e.tags || []).join(" "), boost: 1 + 0.25 * passed(e.outcome) })), q, { limit: 20 }).map(hh => ({ ...byId.get(hh.id), score: hh.score, terms: hh.terms })) });
      },
      addMemory({ kind, title, body, tags }) {
        const t = String(title || "").trim().slice(0, 160), b = String(body || "").trim().slice(0, 8000);
        if (!t || !b) return bad("A memory needs a title and some text.");
        if (LlmPlan.scanFiles({ "memory.txt": t + "\n" + b }, SPECTOR_RULES).critical) return bad("That text holds a key-shaped value. Keys belong in the vault, never in memory.");
        const e = { id: uid("mem"), kind: kind || "note", title: t, body: b, tags: (tags || []).slice(0, 8), outcome: {}, source: "person", createdAt: Date.now() };
        (W().memory || (W().memory = [])).push(e); save(); return ok(e);
      },
      removeMemory(id) { W().memory = (W().memory || []).filter(e => e.id !== id); save(); return ok({ ok: true }); },
      selfCheck(n) {
        const count = Math.max(3, Math.min(30, Number(n) || 9)), from = Math.floor(Date.now() / 60000) % 997;
        const items = [...Array(count)].map((_, k) => ({ ...LlmPlan.selfCheckItem(from + k), reply: null, correct: null }));
        const list = W().memory || (W().memory = []);
        items.forEach(it => list.push({ id: uid("mem"), kind: "lesson", title: it.question, body: it.answer, tags: ["self-check", it.category], outcome: { computed: true }, source: "self-check", createdAt: Date.now() }));
        save();
        return ok({ engine: "deterministic-rules", asked: count, graded: 0, correct: 0, items, note: "Sample mode has no model: the computed answers were stored as lessons." });
      },
      exportMemory() { return ok((W().memory || []).map(e => JSON.stringify({ id: e.id, kind: e.kind, outcome: e.outcome || {}, messages: [{ role: "user", content: e.title }, { role: "assistant", content: e.body }] })).join("\n") + "\n"); },
      listForged() { return ok((W().forged || []).filter(f => f.status === "mounted").slice().reverse()); },
      forge(body) {
        let skill;
        try { skill = body.skillMd ? LlmPlan.readSkillMd(body.skillMd) : LlmPlan.forgeSkill(body); } catch (e) { return bad(e.message); }
        const scan = LlmPlan.scanFiles(skill.files, SPECTOR_RULES);
        const list = W().forged || (W().forged = []);
        if (list.some(f => f.status === "mounted" && f.name === skill.name)) return bad("A mounted skill already has this name in this workspace.");
        if (!scan.ok) return ok({ mounted: false, skill: { name: skill.name, files: skill.files }, scan });
        const f = { id: uid("fs"), name: skill.name, description: skill.description, kind: skill.kind, files: skill.files, scan, status: "mounted", approvalId: null, createdAt: Date.now() };
        list.push(f); W().events.push(ev("member:owner", "skill.forged", skill.name)); save();
        return ok({ mounted: true, skill: f, scan });
      },
      unmountSkill(id) { const f = (W().forged || []).find(x => x.id === id); if (f) f.status = "removed"; save(); return ok({ ok: true }); },
      installSkill(id) {
        const f = (W().forged || []).find(x => x.id === id && x.status === "mounted");
        if (!f) return bad("No mounted skill with that id.");
        if (!f.approvalId) { const ap = { id: uid("ap"), category: "install", agentId: null, action: "Install the forged skill “" + f.name + "” into .claude/skills", payload: "Needs Director 00's approval and a written security review.", status: "pending", createdAt: Date.now() }; W().approvals.push(ap); f.approvalId = ap.id; save(); }
        return ok({ locked: true, approvalId: f.approvalId });
      },
      listMissions() { return ok(MS().slice().sort((a, b) => b.createdAt - a.createdAt).map(m => ({ id: m.id, title: m.title, template: m.template, status: m.status, createdAt: m.createdAt, steps: m.steps.length, done: m.steps.filter(s => s.status === "done").length, blocked: m.steps.filter(s => s.status === "blocked").length, failed: m.steps.filter(s => s.status === "failed").length, phases: new Set(m.steps.map(s => s.phase)).size, capsules: m.capsules.length, health: missionHealth(m) }))); },
      getMission(id) { const m = findMission(id); return m ? ok(missionOut(m)) : bad("No mission with that id in this workspace."); },
      createMission(input) {
        const tpl = (DATA.templates || {})[input.template];
        if (!tpl) return bad("Pick a template.");
        const ce = Number(input.capsuleEvery);
        if (!Number.isInteger(ce) || ce < 1 || ce > 10) return bad("Save a capsule every 1 to 10 phases.");
        const t = String(input.title || tpl.title).trim();
        if (!t || t.length > 120) return bad("Use 1 to 120 characters for the title.");
        const m = newMission(tpl, input.template, { title: t, capsuleEvery: ce });
        MS().push(m); W().events.push(ev("member:owner", "mission.created", m.id)); save(); return ok(missionOut(m));
      },
      runMission(id) { const m = findMission(id); return m ? startSample(m) : bad("No mission with that id in this workspace."); },
      pauseMission(id) {
        const m = findMission(id);
        if (!m || !["running", "awaiting_approval"].includes(m.status)) return bad("Only a running mission can be paused.");
        clearTimeout(m.timer); m.timer = null; m.steps.forEach(s => { if (s.status === "running") s.status = "queued"; });
        m.status = "paused"; capsule(m, "paused"); W().events.push(ev("member:owner", "mission.paused", id)); save(); return ok(missionOut(m));
      },
      verifyMission(id) { const m = findMission(id); return m ? ok(verifyChain(m.capsules, m.id)) : bad("No mission with that id in this workspace."); },
      getCapsule(id, seq) {
        const m = findMission(id), c = m && m.capsules.find(x => x.seq === Number(seq));
        if (!c) return bad("No capsule with that number.");
        return ok({ ...c, hashOk: sealCapsule({ mission_id: m.id, seq: c.seq, label: c.label, state: c.state, prev_hash: c.prevHash, created_at: new Date(c.createdAt).toISOString() }) === c.hash, canonicalBytes: new TextEncoder().encode(canonical(c.state)).length });
      },
      restoreCapsule(id, seq) {
        const m = findMission(id);
        if (!m) return bad("No mission with that id in this workspace.");
        if (m.status === "running") return bad("Pause the mission before you restore a capsule.");
        const chain = verifyChain(m.capsules, m.id);
        if (!chain.ok) return bad("The capsule chain is broken, so nothing was restored: " + chain.problems.join("; "));
        const c = m.capsules.find(x => x.seq === Number(seq));
        if (!c) return bad("No capsule with that number.");
        for (const saved of c.state.steps) {
          const s = m.steps.find(x => x.idx === saved.idx);
          let status = saved.status === "running" ? "queued" : saved.status, approvalId = saved.approval;
          const p = approvalId && W().approvals.find(x => x.id === approvalId);
          if (status === "blocked" && (!p || p.status !== "pending")) { status = "queued"; approvalId = null; }
          setS(m, s, { status, gateStatus: saved.gate, approvalId, output: saved.output, gates: status === "queued" ? [] : s.gates });
        }
        m.status = "paused"; m.finishedAt = null;
        capsule(m, "restored from #" + c.seq);
        W().events.push(ev("member:owner", "mission.restored", id)); save(); return ok(missionOut(m));
      },
      skipStep(id, idx) {
        const m = findMission(id), s = m && m.steps.find(x => x.idx === Number(idx));
        if (!s) return bad("No step with that number.");
        if (s.status !== "blocked") return bad("Only a step that waits for approval can be skipped.");
        setS(m, s, { status: "skipped", output: { approval: s.approvalId, skipped: "A person chose to carry on without it. The request stays in the inbox." } });
        W().events.push(ev("member:owner", "mission.step_skipped", id));
        if (m.status !== "paused") { m.status = "running"; if (!m.timer) { const ws = W(); m.timer = setTimeout(() => advance(ws, m, 0), 300); } }
        save(); return ok(missionOut(m));
      },
    });
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
    // Server push first (ADR-137): the server sends a "change" event when the workspace changes; the
    // 1.5 s poll is only the fallback when the stream cannot stay open.
    let es = null, live = "poll";
    const onChange = v => { if (version !== null && v !== version) subs.forEach(fn => fn()); version = v; };
    function startStream() {
      if (typeof EventSource !== "function") { startPolling(); return; }
      if (es) es.close();
      es = new EventSource(w("/stream"));
      es.addEventListener("change", e => { try { live = "stream"; onChange(JSON.parse(e.data).v); } catch (x) { /* ignore a bad frame */ } });
      es.addEventListener("error", () => { if (es && es.readyState === 2) { live = "poll"; startPolling(); } });
    }
    const startLive = () => { if (!es && !timer) startStream(); };
    poll();
    const api = {
      mode: "live",
      info,
      subscribe(fn) { subs.add(fn); startLive(); return () => subs.delete(fn); },
      get liveUpdates() { return live; },
      setFail(on) { failMode = !!on; },
      get failMode() { return failMode; },
      get slug() { return slug; },
      reset() { return Promise.reject(new Error("Live data is not reset from the page. Stop the server and delete jarvis/server/.data to start over.")); },
      listWorkspaces: () => req("GET", "/api/workspaces"),
      // The change marker is read right away (not on the next poll), so a change that lands within the
      // first poll interval after a switch is still noticed.
      async switchWorkspace(s) { const ws = await req("GET", "/api/w/" + encodeURIComponent(s)); slug = s; version = null; store$.set("jarvis-ws", s); await poll(); if (es) startStream(); subs.forEach(fn => fn()); return ws; },
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
      listMissions: () => req("GET", w("/missions")),
      llmStatus: () => req("GET", "/api/llm/status"),
      llmRun: body => req("POST", "/api/llm/run", { ...body, workspace: slug }),
      council: body => req("POST", "/api/llm/council", { ...body, workspace: slug }),
      macroMission: body => req("POST", w("/missions/macro"), body),
      telemetryMetrics: () => req("GET", w("/telemetry/metrics")),
      telemetrySeries: (metric, threshold) => req("GET", w("/telemetry/series?metric=" + encodeURIComponent(metric) + "&threshold=" + encodeURIComponent(threshold))),
      auditHead: () => req("GET", w("/audit/head")),
      auditLeaves: limit => req("GET", w("/audit/leaves?limit=" + encodeURIComponent(limit || 20))),
      auditProof: seq => req("GET", w("/audit/merkle-proof?seq=" + encodeURIComponent(seq))),
      auditVerify: () => req("GET", w("/audit/verify")),
      auditRecord: (kind, target) => req("POST", w("/audit/record"), { kind, target }),
      diagnostics: () => req("GET", w("/diagnostics")),
      diagnosticsBundle: () => req("GET", w("/diagnostics/bundle")),
      studioSnapshots: () => req("GET", w("/studio/snapshots")),
      studioGet: id => req("GET", w("/studio/snapshots/" + encodeURIComponent(id))),
      studioSave: body => req("POST", w("/studio/snapshots"), body),
      studioFork: id => req("POST", w("/studio/snapshots/" + encodeURIComponent(id) + "/fork"), {}),
      studioDiff: (a, b) => req("GET", w("/studio/diff?a=" + encodeURIComponent(a) + "&b=" + encodeURIComponent(b))),
      studioVerify: () => req("GET", w("/studio/verify")),
      liveSearch: body => req("POST", "/api/search/live", { ...body, workspace: slug }),
      // ADR-140: a chat answer token by token. Server-Sent Events over a same-origin POST, read with fetch.
      async llmStream(body, on) {
        const r = await fetch("/api/llm/stream", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "content-type": "application/json", "x-jarvis": "1" }, body: JSON.stringify({ ...body, workspace: slug }), signal: on.signal });
        if (!r.ok || !r.body) { let j = null; try { j = await r.json(); } catch (e) { /* not JSON */ } throw new Error((j && j.error) || "The server answered " + r.status + "."); }
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = "", done = null;
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = (/^event: (\w+)/m.exec(block) || [])[1], line = (/^data: (.*)$/m.exec(block) || [])[1];
            let data = null; try { data = JSON.parse(line); } catch (e) { continue; }
            if (ev === "token") on.token(data.t); else if (ev === "thinking") on.thinking(data.t); else if (ev === "done") done = data; else if (ev === "error") throw new Error(data.message);
          }
        }
        return done || { engine: "deterministic-rules", warning: "The stream ended early." };
      },
      searchStatus: () => req("GET", "/api/search/status"),
      // ADR-141: asking is recorded (202) as a locked card; changing the mode directly answers 403.
      accessStatus: async () => ({ ...(await req("GET", "/api/access")), ...(await req("GET", "/api/founder/status")) }),
      requestPublic: () => req("POST", w("/access/request-public"), {}),
      listEndpoints: () => req("GET", w("/model-endpoints")),
      requestEndpoint: body => req("POST", w("/model-endpoints"), body),
      removeEndpoint: id => req("DELETE", w("/model-endpoints/" + encodeURIComponent(id)), {}),
      signOut: async () => { await req("POST", "/api/founder/logout", {}); location.replace("/login"); return { ok: true }; },
      // ADR-142: the live skill loader.
      listRuntime: () => req("GET", w("/skills/runtime")),
      evolutionLog: () => req("GET", w("/skills/evolution")),
      discoverSkills: q => req("POST", w("/skills/discover-online"), { q }),
      importSkill: body => req("POST", w("/skills/import"), body),
      synthesizeSkill: body => req("POST", w("/skills/synthesize-and-mount"), body),
      evolveSkill: body => req("POST", w("/skills/evolve"), body),
      unmountRuntime: id => req("DELETE", w("/skills/runtime/" + encodeURIComponent(id)), {}),
      installRuntime: id => req("POST", w("/skills/runtime/" + encodeURIComponent(id) + "/install"), {}),
      planMission: body => req("POST", w("/missions/plan"), body),
      // ADR-137
      listWorkflows: () => req("GET", w("/workflows")),
      getWorkflow: id => req("GET", w("/workflows/" + encodeURIComponent(id))),
      createWorkflow: body => req("POST", w("/workflows"), body),
      saveWorkflow: (id, body) => req("PUT", w("/workflows/" + encodeURIComponent(id)), body),
      deleteWorkflow: id => req("DELETE", w("/workflows/" + encodeURIComponent(id)), {}),
      runWorkflow: id => req("POST", w("/workflows/" + encodeURIComponent(id) + "/run"), {}),
      addMember: body => req("POST", w("/members"), body),
      setRole: (id, role) => req("PATCH", w("/members/" + encodeURIComponent(id)), { role }),
      removeMember: id => req("DELETE", w("/members/" + encodeURIComponent(id)), {}),
      listSchedules: () => req("GET", w("/schedules")),
      setSchedule: (agentId, body) => req("PUT", w("/agents/" + encodeURIComponent(agentId) + "/schedule"), body),
      deleteSchedule: agentId => req("DELETE", w("/agents/" + encodeURIComponent(agentId) + "/schedule"), {}),
      listWebhooks: () => req("GET", w("/webhooks")),
      createWebhook: body => req("POST", w("/webhooks"), body),
      activateWebhook: id => req("POST", w("/webhooks/" + encodeURIComponent(id) + "/activate"), {}),
      pauseWebhook: id => req("POST", w("/webhooks/" + encodeURIComponent(id) + "/pause"), {}),
      testWebhook: id => req("POST", w("/webhooks/" + encodeURIComponent(id) + "/test"), {}),
      deleteWebhook: id => req("DELETE", w("/webhooks/" + encodeURIComponent(id)), {}),
      webhookSecret: id => req("GET", w("/webhooks/" + encodeURIComponent(id) + "/secret")),
      billing: () => req("GET", w("/billing")),
      saveTier: body => req("POST", w("/billing/tiers"), body),
      deleteTier: id => req("DELETE", w("/billing/tiers/" + encodeURIComponent(id)), {}),
      requestMoney: what => req("POST", w("/billing/request"), { what }),
      analytics: () => req("GET", w("/analytics")),
      // ADR-138
      searchMemory: ({ q, kind } = {}) => req("GET", w("/memory?q=" + encodeURIComponent(q || "") + "&kind=" + encodeURIComponent(kind || ""))),
      addMemory: body => req("POST", w("/memory"), body),
      removeMemory: id => req("DELETE", w("/memory/" + encodeURIComponent(id)), {}),
      selfCheck: n => req("POST", w("/memory/self-check"), { n }),
      exportMemory: async () => { const r = await fetch(w("/memory/export"), { cache: "no-store", credentials: "same-origin" }); if (!r.ok) throw new Error("The server answered " + r.status + "."); return r.text(); },
      listForged: () => req("GET", w("/forge")),
      forge: body => req("POST", w("/forge"), body),
      unmountSkill: id => req("DELETE", w("/forge/" + encodeURIComponent(id)), {}),
      installSkill: id => req("POST", w("/forge/" + encodeURIComponent(id) + "/install"), {}),
      getMission: id => req("GET", w("/missions/" + encodeURIComponent(id))),
      createMission: input => req("POST", w("/missions"), input),
      runMission: id => req("POST", w("/missions/" + encodeURIComponent(id) + "/run"), {}),
      pauseMission: id => req("POST", w("/missions/" + encodeURIComponent(id) + "/pause"), {}),
      verifyMission: id => req("GET", w("/missions/" + encodeURIComponent(id) + "/verify")),
      getCapsule: (id, seq) => req("GET", w("/missions/" + encodeURIComponent(id) + "/capsules/" + Number(seq))),
      restoreCapsule: (id, seq) => req("POST", w("/missions/" + encodeURIComponent(id) + "/capsules/" + Number(seq) + "/restore"), {}),
      skipStep: (id, idx) => req("POST", w("/missions/" + encodeURIComponent(id) + "/steps/" + Number(idx) + "/skip"), {}),
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
  function setTheme(t) { applyTheme(t); store$.set("jarvis-theme", t); syncSend({ type: "theme", theme: t }); }
  applyTheme(store$.get("jarvis-theme") || store$.get("omega-theme") || "dark");
  themeBtn.addEventListener("click", () => setTheme(theme() === "light" ? "dark" : "light"));
  function applyDir(d) {
    root.dir = d === "rtl" ? "rtl" : "ltr";
    dirBtn.setAttribute("aria-label", d === "rtl" ? "Switch to left-to-right layout" : "Switch to right-to-left layout");
  }
  function setDir(d) { applyDir(d); store$.set("jarvis-dir", d); }
  applyDir(store$.get("jarvis-dir") || "ltr");
  dirBtn.addEventListener("click", () => setDir(root.dir === "rtl" ? "ltr" : "rtl"));

  /* ── Arabic / English (ADR-137) ─────────────────────────────
     One dictionary (jarvis/app/src/i18n-ar.json, inlined by the build): exact strings and a few
     patterns for text with numbers. Every text node and the aria-label, placeholder and title
     attributes are translated as the page draws them (a MutationObserver), so nothing needs to be
     written twice. Left as written: anything under translate="no", code, pre, .mono and .num, form
     values, and the sandboxed preview, which has its own language switch. */
  const I18N = DATA.i18n || { strings: {}, patterns: [] };
  const AR = new Map(Object.entries(I18N.strings || {}));
  const AR_PATTERNS = (I18N.patterns || []).map(([re, out]) => [new RegExp(re), out]);
  const ATTRS = ["aria-label", "placeholder", "title"];
  const origText = new WeakMap(), origAttr = new WeakMap();
  // ?lang=ar|en in the address wins (and is remembered); then the stored choice; English by default.
  const qLang = new URLSearchParams(location.search).get("lang");
  if (qLang === "ar" || qLang === "en") store$.set("jarvis-lang", qLang);
  let uiLang = (qLang || store$.get("jarvis-lang")) === "ar" ? "ar" : "en";
  // Text with a number inside: "3 steps", "Phase 2". Patterns may nest a dictionary word through {{$1}}.
  function tr(text) {
    if (uiLang !== "ar" || !text) return null;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text), core = m[2];
    if (!core || !/[A-Za-z]/.test(core)) return null;
    let out = AR.get(core);
    if (out == null) for (const [re, rep] of AR_PATTERNS) { if (re.test(core)) { out = core.replace(re, rep).replace(/\{\{([^}]*)\}\}/g, (all, w) => AR.get(w) || w); break; } }
    return out == null ? null : m[1] + out + m[3];
  }
  const skipEl = el => !!(el && el.closest && el.closest("[translate=no], code, pre, .mono, .num, script, style, textarea, iframe, .stage"));
  function trNode(n) {
    if (n.nodeType === 3) {
      if (skipEl(n.parentElement)) return;
      const src = origText.has(n) && n.nodeValue === origText.get(n).out ? origText.get(n).src : n.nodeValue;
      const out = uiLang === "ar" ? tr(src) : null;
      if (out != null) { origText.set(n, { src, out }); if (n.nodeValue !== out) n.nodeValue = out; }
      else if (origText.has(n) && n.nodeValue === origText.get(n).out) { n.nodeValue = src; origText.delete(n); }
      return;
    }
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE|IFRAME)$/.test(n.tagName)) return;
    // A textarea's own text is data, but its placeholder and label are interface text.
    if (!skipEl(n) || (n.tagName === "TEXTAREA" && n.getAttribute("translate") !== "no" && !skipEl(n.parentElement))) {
      let saved = origAttr.get(n);
      for (const a of ATTRS) {
        if (!n.hasAttribute(a)) continue;
        const cur = n.getAttribute(a), rec = saved && saved[a];
        const src = rec && cur === rec.out ? rec.src : cur;
        const out = uiLang === "ar" ? tr(src) : null;
        if (out != null) { if (!saved) origAttr.set(n, saved = {}); saved[a] = { src, out }; if (cur !== out) n.setAttribute(a, out); }
        else if (rec && cur === rec.out) { n.setAttribute(a, src); delete saved[a]; }
      }
    }
    for (const c of n.childNodes) trNode(c);
  }
  const observer = new MutationObserver(list => {
    observer.disconnect();
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(trNode);
      else if (m.type === "attributes") trNode(m.target);
      else if (m.type === "characterData") trNode(m.target);
    }
    observe();
  });
  const observe = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const langBtn = $("#langBtn");
  function applyLang(l) {
    uiLang = l === "ar" ? "ar" : "en";
    root.lang = uiLang;
    if (uiLang === "ar") root.dir = "rtl"; else applyDir(store$.get("jarvis-dir") || "ltr");
    const loc = uiLang === "ar" ? "ar-u-nu-latn" : "en";
    rel = new Intl.RelativeTimeFormat(loc, { numeric: "auto" });
    fmtDate = new Intl.DateTimeFormat(loc, { dateStyle: "medium", timeStyle: "short" });
    langBtn.textContent = uiLang === "ar" ? "EN" : "ع";
    langBtn.setAttribute("lang", uiLang === "ar" ? "en" : "ar");
    langBtn.setAttribute("aria-label", uiLang === "ar" ? "Switch to English" : "التبديل إلى العربية");
    observer.disconnect(); trNode(document.body); observe();
  }
  langBtn.addEventListener("click", () => { const l = uiLang === "ar" ? "en" : "ar"; store$.set("jarvis-lang", l); applyLang(l); route(); syncSend({ type: "lang", lang: l }); });
  applyLang(uiLang);

  // ADR-149: every open window of Jarvis on this computer follows the others' language, theme and Studio site
  // (BroadcastChannel, same origin only; nothing leaves the browser). A message received is applied, never sent on.
  const syncCh = typeof BroadcastChannel === "function" ? new BroadcastChannel("jarvis_workspace_sync") : null;
  function syncSend(msg) { if (syncCh) { try { syncCh.postMessage(msg); } catch (e) { /* closed */ } } }
  let syncTimer = null;
  if (syncCh) syncCh.onmessage = e => {
    const m = e.data && typeof e.data === "object" ? e.data : {};
    if (m.type === "lang" && (m.lang === "ar" || m.lang === "en") && m.lang !== uiLang) { store$.set("jarvis-lang", m.lang); applyLang(m.lang); route(); }
    else if (m.type === "theme" && (m.theme === "light" || m.theme === "dark") && m.theme !== theme()) { applyTheme(m.theme); store$.set("jarvis-theme", m.theme); }
    else if (m.type === "studio" && typeof m.site === "string" && m.site.length < 600000) {
      store$.set("jarvis-studio-v1", m.site);
      clearTimeout(syncTimer);
      // Redraw the Studio here unless someone is typing in this window.
      syncTimer = setTimeout(() => { const typing = document.hasFocus() && document.activeElement && document.activeElement.matches("input, textarea, select, [contenteditable]"); if (location.hash.startsWith("#/studio") && !typing) route(); }, 250);
    }
  };

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
  // A closed dialog is emptied, so stale text (in the other language, or old dates) never lingers in the page.
  dlg.addEventListener("close", () => { dlg.replaceChildren(); if (opener && opener.isConnected) opener.focus(); opener = null; });
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
    ? h("p", { class: "sample-note live-note", dir: "auto" }, icon("i-check", "sm"), "Live: real data from the local server (" + (store.info && store.info.mode === "postgres" ? "PostgreSQL" : "SQLite") + "). Runs use real tools with fixed rules; missions and Studio designs can be drafted by a local model on 127.0.0.1.")
    : h("p", { class: "sample-note", dir: "auto" }, icon("i-alert", "sm"), text || "Sample workspace: placeholder data. Start jarvis/server for live data and real runs.");
  // Approval payloads are text in the sample store and objects from the server.
  const payloadText = p => typeof p.payload === "string" ? p.payload : p.payload && p.payload.path ? "+ " + p.payload.path + " (" + fmtN.format(p.payload.bytes || 0) + " bytes)\n\n" + (p.payload.preview || "") : (p.payload && p.payload.note) || "";
  const isSampleRequest = p => (p.payload && p.payload.sample) || (typeof p.payload === "string" && /^Sample request/.test(p.payload));
  function badge(status, label) {
    return h("span", { class: "badge s-" + status }, h("span", { class: "dot", "aria-hidden": "true" }), label || ({ idle: "Idle", running: "Running", succeeded: "Succeeded", failed: "Failed", queued: "Queued", cancelled: "Cancelled", paused: "Paused", ok: "Done", skipped: "Skipped", pending: "Awaiting approval", approved: "Approved", rejected: "Rejected", expired: "Expired",
      draft: "Draft", awaiting_approval: "Awaiting approval", done: "Done", blocked: "Waiting", pass: "Pass", fail: "Fail", none: "—" }[status] || status));
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
      ? h("div", { class: "card" }, h("ul", { class: "feed" }, evs.slice(0, 8).map(e => h("li", null, h("span", { class: "mono t-caption subtle", text: e.actor }), h("span", null, h("span", { text: e.kind.replace(".", " ") }), e.target ? h("span", { class: "mono t-caption subtle", translate: "no", text: " · " + e.target }) : null), timeEl(e.at)))))
      : emptyState("i-inbox", "Nothing has happened yet", "Create an agent and run it. Every action shows up here."));
    return wrap;
  };

  // Create or edit an agent: name, model, role, limits, tools (which set its permissions) and linked
  // skills. Locked permissions are shown and can never be switched on (AGENTS.md §1).
  async function agentDialog(from, existingAgent, preset) {
    let others = [];
    try { others = await store.listAgents(); } catch (e) { toast("error", e.message); return; }
    const editing = !!existingAgent;
    const a = existingAgent || (preset ? { ...preset } : null) || { name: "", model: store.mode === "live" ? "Local rules (no model)" : "Local model (loopback)", rolePrompt: "", maxSteps: 20, tools: ["notes.write"], skills: [] };
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
    // Mounted forged skills (ADR-138) can be linked at once; they are marked "forged" in the picker.
    let forged = [];
    try { forged = (await store.listForged()).map(f => f.name).concat((await store.listRuntime()).map(r => r.name)); } catch (e) { forged = []; }
    const skillNames = [...new Set([...(DATA.skills || []).map(s => s.name), ...forged])].sort();
    const skillFilter = h("input", { class: "input", type: "search", id: "f-skillq", name: "skill-q", autocomplete: "off", placeholder: "Filter skills", "aria-label": "Filter skills" });
    const skillBox = h("div", { class: "skill-pick", role: "group", "aria-label": "Linked skills" }, skillNames.map(n => h("label", { class: "check", dataset: { skill: n } }, h("input", { type: "checkbox", name: "skill", value: n, checked: (a.skills || []).includes(n) }), h("span", { class: "mono t-sm", translate: "no", text: n }), forged.includes(n) ? h("span", { class: "badge", text: "Forged" }) : null)));
    skillFilter.addEventListener("input", () => { const q = skillFilter.value.trim().toLowerCase(); $$("label", skillBox).forEach(l => { l.hidden = !!q && !l.dataset.skill.includes(q); }); });
    const lockedRows = Object.entries(LOCKED).map(([k, why]) => h("label", { class: "check locked-perm" }, h("input", { type: "checkbox", disabled: true, name: "locked-" + k, "aria-describedby": "h-locked" }), icon("i-lock", "sm"), h("span", { text: k[0].toUpperCase() + k.slice(1) + " — " + why })));
    const body = h("div", { class: "stack" },
      field("name", "Name", h("input", { class: "input", name: "agent-name", autocomplete: "off", maxLength: 80, value: a.name, placeholder: "Research assistant" }), "Shown in lists and run logs."),
      field("model", "Model", h("select", { class: "select", name: "model", autocomplete: "off" }, models.map(m => h("option", { text: m, selected: m === a.model })))),
      field("rolePrompt", "Role", h("textarea", { class: "textarea", name: "role", autocomplete: "off", value: a.rolePrompt || "", placeholder: "What this agent does, and what it must never do." })),
      field("maxSteps", "Max steps per run", h("input", { class: "input num", name: "max-steps", inputmode: "numeric", autocomplete: "off", value: String(a.maxSteps) })),
      h("fieldset", null, h("legend", { class: "legend", text: "Execution" }),
        h("label", { class: "check" }, h("input", { type: "radio", name: "mode", value: "single", checked: (a.mode || "single") === "single" }), h("span", { text: "Single run" }), h("span", { class: "subtle t-caption", text: "— one pass through the tools" })),
        h("label", { class: "check" }, h("input", { type: "radio", name: "mode", value: "long_horizon", checked: a.mode === "long_horizon" }), h("span", { text: "Long-horizon mission" }), h("span", { class: "subtle t-caption", text: "— phases, evidence gates, capsules; locked steps wait" }))),
      field("capsuleEvery", "Save a capsule every … phases", h("input", { class: "input num", name: "capsule-every", inputmode: "numeric", autocomplete: "off", value: String(a.capsuleEvery || 1) }), "Long-horizon mode only. 1 to 10."),
      h("fieldset", null, h("legend", { class: "legend", text: "Tools and permissions" }), toolBoxes),
      h("fieldset", null, h("legend", { class: "legend", text: "Linked skills" }), h("span", { class: "hint", text: "Skills this agent follows. They come from .claude/skills in this repo." }), skillFilter, skillBox),
      h("fieldset", null, h("legend", { class: "legend" }, "Locked ", h("bdi", { lang: "ar", dir: "rtl", text: "«قيد الموافقة»" })), lockedRows,
        h("p", { class: "hint", id: "h-locked", text: "No agent can be given these. They are Director 00's decisions outside Jarvis (AGENTS.md §1)." })));
    const save = h("button", { class: "btn btn-primary", type: "button", text: editing ? "Save changes" : "Create agent" });
    save.addEventListener("click", () => {
      const input = { name: f.name.value, model: f.model.value, rolePrompt: f.rolePrompt.value, maxSteps: f.maxSteps.value.trim() === "" ? NaN : Number(f.maxSteps.value),
        mode: ($("input[name=mode]:checked", body) || { value: "single" }).value, capsuleEvery: f.capsuleEvery.value.trim() === "" ? NaN : Number(f.capsuleEvery.value),
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
      pageHead("Agents", "Each agent has a role, a model and the tools it may use.", h("a", { class: "btn btn-secondary", href: "#/agents/templates", text: "Templates" }), h("button", { class: "btn btn-primary", type: "button", onclick: e => agentDialog(e.currentTarget) }, icon("i-plus", "sm"), "New agent")),
      sampleNote(),
      h("div", { class: "filters" }, h("div", { class: "field" }, h("label", { htmlFor: "f-q", text: "Search" }), q), h("div", { class: "field narrow" }, h("label", { htmlFor: "f-st", text: "Status" }), st)),
      box);
  };

  // Live mode asks for the run's input when a tool needs one (a path under docs/, or a public address).
  function runDialog(a, from) {
    const needsPath = a.tools.includes("files.read"), needsUrl = a.tools.includes("web.read");
    const go = input => store.startRun(a.id, input).then(r => {
      if (dlg.open) closeDialog();
      toast("info", r.mission ? "Mission started: phases, gates and capsules." : store.mode === "live" ? "Run started." : "Run started (simulated).");
      location.hash = r.mission ? "#/missions/" + r.mission : "#/runs/" + r.id;
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
      const lh = a.mode === "long_horizon";
      const runBtn = h("button", { class: "btn btn-primary", type: "button", disabled: a.active }, icon("i-run", "sm"), a.active ? "Running…" : lh ? "Start mission" : "Run once");
      runBtn.addEventListener("click", e => runDialog(a, e.currentTarget));
      const editBtn = h("button", { class: "btn btn-secondary", type: "button", text: "Edit", onclick: e => agentDialog(e.currentTarget, a) });
      const perms = a.permissions || { writeNotes: a.tools.includes("notes.write"), readWeb: a.tools.includes("web.read") };
      const tabs = [["Config", () => h("dl", { class: "stack t-sm" },
        h("div", null, h("dt", { class: "muted", text: "Role" }), h("dd", { dir: "auto", text: a.rolePrompt || "No role written yet." })),
        h("div", null, h("dt", { class: "muted", text: "Model" }), h("dd", { text: a.model + (a.model.includes("Hosted") ? " — the key lives in the Ops Room vault, never in Jarvis." : a.model.includes("no model") ? " — planning and summaries follow fixed rules." : "") })),
        h("div", null, h("dt", { class: "muted", text: "Max steps per run" }), h("dd", { class: "num", text: String(a.maxSteps) })),
        h("div", null, h("dt", { class: "muted", text: "Execution" }), h("dd", { text: a.mode === "long_horizon" ? "Long-horizon mission: phases, gates, a capsule every " + plural(a.capsuleEvery || 1, "phase") + ", locked steps wait while the rest carries on." : "Single run: one pass through the tools." })),
        h("div", null, h("dt", { class: "muted", text: "Permissions" }), h("dd", { class: "row" },
          badge(perms.writeNotes ? "approved" : "idle", perms.writeNotes ? "Writes notes (asks first)" : "No note writing"),
          badge(perms.readWeb ? "approved" : "idle", perms.readWeb ? "Reads public pages" : "No web reading"),
          h("span", { class: "badge s-pending" }, icon("i-lock", "sm"), "Money, publish, permissions, install, outbound: locked"))),
        h("div", null, h("dt", { class: "muted", text: "Linked skills" }), h("dd", null, (a.skills || []).length ? h("ul", { class: "row" }, a.skills.map(s => h("li", { class: "badge mono", translate: "no", text: s }))) : h("span", { class: "subtle", text: "None" }))))],
      ["Schedule", () => schedulePanel(a)],
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

  // The chosen tab survives a redraw of the same page (a live update must not jump back to the first tab).
  const TAB_MEMO = {};
  function tabsWidget(key, tabs) {
    const list = h("div", { class: "tablist", role: "tablist", "aria-label": "Sections" });
    const panels = [];
    const start = TAB_MEMO[key] != null && TAB_MEMO[key].route === location.hash && TAB_MEMO[key].i < tabs.length ? TAB_MEMO[key].i : 0;
    const btns = tabs.map(([label, make], i) => {
      const b = h("button", { class: "tab", role: "tab", type: "button", id: "tab-" + key + i, "aria-controls": "panel-" + key + i, "aria-selected": String(i === start), tabIndex: i === start ? 0 : -1, text: label });
      const p = h("div", { class: "tabpanel", role: "tabpanel", id: "panel-" + key + i, "aria-labelledby": "tab-" + key + i, tabindex: "0", hidden: i !== start }, make());
      panels.push(p); list.appendChild(b); return b;
    });
    const select = b => { btns.forEach((x, i) => { const on = x === b; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; panels[i].hidden = !on; if (on) TAB_MEMO[key] = { i, route: location.hash }; }); b.focus(); };
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
    const picked = [];
    const cmp = h("button", { class: "btn btn-secondary", type: "button", disabled: true, text: "Compare 2 runs" });
    cmp.addEventListener("click", () => { location.hash = "#/runs/compare/" + picked.join("/"); });
    loadInto(box, () => store.listRuns(), runs => runs.length
      ? h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Runs" }, h("table", null,
        h("thead", null, h("tr", null, ["", "Run", "Agent", "Status", "Started", "Duration", "Cost", "Steps"].map((c, i) => h("th", { scope: "col", class: i >= 5 ? "end" : null, text: c, "aria-label": i === 0 ? "Pick to compare" : null })))),
        h("tbody", null, runs.map(r => {
          const cb = h("input", { type: "checkbox", name: "compare", value: r.id, "aria-label": "Compare run " + r.id });
          cb.addEventListener("change", () => { const i = picked.indexOf(r.id); if (cb.checked && i < 0) picked.push(r.id); if (!cb.checked && i >= 0) picked.splice(i, 1); while (picked.length > 2) { const old = picked.shift(); const o = box.querySelector("input[value='" + CSS.escape(old) + "']"); if (o) o.checked = false; } cmp.disabled = picked.length !== 2; });
          return h("tr", null, h("td", null, cb), h("td", null, h("a", { class: "mono", href: "#/runs/" + r.id, text: r.id })), h("td", { dir: "auto" }, h("span", { class: "trunc", text: r.agentName })), h("td", null, badge(r.status), r.trigger === "schedule" ? h("span", { class: "badge", text: "scheduled" }) : null),
            h("td", null, timeEl(r.createdAt)), h("td", { class: "end num", text: dur(r.finishedAt && r.startedAt ? r.finishedAt - r.startedAt : null) }), h("td", { class: "end num", title: "Zero-token: fixed rules and local tools", text: "0" }), h("td", { class: "end num", text: String(r.steps.length) }));
        }))))
      : emptyState("i-run", "No runs yet", "Open an agent and press Run once.", h("a", { class: "btn btn-primary", href: "#/agents", text: "Go to agents" })));
    return h("div", { class: "stack" }, pageHead("Runs", "Every run, newest first. Cost is 0: runs use local tools and fixed rules.", cmp), sampleNote(), box);
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
    // min-width 0: the event table scrolls inside its box instead of widening the page on a phone (ADR-147).
    const box = h("div", { class: "min0" });
    const q = h("input", { class: "input", id: "f-lq", type: "search", name: "q", autocomplete: "off", placeholder: "Actor, action or target" });
    const kind = h("select", { class: "select", id: "f-lk", name: "kind", autocomplete: "off" }, h("option", { value: "", text: "Any kind" }), ["run", "approval", "agent", "workspace"].map(k => h("option", { value: k, text: k })));
    const load = () => loadInto(box, () => store.listEvents(), evs => {
      const qq = q.value.trim().toLowerCase();
      const list = evs.filter(e => (!kind.value || e.kind.startsWith(kind.value + ".")) && (!qq || (e.actor + " " + e.kind + " " + (e.target || "")).toLowerCase().includes(qq)));
      if (!list.length) return emptyState("i-logs", evs.length ? "No event matches" : "No events yet", evs.length ? "Try another word or kind." : "Every action is written here and never edited.");
      return h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Event log" }, h("table", null,
        h("thead", null, h("tr", null, ["When", "Actor", "Action", "Target"].map(c => h("th", { scope: "col", text: c })))),
        h("tbody", null, list.map(e => h("tr", null, h("td", null, timeEl(e.at)), h("td", { class: "mono t-caption", text: e.actor }), h("td", { class: "mono t-caption", translate: "no", text: e.kind }), h("td", { class: "mono t-caption", translate: "no", text: e.target || "—" }))))));
    });
    let t;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 150); });
    kind.addEventListener("change", load);
    load();
    return h("div", { class: "stack" }, pageHead("Logs", "The audit trail. Append-only: nothing here is edited or deleted."), sampleNote(), merklePanel(),
      h("div", { class: "filters" }, h("div", { class: "field" }, h("label", { htmlFor: "f-lq", text: "Search" }), q), h("div", { class: "field narrow" }, h("label", { htmlFor: "f-lk", text: "Kind" }), kind)), box);
  };

  // ADR-147: the Merkle audit tree. The browser recomputes the leaf from the entry's fields and checks the
  // inclusion proof itself (RFC 9162 section 2.1.3.2), so it does not have to trust the server's answer.
  function merklePanel() {
    const headBox = h("div", { class: "row" }), list = h("ol", { class: "snaps", "aria-label": "Audited entries, newest first" }), proofBox = h("div", { class: "stack", "aria-live": "polite" });
    const verifyBtn = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Verify the whole log" });
    const short = x => x.slice(0, 12) + "…";
    const showHead = hd => headBox.replaceChildren(h("span", { class: "badge" }, h("span", { class: "num", text: String(hd.size) }), " entries"), h("code", { class: "t-caption", translate: "no", text: "root " + short(hd.root) }));
    const prove = seq => store.auditProof(seq).then(p => {
      const leafOk = LlmPlan.leafHash(p.entry) === p.leafHash, pathOk = LlmPlan.verifyInclusion(p.leafHash, p.seq, p.size, p.path, p.root);
      proofBox.replaceChildren(
        h("div", { class: "row" }, leafOk && pathOk ? badge("ok", "Inclusion proof verified in this browser") : badge("failed", "The proof does not check"), h("span", { class: "t-caption muted", text: "entry " + p.seq + " of " + p.size + " · " + p.path.length + " hashes" })),
        h("pre", { class: "diff", translate: "no", text: p.entry + "\nleaf  " + p.leafHash + "\n" + p.path.map((x, i) => "path" + i + " " + x).join("\n") + "\nroot  " + p.root }));
    }, e => toast("error", e.message));
    const load = () => Promise.all([store.auditHead(), store.auditLeaves(10)]).then(([hd, leaves]) => {
      showHead(hd);
      list.replaceChildren(...leaves.map(l => h("li", { class: "row between" }, h("span", null, h("span", { class: "num", text: "#" + l.seq }), " ", h("code", { translate: "no", text: l.kind }), " ", h("span", { class: "t-caption subtle", translate: "no", text: l.target || "" })),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Prove", "aria-label": "Prove entry " + l.seq, onclick: () => prove(l.seq) }))));
      if (!leaves.length) list.replaceChildren(h("li", { class: "muted t-sm", text: "No audited entries yet. Approvals, agent changes, gate results and exports are added here." }));
    }, () => {});
    verifyBtn.addEventListener("click", () => store.auditVerify().then(v => toast(v.ok ? "ok" : "error", v.ok ? "The log verifies: " + v.size + " entries, every leaf and tree head recomputed." : "The log is broken at entry " + v.brokenAt + ": " + v.reason), e => toast("error", e.message)));
    load();
    return h("section", { class: "panel", "aria-labelledby": "h-merkle" }, h("h2", { id: "h-merkle", text: "Merkle audit tree" }),
      h("p", { class: "t-sm", text: "Sensitive events are leaves of a SHA-256 Merkle tree (RFC 6962). A proof shows an entry is in the log; any edit or removal changes the root." }),
      h("div", { class: "row between" }, headBox, verifyBtn), list, proofBox);
  }

  function seg(label, options, current, onPick) {
    const g = h("div", { class: "seg", role: "group", "aria-label": label });
    options.forEach(([value, text, extra]) => {
      const b = h("button", { type: "button", "aria-pressed": String(value === current), text, lang: extra && extra.lang, dir: extra && extra.dir });
      b.addEventListener("click", () => { $$("button", g).forEach(x => x.setAttribute("aria-pressed", String(x === b))); onPick(value); });
      g.appendChild(b);
    });
    return g;
  }

  // Local model panel (ADR-136, ADR-140): engine, the open-weight families found, and a streamed answer.
  const ENGINE_LABEL = { ollama: "Ollama (native API)", openai: "OpenAI-compatible (vLLM, llama.cpp, LM Studio or Ollama /v1)" };
  function llmAsk(st) {
    const q = h("textarea", { class: "textarea", id: "f-ask", name: "ask", rows: 3, autocomplete: "off", maxLength: 8000, dir: "auto", placeholder: "Explain breadth-first search in two sentences." });
    const out = h("p", { class: "stream-out t-sm", dir: "auto", translate: "no", "aria-live": "polite" });
    const think = h("p", { class: "stream-think t-caption", dir: "auto", translate: "no" });
    const thinkBox = h("details", { class: "thinking", hidden: true }, h("summary", { text: "Reasoning (model's own words, untrusted)" }), think);
    const meta = h("p", { class: "subtle t-caption" });
    const go = h("button", { class: "btn btn-primary", type: "button" }, "Ask");
    const stopBtn = h("button", { class: "btn btn-secondary", type: "button", hidden: true, text: "Stop" });
    let ctl = null;
    stopBtn.addEventListener("click", () => { if (ctl) ctl.abort(); });
    go.addEventListener("click", async () => {
      if (!q.value.trim()) { toast("warn", "Write what you want first."); q.focus(); return; }
      out.textContent = ""; think.textContent = ""; thinkBox.hidden = true; meta.textContent = "Waiting for the first token…";
      go.disabled = true; stopBtn.hidden = false; ctl = new AbortController();
      const t0 = performance.now();
      try {
        const d = await store.llmStream({ prompt: q.value }, { signal: ctl.signal, token: t => { if (!out.textContent) meta.textContent = "Streaming…"; out.textContent += t; }, thinking: t => { thinkBox.hidden = false; think.textContent += t; } });
        meta.textContent = (d.model ? d.model + " · " : "") + (d.label || "") + " · " + fmtN.format(Math.round(performance.now() - t0)) + " ms · cost 0" + (d.warning ? " · " + d.warning : "");
      } catch (e) {
        meta.textContent = e.name === "AbortError" ? "Stopped." : e.message;
      } finally { go.disabled = false; stopBtn.hidden = true; ctl = null; }
    });
    return h("div", { class: "stack ask" },
      h("div", { class: "field" }, h("label", { htmlFor: "f-ask", text: "Ask the local model" }), q),
      h("div", { class: "row" }, go, stopBtn, h("span", { class: "subtle t-caption", text: st.online ? "Streams from " + (st.chatModel || "the local model") + ". The answer is untrusted text and changes nothing." : "Needs a local model on 127.0.0.1." })),
      thinkBox, out, meta);
  }
  // ADR-143: the full open-weight catalog (licence, job, notes), marked where a model is served here.
  function catalogTable(st) {
    const here = new Set((st.profiles || []).map(p => p.family));
    return h("details", { class: "catalog" }, h("summary", { text: "Open-weight model catalog (" + LlmPlan.MODEL_PROFILES.length + " families)" }),
      h("p", { class: "subtle t-caption", text: "Licences as the model cards state them; check the card of the exact file you pull. Every one runs on 127.0.0.1 only." }),
      h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Open-weight model catalog" }, h("table", null,
        h("thead", null, h("tr", null, h("th", { scope: "col", text: "Family" }), h("th", { scope: "col", text: "Used for" }), h("th", { scope: "col", text: "Licence" }), h("th", { scope: "col", text: "Here" }))),
        h("tbody", null, LlmPlan.MODEL_PROFILES.map(p => h("tr", null,
          h("td", null, h("b", { translate: "no", text: p.family }), h("br"), h("span", { class: "subtle t-caption", translate: "no", text: p.maker + " · " + p.origin })),
          h("td", { text: LlmPlan.ROLE_LABEL[p.role] || p.role }),
          h("td", { class: "t-caption wrap", translate: "no", text: p.licence }),
          h("td", null, here.has(p.family) ? badge("ok", "Served") : h("span", { class: "subtle t-caption", text: "—" }))))))));
  }
  function llmPanel() {
    const box = h("div", { class: "stack" });
    loadInto(box, () => store.llmStatus(), st => h("div", { class: "stack" },
      h("div", { class: "row" }, badge(st.online ? "ok" : "idle", st.online ? (st.api === "openai" ? "OpenAI-compatible local · 0-token" : "Ollama local · 0-token") : "Fixed rules (no model)"), h("code", { class: "t-caption", translate: "no", text: st.host || "http://127.0.0.1:11434" })),
      st.online ? h("dl", { class: "kv" },
        h("dt", { text: "Engine" }), h("dd", { text: ENGINE_LABEL[st.api] || ENGINE_LABEL.ollama }),
        h("dt", { text: "Plans" }), h("dd", null, h("code", { translate: "no", text: st.planModel || "—" })),
        h("dt", { text: "Designs" }), h("dd", null, h("code", { translate: "no", text: st.designModel || "—" })),
        h("dt", { text: "Answers" }), h("dd", null, h("code", { translate: "no", text: st.chatModel || "—" })),
        h("dt", { text: "Local models" }), h("dd", { class: "mono t-caption", translate: "no", text: st.models.join(", ") || "none" }))
        : h("p", { class: "t-sm muted", text: st.sample ? "Sample mode has no model. Start jarvis/server and Ollama on this computer." : "No local model answers on 127.0.0.1. Missions and the Studio use the fixed rules until one does." }),
      st.profiles && st.profiles.length ? h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Open-weight model families found" }, h("table", null,
        h("thead", null, h("tr", null, h("th", { scope: "col", text: "Model" }), h("th", { scope: "col", text: "Family" }), h("th", { scope: "col", text: "Licence" }), h("th", { scope: "col", text: "Used for" }))),
        h("tbody", null, st.profiles.map(p => h("tr", null, h("td", { class: "mono t-caption", translate: "no", text: p.model }), h("td", { translate: "no", text: p.maker + " " + p.family }), h("td", { class: "t-caption", translate: "no", text: p.licence }), h("td", { text: { plan: "Plans", design: "Designs and code", chat: "Answers" }[p.role] })))))) : null,
      catalogTable(st),
      llmAsk(st),
      h("p", { class: "t-caption muted", text: "Ollama: build the two Jarvis models once (jarvis/server/models): ollama create jarvis-planner -f Jarvis-Planner.Modelfile, and the same for jarvis-designer. vLLM or llama.cpp: start the server on 127.0.0.1 and set JARVIS_OPENAI_COMPAT_URL=http://127.0.0.1:8000/v1. Hosted endpoints and models ending in :cloud are refused." })));
    return h("section", { class: "panel", "aria-labelledby": "h-llm" }, h("h2", { id: "h-llm", text: "Local model" }), box,
      h("p", { class: "subtle t-caption", text: "Cost to you: 0 tokens. Everything runs on this computer; nothing leaves 127.0.0.1." }));
  }

  /* ── Access (ADR-141): founder-only, and opening to the public is a locked card ─────────── */
  const lockLine = note => h("p", { class: "lock-line" }, icon("i-lock", "sm"), h("bdi", { lang: "ar", dir: "rtl", text: "بانتظار الموافقة" }), h("span", { class: "subtle t-caption", text: "· " + note }));
  function showLocked(from, category, action) {
    openDialog("This waits for Director 00", lockedCard({ id: "lk-" + Date.now(), category, action, createdAt: Date.now() }),
      [h("a", { class: "btn btn-secondary", href: "#/approvals", text: "Open approvals", onclick: closeDialog }), h("button", { class: "btn btn-primary", type: "button", text: "Close", onclick: closeDialog })], from);
    updateCount();
  }
  function accessPanel() {
    const box = h("div", { class: "stack" });
    loadInto(box, () => store.accessStatus(), st => {
      const ask = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-lock", "sm"), "Open to the public…");
      ask.addEventListener("click", e => { const from = e.currentTarget; store.requestPublic().then(() => showLocked(from, "publish", "Open Jarvis to the public (founder_private → public_subscribers)"), err => toast("error", err.message)); });
      const signOut = st.gate ? h("button", { class: "btn btn-ghost", type: "button", text: "Sign out" }) : null;
      if (signOut) signOut.addEventListener("click", () => store.signOut().catch(err => toast("error", err.message)));
      return h("div", { class: "stack" },
        h("div", { class: "row" }, badge("locked", "Founder only"), h("code", { class: "t-caption", translate: "no", text: st.mode })),
        h("dl", { class: "kv" },
          h("dt", { text: "Sign-in" }), h("dd", { text: st.sample ? "No server: this page runs on this computer only." : st.gate ? "On: every page and API call needs the founder key." : "Off: answers on 127.0.0.1 only. Set JARVIS_FOUNDER_KEY to require the key." }),
          h("dt", { text: "Public address" }), h("dd", null, st.publicHost ? h("code", { translate: "no", text: "https://" + st.publicHost }) : h("span", { class: "muted", text: "None (127.0.0.1 only)" }))),
        lockLine("Opening Jarvis to the public is a publish action (AGENTS.md §1). The database keeps it founder only."),
        h("div", { class: "row" }, ask, signOut));
    });
    return h("section", { class: "panel", "aria-labelledby": "h-access" }, h("h2", { id: "h-access", text: "Access" }), box);
  }
  function endpointsPanel() {
    const list = h("div", { class: "stack" });
    const name = h("input", { class: "input", id: "f-epname", name: "endpoint-name", autocomplete: "off", maxLength: 60, placeholder: "DeepSeek API" });
    const url = h("input", { class: "input mono", id: "f-epurl", name: "endpoint-url", type: "url", autocomplete: "off", placeholder: "https://api.example.com/v1", translate: "no" });
    const reload = () => loadInto(list, () => store.listEndpoints(), eps => eps.length ? h("ul", { class: "feed" }, eps.map(e => h("li", { class: "forged" },
      h("div", { class: "stack" }, h("b", { dir: "auto", text: e.name }), h("code", { class: "t-caption", translate: "no", text: e.url }), lockLine("Draft. Workspace text would leave this computer.")),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", onclick: () => store.removeEndpoint(e.id).then(reload, err => toast("error", err.message)) })))) : h("p", { class: "muted t-sm", text: "No hosted endpoint requested. Local models on 127.0.0.1 need none." }));
    const add = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-lock", "sm"), "Ask to add…");
    add.addEventListener("click", e => { const from = e.currentTarget; store.requestEndpoint({ name: name.value, url: url.value }).then(r => { name.value = ""; url.value = ""; reload(); showLocked(from, "outbound", "Send workspace text to the hosted model endpoint " + r.endpoint.host); }, err => toast("error", err.message)); });
    reload();
    return h("section", { class: "panel", "aria-labelledby": "h-ep" }, h("h2", { id: "h-ep", text: "Hosted model endpoints" }),
      h("p", { class: "t-sm", text: "Jarvis talks to models on 127.0.0.1 only. A hosted endpoint would send prompts, memory examples and plans outside this computer and needs a key, so asking for one makes a locked card for Director 00. Nothing is sent." }),
      h("div", { class: "grid-2" }, h("div", { class: "field" }, h("label", { htmlFor: "f-epname", text: "Name" }), name), h("div", { class: "field" }, h("label", { htmlFor: "f-epurl", text: "Address" }), url)),
      h("div", { class: "row" }, add), list);
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
        llmPanel(),
        accessPanel(),
        endpointsPanel(),
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
    loadInto(box, () => store.workspace(), render);
    return h("div", { class: "stack" }, pageHead("Settings", "Workspace, members, keys and how Jarvis looks."), box,
      h("section", { class: "block", "aria-labelledby": "h-members" }, h("h2", { id: "h-members", text: "Members" }),
        h("p", { class: "muted t-sm", text: "Add people and give them a role. Nobody is emailed: invitations are outbound messages, which stay locked. Repository permissions are a separate, locked decision." }), membersPanel()),
      h("section", { class: "block", "aria-labelledby": "h-plans" }, h("h2", { id: "h-plans", text: "Plans and tokens" }), plansPanel()));
  };

  /* ── Mission Control (ADR-135) ──────────────────────────────── */
  const TEMPLATE_LIST = () => Object.entries(DATA.templates || {});
  function healthMeter(hl) {
    const bar = h("span", { class: "bar " + (hl.score >= 70 ? "s-ok" : hl.score >= 40 ? "s-warn" : "s-failed") });
    bar.style.inlineSize = hl.score + "%";
    return h("div", { class: "health" },
      h("div", { class: "row" }, h("b", { class: "num", text: String(hl.score) }), h("span", { class: "muted t-sm", text: "/ 100 · " + hl.label })),
      h("div", { class: "meter", role: "img", "aria-label": "Context health " + hl.score + " of 100, " + hl.label }, bar));
  }
  function missionDialog(from) {
    const tpl = h("select", { class: "select", id: "f-mtpl", name: "template", autocomplete: "off" }, TEMPLATE_LIST().map(([k, t]) => h("option", { value: k, text: t.title })));
    const title = h("input", { class: "input", id: "f-mtitle", name: "mission-title", autocomplete: "off", maxLength: 120, placeholder: "Uses the template's title when empty" });
    const every = h("input", { class: "input num", id: "f-mevery", name: "capsule-every", inputmode: "numeric", autocomplete: "off", value: "1" });
    const info = h("p", { class: "hint", id: "h-mtpl" });
    const show = () => { const t = DATA.templates[tpl.value]; info.textContent = t ? t.steps.length + " steps in " + new Set(t.steps.map(s => s.phase)).size + " phases · " + t.goal : ""; };
    tpl.setAttribute("aria-describedby", "h-mtpl"); tpl.addEventListener("change", show); show();
    const go = h("button", { class: "btn btn-primary", type: "button", text: "Create mission" });
    go.addEventListener("click", () => {
      go.disabled = true;
      store.createMission({ template: tpl.value, title: title.value.trim() || undefined, capsuleEvery: every.value.trim() === "" ? NaN : Number(every.value) })
        .then(m => { closeDialog(); toast("ok", "Mission created. Press Run when ready."); location.hash = "#/missions/" + m.id; }, e => { toast("error", e.message); go.disabled = false; });
    });
    openDialog("New mission", h("div", { class: "stack" },
      h("div", { class: "field" }, h("label", { htmlFor: "f-mtpl", text: "Template" }), tpl, info),
      h("div", { class: "field" }, h("label", { htmlFor: "f-mtitle", text: "Title" }), title),
      h("div", { class: "field" }, h("label", { htmlFor: "f-mevery", text: "Save a capsule every … phases" }), every, h("span", { class: "hint", text: "1 to 10. A capsule also saves when the mission waits, pauses, finishes or is restored." }))),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Cancel", onclick: closeDialog }), go], from);
  }

  // ADR-145: the Ctrl+K macro composer. The fixed rules turn the text into steps and the prover checks the
  // state machine as you type; sensitive steps stop at a locked card, and the server proves it again.
  function macroDialog(from) {
    const text = h("textarea", { class: "textarea", id: "f-macro", name: "macro", autocomplete: "off", rows: 4, maxLength: 2000, dir: "auto", placeholder: "Read the latest commits, then run the tests, then publish the site", "aria-describedby": "h-macro" });
    const proofBox = h("div", { class: "stack macro-proof", "aria-live": "polite" });
    const runBtn = h("button", { class: "btn btn-primary", type: "button", disabled: true }, icon("i-run", "sm"), "Run macro");
    let timer = null;
    const check = () => {
      const steps = text.value.trim() ? LlmPlan.fallbackPlan(text.value) : [];
      if (!steps.length) { proofBox.replaceChildren(h("p", { class: "muted t-sm", text: "Write the steps to see the proof." })); runBtn.disabled = true; return; }
      const p = LlmPlan.provePlan(steps);
      runBtn.disabled = !p.verified;
      proofBox.replaceChildren(...[
        h("div", { class: "row" }, p.verified ? badge("ok", "Formal Proof: Verified") : badge("failed", "Formal Proof: Failed"),
          h("span", { class: "t-caption muted", text: p.states + " states · " + p.transitions + " transitions · " + p.deadlocks.length + " deadlocks · " + (p.effects - p.violations.length) + "/" + p.effects + " effects behind a lock" })),
        h("ol", { class: "plist final" }, steps.map(x => h("li", { class: x.locked ? "locked" : "" }, h("span", { dir: "auto", text: x.title }),
          x.locked ? h("p", { class: "lock-line" }, icon("i-lock", "sm"), h("bdi", { lang: "ar", dir: "rtl", text: "قيد الموافقة" }), h("span", { class: "subtle t-caption", text: "· the macro stops here until Director 00 approves (" + x.category + ")" }))
            : h("span", { class: "t-caption subtle", text: x.kind === "gate" ? "gate" : x.kind === "approval" ? "approval" : "read tool" })))),
        p.violations.length ? h("ul", { class: "plist" }, p.violations.map(v => h("li", { class: "err", translate: "no", text: v.effect + ": " + v.path.join(" → ") }))) : null].filter(Boolean));
    };
    text.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(check, 150); });
    runBtn.addEventListener("click", () => {
      runBtn.disabled = true; runBtn.setAttribute("aria-busy", "true");
      store.macroMission({ text: text.value }).then(m => { closeDialog(); toast("ok", "Macro proved and started as a mission. Locked steps wait for Director 00."); location.hash = "#/missions/" + m.id; },
        e => { toast("error", e.message); runBtn.disabled = false; }).finally(() => runBtn.removeAttribute("aria-busy"));
    });
    check();
    openDialog("Compose a macro", h("div", { class: "stack" },
      h("div", { class: "field" }, h("label", { htmlFor: "f-macro", text: "Steps" }), text,
        h("span", { class: "hint", id: "h-macro", text: "One per line, or joined with “then”. No model: the fixed rules make the steps, and a breadth-first proof checks for deadlocks and for any money, publishing, permission, install or outbound step that could run without a locked approval." })),
      proofBox), [h("button", { class: "btn btn-secondary", type: "button", text: "Cancel", onclick: closeDialog }), runBtn], from);
  }

  pages.missions = () => {
    const box = h("div");
    const render = list => list.length ? h("ul", { class: "mlist", "aria-label": "Missions" }, list.map(m => {
      const bar = h("span", { class: "bar s-ok" });
      bar.style.inlineSize = (m.steps ? Math.round(m.done / m.steps * 100) : 0) + "%";
      return h("li", null, h("a", { class: "mcard", href: "#/missions/" + m.id },
        h("div", { class: "row between" }, h("b", { dir: "auto", class: "trunc", text: m.title }), badge(m.status)),
        h("span", { class: "mono t-caption subtle", translate: "no", text: m.template }),
        h("div", { class: "meter", role: "img", "aria-label": m.done + " of " + m.steps + " steps done" }, bar),
        h("div", { class: "row t-caption muted" },
          h("span", { class: "num", text: m.done + "/" + m.steps + " steps" }), h("span", { text: "·" }), h("span", { text: plural(m.phases, "phase") }), h("span", { text: "·" }), h("span", { text: plural(m.capsules, "capsule") }),
          m.blocked ? h("span", { class: "badge s-pending" }, icon("i-lock", "sm"), m.blocked + " waiting") : null,
          m.failed ? badge("failed", m.failed + " failed") : null),
        h("span", { class: "t-caption subtle" }, "Context health " + m.health.score + " · " + m.health.label + " ", h("span", { class: "tag-inf", text: "[INFERENCE]" }))));
    })) : emptyState("i-layers", "No missions yet", "A mission is a long task in phases, with gates, capsules and approvals.", h("button", { class: "btn btn-primary", type: "button", text: "New mission", onclick: e => missionDialog(e.currentTarget) }));
    loadInto(box, () => store.listMissions(), render);
    const goal = h("textarea", { class: "textarea", id: "f-goal", name: "goal", autocomplete: "off", rows: 3, maxLength: 2000, dir: "auto", placeholder: "Read the latest commits, run the tests and the security gate, then save a release note", "aria-describedby": "h-goal" });
    const planBtn = h("button", { class: "btn btn-primary", type: "button" }, icon("i-run", "sm"), "Plan mission");
    planBtn.addEventListener("click", () => {
      if (!goal.value.trim()) { toast("warn", "Write the goal first."); goal.focus(); return; }
      planBtn.disabled = true; planBtn.setAttribute("aria-busy", "true"); goal.setAttribute("aria-busy", "true");
      store.planMission({ goal: goal.value }).then(m => { toast("ok", m.planner && m.planner.engine === "ollama-local-loopback" ? "Planned by " + m.planner.model + ". Locks were decided by rule." : "Planned by the fixed rules. Locks were decided by rule."); location.hash = "#/missions/" + m.id; },
        e => toast("error", e.message)).finally(() => { planBtn.disabled = false; planBtn.removeAttribute("aria-busy"); goal.removeAttribute("aria-busy"); });
    });
    // ADR-144: the council debates the goal first (architect, red team and UX critic, synthesizer). The trace
    // shows each role; the rules have the last word, so a locked step stays locked whatever the roles say.
    const councilBox = h("div", { class: "stack", "aria-live": "polite" });
    const councilBtn = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-brain", "sm"), "Ask the council");
    const askCouncil = createMission => {
      if (!goal.value.trim()) { toast("warn", "Write the goal first."); goal.focus(); return Promise.resolve(); }
      councilBtn.disabled = true; councilBtn.setAttribute("aria-busy", "true");
      if (!createMission) councilBox.replaceChildren(h("p", { class: "muted", text: "The council is debating…" }));
      return store.council({ mode: "plan", prompt: goal.value, createMission }).then(out => {
        if (createMission && out.mission) { toast("ok", "Mission made from the council's plan. Locked steps wait for Director 00."); location.hash = "#/missions/" + out.mission.id; return; }
        councilBox.replaceChildren(councilTrace(out, () => askCouncil(true)));
      }, e => { councilBox.replaceChildren(h("p", { class: "err" }, icon("i-alert", "sm"), e.message)); toast("error", e.message); })
        .finally(() => { councilBtn.disabled = false; councilBtn.removeAttribute("aria-busy"); });
    };
    councilBtn.addEventListener("click", () => askCouncil(false));
    const planPanel = h("section", { class: "panel", "aria-labelledby": "h-plan" }, h("h2", { id: "h-plan", text: "Plan with the local model" }),
      h("div", { class: "field" }, h("label", { htmlFor: "f-goal", text: "Goal" }), goal,
        h("span", { class: "hint", id: "h-goal", text: "The local model on 127.0.0.1 drafts the steps when Ollama runs; otherwise the fixed rules do. Either way Jarvis decides the locks: money, publishing, permissions, installs and outbound messages always wait for Director 00." })),
      h("div", { class: "row" }, planBtn, councilBtn), councilBox);
    // Changes made from a dialog land after it closes, so the close event refreshes too.
    const refresh = () => { if (!box.isConnected) { off(); dlg.removeEventListener("close", refresh); return; } if (dlg.open) return; store.listMissions().then(l => box.replaceChildren(render(l)), () => {}); };
    const off = store.subscribe(refresh);
    dlg.addEventListener("close", refresh);
    return h("div", { class: "stack" },
      pageHead("Missions", "Long tasks in ordered phases. Gates need evidence, capsules keep a verified trail, and locked steps wait while the rest carries on.",
        h("button", { class: "btn btn-primary", type: "button", onclick: e => missionDialog(e.currentTarget) }, icon("i-plus", "sm"), "New mission")),
      sampleNote(), planPanel, box);
  };

  // The council's debate (ADR-144): three role cards, then whether the locks held. Model text is untrusted.
  function councilTrace(out, onCreate) {
    const [arch, critic, synth] = out.trace;
    const SEV = { high: "failed", medium: "warn", low: "idle" };
    const engineLine = t => h("p", { class: "t-caption muted" }, t.model ? h("code", { translate: "no", text: t.model }) : "fixed rules (no model)", t.model ? " " : "", t.model ? h("span", { class: "tag-inf", text: "[INFERENCE - local LLM]" }) : null);
    const card = (cls, title, ...kids) => h("article", { class: "council-card " + cls }, h("h3", { text: title }), ...kids);
    const finalSteps = out.final.steps.map(x => h("li", { class: x.locked ? "locked" : "" }, h("span", { dir: "auto", text: x.title }), x.locked ? lockLine("locked by rule: " + x.category) : h("span", { class: "t-caption subtle", text: x.kind === "gate" ? "gate" : x.kind === "approval" ? "approval" : "read tool" })));
    return h("section", { class: "panel council", "aria-labelledby": "h-council" }, h("h2", { id: "h-council", text: "Council debate" }),
      h("div", { class: "council-grid" },
        card("arch", "1 · Architect", engineLine(arch),
          h("ol", { class: "plist" }, arch.proposal.map(p => h("li", null, h("span", { dir: "auto", text: p.title }), " ", p.locked || p.gate === "approval" ? badge("pending", "proposed locked") : h("span", { class: "t-caption subtle", text: "proposed unlocked" }))))),
        card("crit", "2 · Red team and UX critic", h("p", { class: "t-caption muted", text: "Fixed rules: locks (AGENTS.md §1), private addresses, a test gate before publishing, plan size." }),
          critic.findings.length ? h("ul", { class: "plist" }, critic.findings.map(f => h("li", null, badge(SEV[f.severity], f.severity + " · " + f.rule), " ", h("span", { dir: "auto", text: f.text })))) : h("p", { class: "t-sm", text: "No findings." }),
          critic.opinion ? h("details", { class: "think" }, h("summary", { text: "The model's own critique (untrusted, changes nothing)" }), h("p", { class: "t-sm", dir: "auto", text: critic.opinion.text }), h("span", { class: "tag-inf", text: critic.opinion.label })) : null),
        card("synth", "3 · Synthesizer", h("p", { class: "t-caption muted", text: synth.engine === "rules" ? "Fixed repairs (no model)" : "Rewrite by " + synth.engine.replace(/^rules \+ /, "") + ", locked again by rule" }),
          synth.changes.length ? h("ul", { class: "plist" }, synth.changes.map(c => h("li", { dir: "auto", text: c }))) : null,
          h("ol", { class: "plist final" }, finalSteps))),
      h("div", { class: "row between" },
        out.locksHold ? badge("ok", "Locks hold: every sensitive step waits for Director 00") : badge("failed", "A sensitive step is not locked; nothing was made"),
        out.locksHold ? h("button", { class: "btn btn-primary", type: "button", onclick: onCreate }, icon("i-layers", "sm"), "Make it a mission") : null),
      h("p", { class: "hint", text: "Making it a mission runs the council again and builds the mission from that answer, so the steps never come from this page." }));
  }

  // Who planned a mission. The model's thinking is untrusted text: shown with textContent, folded.
  function plannerBox(pl) {
    if (!pl) return null;
    const byModel = pl.engine === "ollama-local-loopback";
    return h("section", { class: "panel planner", "aria-labelledby": "h-planner" }, h("h2", { id: "h-planner", text: "Planner" }),
      pl.engine === "workflow" ? h("p", { class: "t-sm" }, "Built from the workflow graph ", h("a", { href: "#/workflows/" + pl.workflowId, text: pl.planFrom || "" }), " (no model)") :
      pl.engine === "macro" ? h("p", { class: "t-sm" }, "Composed in Ctrl+K from the fixed rules (no model) ", pl.proof && pl.proof.verified ? badge("ok", "Formal Proof: Verified") : null) :
      pl.engine === "council" ? h("p", { class: "t-sm" }, "Agreed by the council: architect, red team and UX critic, synthesizer", pl.model ? h("span", null, " (", h("code", { translate: "no", text: pl.model }), ") ", h("span", { class: "tag-inf", text: "[INFERENCE - local LLM]" })) : " (fixed rules, no model)") :
      h("p", { class: "t-sm" }, byModel ? "Drafted by the local model " : "Drafted by the fixed rules", byModel ? h("code", { translate: "no", text: pl.model }) : null, byModel ? " on 127.0.0.1 " : " ", h("span", { class: "tag-inf", text: byModel ? "[INFERENCE - local LLM]" : "(no model)" })),
      h("p", { class: "t-caption muted", text: "Every lock was decided by Jarvis's rules, not by the plan, and the database refuses to mark a locked step done." }),
      pl.warning ? h("p", { class: "t-caption muted", dir: "auto", text: pl.warning }) : null,
      pl.thinking ? h("details", { class: "think" }, h("summary", { text: "Thinking (untrusted model text)" }), h("pre", { class: "log", dir: "auto", text: pl.thinking })) : null);
  }

  function gateChips(s) {
    const res = (s.output && s.output.results) || [];
    if (!res.length) return h("div", { class: "row" }, s.criteria.map(c => h("span", { class: "badge s-idle" }, h("span", { class: "dot", "aria-hidden": "true" }), (GATE_LABEL[c.check] || c.check) + " · not run")));
    return h("ul", { class: "gates", "aria-label": "Gate results" }, res.map(r => h("li", null,
      h("span", { class: "badge " + (r.ok ? "s-ok" : "s-failed") }, h("span", { class: "dot", "aria-hidden": "true" }), (GATE_LABEL[r.check] || r.check) + " · " + (r.ok ? "pass" : "fail")),
      h("span", { class: "t-caption muted", text: r.detail }),
      h("code", { class: "t-caption subtle", translate: "no", text: r.evidence + (r.sha256 ? " · " + r.sha256.slice(0, 12) : "") + (r.snapshot ? " · build snapshot" : "") }))));
  }
  function missionStepSummary(s) {
    const o = s.output;
    if (s.status === "skipped") return (o && (o.reason || o.skipped)) || "Skipped.";
    if (!o) return s.dependsOn.length ? "Needs " + s.dependsOn.map(d => "T" + (d + 1)).join(", ") : "Ready when its phase starts.";
    if (o.simulated) return o.note;
    if (o.error) return o.error;
    if (o.rejected !== undefined) return "Rejected: " + o.rejected;
    if (o.written !== undefined) return o.written ? "Approved and written to " + o.written : (o.note || "Approved.");
    if (o.approval) return o.locked ? "Waiting for Director 00 outside Jarvis." : "Waiting for a person to approve.";
    if (o.results) return (o.pass ? "Gate passed: " : "Gate failed: ") + plural(o.results.filter(r => r.ok).length, "check") + " of " + o.results.length + " passed on saved evidence.";
    return stepSummary(s);
  }
  function lockedStepCard(m, s) {
    const skip = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Carry on without it…" });
    skip.addEventListener("click", e => openDialog("Carry on without “" + s.title + "”?", h("p", { class: "muted t-sm", text: "The step and the steps that need it are skipped, so the mission can finish. The locked request stays in the Approvals inbox for Director 00; nothing is approved." }),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Keep waiting", onclick: closeDialog }),
        h("button", { class: "btn btn-primary", type: "button", text: "Carry on", onclick: () => store.skipStep(m.id, s.idx).then(() => { closeDialog(); toast("info", "Skipped. The request stays in the inbox."); }, err => toast("error", err.message)) })], e.currentTarget));
    return h("div", { class: "approval locked mlock" },
      h("p", { class: "lock-line" }, icon("i-lock", "sm"), h("bdi", { lang: "ar", dir: "rtl", text: "بانتظار الموافقة" }), h("span", { class: "subtle t-caption", text: "· Waiting for Director 00" })),
      h("p", { class: "muted t-sm", text: "Locked: this " + LOCKED[s.category] + ". Jarvis has no approve button for it, and the database refuses to mark this step done (mission_steps_locked_never_done). Steps that do not need it carry on." }),
      h("div", { class: "row" }, h("a", { class: "btn btn-ghost btn-sm", href: "#/approvals", text: "Open in Approvals" }), skip));
  }
  function stepItem(m, s) {
    const kindIcon = { tool: "i-run", gate: "i-check", approval: "i-lock" }[s.kind];
    const decide = s.kind === "approval" && s.status === "blocked" && !s.locked && s.approvalId
      ? h("div", { class: "row" },
        h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Approve", onclick: e => { e.currentTarget.disabled = true; store.decide(s.approvalId, "approved").then(() => toast("ok", "Approved. The mission carries on."), err => toast("error", err.message)); } }),
        h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Reject…", onclick: e => rejectDialog({ id: s.approvalId, action: s.title }, e.currentTarget) }))
      : null;
    return h("li", { class: "mstep k-" + s.kind + (s.locked && s.status === "blocked" ? " is-locked" : ""), dataset: { idx: String(s.idx) } },
      h("div", { class: "mstep-head" },
        h("span", { class: "idx num", text: "T" + (s.idx + 1) }),
        h("div", { class: "what" }, h("b", { dir: "auto", text: s.title }),
          h("span", { class: "t-caption subtle" }, icon(kindIcon, "sm"), " " + s.kind + (s.tool ? " · " : ""), s.tool ? h("code", { translate: "no", text: s.tool }) : null, s.category ? " · " + s.category : "", s.dependsOn.length ? " · needs " + s.dependsOn.map(d => "T" + (d + 1)).join(", ") : "")),
        h("div", { class: "row" }, badge(s.status), h("span", { class: "num subtle t-caption", text: dur(s.ms) }))),
      h("p", { class: "t-sm muted", dir: "auto", text: missionStepSummary(s) }),
      s.kind === "gate" ? gateChips(s) : null,
      s.locked && s.status === "blocked" ? lockedStepCard(m, s) : decide);
  }
  function capsuleDialog(m, seq, from) {
    store.getCapsule(m.id, seq).then(c => openDialog("Capsule #" + c.seq + " · " + c.label, h("div", { class: "stack" },
      h("dl", { class: "kv" },
        h("dt", { text: "Hash check" }), h("dd", null, badge(c.hashOk ? "ok" : "failed", c.hashOk ? "SHA-256 matches its content" : "Does not match its content")),
        h("dt", { text: "SHA-256" }), h("dd", { class: "mono hash", translate: "no", text: c.hash }),
        h("dt", { text: "Previous" }), h("dd", { class: "mono hash", translate: "no", text: c.prevHash }),
        h("dt", { text: "Saved" }), h("dd", null, timeEl(c.createdAt)),
        h("dt", { text: "Canonical state" }), h("dd", { class: "num", text: fmtN.format(c.canonicalBytes) + " bytes" })),
      h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Saved step states" }, h("table", null,
        h("thead", null, h("tr", null, ["Step", "Status", "Gate"].map(x => h("th", { scope: "col", text: x })))),
        h("tbody", null, c.state.steps.map(st => h("tr", null, h("td", { class: "num", text: "T" + (st.idx + 1) }), h("td", null, badge(st.status)), h("td", null, st.gate === "none" ? h("span", { class: "subtle", text: "—" }) : badge(st.gate)))))))),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Close", onclick: closeDialog })], from), e => toast("error", e.message));
  }
  function restoreDialog(m, c, from) {
    if (m.status === "running") { toast("warn", "Pause the mission before you restore a capsule."); return; }
    openDialog("Restore capsule #" + c.seq + "?", h("div", { class: "stack" },
      h("p", { class: "t-sm", text: "Every step goes back to how it was at “" + c.label + "”. The chain is checked first; a broken chain restores nothing. The mission pauses, and a new capsule records the restore. Nothing is deleted: capsules are append-only." }),
      h("p", { class: "mono t-caption subtle", translate: "no", text: c.hash })),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Cancel", onclick: closeDialog }),
        h("button", { class: "btn btn-primary", type: "button", text: "Restore", onclick: () => store.restoreCapsule(m.id, c.seq).then(() => { closeDialog(); toast("ok", "Restored from #" + c.seq + ". Press Run to carry on."); }, e => toast("error", e.message)) })], from);
  }

  pages.mission = id => {
    const box = h("div", { class: "stack" });
    const render = m => {
      const busy = m.status === "running";
      const runBtn = ["draft", "paused", "awaiting_approval"].includes(m.status)
        ? h("button", { class: "btn btn-primary", type: "button", onclick: e => { e.currentTarget.disabled = true; store.runMission(m.id).then(() => toast("info", m.simulated ? "Mission started (simulated tools)." : "Mission started."), err => toast("error", err.message)); } }, icon("i-run", "sm"), m.status === "draft" ? "Run mission" : "Resume")
        : null;
      const pauseBtn = ["running", "awaiting_approval"].includes(m.status)
        ? h("button", { class: "btn btn-secondary", type: "button", text: "Pause", onclick: e => { e.currentTarget.disabled = true; store.pauseMission(m.id).then(() => toast("warn", "Paused. A capsule was saved."), err => toast("error", err.message)); } })
        : null;
      const phases = [...new Set(m.steps.map(s => s.phase))].sort((a, b) => a - b);
      const done = m.steps.filter(s => s.status === "done").length;
      const lockedWaiting = m.steps.filter(s => s.locked && s.status === "blocked").length;
      const verifyBtn = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Verify chain" });
      verifyBtn.addEventListener("click", () => store.verifyMission(m.id).then(v => toast(v.ok ? "ok" : "error", v.ok ? "Chain verified: " + plural(v.count, "capsule") + ", head " + v.head.slice(0, 12) + "…" : "Chain broken: " + v.problems.join("; ")), e => toast("error", e.message)));
      const caps = m.capsules.slice().reverse();
      return h("div", { class: "stack" },
        pageHead(m.title, m.goal && m.goal.trim() !== m.title.trim() ? m.goal : null, badge(m.status), pauseBtn, runBtn),
        m.simulated ? sampleNote("Sample mission: tool steps are simulated; gates judge the repo's evidence files as of the build; capsules are real SHA-256 chains in this browser. Start jarvis/server for real runs.") : sampleNote(),
        plannerBox(m.planner),
        lockedWaiting && m.status !== "succeeded" ? h("p", { class: "sample-note lock-note", role: "note" }, icon("i-lock", "sm"), plural(lockedWaiting, "locked step") + (lockedWaiting === 1 ? " waits" : " wait") + " for Director 00 outside Jarvis; every step that does not need " + (lockedWaiting === 1 ? "it" : "them") + " has carried on.") : null,
        h("div", { class: "mission" },
          h("div", { class: "stack" },
            h("div", { class: "mstats" },
              h("div", { class: "stat" }, h("span", { class: "label", text: "Steps done" }), h("span", { class: "value num", text: done + "/" + m.steps.length })),
              h("div", { class: "stat" }, h("span", { class: "label", text: "Phases" }), h("span", { class: "value num", text: String(phases.length) })),
              h("div", { class: "stat" }, h("span", { class: "label", text: "Capsules" }), h("span", { class: "value num", text: String(m.capsules.length) }))),
            phases.map(ph => {
              const steps = m.steps.filter(s => s.phase === ph);
              const state = steps.every(s => ["done", "skipped"].includes(s.status)) ? "done" : steps.some(s => s.status === "running") ? "running" : steps.some(s => s.status === "failed") ? "failed" : steps.some(s => s.status === "blocked") ? "blocked" : "queued";
              return h("section", { class: "phase", "aria-labelledby": "ph-" + ph },
                h("header", { class: "row between" }, h("h2", { id: "ph-" + ph, text: "Phase " + ph }), h("div", { class: "row" }, h("span", { class: "t-caption muted", text: steps.length > 1 ? "parallel · " + steps.length + " steps" : "1 step" }), badge(state))),
                h("ol", { class: "msteps" }, steps.map(s => stepItem(m, s))));
            })),
          h("aside", { class: "stack mside", "aria-label": "Mission state" },
            h("section", { class: "panel", "aria-labelledby": "h-health" }, h("h2", { id: "h-health", text: "Context health" }), healthMeter(m.health),
              h("p", { class: "t-caption muted", text: plural(m.health.stepsSinceCapsule, "step") + " since the last capsule · ≈" + fmtN.format(m.health.outputTokens) + " output tokens" }),
              h("p", { class: "t-caption subtle", text: m.health.basis })),
            h("section", { class: "panel", "aria-labelledby": "h-caps" }, h("h2", { id: "h-caps", text: "State capsules" }),
              h("div", { class: "row between" }, badge(m.chain.ok ? "ok" : "failed", m.chain.ok ? "Chain intact · " + m.chain.count : "Chain broken"), verifyBtn),
              caps.length ? h("ol", { class: "caps", "aria-label": "Capsules, newest first" }, caps.map(c => h("li", null,
                h("div", { class: "what" }, h("b", null, h("span", { class: "num", text: "#" + c.seq }), " " + c.label), h("span", { class: "mono t-caption subtle", translate: "no", text: c.hash.slice(0, 16) + "… ← " + c.prevHash.slice(0, 8) + "…" }), timeEl(c.createdAt)),
                h("div", { class: "row" },
                  h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Inspect", "aria-label": "Inspect capsule " + c.seq, onclick: e => capsuleDialog(m, c.seq, e.currentTarget) }),
                  h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Restore…", "aria-label": "Restore capsule " + c.seq, disabled: busy, onclick: e => restoreDialog(m, c, e.currentTarget) })))))
                : h("p", { class: "muted t-sm", text: "No capsule yet. The first one is saved when phase 1 finishes." }),
              busy ? h("p", { class: "hint", text: "Pause the mission to restore a capsule." }) : null),
            h("section", { class: "panel", "aria-labelledby": "h-files" }, h("h2", { id: "h-files", text: "Plan files" }),
              h("p", { class: "t-sm", text: "The replica-long-horizon record of this mission:" }),
              h("ul", { class: "row" }, m.files.names.map(n => h("li", { class: "badge mono", translate: "no", text: n }))),
              h("p", { class: "mono t-caption subtle", translate: "no", text: m.files.dir }),
              h("p", { class: "t-caption muted", text: "gate.py and capsule.py from .claude/skills/replica-long-horizon read the same files." })))));
    };
    loadInto(box, () => store.getMission(id), render);
    const refresh = () => { if (!box.isConnected) { off(); dlg.removeEventListener("close", refresh); return; } if (dlg.open) return; store.getMission(id).then(m => box.replaceChildren(render(m)), () => {}); };
    const off = store.subscribe(refresh);
    dlg.addEventListener("close", refresh);
    return h("div", { class: "stack" }, h("p", null, h("a", { href: "#/missions", text: "← Missions" })), box);
  };

  /* ── Workflows (S06, S07; ADR-137) ──────────────────────────── */
  const KIND_LABEL = { tool: "Read tool", gate: "Gate", approval: "Approval", note: "Note (asks first)" };
  const CHECK_LABEL = { tests: "TDD", lint: "Lint", contrast: "Contrast", security: "Security" };
  const CATEGORY_LABEL = { file_write: "Write a file", money: "Money", publish: "Publish", permissions: "Permissions", install: "Install", outbound: "Outbound message" };
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v)); kids.flat().forEach(k => k && n.append(k)); return n; };

  function newWorkflowDialog(from) {
    const name = h("input", { class: "input", id: "f-wfname", name: "workflow-name", autocomplete: "off", maxLength: 80, value: "New workflow" });
    const go = h("button", { class: "btn btn-primary", type: "button", text: "Create workflow" });
    go.addEventListener("click", () => {
      go.disabled = true;
      store.createWorkflow({ name: name.value, graph: LlmPlan.starterGraph() }).then(w => { closeDialog(); location.hash = "#/workflows/" + w.id; }, e => { toast("error", e.message); go.disabled = false; });
    });
    openDialog("New workflow", h("div", { class: "stack" }, h("div", { class: "field" }, h("label", { htmlFor: "f-wfname", text: "Name" }), name),
      h("p", { class: "hint", text: "It starts from the review-and-release graph; change it in the editor." })),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Cancel", onclick: closeDialog }), go], from);
  }

  pages.workflows = () => {
    const box = h("div");
    const render = list => list.length ? h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Workflows" }, h("table", null,
      h("thead", null, h("tr", null, ["Workflow", "Steps", "Locked steps", "Version", "Updated"].map((c, i) => h("th", { scope: "col", class: i && i < 4 ? "end" : null, text: c })))),
      h("tbody", null, list.map(w => h("tr", null,
        h("td", null, h("a", { href: "#/workflows/" + w.id, dir: "auto", class: "trunc", text: w.name })),
        h("td", { class: "end num", text: String(w.steps) }),
        h("td", { class: "end" }, w.locked ? h("span", { class: "badge s-pending" }, icon("i-lock", "sm"), h("span", { class: "num", text: String(w.locked) })) : h("span", { class: "subtle", text: "0" })),
        h("td", { class: "end num", text: "v" + w.version }),
        h("td", null, timeEl(typeof w.updatedAt === "number" ? w.updatedAt : Date.parse(w.updatedAt))))))))
      : emptyState("i-flow", "No workflows yet", "A workflow links read tools, gates and approvals; running it makes a mission.", h("button", { class: "btn btn-primary", type: "button", text: "New workflow", onclick: e => newWorkflowDialog(e.currentTarget) }));
    loadInto(box, () => store.listWorkflows(), render);
    return h("div", { class: "stack" },
      pageHead("Workflows", "Draw how steps depend on each other. Running a workflow makes a mission: steps that need nothing run together, gates need evidence, and locked steps wait.",
        h("button", { class: "btn btn-primary", type: "button", onclick: e => newWorkflowDialog(e.currentTarget) }, icon("i-plus", "sm"), "New workflow")),
      sampleNote(), box);
  };

  pages.workflow = id => {
    const box = h("div", { class: "stack" });
    let wf = null, graph = null, selected = null, dirty = false;
    const NW = 196, NH = 64;
    const canvasWrap = h("div", { class: "wf-canvas" });
    const inspector = h("div", { class: "stack" });
    const phasesBox = h("div", { class: "stack" });
    const errBox = h("p", { class: "err", role: "alert", hidden: true });
    const nameIn = h("input", { class: "input", id: "f-wfn", name: "workflow-name", autocomplete: "off", maxLength: 80 });
    const status = h("span", { class: "subtle t-caption", "aria-live": "polite" });
    const markDirty = () => { dirty = true; status.textContent = "Unsaved changes"; drawPhases(); };
    const rtl = () => root.dir === "rtl";
    function extent() { const xs = graph.nodes.map(n => n.x), ys = graph.nodes.map(n => n.y); return { w: Math.max(640, Math.max(0, ...xs) + NW + 40), h: Math.max(260, Math.max(0, ...ys) + NH + 40) }; }
    const dispX = (n, W) => (rtl() ? W - n.x - NW : n.x);

    function draw() {
      const { w: W, h: H } = extent();
      const s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "group", "aria-label": "Workflow graph: " + graph.nodes.length + " steps" });
      s.append(svg("defs", null, svg("marker", { id: "wf-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0 0 L10 5 L0 10 z", class: "wf-arrowhead" }))));
      const byId = new Map(graph.nodes.map(n => [n.id, n]));
      for (const e of graph.edges) {
        const a = byId.get(e.from), b = byId.get(e.to); if (!a || !b) continue;
        const ax = dispX(a, W) + (rtl() ? 0 : NW), ay = a.y + NH / 2, bx = dispX(b, W) + (rtl() ? NW : 0), by = b.y + NH / 2, dx = Math.max(40, Math.abs(bx - ax) / 2) * (rtl() ? -1 : 1);
        s.append(svg("path", { d: `M${ax} ${ay} C${ax + dx} ${ay} ${bx - dx} ${by} ${bx} ${by}`, class: "wf-edge" + (LlmPlan.nodeLocked(b) ? " to-locked" : ""), "marker-end": "url(#wf-arrow)" }));
      }
      for (const n of graph.nodes) {
        const locked = LlmPlan.nodeLocked(n);
        const g = svg("g", { class: "wf-node k-" + n.kind + (locked ? " locked" : "") + (selected === n.id ? " sel" : ""), transform: `translate(${dispX(n, W)} ${n.y})`, tabindex: "0", role: "button", "aria-pressed": String(selected === n.id), "aria-label": n.title + ", " + KIND_LABEL[n.kind] + (locked ? ", locked: waits for approval" : "") });
        const shown = (tr(n.title) || n.title).trim(); // translate before shortening, so the dictionary still matches
        const t = svg("text", { x: rtl() ? NW - 12 : 12, y: 26, class: "wf-title", "text-anchor": "start", direction: rtl() ? "rtl" : "ltr" }); t.textContent = shown.length > 24 ? shown.slice(0, 23) + "…" : shown;
        const sub = svg("text", { x: rtl() ? NW - 12 : 12, y: 48, class: "wf-sub", direction: rtl() ? "rtl" : "ltr" }); sub.textContent = locked ? "Locked · waits for approval" : n.kind === "tool" ? n.tool : n.kind === "gate" ? CHECK_LABEL[n.check] + " gate" : KIND_LABEL[n.kind];
        g.append(svg("rect", { width: NW, height: NH, rx: 12, class: "wf-box" }), t, sub);
        g.addEventListener("pointerdown", ev => startDrag(ev, n, g, W));
        g.addEventListener("click", () => select(n.id));
        g.addEventListener("keydown", ev => {
          const step = ev.shiftKey ? 40 : 10;
          const mv = { ArrowRight: [rtl() ? -step : step, 0], ArrowLeft: [rtl() ? step : -step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(n.id); }
          else if (mv) { ev.preventDefault(); n.x = Math.max(0, n.x + mv[0]); n.y = Math.max(0, n.y + mv[1]); markDirty(); draw(); focusNode(n.id); }
        });
        s.append(g);
      }
      // Fits the panel; below 640 px the graph keeps its size and the panel scrolls instead.
      s.style.minWidth = Math.min(W, 640) + "px";
      s.style.aspectRatio = W + " / " + H;
      canvasWrap.replaceChildren(s);
    }
    const focusNode = nid => { const el = canvasWrap.querySelector(".wf-node[aria-label^='" + CSS.escape(graph.nodes.find(n => n.id === nid).title) + "']"); if (el) el.focus(); };
    // Drag a node with the pointer; positions are stored in left-to-right coordinates.
    function startDrag(ev, n, g, W) {
      if (ev.button !== 0) return;
      const s = canvasWrap.querySelector("svg"), m = s.getScreenCTM(); if (!m) return;
      const sx = ev.clientX, sy = ev.clientY, ox = n.x, oy = n.y; let moved = false;
      g.setPointerCapture(ev.pointerId);
      const move = e => { const dx = (e.clientX - sx) / m.a, dy = (e.clientY - sy) / m.d; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; n.x = Math.max(0, Math.round(ox + (rtl() ? -dx : dx))); n.y = Math.max(0, Math.round(oy + dy)); g.setAttribute("transform", `translate(${dispX(n, W)} ${n.y})`); };
      const up = () => { g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); if (moved) { markDirty(); draw(); } };
      g.addEventListener("pointermove", move); g.addEventListener("pointerup", up);
    }
    function select(nid) { selected = nid; draw(); drawInspector(); }
    function drawInspector() {
      const n = graph.nodes.find(x => x.id === selected);
      if (!n) { inspector.replaceChildren(h("p", { class: "muted t-sm", text: "Select a step to edit it, or add one." })); return; }
      const title = h("input", { class: "input", id: "f-node-title", name: "node-title", autocomplete: "off", maxLength: 80, value: n.title, dir: "auto" });
      title.addEventListener("input", () => { n.title = title.value; markDirty(); draw(); });
      const kind = h("select", { class: "select", id: "f-node-kind", name: "node-kind", autocomplete: "off" }, Object.entries(KIND_LABEL).map(([k, l]) => h("option", { value: k, text: l, selected: n.kind === k })));
      kind.addEventListener("change", () => { n.kind = kind.value; delete n.tool; delete n.check; delete n.category; if (n.kind === "tool") n.tool = "files.read"; if (n.kind === "gate") n.check = "tests"; if (n.kind === "approval") n.category = "file_write"; markDirty(); draw(); drawInspector(); });
      const extra = n.kind === "tool" ? ["tool", "Read tool", LlmPlan.WF_TOOLS.map(t => [t, t])] : n.kind === "gate" ? ["check", "Check", LlmPlan.WF_CHECKS.map(c => [c, CHECK_LABEL[c]])] : n.kind === "approval" ? ["category", "Asks for", LlmPlan.WF_CATEGORIES.map(c => [c, CATEGORY_LABEL[c]])] : null;
      let extraField = null;
      if (extra) {
        const sel = h("select", { class: "select", id: "f-node-" + extra[0], name: "node-" + extra[0], autocomplete: "off" }, extra[2].map(([v, l]) => h("option", { value: v, text: l, selected: n[extra[0]] === v })));
        sel.addEventListener("change", () => { n[extra[0]] = sel.value; markDirty(); draw(); });
        extraField = h("div", { class: "field" }, h("label", { htmlFor: sel.id, text: extra[1] }), sel);
      }
      const needs = h("fieldset", null, h("legend", { class: "legend", text: "Needs (runs after)" }), graph.nodes.filter(o => o.id !== n.id).map(o => {
        const cb = h("input", { type: "checkbox", name: "needs", value: o.id, checked: graph.edges.some(e => e.from === o.id && e.to === n.id) });
        cb.addEventListener("change", () => { graph.edges = graph.edges.filter(e => !(e.from === o.id && e.to === n.id)); if (cb.checked) graph.edges.push({ from: o.id, to: n.id }); markDirty(); draw(); });
        return h("label", { class: "check" }, cb, h("span", { dir: "auto", text: o.title }));
      }));
      const del = h("button", { class: "btn btn-danger btn-sm", type: "button", text: "Delete step" });
      del.addEventListener("click", () => { graph.nodes = graph.nodes.filter(x => x.id !== n.id); graph.edges = graph.edges.filter(e => e.from !== n.id && e.to !== n.id); selected = null; markDirty(); draw(); drawInspector(); });
      const locked = LlmPlan.nodeLocked(n);
      // replaceChildren() prints a null argument as "null"; absent parts (extraField, the lock note) are filtered out.
      inspector.replaceChildren(...[
        h("div", { class: "field" }, h("label", { htmlFor: "f-node-title", text: "Title" }), title),
        h("div", { class: "field" }, h("label", { htmlFor: "f-node-kind", text: "Kind" }), kind), extraField, needs,
        locked ? h("p", { class: "sample-note lock-note" }, icon("i-lock", "sm"), "This step is locked: it waits for Director 00 outside Jarvis, whatever kind it is drawn as.") : null,
        h("div", { class: "row" }, del)].filter(Boolean));
    }
    function drawPhases() {
      let steps;
      try { steps = LlmPlan.graphToSteps(LlmPlan.checkGraph(graph)); errBox.hidden = true; }
      catch (e) { errBox.hidden = false; errBox.textContent = e.message; phasesBox.replaceChildren(); return false; }
      const phases = [...new Set(steps.map(x => x.phase))];
      phasesBox.replaceChildren(...phases.map(p => h("div", { class: "wf-phase" }, h("b", { text: "Phase " + p }),
        h("ul", null, steps.filter(x => x.phase === p).map(x => h("li", null, h("span", { dir: "auto", text: x.title }), " ", x.locked ? h("span", { class: "badge s-pending" }, icon("i-lock", "sm"), "Locked") : h("span", { class: "badge" + (x.kind === "tool" ? " mono" : ""), text: x.kind === "gate" ? CHECK_LABEL[x.criteria[0].check] : x.kind === "tool" ? x.tool : "asks first" })))))));
      return true;
    }
    const addBtn = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-plus", "sm"), "Add step");
    addBtn.addEventListener("click", () => {
      let i = graph.nodes.length + 1; while (graph.nodes.some(n => n.id === "step-" + i)) i++;
      const maxY = Math.max(0, ...graph.nodes.map(n => n.y));
      graph.nodes.push({ id: "step-" + i, title: "New step " + i, kind: "tool", tool: "files.read", x: 40, y: graph.nodes.length ? maxY + 100 : 40 });
      markDirty(); select("step-" + i);
    });
    const saveBtn = h("button", { class: "btn btn-secondary", type: "button", text: "Save" });
    const save = () => { if (!drawPhases()) return Promise.reject(new Error(errBox.textContent)); return store.saveWorkflow(wf.id, { name: nameIn.value, graph }).then(w => { wf = w; dirty = false; status.textContent = "Saved · v" + w.version; return w; }); };
    saveBtn.addEventListener("click", () => save().then(() => toast("ok", "Workflow saved."), e => toast("error", e.message)));
    const runBtn = h("button", { class: "btn btn-primary", type: "button" }, icon("i-run", "sm"), "Run workflow");
    runBtn.addEventListener("click", () => { runBtn.disabled = true; (dirty ? save() : Promise.resolve()).then(() => store.runWorkflow(wf.id)).then(r => { toast("info", "Running as a mission. Locked steps will wait."); location.hash = "#/missions/" + r.mission; }, e => toast("error", e.message)).finally(() => { runBtn.disabled = false; }); });
    const delWf = h("button", { class: "btn btn-ghost", type: "button", text: "Delete workflow…" });
    delWf.addEventListener("click", e => openDialog("Delete this workflow?", h("p", { class: "muted t-sm", text: "Missions it already ran stay." }),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Keep it", onclick: closeDialog }), h("button", { class: "btn btn-danger", type: "button", text: "Delete", onclick: () => store.deleteWorkflow(wf.id).then(() => { closeDialog(); location.hash = "#/workflows"; }, err => toast("error", err.message)) })], e.currentTarget));
    nameIn.addEventListener("input", markDirty);
    loadInto(box, () => store.getWorkflow(id), w => {
      wf = w; graph = JSON.parse(JSON.stringify(w.graph)); nameIn.value = w.name; status.textContent = "v" + w.version;
      draw(); drawInspector(); drawPhases();
      return h("div", { class: "stack" },
        h("div", { class: "page-head" }, h("div", { class: "field wf-name" }, h("label", { htmlFor: "f-wfn", text: "Workflow name" }), nameIn), h("div", { class: "row" }, status, delWf, addBtn, saveBtn, runBtn)),
        sampleNote(), errBox,
        h("div", { class: "wf-layout" },
          h("section", { class: "panel wf-stage", "aria-labelledby": "h-graph" }, h("h2", { id: "h-graph", text: "Graph" }),
            h("p", { class: "hint", text: "Drag a step, or select it and use the arrow keys (Shift for bigger moves). Links run from a step to the steps that need it." }), canvasWrap),
          h("aside", { class: "stack" },
            h("section", { class: "panel", "aria-labelledby": "h-insp" }, h("h2", { id: "h-insp", text: "Step" }), inspector),
            h("section", { class: "panel", "aria-labelledby": "h-wfph" }, h("h2", { id: "h-wfph", text: "Phases when it runs" }), phasesBox),
            w.runs && w.runs.length ? h("section", { class: "panel", "aria-labelledby": "h-wfruns" }, h("h2", { id: "h-wfruns", text: "Runs" }), h("ul", { class: "stack" }, w.runs.map(r => h("li", { class: "row" }, h("a", { href: "#/missions/" + r.id, class: "mono t-caption", text: String(r.id).slice(0, 12) }), badge(r.status), timeEl(typeof r.createdAt === "number" ? r.createdAt : Date.parse(r.createdAt)))))) : null)));
    });
    return h("div", { class: "stack" }, h("p", null, h("a", { href: "#/workflows", text: "← Workflows" })), box);
  };

  /* ── Analytics (ADR-137): bars are SVG, every label and number is HTML text ── */
  const barSvg = (value, max, cls) => {
    const s = svg("svg", { class: "bar-svg", viewBox: "0 0 100 10", preserveAspectRatio: "none", "aria-hidden": "true" });
    s.append(svg("rect", { x: 0, y: 0, width: 100, height: 10, rx: 2, class: "bar-track" }), svg("rect", { x: 0, y: 0, width: max ? Math.max(value ? 1.5 : 0, value / max * 100) : 0, height: 10, rx: 2, class: "bar-fill " + (cls || "") }));
    return s;
  };
  const barRows = (rows, label) => {
    const max = Math.max(1, ...rows.map(r => r.value));
    return h("ul", { class: "bars", "aria-label": label }, rows.map(r => h("li", null, h("span", { class: "bar-label", dir: "auto", text: r.label }), barSvg(r.value, max, r.cls), h("span", { class: "num bar-value", text: r.text || fmtN.format(r.value) }))));
  };
  pages.analytics = () => {
    const box = h("div", { class: "stack" });
    loadInto(box, () => store.analytics(), a => {
      const runs = a.runsByDay.reduce((n, d) => n + d.runs, 0);
      const gp = a.gateRates.reduce((n, g) => n + g.pass, 0), gf = a.gateRates.reduce((n, g) => n + g.fail, 0);
      const tokens = a.tokens.reduce((n, t) => n + t.tokens, 0);
      const maxDay = Math.max(1, ...a.runsByDay.map(d => d.runs));
      const daySvg = svg("svg", { class: "days-svg", viewBox: "0 0 140 40", preserveAspectRatio: "none", "aria-hidden": "true" },
        a.runsByDay.map((d, i) => svg("rect", { x: i * 10 + 1, y: 40 - Math.max(d.runs ? 2 : 0, d.runs / maxDay * 38), width: 8, height: Math.max(d.runs ? 2 : 0, d.runs / maxDay * 38), rx: 1.5, class: "bar-fill" })));
      return h("div", { class: "stack" },
        h("section", { class: "creator", "aria-labelledby": "h-creator" },
          h("div", { class: "row between" }, h("h2", { id: "h-creator", text: "Creator mode" }), badge("ok", "Zero-token · unlimited")),
          h("p", { class: "t-sm", text: "You build and run everything at no token cost: local rules and the local model on 127.0.0.1. Paid plans for other people are drafts; charging anyone stays locked for Director 00." }),
          h("a", { class: "btn btn-secondary btn-sm", href: "#/settings", text: "Plans and token ledger" })),
        h("div", { class: "stats" },
          h("div", { class: "stat" }, h("span", { class: "label", text: "Runs in 14 days" }), h("span", { class: "value num", text: fmtN.format(runs) })),
          h("div", { class: "stat" }, h("span", { class: "label", text: "Gate checks passed" }), h("span", { class: "value num", text: gp + gf ? Math.round(gp / (gp + gf) * 100) + "%" : "—" }), h("span", { class: "subtle t-caption num", text: gp + " / " + (gp + gf) })),
          h("div", { class: "stat" }, h("span", { class: "label", text: "State capsules" }), h("span", { class: "value num", text: fmtN.format(a.capsules) })),
          h("div", { class: "stat" }, h("span", { class: "label", text: "Tokens used" }), h("span", { class: "value num", text: fmtN.format(tokens) }), h("span", { class: "subtle t-caption", text: "Cost: 0 · estimated as characters ÷ 4 [INFERENCE]" }))),
        h("div", { class: "grid-2" },
          h("section", { class: "panel", "aria-labelledby": "h-days" }, h("h2", { id: "h-days", text: "Runs per day" }), daySvg,
            h("div", { class: "row between t-caption subtle" }, h("span", { class: "num", text: a.runsByDay[0].day }), h("span", { class: "num", text: a.runsByDay[13].day })),
            h("p", { class: "vh", text: a.runsByDay.map(d => d.day + ": " + d.runs).join(", ") })),
          h("section", { class: "panel", "aria-labelledby": "h-gates" }, h("h2", { id: "h-gates", text: "Gate pass rate" }),
            barRows(a.gateRates.map(g => ({ label: CHECK_LABEL[g.check], value: g.rate || 0, text: g.rate == null ? "no runs" : g.rate + "% · " + g.pass + "/" + (g.pass + g.fail), cls: g.rate != null && g.rate < 100 ? "warn" : "" })), "Gate pass rate")),
          h("section", { class: "panel", "aria-labelledby": "h-ag" }, h("h2", { id: "h-ag", text: "Agents" }),
            a.agents.length ? barRows(a.agents.map(g => ({ label: g.agent, value: g.runs, text: g.succeeded + " ok · " + g.failed + " failed" })), "Runs per agent") : h("p", { class: "muted t-sm", text: "No agents yet." })),
          h("section", { class: "panel", "aria-labelledby": "h-ms" }, h("h2", { id: "h-ms", text: "Missions" }),
            a.missionsByStatus.length ? barRows(a.missionsByStatus.map(m => ({ label: m.key, value: m.count })), "Missions by status") : h("p", { class: "muted t-sm", text: "No missions yet." })),
          h("section", { class: "panel", "aria-labelledby": "h-tok" }, h("h2", { id: "h-tok", text: "Tokens by engine" }),
            a.tokens.length ? barRows(a.tokens.map(t => ({ label: t.engine, value: t.tokens, text: fmtN.format(t.tokens) + " · cost 0" })), "Tokens by engine") : h("p", { class: "muted t-sm", text: "Nothing used yet." })),
          h("section", { class: "panel", "aria-labelledby": "h-apr" }, h("h2", { id: "h-apr", text: "Approvals" }),
            a.approvals.length ? barRows(a.approvals.map(p => ({ label: p.key.replace("locked-", "locked · "), value: p.count, cls: p.key.startsWith("locked") ? "locked" : "" })), "Approvals") : h("p", { class: "muted t-sm", text: "No requests yet." }))));
    });
    return h("div", { class: "stack" }, pageHead("Analytics", "How agents, gates, missions and tokens are doing in this workspace."), sampleNote(), telemetryPanel(), box);
  };
  // ADR-147: a telemetry series, analysed in one pass (Welford, EWMA, online z-score, VPIN) and drawn after
  // LTTB downsampling, with every anomaly marked at its own place. Labels are HTML beside the chart.
  function telemetryPanel() {
    const metricSel = h("select", { class: "select", id: "f-metric", name: "metric", autocomplete: "off" });
    const thSel = h("select", { class: "select", id: "f-lttb", name: "lttb", autocomplete: "off" }, [60, 120, 240].map(n => h("option", { value: n, text: n + " points", selected: n === 120 })));
    const box = h("div", { class: "stack", "aria-live": "polite" });
    const live = store.mode === "live";
    const draw = r => {
      if (!r.points.length) return h("p", { class: "muted t-sm", text: "No points for this metric yet." });
      const W = 720, H = 200, P = 8, ts = r.points.map(p => p.t), all = r.points.map(p => p.v).concat(r.anomalies.map(a => a.v));
      const t0 = Math.min(...ts), t1 = Math.max(...ts), v0 = Math.min(...all), v1 = Math.max(...all);
      const X = t => P + (t1 > t0 ? (t - t0) / (t1 - t0) : 0.5) * (W - 2 * P), Y = v => H - P - (v1 > v0 ? (v - v0) / (v1 - v0) : 0.5) * (H - 2 * P);
      const d = r.points.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ");
      const chart = svg("svg", { class: "ts-svg", viewBox: "0 0 " + W + " " + H, "aria-hidden": "true" },
        svg("path", { class: "ts-line", d }), ...r.anomalies.map(a => svg("circle", { class: "ts-dot", cx: X(a.t).toFixed(1), cy: Y(a.v).toFixed(1), r: 5 })));
      const st = r.stats, fmtV = v => v == null ? "—" : fmtN.format(v);
      return h("div", { class: "stack" },
        h("div", { class: "stats" },
          h("div", { class: "stat" }, h("span", { class: "label", text: "Points drawn" }), h("span", { class: "value num", text: r.points.length + " / " + fmtN.format(r.raw) }), h("span", { class: "subtle t-caption", text: "LTTB keeps peaks and troughs" })),
          h("div", { class: "stat" }, h("span", { class: "label", text: "Mean · SD" }), h("span", { class: "value num", text: fmtV(st.mean) + " · " + fmtV(st.sd) }), h("span", { class: "subtle t-caption", text: "Welford, one pass" })),
          h("div", { class: "stat" }, h("span", { class: "label", text: "EWMA" }), h("span", { class: "value num", text: fmtV(st.ewma) }), h("span", { class: "subtle t-caption", text: "alpha 0.1" })),
          h("div", { class: "stat" }, h("span", { class: "label", text: "Flow imbalance (VPIN)" }), h("span", { class: "value num", text: st.vpin == null ? "—" : st.vpin.toFixed(3) }), h("span", { class: "tag-inf", text: "[INFERENCE]" })),
          h("div", { class: "stat" }, h("span", { class: "label", text: "Anomalies" }), h("span", { class: "value num", text: String(r.anomalies.length) }), h("span", { class: "subtle t-caption", text: "|z| > 3 against the values before" }))),
        h("div", { class: "ts-wrap" }, chart),
        h("div", { class: "row between t-caption subtle" }, h("span", { class: "num", text: fmtDate.format(new Date(t0)) }), h("span", { class: "num", text: fmtN.format(v0) + " – " + fmtN.format(v1) }), h("span", { class: "num", text: fmtDate.format(new Date(t1)) })),
        r.anomalies.length ? h("ul", { class: "row diff-blocks", "aria-label": "Anomalies" }, r.anomalies.slice(-8).map(a => h("li", { class: "badge s-failed num", text: fmtN.format(a.v) + " · z " + a.z }))) : null,
        h("p", { class: "vh", text: r.points.length + " points from " + fmtN.format(v0) + " to " + fmtN.format(v1) + "; " + r.anomalies.length + " anomalies." }));
    };
    const loadSeries = () => loadInto(box, () => store.telemetrySeries(metricSel.value, thSel.value), draw);
    metricSel.addEventListener("change", loadSeries); thSel.addEventListener("change", loadSeries);
    store.telemetryMetrics().then(list => {
      if (!list.length) { box.replaceChildren(emptyState("i-chart", "No telemetry yet", "Each request to this workspace is timed on this computer; points appear after a few clicks.")); return; }
      metricSel.replaceChildren(...list.map(m => h("option", { value: m.metric, translate: "no", text: m.metric + " · " + fmtN.format(m.n) })));
      const pick = list.find(m => m.metric === "api.latency_ms") || list[0];
      metricSel.value = pick.metric;
      loadSeries();
    }, e => box.replaceChildren(h("p", { class: "err" }, icon("i-alert", "sm"), e.message)));
    return h("section", { class: "panel", "aria-labelledby": "h-tele" }, h("h2", { id: "h-tele", text: "Telemetry" }),
      live ? h("p", { class: "t-caption muted", text: "Measured on this computer: request times and anything posted to /telemetry/record." }) : h("p", { class: "sample-note", dir: "auto" }, icon("i-alert", "sm"), h("bdi", { lang: "ar", dir: "rtl", text: "مثال تعليمي — أرقام افتراضية" }), " · Teaching example: made-up numbers"),
      h("div", { class: "snap-pick" }, h("div", { class: "field" }, h("label", { htmlFor: "f-metric", text: "Metric" }), metricSel), h("div", { class: "field" }, h("label", { htmlFor: "f-lttb", text: "Draw" }), thSel)),
      box);
  }

  /* ── Webhooks (ADR-137) ─────────────────────────────────────── */
  function secretDialog(id, secret, from) {
    const show = s => openDialog("Webhook secret", h("div", { class: "stack" },
      h("p", { class: "t-sm", text: "Sign each delivery's exact body with HMAC-SHA256 using this secret, and send it as X-Jarvis-Signature: sha256=<hex>. Keep it out of git and chats." }),
      h("pre", { class: "diff", translate: "no", text: s })), [h("button", { class: "btn btn-secondary", type: "button", text: "Close", onclick: closeDialog })], from);
    if (secret) show(secret); else store.webhookSecret(id).then(r => show(r.secret), e => toast("error", e.message));
  }
  pages.webhooks = () => {
    const box = h("div", { class: "stack" });
    const render = list => list.length ? h("div", { class: "stack" }, list.map(wh => {
      const act = (fn, msg) => e => { e.currentTarget.disabled = true; fn().then(r => { if (r && r.locked) toast("warn", "Locked: sending outside Jarvis waits for Director 00."); else toast("ok", msg); reload(); }, err => { toast("error", err.message); reload(); }); };
      return h("article", { class: "approval" + (wh.external ? " locked" : ""), "aria-labelledby": "wh-" + wh.id },
        h("div", { class: "row between" }, h("h3", { id: "wh-" + wh.id, dir: "auto", text: wh.name }), h("div", { class: "row" }, h("span", { class: "badge", text: wh.direction === "in" ? "Incoming" : "Outgoing" }), badge(wh.status === "active" ? "ok" : wh.status === "paused" ? "paused" : "idle", wh.status === "active" ? "On" : wh.status === "paused" ? "Paused" : "Draft"))),
        h("p", { class: "mono t-caption", translate: "no", text: wh.direction === "in" ? "POST " + wh.endpoint : wh.url }),
        wh.external ? h("p", { class: "lock-line" }, icon("i-lock", "sm"), h("bdi", { lang: "ar", dir: "rtl", text: "بانتظار الموافقة" }), h("span", { class: "subtle t-caption", text: "· Sending outside this computer is an outbound message (AGENTS.md §1). The database refuses to switch it on." })) : null,
        wh.deliveries.length ? h("ul", { class: "feed" }, wh.deliveries.slice(0, 5).map(d => h("li", null, badge(d.status === "verified" || d.status === "sent" ? "ok" : "failed", d.status), h("span", { class: "t-caption", text: d.detail }), h("span", { class: "mono t-caption subtle", translate: "no", text: d.body_sha256 ? d.body_sha256.slice(0, 12) : "" }), timeEl(typeof d.at === "number" ? d.at : Date.parse(d.at))))) : h("p", { class: "muted t-sm", text: "No deliveries yet." }),
        h("div", { class: "row" },
          wh.status !== "active" ? h("button", { class: "btn btn-primary btn-sm", type: "button", text: wh.external ? "Ask to switch on…" : "Switch on", onclick: act(() => store.activateWebhook(wh.id), "Webhook switched on.") }) : h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Pause", onclick: act(() => store.pauseWebhook(wh.id), "Paused.") }),
          wh.direction === "out" && wh.status === "active" ? h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Send test event", onclick: act(() => store.testWebhook(wh.id).then(r => { toast(r.status === "sent" ? "ok" : "error", "Test: " + r.status + " · " + r.detail); return null; }), "Sent.") }) : null,
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Show secret", onclick: e => secretDialog(wh.id, null, e.currentTarget) }),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", onclick: act(() => store.deleteWebhook(wh.id), "Deleted.") })));
    })) : emptyState("i-hook", "No webhooks yet", store.mode === "live" ? "Incoming webhooks let local tools tell Jarvis something happened; outgoing ones send mission results to a tool on this computer." : "Webhooks run on the local server, where their secrets are kept. Start it with: node jarvis/server/server.mjs");
    const reload = () => loadInto(box, () => store.listWebhooks(), render);
    const name = h("input", { class: "input", id: "f-whname", name: "webhook-name", autocomplete: "off", maxLength: 80, placeholder: "CI results" });
    const dir = h("select", { class: "select", id: "f-whdir", name: "webhook-direction", autocomplete: "off" }, h("option", { value: "in", text: "Incoming (a tool posts to Jarvis)" }), h("option", { value: "out", text: "Outgoing (Jarvis posts to a tool)" }));
    const url = h("input", { class: "input mono", id: "f-whurl", name: "webhook-url", type: "url", autocomplete: "off", placeholder: "http://127.0.0.1:9000/hook", disabled: true });
    dir.addEventListener("change", () => { url.disabled = dir.value !== "out"; });
    const add = h("button", { class: "btn btn-primary", type: "button" }, icon("i-plus", "sm"), "Add webhook");
    add.addEventListener("click", e => { const from = e.currentTarget; store.createWebhook({ name: name.value, direction: dir.value, url: url.value }).then(wh => { name.value = ""; reload(); secretDialog(wh.id, wh.secret, from); }, err => toast("error", err.message)); });
    reload();
    return h("div", { class: "stack" },
      pageHead("Webhooks", "Signed with HMAC-SHA256. Outgoing webhooks may only reach this computer; anything outside waits for Director 00."), sampleNote(),
      h("section", { class: "panel", "aria-labelledby": "h-whnew" }, h("h2", { id: "h-whnew", text: "New webhook" }),
        h("div", { class: "grid-2" }, h("div", { class: "field" }, h("label", { htmlFor: "f-whname", text: "Name" }), name), h("div", { class: "field" }, h("label", { htmlFor: "f-whdir", text: "Direction" }), dir)),
        h("div", { class: "field" }, h("label", { htmlFor: "f-whurl", text: "Address (outgoing only)" }), url), h("div", { class: "row" }, add)),
      box);
  };

  /* ── Run comparison (ADR-137) ───────────────────────────────── */
  pages.compare = (a, b) => {
    const box = h("div");
    loadInto(box, () => Promise.all([store.getRun(a), store.getRun(b)]), ([x, y]) => {
      const tools = [...new Set([...x.steps.map(s => s.tool), ...y.steps.map(s => s.tool)])];
      const col = r => h("div", { class: "stat" }, h("span", { class: "label", dir: "auto", text: r.agentName }), h("span", { class: "row" }, badge(r.status), timeEl(r.createdAt)), h("span", { class: "num t-caption", text: dur(r.finishedAt && r.startedAt ? r.finishedAt - r.startedAt : null) + " · cost 0" }));
      return h("div", { class: "stack" }, h("div", { class: "grid-2" }, col(x), col(y)),
        h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Steps side by side" }, h("table", null,
          h("thead", null, h("tr", null, ["Step", "Run A", "Run B", "Change"].map(c => h("th", { scope: "col", text: c })))),
          h("tbody", null, tools.map(t => {
            const sa = x.steps.find(s => s.tool === t), sb = y.steps.find(s => s.tool === t);
            const d = sa && sb && sa.ms != null && sb.ms != null ? sb.ms - sa.ms : null;
            return h("tr", null, h("td", { class: "mono", text: t }),
              h("td", null, sa ? h("span", { class: "row" }, badge(sa.status), h("span", { class: "num t-caption", text: dur(sa.ms) })) : h("span", { class: "subtle", text: "—" })),
              h("td", null, sb ? h("span", { class: "row" }, badge(sb.status), h("span", { class: "num t-caption", text: dur(sb.ms) })) : h("span", { class: "subtle", text: "—" })),
              h("td", { class: "num", text: !sa ? "only in B" : !sb ? "only in A" : sa.status !== sb.status ? sa.status + " → " + sb.status : d == null ? "same" : (d > 0 ? "+" : "") + fmtN.format(d) + " ms" }));
          })))));
    });
    return h("div", { class: "stack" }, h("p", null, h("a", { href: "#/runs", text: "← Runs" })), pageHead("Compare runs", "Two runs side by side, step by step."), box);
  };

  /* ── Agent templates gallery (ADR-137) ──────────────────────── */
  const AGENT_TEMPLATES = [
    { name: "Release notes writer", rolePrompt: "Turns recent commits into release notes. Publishing them is Director 00's call.", tools: ["git.log", "notes.write"], skills: ["replica-build"], maxSteps: 10, mode: "single" },
    { name: "Decision record reader", rolePrompt: "Reads docs/adr and summarises what changed and why.", tools: ["files.read", "notes.write"], skills: ["omega-knowledge-domain"], maxSteps: 12, mode: "single" },
    { name: "Design token auditor", rolePrompt: "Reads jarvis/replica/design and reports which tokens changed and whether the gates still pass.", tools: ["files.read", "notes.write"], skills: ["replica-design"], maxSteps: 12, mode: "long_horizon" },
    { name: "Run reviewer", rolePrompt: "Reads this workspace's runs and writes a short review of what failed.", tools: ["runs.read", "notes.write"], skills: [], maxSteps: 8, mode: "single" },
    { name: "Notes librarian", rolePrompt: "Lists the notes this workspace wrote and the docs they cite.", tools: ["notes.read", "files.read"], skills: [], maxSteps: 8, mode: "single" },
    { name: "Release readiness mission", rolePrompt: "Reads commits and decision records, passes the security gate, then asks to save a note.", tools: ["git.log", "files.read", "notes.write"], skills: ["replica-long-horizon"], maxSteps: 12, mode: "long_horizon" },
  ];
  pages.templates = () => h("div", { class: "stack" }, h("p", null, h("a", { href: "#/agents", text: "← Agents" })),
    pageHead("Agent templates", "Start an agent from a template, then change anything before you save."),
    h("ul", { class: "mlist", "aria-label": "Templates" }, AGENT_TEMPLATES.map(t => h("li", null, h("article", { class: "mcard" },
      h("b", { dir: "auto", text: t.name }), h("p", { class: "t-sm muted", dir: "auto", text: t.rolePrompt }),
      h("div", { class: "row" }, t.tools.map(x => h("span", { class: "badge mono", text: x })), t.mode === "long_horizon" ? h("span", { class: "badge", text: "Long-horizon" }) : null),
      h("div", null, h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Use template", onclick: e => agentDialog(e.currentTarget, null, { ...t, model: store.mode === "live" ? "Local rules (no model)" : "Local model (loopback)" }) })))))));

  /* ── Schedule panel on an agent (ADR-137) ───────────────────── */
  function schedulePanel(a) {
    const box = h("div", { class: "stack" });
    const PRESETS_MIN = [[15, "Every 15 minutes"], [60, "Every hour"], [360, "Every 6 hours"], [1440, "Every day"], [10080, "Every week"]];
    loadInto(box, () => store.listSchedules(), list => {
      const cur = list.find(x => x.agentId === a.id);
      const every = h("select", { class: "select", id: "f-every", name: "every", autocomplete: "off" }, PRESETS_MIN.map(([m, l]) => h("option", { value: String(m), text: l, selected: cur ? cur.everyMinutes === m : m === 60 })));
      const on = h("input", { class: "switch", type: "checkbox", role: "switch", id: "f-schon", name: "schedule-on", checked: cur ? cur.enabled : true });
      const saveB = h("button", { class: "btn btn-primary btn-sm", type: "button", text: cur ? "Save schedule" : "Schedule runs" });
      saveB.addEventListener("click", () => store.setSchedule(a.id, { everyMinutes: Number(every.value), enabled: on.checked }).then(() => { toast("ok", "Schedule saved."); box.replaceWith(schedulePanel(a)); }, e => toast("error", e.message)));
      const rm = cur ? h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove schedule", onclick: () => store.deleteSchedule(a.id).then(() => { toast("ok", "Schedule removed."); box.replaceWith(schedulePanel(a)); }, e => toast("error", e.message)) }) : null;
      return h("div", { class: "stack" },
        h("div", { class: "field" }, h("label", { htmlFor: "f-every", text: "Run" }), every),
        h("label", { class: "check", htmlFor: "f-schon" }, on, h("span", { text: "On" })),
        cur ? h("p", { class: "t-sm muted" }, "Next run ", timeEl(typeof cur.nextAt === "number" ? cur.nextAt : Date.parse(cur.nextAt)), cur.lastError ? " · last try: " + cur.lastError : "") : null,
        h("p", { class: "hint", text: store.mode === "live" ? "The local server starts due runs every 30 seconds while it runs. A run is skipped while the agent is busy." : "Sample mode keeps the schedule; only the local server runs it." }),
        h("div", { class: "row" }, saveB, rm));
    });
    return box;
  }

  /* ── Members and roles, plans and tokens (Settings, ADR-137) ─── */
  function membersPanel() {
    const box = h("div", { class: "stack" });
    const render = list => {
      const email = h("input", { class: "input", id: "f-memail", name: "member-email", type: "email", autocomplete: "off", placeholder: "name@example.com" });
      const role = h("select", { class: "select", id: "f-mrole", name: "member-role", autocomplete: "off" }, ["viewer", "operator", "admin"].map(r => h("option", { value: r, text: r })));
      const add = h("button", { class: "btn btn-primary btn-sm", type: "button", text: "Add member" });
      add.addEventListener("click", () => store.addMember({ email: email.value, role: role.value }).then(l => { toast("ok", "Added. No invitation was sent: outbound messages are locked."); box.replaceChildren(render(l)); }, e => toast("error", e.message)));
      return h("div", { class: "stack" },
        h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Members" }, h("table", null,
          h("thead", null, h("tr", null, ["Member", "Role", ""].map(c => h("th", { scope: "col", text: c })))),
          h("tbody", null, list.map(m => {
            if (m.role === "owner") return h("tr", null, h("td", { text: m.email }), h("td", null, h("span", { class: "badge", text: "owner" })), h("td"));
            const sel = h("select", { class: "select", name: "role-" + m.id, autocomplete: "off", "aria-label": "Role of " + m.email }, ["viewer", "operator", "admin"].map(r => h("option", { value: r, text: r, selected: m.role === r })));
            sel.addEventListener("change", () => store.setRole(m.id, sel.value).then(l => { toast("ok", "Role changed."); box.replaceChildren(render(l)); }, e => toast("error", e.message)));
            return h("tr", null, h("td", { text: m.email }), h("td", null, sel), h("td", null, h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Remove", "aria-label": "Remove " + m.email, onclick: () => store.removeMember(m.id).then(l => box.replaceChildren(render(l)), e => toast("error", e.message)) })));
          })))),
        h("div", { class: "member-add" }, h("div", { class: "field" }, h("label", { htmlFor: "f-memail", text: "Email" }), email), h("div", { class: "field" }, h("label", { htmlFor: "f-mrole", text: "Role" }), role), add));
    };
    loadInto(box, () => store.members(), render);
    return box;
  }
  function plansPanel() {
    const box = h("div", { class: "stack" });
    const render = b => {
      const name = h("input", { class: "input", id: "f-tname", name: "tier-name", autocomplete: "off", maxLength: 40, placeholder: "Pro" });
      const toks = h("input", { class: "input num", id: "f-ttok", name: "tier-tokens", inputmode: "numeric", autocomplete: "off", placeholder: "2000000" });
      const price = h("input", { class: "input num", id: "f-tprice", name: "tier-price", inputmode: "numeric", autocomplete: "off", placeholder: "1900" });
      const save = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Save draft plan" });
      save.addEventListener("click", () => store.saveTier({ name: name.value, monthlyTokens: Number(toks.value), priceMinor: Number(price.value || 0), currency: "USD" }).then(nb => box.replaceChildren(render(nb)), e => toast("error", e.message)));
      const money = what => e => store.requestMoney(what).then(() => { toast("warn", "Locked: charging people waits for Director 00 outside Jarvis."); location.hash = "#/approvals"; }, err => toast("error", err.message));
      return h("div", { class: "stack" },
        h("div", { class: "row" }, badge("ok", b.creatorZeroToken ? "Creator · zero-token · unlimited" : "Creator mode off"), badge("idle", b.billingEnabled ? "Billing on" : "Billing off")),
        h("p", { class: "t-sm", text: "You pay nothing: every entry in the ledger is yours at cost 0. Plans for future subscribers are drafts; turning on billing or a plan is a money decision that waits for Director 00 (AGENTS.md §1), and the database keeps both off." }),
        b.tiers.length ? h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Draft plans" }, h("table", null,
          h("thead", null, h("tr", null, ["Plan", "Tokens a month", "Draft price", "Status", ""].map(c => h("th", { scope: "col", text: c })))),
          h("tbody", null, b.tiers.map(t => h("tr", null, h("td", { text: t.name }), h("td", { class: "num", text: fmtN.format(t.monthlyTokens) }), h("td", { class: "num", text: (t.priceMinor / 100).toFixed(2) + " " + t.currency }), h("td", null, badge("idle", "Draft")),
            h("td", null, h("div", { class: "row" }, h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: money(t.name) }, icon("i-lock", "sm"), "Activate…"), h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Delete", "aria-label": "Delete plan " + t.name, onclick: () => store.deleteTier(t.id).then(nb => box.replaceChildren(render(nb)), e => toast("error", e.message)) })))))))) : h("p", { class: "muted t-sm", text: "No draft plans yet." }),
        h("div", { class: "member-add" }, h("div", { class: "field" }, h("label", { htmlFor: "f-tname", text: "Plan name" }), name), h("div", { class: "field" }, h("label", { htmlFor: "f-ttok", text: "Tokens a month" }), toks), h("div", { class: "field" }, h("label", { htmlFor: "f-tprice", text: "Draft price (cents)" }), price), save),
        h("div", { class: "row" }, h("button", { class: "btn btn-secondary", type: "button", onclick: money("billing") }, icon("i-lock", "sm"), "Turn on billing…")),
        h("h3", { class: "t-sm", text: "Token ledger" }),
        b.ledger.recent.length ? h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Token ledger" }, h("table", null,
          h("thead", null, h("tr", null, ["When", "Engine", "Tokens", "Cost"].map(c => h("th", { scope: "col", text: c })))),
          h("tbody", null, b.ledger.recent.map(l => h("tr", null, h("td", null, timeEl(typeof l.at === "number" ? l.at : Date.parse(l.at))), h("td", { class: "mono t-caption", text: l.engine + (l.model ? " · " + l.model : "") }), h("td", { class: "num", text: fmtN.format(l.tokens) }), h("td", { class: "num", text: "0" })))))) : h("p", { class: "muted t-sm", text: "Nothing used yet." }));
    };
    loadInto(box, () => store.billing(), render);
    return box;
  }

  /* ── Studio (S13): live builder in a sandboxed frame ─────────── */
  // The clean-room extractor: jarvis/server/lib/clean-clone.mjs, inlined by the build (pure functions,
  // no network), so pasted HTML is extracted in the page exactly as the server does it.
  const CleanRoom = (() => {
    /*@CLEAN_CLONE@*/
    return { cleanClone };
  })();
  // The fixed rules around the local model (jarvis/server/lib/llm-plan.mjs, inlined by the build):
  // sample mode plans with them, and live mode gets the same locks from the server.
  const LlmPlan = (() => {
    /*@LLM_PLAN@*/
    /*@WORKFLOW_GRAPH@*/
    /*@MEMORY_LIBS@*/
    /*@COUNCIL_LIBS@*/
    return { fallbackPlan, enforceApprovalGates, lockCategory, checkGraph, graphToSteps, starterGraph, nodeLocked, WF_TOOLS, WF_CHECKS, WF_CATEGORIES, bm25, tokenize, forgeSkill, readSkillMd, scanFiles, selfCheckItem, auditSkill, slugName, stepsFromMission, LOADER_RULES, MODEL_PROFILES, ROLE_LABEL,
      runCouncil, snapshotOf, snapshotHash, canonical, lineDiff, prettyLines, blockDiff, uxReport,
      planMachine, provePlan, exportSql, exportTokens, exportComponent, exportSpec, slugOf,
      analyse, lttb, leafHash, frontierPush, frontierRoot, inclusionPath, verifyInclusion, auditEntry, EMPTY_ROOT, AUDITED,
      scrub, layer, LOCK_CONSTRAINTS, SSRF_PROBES, isBlockedAddress };
  })();
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
    const save = () => { const text = JSON.stringify(site); store$.set("jarvis-studio-v1", text); syncSend({ type: "studio", site: text }); };
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
      heat.style.width = frame.style.width; heat.style.height = frame.style.height; heat.style.transform = frame.style.transform;
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
    const changed = () => { save(); push(); checkContrast(); reHeat(); renderExportInfo(); };

    const nameIn = h("input", { class: "input", id: "f-site", name: "site-name", autocomplete: "off", value: site.name, maxLength: 80 });
    nameIn.addEventListener("input", () => { site.name = nameIn.value; changed(); });
    const langSeg = seg("Preview language", [["en", "EN · LTR"], ["ar", "AR · RTL", { lang: "ar" }]], site.lang, v => { site.lang = v; changed(); renderBlocks(); });
    const widthSeg = seg("Preview width", [[375, "Phone 375"], [768, "Tablet 768"], [1440, "Laptop 1440"]], site.width, v => { site.width = v; save(); fit(); reHeat(); });
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

    const saveText = (name, text, type) => {
      const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], { type }));
      const a = h("a", { href: url, download: name, hidden: true });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const pageHtml = () => {
      const p = DATA.preview || {};
      const csp = p.cssHash && p.jsHash ? "default-src 'none'; script-src '" + p.jsHash + "'; style-src '" + p.cssHash + "'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'; object-src 'none'" : null;
      return siteHtml(site, csp);
    };
    const download = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-download", "sm"), "Download HTML");
    download.addEventListener("click", () => {
      saveText((site.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site") + ".html", pageHtml(), "text/html");
      toast("ok", "Saved a single HTML file with its fonts and a strict CSP. Nothing was published.");
    });
    // ADR-145: five files from one site. Each is written in this browser; nothing is sent or run.
    const exportInfo = h("div", { class: "stack", "aria-live": "polite" });
    const tokensOf = () => LlmPlan.exportTokens(site, (a, b) => { const x = C.rgb(a), y = C.rgb(b); return { ratio: C.ratio(x, y), apca: C.apca(x, y) }; });
    const EXPORTS = [
      ["HTML page", ".html", "text/html", () => pageHtml()],
      ["Web Component", ".mjs", "text/javascript", () => LlmPlan.exportComponent(site, PV_CSS)],
      ["Design tokens", ".tokens.json", "application/json", () => JSON.stringify(tokensOf(), null, 2) + "\n"],
      ["SQL schema", ".sql", "text/plain", () => LlmPlan.exportSql(site).sql],
      ["Three-size test", ".spec.mjs", "text/javascript", () => LlmPlan.exportSpec(site)],
    ];
    const exportBtns = EXPORTS.map(([label, ext, type, make]) => h("button", { class: "btn btn-secondary btn-sm", type: "button", dataset: { export: ext },
      onclick: () => { saveText(LlmPlan.slugOf(site.name) + ext, make(), type); toast("ok", "Saved " + LlmPlan.slugOf(site.name) + ext + ". Nothing was published."); store.auditRecord("export." + ext.split(".")[1], LlmPlan.slugOf(site.name) + ext).catch(() => {}); } }, icon("i-download", "sm"), label));
    // ADR-149: a template as gzip, compressed and read back in this browser (CompressionStream), no library.
    // Import is capped at 1 MB compressed and 2 MB unpacked, and every field is checked before use.
    const gzOut = h("button", { class: "btn btn-secondary btn-sm", type: "button" }, icon("i-download", "sm"), "Template (.json.gz)");
    gzOut.addEventListener("click", async () => {
      if (typeof CompressionStream !== "function") { toast("error", "This browser cannot compress files."); return; }
      const json = JSON.stringify({ format: "jarvis-studio-template-v1", savedAt: new Date().toISOString(), site: LlmPlan.snapshotOf(site) });
      const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
      saveText(LlmPlan.slugOf(site.name) + ".json.gz", gz, "application/gzip");
      toast("ok", "Saved the template compressed: " + Math.ceil(json.length / 1024) + " KB to " + Math.ceil(gz.size / 1024) + " KB.");
    });
    const gzIn = h("input", { class: "input", type: "file", id: "f-gz", name: "template-gz", accept: ".gz,application/gzip", "aria-describedby": "h-gz" });
    const cleanText = v => (typeof v === "string" ? v.slice(0, 400) : "");
    const cleanSite = t => {
      if (!t || t.format !== "jarvis-studio-template-v1" || !t.site || !Array.isArray(t.site.blocks)) throw new Error("This is not a Jarvis Studio template.");
      const theme = {};
      for (const [k, v] of Object.entries(t.site.theme || {})) if (PRESETS.night[k] !== undefined && /^#[0-9a-fA-F]{6}$/.test(v)) theme[k] = v;
      const blocks = t.site.blocks.filter(b => b && BLOCK_NAMES[b.type]).slice(0, 20).map((b, i) => ({ id: /^[\w-]{1,40}$/.test(b.id) ? b.id : "b-" + i, type: b.type, on: b.on !== false,
        t: Object.fromEntries(["en", "ar"].map(l => [l, Object.fromEntries(Object.entries((b.t && b.t[l]) || {}).filter(([k]) => /^[a-z0-9]{1,12}$/.test(k)).map(([k, v]) => [k, cleanText(v)]))])) }));
      return { v: 1, name: cleanText(t.site.name).slice(0, 80) || "Imported template", lang: t.site.lang === "ar" ? "ar" : "en", width: [375, 768, 1440].includes(t.site.width) ? t.site.width : 1440,
        preset: "custom", theme: { ...PRESETS.night, ...theme }, blocks };
    };
    gzIn.addEventListener("change", async () => {
      const f = gzIn.files && gzIn.files[0];
      gzIn.value = "";
      if (!f) return;
      try {
        if (typeof DecompressionStream !== "function") throw new Error("This browser cannot read compressed files.");
        if (f.size > 1024 * 1024) throw new Error("The file is larger than 1 MB.");
        const reader = f.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
        const parts = [];
        let size = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("The template is larger than 2 MB unpacked."); }
          parts.push(value);
        }
        const text = new TextDecoder().decode(await new Blob(parts).arrayBuffer());
        site = cleanSite(JSON.parse(text));
        delete site.theme.label;
        save(); toast("ok", "Imported “" + site.name + "”: " + plural(site.blocks.length, "section") + ".");
        route();
      } catch (e) { toast("error", e instanceof SyntaxError ? "The file is not valid JSON inside the gzip." : e.message); }
    });

    const renderExportInfo = () => {
      const sq = LlmPlan.exportSql(site), tk = tokensOf().$extensions["jarvis.contrast"].checks;
      exportInfo.replaceChildren(
        h("p", { class: "t-caption muted" }, "SQL: " + plural(sq.tables.length, "table") + " inferred ", h("span", { class: "tag-inf", text: "[INFERENCE]" })),
        h("ul", { class: "row diff-blocks", "aria-label": "Tables that start locked" }, sq.locked.map(t => h("li", { class: "badge s-pending" }, icon("i-lock", "sm"), h("span", { translate: "no", text: t })))),
        h("p", { class: "t-caption muted", text: "Tokens: " + tk.filter(c => c.pass).length + " of " + tk.length + " text pairs pass WCAG 4.5 and APCA 60." }));
    };
    const publish = h("button", { class: "btn btn-ghost", type: "button" }, icon("i-lock", "sm"), "Publish…");
    publish.addEventListener("click", e => openDialog("Publishing is locked", lockedCard({ id: "pub", category: "publish", action: "Publish “" + site.name + "” to an outside domain", createdAt: Date.now() }),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Close", onclick: closeDialog })], e.currentTarget));
    const resetBtn = h("button", { class: "btn btn-ghost", type: "button", text: "Start over…" });
    resetBtn.addEventListener("click", e => openDialog("Start the site over?", h("p", { class: "muted t-sm", text: "Sections, text and colours go back to the starting sample." }),
      [h("button", { class: "btn btn-secondary", type: "button", text: "Keep my site", onclick: closeDialog }), h("button", { class: "btn btn-danger", type: "button", text: "Start over", onclick: () => { site = defaultSite(); save(); closeDialog(); route(); } })], e.currentTarget));

    // Clean-room clone: the local server reads one public page (or pasted HTML), keeps only its layout,
    // and returns blocks filled with our own copy. Publishing stays locked.
    const cloneUrl = h("input", { class: "input mono", id: "f-clone-url", name: "clone-url", type: "url", autocomplete: "off", placeholder: "https://example.com/", "aria-describedby": "h-clone" });
    const cloneHtml = h("textarea", { class: "textarea code", translate: "no", id: "f-clone-html", name: "clone-html", autocomplete: "off", spellcheck: false, rows: 5, placeholder: "<!doctype html>…" });
    const report = h("div", { class: "report", "aria-live": "polite" });
    const live = store.mode === "live";
    const cloneBtn = h("button", { class: "btn btn-primary", type: "button" }, icon("i-copy", "sm"), "Clean-room clone");
    if (PENDING_CLONE) { cloneUrl.value = PENDING_CLONE; PENDING_CLONE = null; setTimeout(() => { if (cloneBtn.isConnected) cloneBtn.click(); }, 0); }
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
        // The template wears our design system, never the source's: Jarvis night tokens (accent #77bcff),
        // the glass bar (blur 16, saturate 180) and Readex Pro, Inter and Geist Mono from the preview runtime.
        site.theme = { ...PRESETS.night }; delete site.theme.label; site.preset = "night"; presetSel.value = "night"; renderColors();
        changed(); renderBlocks();
        const r = out.report, d = r.dropped;
        report.replaceChildren(h("dl", null,
          h("dt", { text: "Source" }), h("dd", { class: "mono", translate: "no", text: r.source + (r.fetch ? " · robots: " + r.fetch.robots : "") }),
          h("dt", { text: "Kept" }), h("dd", { text: r.kept }),
          h("dt", { text: "Sections" }), h("dd", { text: r.sections.join(" · ") }),
          h("dt", { text: "Dropped" }), h("dd", { text: [plural(d.scripts, "script") + " (" + plural(d.trackers, "tracker") + ")", plural(d.stylesheets, "stylesheet"), plural(d.images, "image"), plural(d.frames, "frame"), plural(d.textCharacters, "character") + " of their text"].join(", ") }),
          h("dt", { text: "Sweep" }), h("dd", null, r.sweep.leaks ? badge("failed", r.sweep.leaks + " possible leaks: " + r.sweep.leaked.join(", ")) : badge("ok", "0 leaks · " + plural(r.sweep.brandTermsChecked, "brand term") + " and " + plural(r.sweep.sourcePhrasesChecked, "phrase") + " checked"))));
        toast("ok", "Extracted " + out.blocks.length + " sections into a clean template in the Jarvis design system. Nothing of the source was kept.");
      } catch (e) {
        report.replaceChildren(h("p", { class: "err" }, icon("i-alert", "sm"), e.message));
        toast("error", e.message);
      } finally { cloneBtn.disabled = false; cloneBtn.removeAttribute("aria-busy"); }
    });
    // Design from a description: the local model drafts HTML on the server, and only its layout survives
    // the same clean-room extractor; with no model the fixed rules give a starting page.
    const designIn = h("input", { class: "input", id: "f-design", name: "design-prompt", autocomplete: "off", maxLength: 400, dir: "auto", placeholder: "A pricing page with three plans and questions" });
    const designBtn = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-run", "sm"), "Design with local model");
    designBtn.addEventListener("click", async () => {
      if (!designIn.value.trim()) { toast("warn", "Describe the page first."); designIn.focus(); return; }
      designBtn.disabled = true; designBtn.setAttribute("aria-busy", "true"); designIn.setAttribute("aria-busy", "true");
      try {
        const out = await store.llmRun({ mode: "design", prompt: designIn.value, lang: site.lang });
        site.blocks = out.blocks.map(b => ({ id: b.id, type: b.type, on: true, t: b.t, cols: b.cols || null, rows: b.rows || null }));
        site.theme = { ...PRESETS.night }; delete site.theme.label; site.preset = "night"; presetSel.value = "night"; renderColors();
        changed(); renderBlocks();
        report.replaceChildren(h("dl", null,
          h("dt", { text: "Engine" }), h("dd", null, out.engine === "ollama-local-loopback" ? h("code", { translate: "no", text: out.model }) : "fixed rules (no model)", " ", h("span", { class: "tag-inf", text: out.label })),
          h("dt", { text: "Sections" }), h("dd", { text: out.report.sections.join(" · ") }),
          h("dt", { text: "Sweep" }), h("dd", null, badge(out.report.sweep.leaks ? "failed" : "ok", out.report.sweep.leaks ? out.report.sweep.leaks + " possible leaks" : "0 leaks: only the layout was kept")),
          out.thinking ? h("dt", { text: "Thinking" }) : null, out.thinking ? h("dd", null, h("details", { class: "think" }, h("summary", { text: "Show (untrusted model text)" }), h("pre", { class: "log", dir: "auto", text: out.thinking }))) : null));
        toast("ok", out.engine === "ollama-local-loopback" ? "Designed by the local model; only the layout was kept." : (out.warning || "Designed by the fixed rules."));
      } catch (e) { toast("error", e.message); }
      finally { designBtn.disabled = false; designBtn.removeAttribute("aria-busy"); designIn.removeAttribute("aria-busy"); }
    });
    const clonePanel = h("section", { class: "panel clone-bar", "aria-labelledby": "h-clone-t" }, h("h2", { id: "h-clone-t", text: "Clean-room template extractor" }),
      h("div", { class: "clone-row" }, h("div", { class: "field" }, h("label", { htmlFor: "f-design", text: "Describe a page" }), designIn), designBtn),
      h("div", { class: "clone-row" }, h("div", { class: "field" }, h("label", { htmlFor: "f-clone-url", text: "Page address" }), cloneUrl), cloneBtn),
      h("details", null, h("summary", { text: "Or paste HTML" }), h("div", { class: "field" }, h("label", { htmlFor: "f-clone-html", text: "HTML" }), cloneHtml)),
      h("p", { class: "hint", id: "h-clone", text: live
        ? "Keeps only the layout (sections, card counts, table shapes). Text, images, colours, scripts and trackers are dropped and replaced with our own copy in English and Arabic. One request; robots.txt is respected."
        : "Pasted HTML is extracted right here, with no network. Reading an address needs the local server: node jarvis/server/server.mjs, then open http://127.0.0.1:8798." }),
      h("ul", { class: "row ds-line", "aria-label": "Design system applied to the template" }, ["OKLCH tokens", "accent #77bcff", "glass blur 16 · saturate 180", "Readex Pro · Inter · Geist Mono", "EN LTR · AR RTL"].map(t => h("li", { class: "badge", translate: "no", text: t }))),
      report);

    // ADR-144: UX heatmap. The sandboxed preview measures its own boxes (sizes and positions only) in this
    // language and in the mirrored one; ux-physics.mjs scores Fitts, Hick and symmetry and draws the weights.
    // An SVG element has no hidden property, so the attribute is set (and [hidden] hides it in the CSS).
    const heat = svg("svg", { class: "heat", "aria-hidden": "true", focusable: "false", hidden: "" });
    stage.append(heat);
    const uxBox = h("div", { class: "ux-report", "aria-live": "polite" });
    uxBox.hidden = true;
    let measureReq = 0, heatOn = false, heatTimer = null;
    const pending = new Map();
    const onBoxes = e => {
      if (!stage.isConnected) { window.removeEventListener("message", onBoxes); return; }
      if (e.source !== frame.contentWindow || !e.data || e.data.type !== "jarvis-boxes") return;
      const done = pending.get(e.data.req);
      if (done) { pending.delete(e.data.req); done(e.data); }
    };
    window.addEventListener("message", onBoxes);
    const ask = () => new Promise((res, rej) => {
      const id = ++measureReq;
      pending.set(id, res);
      frame.contentWindow.postMessage({ type: "jarvis-measure", req: id }, "*");
      setTimeout(() => { if (pending.delete(id)) rej(new Error("The preview did not answer the measure request.")); }, 2000);
    });
    const sendSite = x => frame.contentWindow.postMessage(JSON.parse(JSON.stringify({ name: x.name, lang: x.lang, theme: x.theme, blocks: x.blocks })), "*");
    async function runHeat() {
      if (!ready || !heatOn) return;
      const here = await ask();
      sendSite({ ...site, lang: site.lang === "ar" ? "en" : "ar" });
      const other = await ask();
      push();
      const ltr = here.dir === "rtl" ? other : here, rtl = here.dir === "rtl" ? here : other;
      const rep = LlmPlan.uxReport(here.boxes, here.vw, here.vh, null);
      rep.symmetry = LlmPlan.uxReport(ltr.boxes, ltr.vw, ltr.vh, rtl.boxes).symmetry;
      const g = rep.heat, cw = here.vw / g.cols, ch = here.vh / g.rows;
      heat.setAttribute("viewBox", "0 0 " + here.vw + " " + here.vh);
      const cells = [];
      g.grid.forEach((row, r) => row.forEach((v, c) => { if (v > 0.04) cells.push(svg("rect", { class: "hc", x: (c * cw).toFixed(1), y: (r * ch).toFixed(1), width: cw.toFixed(1), height: ch.toFixed(1), "fill-opacity": (v * 0.55).toFixed(2) })); }));
      const small = rep.fitts.targets.filter(t => t.small).map(t => here.boxes.find(b => b.id === t.id)).filter(Boolean);
      heat.replaceChildren(...cells, ...small.map(b => svg("rect", { class: "hsmall", x: b.x.toFixed(1), y: b.y.toFixed(1), width: b.w.toFixed(1), height: b.h.toFixed(1), rx: 4 })));
      heat.removeAttribute("hidden");
      const worst = rep.hick.groups[0];
      uxBox.replaceChildren(h("dl", null,
        h("dt", { text: "Fitts" }), h("dd", null, h("span", { class: "num", text: rep.fitts.score + " / 100" }), " · " + rep.fitts.small + " of " + rep.fitts.targets.length + " targets under 44 × 44 px · mean " + rep.fitts.meanId + " bits"),
        h("dt", { text: "Hick" }), h("dd", null, worst ? h("span", { class: "num", text: worst.rt.toFixed(3) + " s" }) : "No group of choices", worst ? " for the largest group (" + worst.n + " choices)" + (rep.hick.over ? " · " + rep.hick.over + " over 7" : "") + " " : " ", h("span", { class: "tag-inf", text: "[INFERENCE]" })),
        h("dt", { text: "Mirror" }), h("dd", null, h("span", { class: "num", text: rep.symmetry.score + "%" }), " symmetry between English and Arabic over " + rep.symmetry.pairs + " pairs"),
        h("dt", { text: "Heat" }), h("dd", null, "Actions 1.0, headings 0.8 to 0.5, images 0.6, text 0.25; lifted near the thumb on a phone ", h("span", { class: "tag-inf", text: "[INFERENCE]" }))));
      uxBox.hidden = false;
    }
    const heatBtn = h("button", { class: "btn btn-secondary btn-sm", type: "button", "aria-pressed": "false" }, icon("i-chart", "sm"), "UX heatmap");
    heatBtn.addEventListener("click", () => {
      heatOn = !heatOn;
      heatBtn.setAttribute("aria-pressed", String(heatOn));
      if (!heatOn) { heat.setAttribute("hidden", ""); uxBox.hidden = true; return; }
      runHeat().catch(e => toast("error", e.message));
    });
    const reHeat = () => { if (!heatOn) return; clearTimeout(heatTimer); heatTimer = setTimeout(() => runHeat().catch(() => {}), 400); };

    // ADR-144: the time machine. Each saved state is chained by SHA-256 to the one before; a diff shows two
    // states side by side, and a fork brings an old state back as a new snapshot at the end of the chain.
    const snapLabel = h("input", { class: "input", id: "f-snap-label", name: "snapshot-label", autocomplete: "off", maxLength: 80, dir: "auto", placeholder: "Before the new hero" });
    const saveSnap = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-check", "sm"), "Save snapshot");
    const snapList = h("ol", { class: "snaps", "aria-label": "Snapshots, newest first" });
    const fromSel = h("select", { class: "select", id: "f-snap-a", name: "snapshot-from", autocomplete: "off" });
    const toSel = h("select", { class: "select", id: "f-snap-b", name: "snapshot-to", autocomplete: "off" });
    const cmpBtn = h("button", { class: "btn btn-secondary", type: "button", text: "Compare" });
    const forkBtn = h("button", { class: "btn btn-ghost", type: "button", text: "Fork snapshot" });
    const chainBadge = h("span", { class: "badge s-idle", text: "No snapshots yet" });
    const diffBox = h("div", { class: "stack", "aria-live": "polite" });
    const short = x => x.slice(0, 10) + "…";
    async function loadSnaps() {
      const [list, ver] = await Promise.all([store.studioSnapshots(), store.studioVerify()]);
      snapList.replaceChildren(...list.slice(0, 12).map(x => h("li", null,
        h("span", { class: "num", text: "#" + x.seq }), " ", h("b", { dir: "auto", translate: "no", text: x.label }),
        h("span", { class: "t-caption subtle" }, " · ", h("code", { translate: "no", text: short(x.hash) }), " · " + plural(x.blocks, "section") + (x.parentId ? " · fork of #" + ((list.find(y => y.id === x.parentId) || {}).seq || "?") : "")))));
      const opts = () => list.map(x => h("option", { value: x.id, translate: "no", text: "#" + x.seq + " " + x.label }));
      fromSel.replaceChildren(...opts()); toSel.replaceChildren(...opts());
      if (list[1]) fromSel.value = list[1].id;
      if (list[0]) toSel.value = list[0].id;
      cmpBtn.disabled = list.length < 2; forkBtn.disabled = !list.length;
      chainBadge.className = "badge " + (!ver.count ? "s-idle" : ver.ok ? "s-ok" : "s-failed");
      chainBadge.replaceChildren(h("span", { class: "dot", "aria-hidden": "true" }), !ver.count ? "No snapshots yet" : ver.ok ? "Chain verified · " + plural(ver.count, "snapshot") : "Chain broken at #" + ver.brokenAt + ": " + ver.reason);
    }
    saveSnap.addEventListener("click", async () => {
      saveSnap.disabled = true;
      try {
        const r = await store.studioSave({ site, label: snapLabel.value.trim() || "Saved" });
        toast("ok", r.unchanged ? "Nothing changed since snapshot #" + r.seq + "." : "Saved snapshot #" + r.seq + " · " + short(r.hash));
        snapLabel.value = "";
        await loadSnaps();
      } catch (e) { toast("error", e.message); } finally { saveSnap.disabled = false; }
    });
    function sideBySide(lines) {
      const rows = [];
      for (let i = 0; i < lines.length;) {
        if (lines[i].op === "same") { rows.push([lines[i], lines[i]]); i++; continue; }
        const dels = [], adds = [];
        while (i < lines.length && lines[i].op !== "same") (lines[i].op === "del" ? dels : adds).push(lines[i++]);
        for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push([dels[k] || null, adds[k] || null]);
      }
      const near = rows.map((r, i) => rows.slice(Math.max(0, i - 2), i + 3).some(([a, b]) => !(a && b && a.op === "same")));
      const out = [];
      let gap = 0;
      rows.forEach((r, i) => {
        if (!near[i]) { gap++; return; }
        if (gap) { out.push(h("tr", { class: "d-gap" }, h("td", { colspan: 4, text: "⋯ " + plural(gap, "unchanged line") }))); gap = 0; }
        const cell = (x, side) => x ? [h("td", { class: "num subtle", text: String(side === "a" ? x.a : x.b) }), h("td", { class: "d-" + x.op, translate: "no", text: x.text })] : [h("td"), h("td", { class: "d-none" })];
        out.push(h("tr", null, ...cell(r[0], "a"), ...cell(r[1], "b")));
      });
      if (gap) out.push(h("tr", { class: "d-gap" }, h("td", { colspan: 4, text: "⋯ " + plural(gap, "unchanged line") })));
      return out.slice(0, 300);
    }
    cmpBtn.addEventListener("click", async () => {
      try {
        const d = await store.studioDiff(fromSel.value, toSel.value);
        const CH = { added: "ok", removed: "failed", changed: "warn", moved: "idle" };
        diffBox.replaceChildren(
          h("p", { class: "t-sm" }, "From #" + d.a.seq + " to #" + d.b.seq + ": ", h("span", { class: "num", text: "+" + d.added + " −" + d.removed }), " lines"),
          d.blocks.length ? h("ul", { class: "row diff-blocks", "aria-label": "Sections that changed" }, d.blocks.map(b => h("li", null, badge(CH[b.change], b.change + " · " + (BLOCK_NAMES[b.type] || b.type) + (b.at ? " " + b.at[0] + " → " + b.at[1] : ""))))) : h("p", { class: "muted t-sm", text: "The sections are the same." }),
          h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Side-by-side diff" },
            h("table", { class: "sbs" }, h("thead", null, h("tr", null, h("th", { colspan: 2, translate: "no", text: "#" + d.a.seq + " " + d.a.label }), h("th", { colspan: 2, translate: "no", text: "#" + d.b.seq + " " + d.b.label }))), h("tbody", null, sideBySide(d.lines)))));
      } catch (e) { toast("error", e.message); }
    });
    forkBtn.addEventListener("click", async () => {
      try {
        const f = await store.studioFork(fromSel.value);
        site = { ...site, ...f.site, v: 1, theme: { ...(f.site.theme || site.theme) }, preset: "custom" };
        save(); toast("ok", "Forked into snapshot #" + f.seq + ". The Studio now shows it.");
        route();
      } catch (e) { toast("error", e.message); }
    });
    const timePanel = h("section", { class: "panel", "aria-labelledby": "h-time" }, h("h2", { id: "h-time", text: "Time machine" }),
      h("div", { class: "clone-row" }, h("div", { class: "field" }, h("label", { htmlFor: "f-snap-label", text: "Snapshot name" }), snapLabel), saveSnap),
      h("div", { class: "row" }, chainBadge), snapList,
      h("div", { class: "snap-pick" }, h("div", { class: "field" }, h("label", { htmlFor: "f-snap-a", text: "From" }), fromSel), h("div", { class: "field" }, h("label", { htmlFor: "f-snap-b", text: "To" }), toSel)),
      h("div", { class: "row" }, cmpBtn, forkBtn),
      h("p", { class: "hint", text: "Each snapshot's SHA-256 covers the site and the hash before it, so an edit to history shows. A fork adds a new snapshot; nothing old is changed." }),
      diffBox);
    loadSnaps().catch(e => toast("error", e.message));

    renderColors(); renderBlocks(); checkContrast(); renderExportInfo();
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
          h("section", { class: "panel", "aria-labelledby": "h-out" }, h("h2", { id: "h-out", text: "Output" }), h("div", { class: "row" }, download, publish, resetBtn),
            h("h3", { class: "t-sm", text: "Export 5 files" }), h("div", { class: "row" }, exportBtns), exportInfo,
            h("h3", { class: "t-sm", text: "Compressed template" }), h("div", { class: "row" }, gzOut),
            h("div", { class: "field" }, h("label", { htmlFor: "f-gz", text: "Import a template (.json.gz)" }), gzIn, h("span", { class: "hint", id: "h-gz", text: "Compressed and read in this browser; nothing is uploaded." })),
            h("p", { class: "hint", text: "Payments, publishing and permissions tables start at pending_approval, and a check refuses approval without a person and a time." })),
          timePanel),
        h("div", { class: "preview-col" },
          h("div", { class: "preview-bar" }, widthSeg, h("div", { class: "row" }, heatBtn, liveBadge, widthNote)),
          stage, uxBox)));
  };

  /* ── Skill Mixer (S14) ─────────────────────────────────────── */
  const SOURCE_LABEL = { project: "Project", reviewed: "Reviewed third-party", vendored: "Vendored reference", forged: "Forged in this workspace", loaded: "Loaded in this workspace" };
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
          s.description ? h("p", { lang: "en", dir: "ltr", translate: "no", text: s.description }) : h("p", { text: "No description." }),
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

    const editor = h("textarea", { class: "textarea code", translate: "no", id: "f-skillmd", name: "skill-md", autocomplete: "off", spellcheck: false, placeholder: "---\nname: my-skill\ndescription: What it does and when to use it.\n---\n\n# my-skill\n\nSteps…" });
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
    const asRow = source => f => ({ name: f.name, description: f.description, source, findings: { critical: f.scan.critical, high: f.scan.high, medium: f.scan.medium, low: f.scan.low }, review: "" });
    const forgePanel = skillForge(editor, e => store.listRuntime().catch(() => []).then(rt => { skills.length = 0; skills.push(...(DATA.skills || []), ...e.map(asRow("forged")), ...rt.map(asRow("loaded"))); renderList(); renderMix(); }));
    if (PENDING_SKILL_Q) { q.value = PENDING_SKILL_Q; PENDING_SKILL_Q = null; }
    return h("div", { class: "stack" },
      pageHead("Skill Mixer", "The skills installed in this repo, with their SkillSpector status. Mix them into a plan for Claude Code."),
      h("p", { class: "sample-note" }, icon("i-alert", "sm"), scan ? "Real data from the repo, scanned " + fmtDate.format(new Date(scan.generated)) + " at build time (" + skills.length + " skills, " + scan.summary.critical + " critical, " + scan.summary.high + " high)." : "No scan in this build."),
      forgePanel,
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

  /* ── Skill Forge (ADR-138): write or paste a skill, scan it with SkillSpector's rules, mount it in
     this workspace. Writing it into .claude/skills is an install: a locked approval. ── */
  function skillForge(editor, onList) {
    const name = h("input", { class: "input mono", id: "f-fname", name: "forge-name", autocomplete: "off", maxLength: 41, placeholder: "token-checker", translate: "no" });
    const desc = h("textarea", { class: "textarea", id: "f-fdesc", name: "forge-description", autocomplete: "off", rows: 3, maxLength: 300, placeholder: "Checks that every colour in a stylesheet comes from the token file." });
    const kind = h("select", { class: "select", id: "f-fkind", name: "forge-kind", autocomplete: "off" }, h("option", { value: "checklist", text: "Checklist (SKILL.md only)" }), h("option", { value: "python-tool", text: "Python tool (standard library)" }));
    const result = h("div", { class: "stack", "aria-live": "polite" });
    const mounted = h("div", { class: "stack" });
    const showScan = (r, from) => {
      const s = r.scan;
      result.replaceChildren(...[h("div", { class: "row" }, r.mounted ? badge("ok", "Mounted in this workspace") : badge("failed", "Refused: " + s.critical + " critical, " + s.high + " high"),
          h("span", { class: "subtle t-caption num", text: s.findings.length + " findings · " + Object.keys((r.skill && r.skill.files) || {}).length + " files" })),
        s.findings.length ? h("ul", { class: "checks" }, s.findings.slice(0, 8).map(f => h("li", { class: f.sev === "critical" || f.sev === "high" ? "fail" : "warn" }, h("span", { class: "mark", "aria-hidden": "true", text: f.sev === "critical" || f.sev === "high" ? "✕" : "!" }),
          h("span", null, h("span", { class: "mono t-caption", translate: "no", text: f.file + ":" + f.line + " " + f.rule + " " }), f.msg)))) : null].filter(Boolean));
      if (r.mounted) toast("ok", "Mounted " + r.skill.name + ". It is in the Skill Mixer and the agent editor now.");
      else toast("error", "Not mounted: SkillSpector found a critical or high problem.");
      if (from && from.isConnected) from.focus();
    };
    const reload = () => store.listForged().then(list => {
      onList(list);
      mounted.replaceChildren(list.length ? h("ul", { class: "feed" }, list.map(f => h("li", { class: "forged" },
        h("div", { class: "stack" }, h("b", { class: "mono", translate: "no", text: f.name }), h("span", { class: "t-caption", dir: "auto", translate: "no", text: f.description }),
          h("span", { class: "row" }, findingsBadge({ critical: f.scan.critical, high: f.scan.high, medium: f.scan.medium, low: f.scan.low }), h("span", { class: "badge", text: f.kind === "python-tool" ? "Python tool" : f.kind === "pasted" ? "Pasted" : "Checklist" }),
            f.approvalId ? h("span", { class: "badge s-locked" }, icon("i-lock", "sm"), h("bdi", { lang: "ar", dir: "rtl", text: "قيد الموافقة" })) : null)),
        h("div", { class: "row" },
          h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: e => { const from = e.currentTarget; store.installSkill(f.id).then(r => { openDialog("Installing a skill is locked", lockedCard({ id: r.approvalId, category: "install", action: "Install the forged skill “" + f.name + "” into .claude/skills", createdAt: Date.now() }), [h("a", { class: "btn btn-secondary", href: "#/approvals", text: "Open approvals", onclick: closeDialog }), h("button", { class: "btn btn-primary", type: "button", text: "Close", onclick: closeDialog })], from); updateCount(); reload(); }, err => toast("error", err.message)); } }, icon("i-lock", "sm"), "Install into the repo…"),
          h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Unmount", onclick: () => store.unmountSkill(f.id).then(() => { toast("ok", "Unmounted " + f.name + "."); reload(); }, err => toast("error", err.message)) }))))) : h("p", { class: "muted t-sm", text: "No forged skill mounted yet." }));
    }, err => mounted.replaceChildren(errorBox(err, reload)));
    const forgeBtn = h("button", { class: "btn btn-primary", type: "button" }, icon("i-plus", "sm"), "Forge and mount");
    forgeBtn.addEventListener("click", e => { const from = e.currentTarget; store.forge({ name: name.value, description: desc.value, kind: kind.value }).then(r => { showScan(r, from); if (r.mounted) { name.value = ""; desc.value = ""; } reload(); }, err => toast("error", err.message)); });
    const pasteBtn = h("button", { class: "btn btn-secondary", type: "button", text: "Mount the SKILL.md below" });
    pasteBtn.addEventListener("click", e => {
      if (!editor.value.trim()) { toast("warn", "Write or paste a SKILL.md first."); editor.focus(); return; }
      const from = e.currentTarget; store.forge({ skillMd: editor.value }).then(r => { showScan(r, from); reload(); }, err => toast("error", err.message));
    });
    reload();
    return h("section", { class: "panel forge", "aria-labelledby": "h-forge" }, h("h2", { id: "h-forge", text: "Skill Forge" }),
      h("div", { class: "forge-grid" }, h("div", { class: "stack" },
      h("p", { class: "t-sm", text: "Write a skill from a sentence, or mount the SKILL.md below. Every file is scanned with SkillSpector's rules; a critical or high finding is refused. Mounted skills live in this workspace only. Nothing written here runs." }),
      h("div", { class: "grid-2" }, h("div", { class: "field" }, h("label", { htmlFor: "f-fname", text: "Name" }), name), h("div", { class: "field" }, h("label", { htmlFor: "f-fkind", text: "Kind" }), kind)),
      h("div", { class: "field" }, h("label", { htmlFor: "f-fdesc", text: "What it does" }), desc),
      h("div", { class: "row" }, forgeBtn, pasteBtn), result),
      h("div", { class: "stack" }, h("h3", { text: "Mounted in this workspace" }), mounted)));
  }

  /* ── Live open-web search (ADR-139): official keyless JSON APIs through the local server ── */
  const SEARCH_LABEL = { "wikipedia-en": "Wikipedia (English)", "wikipedia-ar": "Wikipedia (العربية)", openalex: "OpenAlex", hn: "Hacker News (Algolia)", github: "GitHub", npm: "npm registry", pypi: "PyPI", osv: "OSV.dev", searxng: "SearXNG (JSON)" };
  const safeUrl = u => { try { const x = new URL(String(u)); return x.protocol === "https:" && !x.username && !x.password ? x.href : null; } catch (e) { return null; } };
  let PENDING_CLONE = null;
  const SEARCH_MODES = [
    ["web", "🌐", "Open web", "Wikipedia in Arabic and English, OpenAlex papers, Hacker News and GitHub, plus your SearXNG if you set one.", "breadth first search"],
    ["packages", "📦", "Packages and code", "npm and GitHub search, and PyPI's page for a package name.", "lodash.debounce"],
    ["osv", "🛡️", "OSV vulnerabilities", "Known vulnerabilities for one package, from OSV.dev. Write ecosystem:package or ecosystem:package@version.", "npm:lodash@4.17.15"],
    ["clone", "🧬", "Clone a live site", "Read one public page in the Studio's clean-room cloner: robots.txt obeyed, private addresses refused, only the layout kept.", "https://example.com/"],
  ];
  pages.search = () => {
    let mode = "web";
    try { const m = store$.get("jarvis-search-mode"); if (SEARCH_MODES.some(x => x[0] === m)) mode = m; } catch (e) { mode = "web"; }
    const q = h("input", { class: "input", id: "f-wq", type: "search", name: "web-q", autocomplete: "off", maxLength: 200, dir: "auto" });
    const hint = h("p", { class: "subtle t-caption", id: "wq-hint" });
    q.setAttribute("aria-describedby", "wq-hint");
    const go = h("button", { class: "btn btn-primary", type: "submit" }, icon("i-search", "sm"), "Search");
    const results = h("div", { class: "stack", "aria-live": "polite" });
    const side = h("div", { class: "stack" });
    const modeBtns = SEARCH_MODES.map(([id, emoji, label]) => {
      const b = h("button", { type: "button", "aria-pressed": String(id === mode), dataset: { mode: id } }, h("span", { "aria-hidden": "true", text: emoji + " " }), h("span", { text: label }));
      b.addEventListener("click", () => { mode = id; store$.set("jarvis-search-mode", id); setMode(); q.focus(); });
      return b;
    });
    const setMode = () => {
      const m = SEARCH_MODES.find(x => x[0] === mode);
      modeBtns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
      hint.textContent = m[3];
      q.placeholder = m[4];
      q.type = mode === "clone" ? "url" : "search";
      q.dir = mode === "web" ? "auto" : "ltr";
      go.lastChild.textContent = mode === "clone" ? "Open in the cloner" : "Search";
    };
    const sourceRow = x => h("li", null,
      badge(x.skipped ? "idle" : x.ok ? "ok" : "failed", x.skipped ? "Skipped" : x.ok ? (x.cached ? "Cached" : "Answered") : "Failed"),
      h("span", { class: "t-sm", translate: "no", text: x.label || SEARCH_LABEL[x.source] }),
      h("span", { class: "subtle t-caption", text: x.skipped ? x.note : x.ok ? (x.count === 1 ? "1 result" : x.count + " results") : x.error }),
      h("span", { class: "num t-caption subtle", text: x.ms ? x.ms + " ms" : "" }));
    const resultCard = r => {
      const url = safeUrl(r.url);
      const meta = r.meta || {};
      const bits = [meta.stars != null ? "★ " + fmtN.format(meta.stars) : null, meta.language, meta.licence, meta.version ? "v" + meta.version : null, meta.year, meta.citations != null ? meta.citations + " cites" : null, meta.points != null ? meta.points + " pts" : null, (meta.aliases || []).join(" "), meta.engine].filter(Boolean);
      return h("li", { class: "mem hit" },
        h("div", { class: "row" }, h("span", { class: "badge", translate: "no", text: SEARCH_LABEL[r.source] || r.source }), bits.length ? h("span", { class: "mono t-caption subtle", translate: "no", text: bits.join(" · ") }) : null),
        h("h3", { dir: "auto", translate: "no" }, url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: r.title }) : r.title),
        r.snippet ? h("p", { class: "mem-body t-sm", dir: "auto", translate: "no", lang: r.lang || null, text: r.snippet }) : null,
        url ? h("p", { class: "mono t-caption subtle url", translate: "no", text: url }) : null);
    };
    const run = async () => {
      const text = q.value.trim();
      if (mode === "clone") {
        if (!safeUrl(text) && !/^http:\/\//.test(text)) { toast("warn", "Write a full public address that starts with https://"); q.focus(); return; }
        PENDING_CLONE = text; location.hash = "#/studio"; return;
      }
      go.disabled = true; results.replaceChildren(skeleton(4));
      try {
        const r = await store.liveSearch({ q: text, mode });
        side.replaceChildren(h("section", { class: "panel", "aria-labelledby": "h-src" }, h("h2", { id: "h-src", text: "Sources" }), h("ul", { class: "feed" }, r.sources.map(sourceRow)),
          h("p", { class: "subtle t-caption", text: "Each source is an official public JSON API, asked once per search with an honest user agent; repeats come from a 10-minute cache. Links open the source's own page." })));
        const body = [];
        if (r.offline) body.push(h("p", { class: "sample-note", dir: "auto" }, icon("i-alert", "sm"), r.fallback ? r.fallback.note : "No source answered."));
        if (r.memoryId) body.push(h("p", { class: "sample-note live-note" }, icon("i-check", "sm"), "Saved to memory as a search episode: titles and links only."));
        if (r.results.length) body.push(h("p", { class: "subtle t-caption", role: "status", text: (r.results.length === 1 ? "1 result" : r.results.length + " results") + " from " + ((n => n === 1 ? "1 source" : n + " sources")(r.sources.filter(x => x.ok && !x.skipped && x.count).length)) }), h("ul", { class: "memlist" }, r.results.map(resultCard)));
        else if (r.fallback && r.fallback.hits.length) body.push(h("h2", { text: "From this workspace's memory" }), h("ul", { class: "memlist" }, r.fallback.hits.map(e => h("li", { class: "mem" }, h("div", { class: "row" }, h("span", { class: "badge", text: MEM_KIND_LABEL[e.kind] || e.kind }), e.score != null ? h("span", { class: "num t-caption subtle", text: "score " + e.score }) : null), h("h3", { dir: "auto", translate: "no", text: e.title }), h("p", { class: "mem-body t-sm", dir: "auto", translate: "no", text: e.body.slice(0, 300) })))));
        else body.push(emptyState("i-search", "Nothing found", r.offline ? "No source answered and memory has nothing that matches." : "Try other words, or another mode."));
        results.replaceChildren(...body);
      } catch (err) { results.replaceChildren(errorBox(err, run)); }
      finally { go.disabled = false; }
    };
    const form = h("form", { class: "search-form", role: "search", "aria-label": "Open-web search" },
      h("div", { class: "seg wrap", role: "group", "aria-label": "Search mode" }, modeBtns),
      h("div", { class: "clone-row" }, h("div", { class: "field" }, h("label", { htmlFor: "f-wq", text: "Search for" }), q), go), hint);
    form.addEventListener("submit", e => { e.preventDefault(); run(); });
    setMode();
    side.replaceChildren(h("section", { class: "panel", "aria-labelledby": "h-src" }, h("h2", { id: "h-src", text: "Sources" }),
      h("ul", { class: "feed" }, Object.entries(SEARCH_LABEL).map(([id, label]) => h("li", null, h("span", { class: "t-sm", translate: "no", text: label }), h("span", { class: "subtle t-caption", text: { searxng: "only if JARVIS_SEARXNG_URL is set", pypi: "one package by name", osv: "vulnerabilities" }[id] || "keyless JSON API" })))),
      h("p", { class: "subtle t-caption", text: "No search page is scraped and no anti-bot check is bypassed. With no internet, Jarvis answers from this workspace's memory and says so." })));
    return h("div", { class: "stack" },
      pageHead("Search", "Live search across official, keyless public APIs, through the local server. Results are untrusted text with links; a summary goes into memory."), sampleNote(),
      form,
      h("div", { class: "mixer" }, results, h("div", { class: "stack mix-side" }, side)));
  };

  /* ── Skill Loader (ADR-142): discover on GitHub, import SKILL.md text, synthesize, evolve; mounted at once ── */
  let PENDING_SKILL_Q = null;
  const ORIGIN_LABEL = { github: "GitHub (text only)", synthesized: "Synthesized", derived: "Derived", captured: "Captured" };
  const EVO_LABEL = { FIX: "FIX", DERIVED: "DERIVED", CAPTURED: "CAPTURED" };
  function scanResult(r) {
    const s = r.scan;
    return h("div", { class: "stack" }, h("div", { class: "row" }, r.mounted ? badge("ok", "Mounted in this workspace") : badge("failed", "Refused: " + s.critical + " critical, " + s.high + " high"),
        h("span", { class: "subtle t-caption num", text: s.findings.length + " findings · " + Object.keys((r.skill && r.skill.files) || {}).length + " files" })),
      s.findings.length ? h("ul", { class: "checks" }, s.findings.slice(0, 8).map(f => h("li", { class: f.sev === "critical" || f.sev === "high" ? "fail" : "warn" }, h("span", { class: "mark", "aria-hidden": "true", text: f.sev === "critical" || f.sev === "high" ? "✕" : "!" }),
        h("span", null, h("span", { class: "mono t-caption", translate: "no", text: f.file + ":" + f.line + " " + f.rule + " " }), f.msg)))) : null);
  }
  pages.loader = () => {
    const results = h("div", { class: "stack", "aria-live": "polite" });
    const mounted = h("div", { class: "stack" });
    const evoBox = h("div", { class: "stack" });
    const outBox = h("div", { class: "stack", "aria-live": "polite" });
    const afterMount = (r, from) => {
      outBox.replaceChildren(scanResult(r));
      toast(r.mounted ? "ok" : "error", r.mounted ? "Mounted " + r.skill.name + ". It is in the Skill Mixer, the agent editor and Ctrl+K now." : "Not mounted: the audit found a critical or high problem.");
      reloadAll(); if (from && from.isConnected) from.focus();
    };
    // Discover
    const dq = h("input", { class: "input", id: "f-dq", type: "search", name: "discover-q", autocomplete: "off", maxLength: 120, placeholder: "database schema review" });
    const dgo = h("button", { class: "btn btn-secondary", type: "submit" }, icon("i-search", "sm"), "Search GitHub");
    const dform = h("form", { class: "clone-row" }, h("div", { class: "field" }, h("label", { htmlFor: "f-dq", text: "Find skills on GitHub" }), dq), dgo);
    dform.addEventListener("submit", e => {
      e.preventDefault(); results.replaceChildren(skeleton(3));
      // replaceChildren() would print a null argument as the text "null", so absent parts are filtered out.
      store.discoverSkills(dq.value).then(r => results.replaceChildren(...[
        r.offline ? h("p", { class: "sample-note", dir: "auto" }, icon("i-alert", "sm"), r.note) : null,
        r.results.length ? h("ul", { class: "memlist" }, r.results.map(x => {
          const path = h("input", { class: "input mono", name: "skill-path", autocomplete: "off", value: "SKILL.md", "aria-label": "Path of SKILL.md in " + x.repo, translate: "no" });
          const imp = h("button", { class: "btn btn-secondary btn-sm", type: "button", text: "Import SKILL.md" });
          imp.addEventListener("click", e2 => { const from = e2.currentTarget; imp.disabled = true; store.importSkill({ repo: x.repo, path: path.value }).then(r2 => afterMount(r2, from), err => toast("error", err.message)).finally(() => { imp.disabled = false; }); });
          return h("li", { class: "mem hit" },
            h("div", { class: "row" }, h("span", { class: "badge", translate: "no", text: "GitHub" }), h("span", { class: "mono t-caption subtle", translate: "no", text: "★ " + fmtN.format(x.stars) + (x.licence ? " · " + x.licence : " · no licence stated") })),
            h("h3", { translate: "no" }, h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.repo })),
            x.description ? h("p", { class: "mem-body t-sm", dir: "auto", translate: "no", text: x.description }) : null,
            h("div", { class: "row" }, path, imp));
        })) : (r.offline ? null : h("p", { class: "muted t-sm", text: "No repository matches." }))].filter(Boolean)), err => results.replaceChildren(h("p", { class: "sample-note", dir: "auto" }, icon("i-alert", "sm"), err.message)));
    });
    // Synthesize
    const ask = h("textarea", { class: "textarea", id: "f-syn", name: "synthesize", rows: 3, autocomplete: "off", maxLength: 400, dir: "auto", placeholder: "A tool that compares how fast two sorting algorithms run on the same list" });
    const kind = h("select", { class: "select", id: "f-synkind", name: "synthesize-kind", autocomplete: "off" }, h("option", { value: "checklist", text: "Checklist (SKILL.md only)" }), h("option", { value: "python-tool", text: "Python tool (standard library)" }));
    const sgo = h("button", { class: "btn btn-primary", type: "button" }, icon("i-plus", "sm"), "Synthesize and mount");
    sgo.addEventListener("click", e => { const from = e.currentTarget; sgo.disabled = true; store.synthesizeSkill({ request: ask.value, kind: kind.value }).then(r => { if (r.warning) toast("warn", r.warning); afterMount(r, from); if (r.mounted) ask.value = ""; }, err => toast("error", err.message)).finally(() => { sgo.disabled = false; }); });
    // Capture from a mission
    const msel = h("select", { class: "select", id: "f-capm", name: "capture-mission", autocomplete: "off" });
    const cgo = h("button", { class: "btn btn-secondary", type: "button", text: "Capture as a skill" });
    cgo.addEventListener("click", e => { const from = e.currentTarget; if (!msel.value) { toast("warn", "Pick the finished mission to capture."); return; } store.evolveSkill({ type: "CAPTURED", missionId: msel.value }).then(r => afterMount(r, from), err => toast("error", err.message)); });
    store.listMissions().then(list => { const done = list.filter(m => m.status === "succeeded" || m.status === "awaiting_approval"); msel.replaceChildren(...(done.length ? done.map(m => h("option", { value: m.id, dir: "auto", text: m.title })) : [h("option", { value: "", text: "No finished mission yet" })])); }, () => {});
    // Mounted list and evolution log
    const fixDialog = (r, from) => {
      const ta = h("textarea", { class: "textarea code", id: "f-fixmd", name: "fix-skill-md", rows: 12, autocomplete: "off", spellcheck: false, translate: "no", value: r.files["SKILL.md"] });
      openDialog("Fix " + r.name, h("div", { class: "stack" }, h("p", { class: "t-sm", text: "Edit the SKILL.md. The new version is audited again; if it fails, the current version stays." }), h("div", { class: "field" }, h("label", { htmlFor: "f-fixmd", text: "SKILL.md" }), ta)),
        [h("button", { class: "btn btn-secondary", type: "button", text: "Cancel", onclick: closeDialog }), h("button", { class: "btn btn-primary", type: "button", text: "Save new version", onclick: () => { const text = ta.value; closeDialog(); store.evolveSkill({ type: "FIX", skillId: r.id, skillMd: text }).then(x => afterMount(x, from), err => toast("error", err.message)); } })], from);
    };
    const deriveDialog = (r, from) => {
      const ta = h("textarea", { class: "textarea", id: "f-derive", name: "derive-steps", rows: 4, autocomplete: "off", dir: "auto", placeholder: "One new step per line" });
      openDialog("Derive from " + r.name, h("div", { class: "stack" }, h("p", { class: "t-sm", text: "A new skill keeps this one's steps and adds yours. The original stays as it is." }), h("div", { class: "field" }, h("label", { htmlFor: "f-derive", text: "New steps" }), ta)),
        [h("button", { class: "btn btn-secondary", type: "button", text: "Cancel", onclick: closeDialog }), h("button", { class: "btn btn-primary", type: "button", text: "Derive and mount", onclick: () => { const steps = ta.value.split("\n").map(x => x.trim()).filter(Boolean); closeDialog(); store.evolveSkill({ type: "DERIVED", skillId: r.id, steps }).then(x => afterMount(x, from), err => toast("error", err.message)); } })], from);
    };
    const renderMounted = list => list.length ? h("ul", { class: "feed" }, list.map(r => h("li", { class: "forged" },
      h("div", { class: "stack" }, h("b", { class: "mono", translate: "no", text: r.name }), h("span", { class: "t-caption", dir: "auto", translate: "no", text: r.description }),
        h("span", { class: "row" }, findingsBadge({ critical: r.scan.critical, high: r.scan.high, medium: r.scan.medium, low: r.scan.low }), h("span", { class: "badge", text: ORIGIN_LABEL[r.origin] || r.origin }), h("span", { class: "badge num", text: "v" + r.version }),
          r.licence ? h("span", { class: "badge", translate: "no", text: r.licence }) : null,
          r.sourceUrl ? h("a", { class: "t-caption", href: r.sourceUrl, target: "_blank", rel: "noopener noreferrer", text: "Source" }) : null,
          r.approvalId ? h("span", { class: "badge s-locked" }, icon("i-lock", "sm"), h("bdi", { lang: "ar", dir: "rtl", text: "قيد الموافقة" })) : null)),
      h("div", { class: "row" },
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Fix…", onclick: e => fixDialog(r, e.currentTarget) }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Derive…", onclick: e => deriveDialog(r, e.currentTarget) }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: e => { const from = e.currentTarget; store.installRuntime(r.id).then(() => showLocked(from, "install", "Install the skill “" + r.name + "” into .claude/skills"), err => toast("error", err.message)); } }, icon("i-lock", "sm"), "Install into the repo…"),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Unmount", onclick: () => store.unmountRuntime(r.id).then(() => { toast("ok", "Unmounted " + r.name + "."); reloadAll(); }, err => toast("error", err.message)) }))))) : h("p", { class: "muted t-sm", text: "No skill loaded yet. Search GitHub, synthesize one, or capture a finished mission." });
    const renderEvo = list => list.length ? h("ul", { class: "feed" }, list.slice(0, 20).map(e => h("li", null, h("span", { class: "badge", translate: "no", text: EVO_LABEL[e.type] || e.type }), h("span", { class: "mono t-caption", translate: "no", text: e.skillName || "—" }), h("span", { class: "t-caption", dir: "auto", translate: "no", text: e.note }), timeEl(typeof e.createdAt === "number" ? e.createdAt : Date.parse(e.createdAt))))) : h("p", { class: "muted t-sm", text: "No change logged yet." });
    const reloadAll = () => { loadInto(mounted, () => store.listRuntime(), renderMounted); loadInto(evoBox, () => store.evolutionLog(), renderEvo); };
    reloadAll();
    const off = store.subscribe(() => { if (!mounted.isConnected) { off(); return; } if (!dlg.open) { store.listRuntime().then(l => mounted.replaceChildren(renderMounted(l)), () => {}); store.evolutionLog().then(l => evoBox.replaceChildren(renderEvo(l)), () => {}); } });
    return h("div", { class: "stack" },
      pageHead("Skill Loader", "Find, write and grow skills from inside Jarvis. Each one is audited, then mounted in this workspace at once. Writing one into the repository stays a locked approval."), sampleNote(),
      h("div", { class: "mixer" },
        h("div", { class: "stack" },
          h("section", { class: "panel", "aria-labelledby": "h-disc" }, h("h2", { id: "h-disc", text: "Discover on GitHub" }),
            h("p", { class: "t-sm", text: "GitHub's official search API, keyless. Importing reads one SKILL.md as text; scripts and other files are never fetched." }), dform, results),
          h("section", { class: "panel", "aria-labelledby": "h-mnt" }, h("h2", { id: "h-mnt", text: "Loaded in this workspace" }), mounted)),
        h("div", { class: "stack mix-side" },
          h("section", { class: "panel", "aria-labelledby": "h-syn" }, h("h2", { id: "h-syn", text: "Synthesize" }),
            h("p", { class: "t-sm", text: "The local model writes the SKILL.md when one runs on 127.0.0.1; otherwise the fixed template does." }),
            h("div", { class: "field" }, h("label", { htmlFor: "f-syn", text: "What the skill or tool should do" }), ask), h("div", { class: "field" }, h("label", { htmlFor: "f-synkind", text: "Kind" }), kind), h("div", { class: "row" }, sgo), outBox),
          h("section", { class: "panel", "aria-labelledby": "h-cap" }, h("h2", { id: "h-cap", text: "Capture a mission" }),
            h("p", { class: "t-sm", text: "Turn a mission that worked into a skill. Its locked steps become stops, never actions." }),
            h("div", { class: "field" }, h("label", { htmlFor: "f-capm", text: "Finished mission" }), msel), h("div", { class: "row" }, cgo)),
          h("section", { class: "panel", "aria-labelledby": "h-evo" }, h("h2", { id: "h-evo", text: "Evolution log" }), h("p", { class: "subtle t-caption", text: "FIX: a new version. DERIVED: a new skill grown from one. CAPTURED: from GitHub, a request or a mission. Append-only." }), evoBox))));
  };

  /* ── Governance (ADR-143): the rules, the knowledge map, the quality gate and the register ───────── */
  const GOV_RULES = [
    ["Surgical changes", "Change only what the task needs, in as few lines as do the job."],
    ["No extra layers", "No abstraction, option or framework the task does not need."],
    ["Evidence before done", "Run the check and quote its output before calling anything done."],
    ["Boundaries hold", "Locks, the CSP, 127.0.0.1 and the approval cards never move to make a task easier."],
  ];
  const GOV_REGISTER = [
    ["Superpowers", "adopted", "Tests first and small task splits, as working rules. Nothing installed."],
    ["gstack", "adopted", "Set up a stack only when a task needs it, as a working rule. Nothing installed."],
    ["UI UX Pro Max", "adopted", "Local UI checklists, read as text rules beside DESIGN.md. Nothing installed."],
    ["Karpathy surgical rules", "adopted", "Written into CLAUDE.md."],
    ["GSD (Redux)", "excluded", "A second task system that conflicts with the Superpowers way of working."],
    ["Claude-Mem", "excluded", "Replaced by the repository's own deterministic memory (BM25 episodes and capsules)."],
    ["Career Ops", "excluded", "It scrapes outside sites, which AGENTS.md §3 forbids."],
    ["HyperFrames", "isolated", "Kept outside the public repository."],
  ];
  const GOV_STATE = { adopted: ["ok", "Adopted as a rule"], excluded: ["failed", "Excluded"], isolated: ["locked", "Kept outside the repo"] };
  function knowledgeMap(g) {
    if (!g) return h("p", { class: "muted t-sm", text: "No map in this build. Run replica-graphify, then build the page." });
    const byId = new Map(g.nodes.map(n => [n.id, n]));
    const cols = [["screen", "Screens"], ["module", "Modules"], ["table", "Tables"], ["skill", "Skills"]];
    const routeOf = new Map(), modFor = new Map();
    for (const e of g.edges) {
      if (e.kind === "requests") (routeOf.get(e.from) || routeOf.set(e.from, []).get(e.from)).push(e.to);
      if (e.kind === "calls") modFor.set(e.from, e.to);
    }
    // screen -> module through the routes it requests; module -> table through SQL.
    const links = [];
    for (const [scr, rts] of routeOf) for (const m of new Set(rts.map(r => modFor.get(r)).filter(Boolean))) links.push([scr, m]);
    for (const e of g.edges) if (e.kind === "sql") links.push([e.from, e.to]);
    const nodesOf = k => g.nodes.filter(n => n.kind === k).sort((a, b) => a.label.localeCompare(b.label));
    const ROW = 22, COLW = 232, TOP = 40;
    const height = TOP + Math.max(...cols.map(([k]) => nodesOf(k).length)) * ROW + 16;
    const pos = new Map();
    cols.forEach(([k], ci) => nodesOf(k).forEach((n, i) => pos.set(n.id, { x: 16 + ci * COLW, y: TOP + i * ROW })));
    const inspector = h("div", { class: "stack gmap-info", "aria-live": "polite" }, h("p", { class: "muted t-sm", text: "Pick a node to see what it reaches." }));
    const edgeEls = links.map(([a, b]) => { const p = pos.get(a), q = pos.get(b); if (!p || !q) return null; const x1 = p.x + 200, x2 = q.x - 6, mx = (x1 + x2) / 2; return svg("path", { class: "gmap-edge", d: `M${x1},${p.y} C${mx},${p.y} ${mx},${q.y} ${x2},${q.y}`, "data-a": a, "data-b": b }); }).filter(Boolean);
    const select = id => {
      const n = byId.get(id); if (!n) return;
      edgeEls.forEach(e => e.classList.toggle("on", e.dataset.a === id || e.dataset.b === id));
      $$(".gmap-node", map).forEach(x => x.classList.toggle("sel", x.dataset.id === id));
      const near = links.filter(([a, b]) => a === id || b === id).map(([a, b]) => byId.get(a === id ? b : a)).filter(Boolean);
      const routes = n.kind === "screen" ? (routeOf.get(id) || []) : n.kind === "module" ? [...modFor].filter(([, m]) => m === id).map(([r]) => r) : [];
      // replaceChildren() prints a null argument as "null", so the absent parts are filtered out.
      inspector.replaceChildren(...[h("h3", { translate: "no", text: n.label }), h("p", { class: "mono t-caption subtle", translate: "no", text: n.file + (n.line ? ":" + n.line : "") }),
        near.length ? h("p", { class: "t-sm" }, h("b", { text: "Linked: " }), h("span", { translate: "no", text: near.map(x => x.label).join(", ") })) : null,
        routes.length ? h("ul", { class: "feed" }, routes.map(r => h("li", { class: "mono t-caption", translate: "no", text: (byId.get(r) || { label: r }).label }))) : null,
        n.constraints && n.constraints.length ? h("p", { class: "t-caption" }, h("b", { text: "Constraints: " }), h("span", { class: "mono", translate: "no", text: n.constraints.join(", ") })) : null,
        n.kind === "skill" ? h("p", { class: "t-caption", translate: "no", text: g.nodes.filter(t => t.kind === "tool" && t.id.startsWith("tool:" + n.label + "/")).map(t => t.label + (t.functions && t.functions.length ? " (" + t.functions.join(", ") + ")" : "")).join(" · ") || "Text rules only (no tool)." }) : null].filter(Boolean));
    };
    const map = svg("svg", { class: "gmap", viewBox: `0 0 ${16 + cols.length * COLW} ${height}`, role: "img", "aria-label": "Map of screens, modules, tables and skills" },
      cols.map(([k, title], ci) => svg("text", { class: "gmap-col", x: 16 + ci * COLW, y: 18 }, tr(title) || title)),
      edgeEls,
      [...pos].map(([id, p]) => { const n = byId.get(id); const gEl = svg("g", { class: "gmap-node k-" + n.kind, transform: `translate(${p.x},${p.y})`, tabindex: "0", role: "button", translate: "no", "aria-label": n.kind + " " + n.label, "data-id": id },
        svg("circle", { r: 4, cx: 0, cy: 0 }), svg("text", { x: 10, y: 4 }, n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label));
        gEl.addEventListener("click", () => select(id)); gEl.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(id); } }); return gEl; }));
    return h("div", { class: "stack" },
      h("p", { class: "subtle t-caption num", translate: "no", text: Object.entries(g.counts).map(([k, v]) => v + " " + k + "s").join(" · ") + " · " + g.edges.length + " edges · sha256 " + g.sha256.slice(0, 12) }),
      h("div", { class: "gmap-wrap" }, h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Knowledge map" }, map), inspector),
      g.unlinked.length ? h("p", { class: "t-caption" }, h("b", { text: "Not reached from the page: " }), h("span", { class: "mono", translate: "no", text: g.unlinked.map(id => (byId.get(id) || { label: id }).label).join(", ") })) : null);
  }
  pages.governance = () => {
    const q = DATA.quality, g = DATA.graph;
    const rules = h("ol", { class: "gov-rules" }, GOV_RULES.map(([t, d]) => h("li", null, h("b", { text: t }), h("span", { class: "t-sm", text: d }))));
    const register = h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Skills and tools register" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { scope: "col", text: "Name" }), h("th", { scope: "col", text: "Decision" }), h("th", { scope: "col", text: "Why" }))),
      h("tbody", null, GOV_REGISTER.map(([n, st, why]) => h("tr", null, h("td", { translate: "no", text: n }), h("td", null, badge(GOV_STATE[st][0], GOV_STATE[st][1])), h("td", { class: "wrap t-sm", text: why }))))));
    const quality = q ? h("div", { class: "stack" },
      h("div", { class: "stats" },
        h("div", { class: "stat" }, h("span", { class: "label", text: "Rules" }), h("span", { class: "value num", text: String(q.rules) })),
        h("div", { class: "stat" }, h("span", { class: "label", text: "Files read" }), h("span", { class: "value num", text: String(q.files) })),
        h("div", { class: "stat" }, h("span", { class: "label", text: "High" }), h("span", { class: "value num", text: String(q.summary.high) })),
        h("div", { class: "stat" }, h("span", { class: "label", text: "Medium · low" }), h("span", { class: "value num", text: q.summary.medium + " · " + q.summary.low }))),
      h("div", { class: "row" }, Object.entries(q.byRule).map(([rid, n]) => h("span", { class: "badge num", translate: "no", text: rid + " × " + n }))),
      q.findings.length ? h("ul", { class: "feed" }, q.findings.slice(0, 12).map(f => h("li", null, badge(f.severity === "high" ? "failed" : f.severity === "medium" ? "warn" : "idle", f.severity), h("span", { class: "mono t-caption", translate: "no", text: f.rule + " " + f.file + ":" + f.line }), h("span", { class: "t-caption", translate: "no", text: f.message })))) : null,
      h("p", { class: "subtle t-caption num", translate: "no", text: "sha256 " + q.sha256.slice(0, 12) + " · " + fmtDate.format(new Date(q.built)) })) : h("p", { class: "muted t-sm", text: "No quality report in this build. Run replica-impeccable, then build the page." });
    return h("div", { class: "stack" },
      pageHead("Governance", "How Jarvis is kept honest: the working rules, a map of what calls what, the quality gate, and which outside tools were taken in or kept out."),
      h("p", { class: "sample-note", dir: "auto" }, icon("i-alert", "sm"), "Build-time snapshots from the repository's own tools, read from the code with fixed rules [INFERENCE]; the code is the truth."),
      h("div", { class: "grid-2" },
        h("section", { class: "panel", "aria-labelledby": "h-grules" }, h("h2", { id: "h-grules", text: "Working rules" }), rules, h("p", { class: "subtle t-caption", text: "From Karpathy's surgical rules, written into CLAUDE.md." })),
        h("section", { class: "panel", "aria-labelledby": "h-greg" }, h("h2", { id: "h-greg", text: "Skills and tools register" }), register, h("p", { class: "subtle t-caption", text: "Adopting means taking text rules; nothing outside is installed or run (AGENTS.md §1)." }))),
      h("section", { class: "panel", "aria-labelledby": "h-gmap" }, h("h2", { id: "h-gmap", text: "Knowledge map" }), h("p", { class: "t-sm", text: "Screens, server modules, database tables and skills, joined by what each one calls. From replica-graphify; no vector database." }), knowledgeMap(g)),
      h("section", { class: "panel", "aria-labelledby": "h-gq" }, h("h2", { id: "h-gq", text: "Quality gate" }), h("p", { class: "t-sm", text: "62 rules from replica-impeccable against filler copy, off-system design, unfinished code and broken docs. Rule text is shown as the tool wrote it." }), quality,
        h("pre", { class: "diff", translate: "no", text: "python3 .claude/skills/replica-impeccable/slop_guard.py jarvis docs/adr --root .\npython3 .claude/skills/replica-humanizer/humanize.py jarvis/README.md --root ." })),
      evidenceGates());
  };
  // ADR-146: two gates with measured evidence. The UI-state gate stops the build when a state is missing; the
  // mutation result is shown as verified only while each tested file still has the hash it was tested with.
  function evidenceGates() {
    const u = DATA.uiStates, m = DATA.mutation;
    const ui = h("section", { class: "panel", "aria-labelledby": "h-gui" }, h("h2", { id: "h-gui", text: "UI-state gate" }),
      h("div", { class: "row" }, badge("ok", "Gate passed"), h("span", { class: "num t-sm", text: u.covered + "/" + u.total + " · " + u.percent + "%" })),
      h("ul", { class: "plist" }, u.components.map(c => h("li", null, h("code", { translate: "no", text: "." + c.component }), " ", h("span", { class: "t-caption muted", translate: "no", text: c.required.join(" · ") })))),
      h("p", { class: "subtle t-caption", text: "Read from the page's CSS by state_prover.py --spec; a missing state stops the build." }));
    const mut = m ? h("section", { class: "panel", "aria-labelledby": "h-gmut" }, h("h2", { id: "h-gmut", text: "Mutation testing" }),
      h("div", { class: "row" }, m.verified ? h("span", { translate: "no" }, badge("ok", "[VERIFIED]")) : badge("warn", "Stale: run the harness again"),
        h("span", { class: "t-sm", text: m.killed + "/" + m.total + " killed · " + m.score + "%" }), h("span", { class: "t-caption muted", text: m.equivalent + " equivalent, each with its reason in the log" })),
      h("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Mutation results" }, h("table", null,
        h("thead", null, h("tr", null, h("th", { scope: "col", text: "File" }), h("th", { scope: "col", text: "Killed" }), h("th", { scope: "col", text: "Equivalent" }), h("th", { scope: "col", text: "Status" }))),
        h("tbody", null, m.targets.map(t => h("tr", null, h("td", { class: "wrap" }, h("code", { translate: "no", text: t.file }), h("div", { class: "t-caption muted", translate: "no", text: t.functions.join(", ") })),
          h("td", { class: "num", text: t.killed + "/" + (t.mutants - t.equivalent) }), h("td", { class: "num", text: String(t.equivalent) }), h("td", null, t.current ? badge("ok", "Matches the code") : badge("warn", "Code changed"))))))),
      h("p", { class: "subtle t-caption num", translate: "no", text: "jarvis/replica/evidence/mutation-audit.log · sha256 " + m.sha256.slice(0, 12) + " · " + fmtDate.format(new Date(m.ranAt)) })) : null;
    return h("div", { class: "grid-2" }, ui, mut);
  }

  /* ── Diagnostics (ADR-148): the five layers, and a bundle scrubbed of anything secret-shaped ── */
  pages.diagnostics = () => {
    const box = h("div", { class: "stack", "aria-live": "polite" });
    const bundleBox = h("div", { class: "stack", "aria-live": "polite" });
    const dlBtn = h("button", { class: "btn btn-primary", type: "button" }, icon("i-download", "sm"), "Download diagnostic bundle");
    dlBtn.addEventListener("click", async () => {
      dlBtn.disabled = true; dlBtn.setAttribute("aria-busy", "true");
      try {
        const b = await store.diagnosticsBundle();
        const text = JSON.stringify(b, null, 2) + "\n";
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const a = h("a", { href: url, download: "jarvis-diagnostics-" + b.workspace + ".json", hidden: true });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        bundleBox.replaceChildren(h("div", { class: "row" }, badge("ok", "Scrubbed before saving"), h("span", { class: "t-sm", text: plural(b.scrubbed.redactions, "value") + " removed" + (b.scrubbed.rules.length ? ": " + b.scrubbed.rules.join(", ") : "") })),
          h("p", { class: "t-caption muted", text: "Saved on this computer. Nothing was sent anywhere; sharing the file is your decision." }));
      } catch (e) { toast("error", e.message); } finally { dlBtn.disabled = false; dlBtn.removeAttribute("aria-busy"); }
    });
    loadInto(box, () => store.diagnostics(), d => h("div", { class: "layers" }, d.layers.map((l, i) => h("section", { class: "panel layer", "aria-labelledby": "h-layer-" + l.id },
      h("div", { class: "row between" }, h("h2", { id: "h-layer-" + l.id }, h("bdi", { class: "num", text: String(i + 1) }), " · ", l.name), l.ok ? badge("ok", "Ready") : badge("warn", "Needs attention")),
      h("ul", { class: "plist" }, l.checks.map(c => h("li", null, c.ok ? badge("ok", "OK") : badge(c.detail === "needs the local server" ? "idle" : "failed", c.detail === "needs the local server" ? "Server" : "Check"), " ", h("b", { text: c.name }), " ", h("bdi", { class: "t-caption muted", dir: "ltr", translate: "no", text: c.detail }))))))));
    return h("div", { class: "stack" },
      pageHead("Diagnostics", "Whether each layer of Jarvis is ready, checked now from the database, the evidence files and the running services."),
      sampleNote(),
      box,
      h("section", { class: "panel", "aria-labelledby": "h-bundle" }, h("h2", { id: "h-bundle", text: "Diagnostic bundle" }),
        h("p", { class: "t-sm", text: "One JSON file with these checks, the Merkle root and the latest events. Before it is saved, values under secret-like names, known key formats and long high-entropy strings are replaced with [REDACTED]. SHA-256 digests are kept: they are hashes, not secrets." }),
        h("div", { class: "row" }, dlBtn), bundleBox),
      h("section", { class: "panel", "aria-labelledby": "h-dlock" }, h("h2", { id: "h-dlock", text: "Still locked" }),
        lockLine("money, publishing, permissions, installs into .claude/skills and outbound messages wait for Director 00; the database refuses them and the API answers 403")));
  };

  /* ── Memory bank (ADR-138): BM25 over this workspace's episodes, self-check, JSONL export ── */
  const MEM_KINDS = ["plan", "design", "answer", "lesson", "note", "search", "skill"];
  const MEM_KIND_LABEL = { plan: "Plan", design: "Design", answer: "Answer", lesson: "Lesson", note: "Note", search: "Search", skill: "Skill" };
  pages.memory = () => {
    const q = h("input", { class: "input", id: "f-mq", type: "search", name: "memory-q", autocomplete: "off", placeholder: "Words to look for, in Arabic or English" });
    const kind = h("select", { class: "select", id: "f-mkind", name: "memory-kind", autocomplete: "off" }, h("option", { value: "", text: "Any kind" }), MEM_KINDS.map(k => h("option", { value: k, text: MEM_KIND_LABEL[k] })));
    const box = h("div", { class: "stack" });
    const outcomeBadges = o => Object.entries(o || {}).filter(([, v]) => v === true || v === false).map(([k, v]) => h("span", { class: "badge " + (v ? "s-ok" : "s-failed"), translate: "no", text: k }));
    const render = r => h("div", { class: "stack" },
      h("p", { class: "subtle t-caption", role: "status", text: q.value.trim() ? r.hits.length + " of " + r.total + " episodes match (BM25)" : r.total + " episodes" }),
      r.hits.length ? h("ul", { class: "memlist" }, r.hits.map(e => h("li", { class: "mem" },
        h("div", { class: "row between" }, h("div", { class: "row" }, h("span", { class: "badge", text: MEM_KIND_LABEL[e.kind] || e.kind }), e.score != null ? h("span", { class: "num t-caption subtle", text: "score " + e.score }) : null),
          h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Delete " + e.title, onclick: () => store.removeMemory(e.id).then(() => { toast("ok", "Deleted from memory."); reload(); }, err => toast("error", err.message)) }, icon("i-x", "sm"))),
        h("h3", { dir: "auto", translate: "no", text: e.title }),
        h("p", { class: "mem-body t-sm", dir: "auto", translate: "no", text: e.body.length > 420 ? e.body.slice(0, 420) + "…" : e.body }),
        h("div", { class: "row" }, (e.terms || []).map(t => h("mark", { class: "term", dir: "auto", text: t })), (e.tags || []).map(t => h("span", { class: "badge", dir: "auto", translate: "no", text: "#" + t })), outcomeBadges(e.outcome),
          h("span", { class: "subtle t-caption", translate: "no", text: e.source || "" }), timeEl(typeof e.createdAt === "number" ? e.createdAt : Date.parse(e.createdAt)))))) :
        emptyState("i-brain", q.value.trim() ? "Nothing matches" : "Memory is empty", q.value.trim() ? "Try other words, or another kind." : "Finished missions, model answers and self-check lessons are kept here. Add a note, or run a self-check."));
    const reload = () => loadInto(box, () => store.searchMemory({ q: q.value, kind: kind.value }), render);
    let qt;
    q.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(reload, 200); });
    kind.addEventListener("change", reload);

    const nTitle = h("input", { class: "input", id: "f-ntitle", name: "note-title", autocomplete: "off", maxLength: 160, placeholder: "Cards use radius 20 = 12 + 8" });
    const nBody = h("textarea", { class: "textarea", id: "f-nbody", name: "note-body", autocomplete: "off", rows: 4, maxLength: 8000, placeholder: "What worked, and why. Never a key or a password." });
    const nTags = h("input", { class: "input", id: "f-ntags", name: "note-tags", autocomplete: "off", placeholder: "design, radius" });
    const addBtn = h("button", { class: "btn btn-primary", type: "button" }, icon("i-plus", "sm"), "Add to memory");
    addBtn.addEventListener("click", () => store.addMemory({ kind: "note", title: nTitle.value, body: nBody.value, tags: nTags.value.split(/[,،\s]+/).filter(Boolean) }).then(() => { nTitle.value = ""; nBody.value = ""; nTags.value = ""; toast("ok", "Saved to memory."); reload(); }, err => toast("error", err.message)));

    const scBox = h("div", { class: "stack", "aria-live": "polite" });
    const scBtn = h("button", { class: "btn btn-secondary", type: "button", text: "Run a self-check" });
    scBtn.addEventListener("click", () => {
      scBtn.disabled = true; scBox.replaceChildren(skeleton(2));
      store.selfCheck(9).then(r => {
        scBox.replaceChildren(h("div", { class: "row" }, badge(r.engine === "ollama-local-loopback" ? "ok" : "idle", r.engine === "ollama-local-loopback" ? "Local model" : "Fixed rules"),
            h("span", { class: "num t-sm", text: r.graded ? r.correct + " / " + r.graded + " correct" : r.asked + " lessons stored" })),
          h("p", { class: "subtle t-caption", text: r.note }),
          h("ul", { class: "checks" }, r.items.map(it => h("li", { class: it.correct === false ? "fail" : "pass" }, h("span", { class: "mark", "aria-hidden": "true", text: it.correct === false ? "✕" : "✓" }),
            h("span", { translate: "no" }, h("span", { dir: "auto", text: it.question }), h("br"), h("span", { class: "subtle t-caption", dir: "auto", text: it.answer }))))));
        toast("ok", "Self-check done: " + r.asked + " lessons stored."); reload();
      }, err => { scBox.replaceChildren(errorBox(err, () => scBtn.click())); }).finally(() => { scBtn.disabled = false; });
    });
    const exBtn = h("button", { class: "btn btn-secondary", type: "button" }, icon("i-download", "sm"), "Export JSONL");
    exBtn.addEventListener("click", () => store.exportMemory().then(text => {
      const url = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
      const a = h("a", { href: url, download: "jarvis-memory-" + store.slug + ".jsonl", hidden: true }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("ok", "Exported " + (text.trim() ? text.trim().split("\n").length : 0) + " episodes as JSONL.");
    }, err => toast("error", err.message)));
    reload();
    return h("div", { class: "stack" },
      pageHead("Memory", "This workspace's own good work, ranked with BM25. The best few episodes go to the local model as examples, marked as data. Retrieval, not training."), sampleNote(),
      h("div", { class: "mixer" },
        h("div", { class: "stack" },
          h("div", { class: "filters" }, h("div", { class: "field" }, h("label", { htmlFor: "f-mq", text: "Search memory" }), q), h("div", { class: "field narrow" }, h("label", { htmlFor: "f-mkind", text: "Kind" }), kind)),
          box),
        h("div", { class: "stack mix-side" },
          h("section", { class: "panel", "aria-labelledby": "h-note" }, h("h2", { id: "h-note", text: "Add a note" }),
            h("div", { class: "field" }, h("label", { htmlFor: "f-ntitle", text: "Title" }), nTitle), h("div", { class: "field" }, h("label", { htmlFor: "f-nbody", text: "Text" }), nBody),
            h("div", { class: "field" }, h("label", { htmlFor: "f-ntags", text: "Tags" }), nTags), h("div", { class: "row" }, addBtn)),
          h("section", { class: "panel", "aria-labelledby": "h-sc" }, h("h2", { id: "h-sc", text: "Self-check" }),
            h("p", { class: "t-sm", text: "Jarvis asks questions whose answers it computes itself: contrast ratios, which actions are locked, and the spacing scale. With a local model it grades the model; either way each computed answer is stored as a lesson." }),
            h("div", { class: "row" }, scBtn, exBtn), scBox),
          h("section", { class: "panel", "aria-labelledby": "h-cur" }, h("h2", { id: "h-cur", text: "Curriculum" }),
            h("p", { class: "t-sm", text: "For a larger set, the replica-hybrid-python skill writes 50,000+ layouts and 50,000+ Arabic and English questions with computed answers, as JSONL, on your computer:" }),
            h("pre", { class: "diff", translate: "no", text: "python3 .claude/skills/replica-hybrid-python/curriculum_50k.py count\npython3 .claude/skills/replica-hybrid-python/curriculum_50k.py export --kind qa --n 50000 --out jarvis/curriculum/qa.jsonl --root ." }),
            h("p", { class: "subtle t-caption", text: "Standard library only, no network. Use it with your own fine-tuning tools if you choose; Jarvis does not train a model." })))));
  };

  /* ── Router ─────────────────────────────────────────────────── */
  const TITLES = { overview: "Overview", agents: "Agents", agent: "Agent", runs: "Runs", run: "Run", missions: "Missions", mission: "Mission", workflows: "Workflows", workflow: "Workflow", analytics: "Analytics", webhooks: "Webhooks", compare: "Compare runs", templates: "Agent templates", approvals: "Approvals", logs: "Logs", settings: "Settings", studio: "Studio", skills: "Skill Mixer", memory: "Memory", search: "Search", loader: "Skill Loader", governance: "Governance", diagnostics: "Diagnostics" };
  let first = true;
  function route() {
    for (const k of Object.keys(TAB_MEMO)) delete TAB_MEMO[k];
    const parts = (location.hash.replace(/^#\/?/, "") || "overview").split("/");
    let key = parts[0], arg = parts[1];
    let make;
    if (key === "agents" && arg === "templates") { make = pages.templates; key = "templates"; }
    else if (key === "agents" && arg) { make = () => pages.agent(decodeURIComponent(arg)); key = "agent"; }
    else if (key === "runs" && arg === "compare" && parts[3]) { make = () => pages.compare(decodeURIComponent(parts[2]), decodeURIComponent(parts[3])); key = "compare"; }
    else if (key === "workflows" && arg) { make = () => pages.workflow(decodeURIComponent(arg)); key = "workflow"; }
    else if (key === "runs" && arg) { make = () => pages.run(decodeURIComponent(arg)); key = "run"; }
    else if (key === "missions" && arg) { make = () => pages.mission(decodeURIComponent(arg)); key = "mission"; }
    else if (pages[key] && !["agent", "run", "mission", "workflow", "compare", "templates"].includes(key)) make = pages[key];
    const main = $("#main");
    const navKey = { agent: "agents", run: "runs", mission: "missions", workflow: "workflows", compare: "runs", templates: "agents" }[key] || key;
    $$(".nav a[data-route]").forEach(a => (a.dataset.route === navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    if (!make) {
      main.replaceChildren(emptyState("i-search", "This page does not exist", "Check the address, or go back to the overview.", h("a", { class: "btn btn-primary", href: "#/overview", text: "Overview" })));
      document.title = "Not found · Jarvis";
    } else {
      main.replaceChildren(make());
      document.title = (tr(TITLES[key]) || TITLES[key]).trim() + " · Jarvis";
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
    ...Object.entries({ overview: "Overview", agents: "Agents", runs: "Runs", missions: "Missions", workflows: "Workflows", analytics: "Analytics", webhooks: "Webhooks", approvals: "Approvals", logs: "Logs", studio: "Studio", search: "Search", skills: "Skill Mixer", loader: "Skill Loader", memory: "Memory", governance: "Governance", diagnostics: "Diagnostics", settings: "Settings" }).map(([k, v]) => [v, "Page", () => { location.hash = "#/" + k; }]),
    ["New agent", "Action", () => { location.hash = "#/agents"; setTimeout(() => agentDialog($("#searchBtn")), 0); }],
    ["New mission", "Action", () => { location.hash = "#/missions"; setTimeout(() => missionDialog($("#searchBtn")), 0); }],
    ["Compose a macro", "Action", () => setTimeout(() => macroDialog($("#searchBtn")), 0)],
    ["Switch theme", "Action", () => setTheme(theme() === "light" ? "dark" : "light")],
    ["Switch direction", "Action", () => setDir(root.dir === "rtl" ? "ltr" : "rtl")],
    ["Switch workspace", "Action", () => wsOpen(true, 0)],
  ];
  function renderPal() {
    const words = palIn.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    shown = cmds.filter(c => words.every(w => c[0].toLowerCase().split(/[\s-]+/).some(n => n.startsWith(w))));
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
    // ADR-142: every mounted skill is a command at once (no restart).
    Promise.all([store.listForged().catch(() => []), store.listRuntime().catch(() => [])]).then(([f, r]) => { cmds = cmds.concat([...f, ...r].map(x => [x.name, "Skill", () => { PENDING_SKILL_Q = x.name; if (location.hash === "#/skills") route(); else location.hash = "#/skills"; }])); if (pal.open) renderPal(); });
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
    store.llmStatus().then(st => {
      const b = $("#llmBadge");
      b.className = "badge llm-badge " + (st.online ? "s-ok" : "s-idle");
      $("#llmWord").textContent = st.online ? (st.api === "openai" ? "Local model · 0-token" : "Ollama local · 0-token") : "Fixed rules";
      b.title = st.online ? "Local models on 127.0.0.1: " + st.models.join(", ") : "No local model: plans and designs use the fixed rules";
    }, () => {});
    store.subscribe(updateCount);
    buildWsMenu();
    updateCount();
    route();
  });
})();
