#!/usr/bin/env node
// Tests for jarvis/server (ADR-134). Runs every check on SQLite, and again on PostgreSQL 16 when
// JARVIS_TEST_PG_URL points at an empty local test database.
//   node --disable-warning=ExperimentalWarning jarvis/server/test/test-server.mjs
//   JARVIS_TEST_PG_URL=postgres://jarvis:pw@127.0.0.1:5432/jarvis_test node … test-server.mjs
import http from "node:http";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.mjs";
import { cleanClone, parse } from "../lib/clean-clone.mjs";
import { checkUrl, robotsAllows, isBlockedAddress, safeLookup, FetchError } from "../lib/fetch-public.mjs";
import { canonical, sealCapsule, verifyChain, judge } from "../lib/missions.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let passed = 0, failed = 0;
const ok = (cond, name, extra) => { if (cond) passed++; else { failed++; console.log("FAIL " + name + (extra !== undefined ? "  (" + JSON.stringify(extra).slice(0, 300) + ")" : "")); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FIXTURE = `<!doctype html><html><head><title>Acmeflow — Ship faster</title><meta property="og:site_name" content="Acmeflow">
<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script><script>window.dataLayer=[]</script><link rel="stylesheet" href="/a.css"></head>
<body><header><nav><a href="/">Acmeflow</a><a href="/p">Product</a><a href="/pr">Pricing</a><a class="btn" href="/s">Try Acmeflow free</a></nav></header>
<main><section><h1>Acmeflow ships your code faster than anyone else</h1><p>The deployment platform loved by forty thousand teams.</p><a class="btn">Start now</a><a class="btn">Book a demo</a></section>
<section><h2>Why teams pick Acmeflow</h2><div class="grid grid-cols-3"><div><img src="1.png"><h3>Instant builds</h3><p>Builds finish in seconds every time</p></div><div><img src="2.png"><h3>Branch previews</h3><p>Every branch gets its own address</p></div><div><img src="3.png"><h3>One-click rollback</h3><p>Undo a bad deploy right away</p></div></div></section>
<section><div><div><b>99.99%</b> uptime</div><div><b>10M</b> deploys</div><div><b>40k</b> teams</div></div></section>
<section><h2>Compare plans</h2><table><tr><th>Plan</th><th>Hobby</th><th>Pro</th><th>Team</th></tr><tr><td>Builds</td><td>100</td><td>1000</td><td>∞</td></tr><tr><td>Seats</td><td>1</td><td>10</td><td>50</td></tr></table></section>
<section><h2>Questions people ask</h2><details><summary>Is there a free plan?</summary><p>Yes, forever.</p></details><details><summary>Can I cancel at any time?</summary><p>Yes.</p></details><details><summary>Do you sell my data?</summary><p>Never.</p></details></section>
<section><h2>Start shipping with Acmeflow today</h2><a class="btn">Create an account</a></section></main>
<iframe src="https://ads.example/x"></iframe><footer><p>© 2026 Acmeflow Incorporated. All rights reserved.</p></footer></body></html>`;

function raw(port, { method = "GET", path = "/api/health", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, res => { let d = ""; res.on("data", c => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d })); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function suite(mode, opts) {
  const dataDir = mkdtempSync(join(tmpdir(), "jarvis-test-"));
  const stubPage = async url => { if (String(url).includes("blocked")) throw new FetchError("blocked", "Private, loopback and reserved addresses are refused."); return { html: FIXTURE, url, host: "www.acmeflow.example", bytes: FIXTURE.length, robots: "allowed", fetchedAt: new Date().toISOString() }; };
  const s = await startServer({ port: 0, dataDir, quiet: true, fetchPage: stubPage, ...opts });
  const base = `http://127.0.0.1:${s.port}`;
  const H = { "content-type": "application/json", "x-jarvis": "1" };
  const j = async (p, o = {}) => { const r = await fetch(base + p, o); let b = null; try { b = await r.json(); } catch (e) { /* html */ } return { status: r.status, body: b }; };
  const post = (p, body, method = "POST") => j(p, { method, headers: H, body: JSON.stringify(body) });
  const tag = s => `[${mode}] ${s}`;

  // Guards
  ok((await raw(s.port, { headers: { host: "evil.example:" + s.port } })).status === 421, tag("wrong Host header is refused (DNS rebinding)"));
  ok((await raw(s.port, { method: "POST", path: "/api/w/omega-prime/agents", headers: { host: "127.0.0.1:" + s.port, "content-type": "application/json" }, body: "{}" })).status === 403, tag("write without X-Jarvis is refused"));
  ok((await raw(s.port, { method: "POST", path: "/api/w/omega-prime/agents", headers: { host: "127.0.0.1:" + s.port, "content-type": "application/json", "x-jarvis": "1", origin: "https://evil.example" }, body: "{}" })).status === 403, tag("cross-origin write is refused"));
  ok((await raw(s.port, { method: "POST", path: "/api/w/omega-prime/agents", headers: { host: "127.0.0.1:" + s.port, "content-type": "text/plain", "x-jarvis": "1" }, body: "{}" })).status === 415, tag("non-JSON write is refused"));
  ok((await raw(s.port, { method: "POST", path: "/api/w/omega-prime/agents", headers: { host: "127.0.0.1:" + s.port, "content-type": "application/json", "x-jarvis": "1" }, body: JSON.stringify({ name: "x".repeat(70000) }) })).status === 413, tag("oversized body is refused"));
  const health = await raw(s.port, { headers: { host: "127.0.0.1:" + s.port } });
  ok(health.status === 200 && /"mode":"/.test(health.body), tag("health answers on the right Host"));
  ok(!/access-control-allow/i.test(JSON.stringify((await fetch(base + "/api/health")).headers)), tag("no CORS headers are ever sent"));
  ok((await j("/api/nope")).status === 404, tag("unknown route is 404"));
  ok((await fetch(base + "/")).headers.get("content-type").startsWith("text/html"), tag("serves the app page"));

  // Workspaces and isolation
  const ws = (await j("/api/workspaces")).body;
  ok(ws.length === 3 && ws[0].name === "OMEGA PRIME" && ws.map(w => w.slug).join() === "omega-prime,jarvis-studio,giant-core", tag("three workspaces in order"), ws);
  const prime = (await j("/api/w/omega-prime/agents")).body, studio = (await j("/api/w/jarvis-studio/agents")).body;
  ok(prime.length === 2 && studio.length === 2 && !prime.some(a => studio.find(b => b.id === a.id)), tag("each workspace has its own agents"));
  ok((await j(`/api/w/giant-core/agents/${prime[0].id}`)).status === 404, tag("an agent is not readable from another workspace"));
  ok((await j("/api/w/nowhere/agents")).status === 404, tag("unknown workspace is 404"));
  ok((await post("/api/w/giant-core", { name: "giant-core main" }, "PATCH")).body.name === "giant-core main", tag("rename a workspace"));

  // Agent editor
  ok((await post("/api/w/giant-core/agents", { name: "", maxSteps: 5, tools: [] })).body.error === "Give the agent a name.", tag("create: empty name refused"));
  ok((await post("/api/w/giant-core/agents", { name: "Commit summariser", maxSteps: 5, tools: [] })).body.error === "Another agent already has this name.", tag("create: duplicate refused"));
  ok((await post("/api/w/giant-core/agents", { name: "Bad tools", maxSteps: 5, tools: ["shell.exec"] })).status === 400, tag("create: unknown tool refused"));
  const made = (await post("/api/w/giant-core/agents", { name: "Doc reader", model: "Local rules (no model)", rolePrompt: "Reads docs.", maxSteps: 8, tools: ["files.read", "notes.write"], skills: ["replica-design"] }));
  ok(made.status === 201 && made.body.permissions.writeNotes === true && made.body.skills[0] === "replica-design", tag("create an agent with skills and limits"), made.body);
  const edited = (await post(`/api/w/giant-core/agents/${made.body.id}`, { name: "Doc reader v2", model: "Local rules (no model)", rolePrompt: "Reads ADRs only.", maxSteps: 9, tools: ["files.read"], skills: ["replica-diff", "replica-build"] }, "PATCH")).body;
  ok(edited.name === "Doc reader v2" && edited.maxSteps === 9 && edited.permissions.writeNotes === false && edited.skills.length === 2, tag("edit name, role, limits, tools and skills"), edited);
  ok((await post(`/api/w/giant-core/agents/${made.body.id}`, { name: "Doc reader v2", maxSteps: 500, tools: [] }, "PATCH")).body.error === "Enter a whole number from 1 to 200.", tag("edit: bad limit refused"));

  // Real run: files.read on the real ADR folder, summary, then an approval for the note
  const reader = prime.find(a => a.name === "ADR reader");
  const started = await post(`/api/w/omega-prime/agents/${reader.id}/runs`, { path: "docs/adr/ADR-13*" });
  ok(started.status === 201, tag("start a real run"), started.body);
  let run;
  for (let i = 0; i < 40; i++) { run = (await j(`/api/w/omega-prime/runs/${started.body.id}`)).body; if (run.status === "succeeded" || run.status === "failed") break; await sleep(50); }
  const expected = readdirSync(join(repo, "docs", "adr")).filter(f => f.startsWith("ADR-13") && f.endsWith(".md")).length;
  const files = run.steps.find(st => st.tool === "files.read").output.files;
  ok(run.status === "succeeded" && files.length === expected && files.every(f => f.heading && f.bytes > 0), tag("files.read read the real ADR files"), { status: run.status, n: files.length, expected });
  ok(run.log.some(l => /fixed rules/.test(l)) && run.simulated === false, tag("the run says it used fixed rules and is not simulated"));
  ok(run.approval && run.approval.category === "file_write" && run.approval.status === "pending", tag("notes.write became a pending approval"));

  // Path safety
  for (const bad of ["../../etc/passwd", "jarvis/server/server.mjs", "/etc/hosts", "docs/../.git/config"]) {
    const r = await post(`/api/w/omega-prime/agents/${reader.id}/runs`, { path: bad });
    let rr; for (let i = 0; i < 40; i++) { rr = (await j(`/api/w/omega-prime/runs/${r.body.id}`)).body; if (rr.status === "failed" || rr.status === "succeeded") break; await sleep(50); }
    ok(rr.status === "failed" && /allowed folders|Only docs/.test(rr.log.join(" ")), tag("path refused: " + bad), rr.log);
  }

  // One active run per agent, enforced by the database
  const gid = await s.store.workspaceIdOf("omega-prime");
  await s.store.createRun("omega-prime", reader.id, {}, ["plan"]);
  let conflict = null;
  try { await s.store.createRun("omega-prime", reader.id, {}, ["plan"]); } catch (e) { conflict = e; }
  ok(conflict && conflict.status === 409, tag("a second active run for the same agent is refused"), conflict && conflict.message);
  const active = (await j("/api/w/omega-prime/runs")).body.find(r => r.status === "queued");
  ok((await post(`/api/w/omega-prime/runs/${active.id}/cancel`, {})).body.status === "cancelled", tag("cancel a run"));

  // Approvals
  ok((await post(`/api/w/omega-prime/approvals/${run.approval.id}/decide`, { decision: "rejected" })).body.error === "Say why, so the agent can do something else.", tag("reject without a reason is refused"));
  const approved = (await post(`/api/w/omega-prime/approvals/${run.approval.id}/decide`, { decision: "approved" })).body;
  const notePath = join(dataDir, approved.written || "missing");
  ok(approved.status === "approved" && existsSync(notePath) && readFileSync(notePath, "utf8").startsWith("# ADR reader"), tag("approving writes the real note file"), approved);
  ok((await post(`/api/w/omega-prime/approvals/${run.approval.id}/decide`, { decision: "approved" })).status === 409, tag("deciding twice is refused"));
  const all = (await j("/api/w/omega-prime/approvals")).body;
  const money = all.find(p => p.category === "money");
  const r403 = await post(`/api/w/omega-prime/approvals/${money.id}/decide`, { decision: "approved" });
  ok(r403.status === 403 && /database refuses/.test(r403.body.error), tag("API: approving a locked request is refused by the database"), r403.body);
  ok(money.payload.sample === true, tag("seeded locked requests are marked sample"));

  // The same rules hold for any SQL client, not just the API
  const db = s.db;
  const owner = (await db.one("select id from members where workspace_id = $1", [gid])).id;
  let e1 = null; try { await db.run("update approvals set status = 'approved', decided_by = $1, decided_at = $2 where id = $3", [owner, new Date().toISOString(), money.id]); } catch (e) { e1 = e; }
  ok(e1 && /approvals_locked_never_approved/.test(e1.message + (e1.constraint || "")), tag("SQL: a locked request cannot be approved"), e1 && e1.message);
  const fw = await s.store.createApproval(gid, { category: "file_write", action: "test", payload: {}, actor: "agent:test" });
  let e2 = null; try { await db.run("update approvals set status = 'approved' where id = $1", [fw]); } catch (e) { e2 = e; }
  ok(e2 && /approvals_decided_by_member/.test(e2.message + (e2.constraint || "")), tag("SQL: approval without a person is refused"), e2 && e2.message);
  let e3 = null; try { await db.run("update events set kind = 'edited'"); } catch (e) { e3 = e; }
  let e4 = null; try { await db.run("delete from events"); } catch (e) { e4 = e; }
  ok(e3 && e4 && /append-only/.test(e3.message) && /append-only/.test(e4.message), tag("SQL: the event log cannot be edited or deleted"));

  // Stats and events
  const st = (await j("/api/w/omega-prime/stats")).body;
  ok(st.agents === 2 && st.locked === 2 && st.waiting >= 1, tag("stats count this workspace only"), st);
  const evs = (await j("/api/w/omega-prime/events")).body;
  ok(evs.some(e => e.kind === "file.written") && evs.some(e => e.kind === "approval.approved"), tag("events record the write and the decision"));

  // Long-horizon missions (ADR-135)
  const waitMission = async (slugName, id, want) => { let d; for (let i = 0; i < 100; i++) { d = (await j(`/api/w/${slugName}/missions/${id}`)).body; if (want.includes(d.status)) return d; await sleep(40); } return d; };
  const seeded = {};
  for (const w of ["omega-prime", "jarvis-studio", "giant-core"]) seeded[w] = (await j(`/api/w/${w}/missions`)).body;
  ok(seeded["giant-core"].length === 1 && seeded["giant-core"][0].template === "release-readiness" && seeded["jarvis-studio"][0].template === "design-audit" && seeded["omega-prime"][0].template === "adr-digest", tag("each workspace has a seeded draft mission"), Object.values(seeded).map(x => x.map(y => y.template)));
  const mid = seeded["jarvis-studio"][0].id;
  ok((await j(`/api/w/giant-core/missions/${mid}`)).status === 404, tag("a mission is not readable from another workspace"));
  let md = (await j(`/api/w/jarvis-studio/missions/${mid}`)).body;
  ok(md.status === "draft" && md.steps.length === 6 && new Set(md.steps.map(x => x.phase)).size === 4 && md.capsules.length === 0, tag("draft mission: 6 steps in 4 phases, no capsule yet"), md.steps && md.steps.map(x => x.phase));
  ok((await post(`/api/w/jarvis-studio/missions/${mid}/run`, {})).status === 200, tag("start a mission"));
  md = await waitMission("jarvis-studio", mid, ["awaiting_approval", "succeeded", "failed"]);
  const st0 = md.steps;
  ok(md.status === "awaiting_approval", tag("mission stops at the approvals, not before"), md.steps.map(x => x.idx + ":" + x.status));
  ok(st0[0].status === "done" && st0[0].output.files.length > 3, tag("tool step read the real design folder"), st0[0].output);
  ok(st0[1].gateStatus === "pass" && st0[1].status === "done" && /0 failing/.test(st0[1].output.results[0].detail), tag("contrast gate passed on the saved report"), st0[1].output);
  ok(st0[2].gateStatus === "pass" && /critical 0, high 0/.test(st0[2].output.results[0].detail) && st0[2].gates.length === 1, tag("security gate passed on the SkillSpector scan and logged a gate row"), st0[2]);
  ok(st0[3].status === "blocked" && st0[3].locked === true && st0[3].approval && st0[3].approval.status === "pending", tag("install step waits as a locked approval"), st0[3]);
  ok(st0[4].status === "blocked" && st0[4].locked === false, tag("note step waits for a person"));
  ok(st0[5].status === "queued", tag("the step that needs the note waits"));
  ok(md.capsules.length >= 3 && md.chain.ok && md.capsules[0].prevHash === "0".repeat(64) && md.capsules[1].prevHash === md.capsules[0].hash, tag("capsules saved after each phase and chained"), md.chain);
  ok(typeof md.health.score === "number" && /\[INFERENCE\]/.test(md.health.basis), tag("context health is a labelled heuristic"), md.health);
  const mdir = join(dataDir, md.files.dir);
  const planText = readFileSync(join(mdir, "task_plan.md"), "utf8");
  ok(/- \[x\] T1: /.test(planText) && /- \[ \] T4: .*\{gate: approval; ac: AC2\}/.test(planText) && readFileSync(join(mdir, "progress.md"), "utf8").includes("Capsule #1") && /AC1: `jarvis\/replica\/design\/contrast-report.txt`/.test(readFileSync(join(mdir, "findings.md"), "utf8")), tag("the three plan files follow the mission"), planText);
  // Locked approval from a mission: the API and the database refuse it.
  const lockedDecide = await post(`/api/w/jarvis-studio/approvals/${st0[3].approvalId}/decide`, { decision: "approved" });
  ok(lockedDecide.status === 403, tag("API: a mission's locked step cannot be approved"), lockedDecide.body);
  let e5 = null; try { await s.db.run("update mission_steps set status = 'done' where id = $1", [st0[3].id]); } catch (e) { e5 = e; }
  ok(e5 && /mission_steps_locked_never_done/.test(e5.message + (e5.constraint || "")), tag("SQL: a locked mission step can never be done"), e5 && e5.message);
  let e6 = null; try { await s.db.run("update mission_steps set gate_status = 'fail' where id = $1", [st0[1].id]); } catch (e) { e6 = e; }
  ok(e6 && /mission_steps_gate_before_done/.test(e6.message + (e6.constraint || "")), tag("SQL: a done gate step must have passed"), e6 && e6.message);
  let e7 = null; try { await s.db.run("update capsules set label = 'edited' where mission_id = $1", [mid]); } catch (e) { e7 = e; }
  let e8 = null; try { await s.db.run("delete from capsules where mission_id = $1", [mid]); } catch (e) { e8 = e; }
  ok(e7 && e8 && /append-only/.test(e7.message) && /append-only/.test(e8.message), tag("SQL: capsules cannot be edited or deleted"));
  // Approving the note writes it and the mission carries on with the steps that need it.
  const noteOk = (await post(`/api/w/jarvis-studio/approvals/${st0[4].approvalId}/decide`, { decision: "approved" })).body;
  ok(noteOk.mission === mid && noteOk.written && existsSync(join(dataDir, noteOk.written)) && readFileSync(join(dataDir, noteOk.written), "utf8").includes("## Gate evidence"), tag("approving the mission note writes it with the gate evidence"), noteOk);
  md = await waitMission("jarvis-studio", mid, ["awaiting_approval"]);
  for (let i = 0; i < 50 && md.steps[5].status !== "done"; i++) { await sleep(40); md = (await j(`/api/w/jarvis-studio/missions/${mid}`)).body; }
  ok(md.steps[4].status === "done" && md.steps[5].status === "done" && md.steps[3].status === "blocked" && md.status === "awaiting_approval", tag("independent steps finished while the locked one still waits"), md.steps.map(x => x.idx + ":" + x.status));
  ok((await post(`/api/w/jarvis-studio/missions/${mid}/steps/0/skip`, {})).status === 409, tag("only a waiting step can be skipped"));
  await post(`/api/w/jarvis-studio/missions/${mid}/steps/3/skip`, {});
  md = await waitMission("jarvis-studio", mid, ["succeeded", "failed"]);
  ok(md.status === "succeeded" && md.steps[3].status === "skipped" && md.capsules[md.capsules.length - 1].label === "finished", tag("carrying on without the locked step finishes the mission"), md.status);
  ok((await j("/api/w/jarvis-studio/approvals")).body.find(p => p.id === st0[3].approvalId).status === "pending", tag("the skipped locked request stays pending in the inbox"));
  const ver = (await j(`/api/w/jarvis-studio/missions/${mid}/verify`)).body;
  const cap1 = (await j(`/api/w/jarvis-studio/missions/${mid}/capsules/1`)).body;
  ok(ver.ok && ver.count === md.capsules.length && cap1.hashOk && cap1.state.steps.length === 6, tag("verify the chain and inspect a capsule"), ver);
  ok((await post(`/api/w/jarvis-studio/missions/${mid}/run`, {})).status === 409, tag("a finished mission does not run again without a restore"));
  const restored = (await post(`/api/w/jarvis-studio/missions/${mid}/capsules/1/restore`, {})).body;
  ok(restored.status === "paused" && restored.steps[0].status === "done" && restored.steps[1].status === "queued" && restored.steps[1].gateStatus === "none" && restored.capsules[restored.capsules.length - 1].label === "restored from #1" && restored.chain.ok, tag("restore puts every step back and seals a new capsule"), restored.steps && restored.steps.map(x => x.status));
  await post(`/api/w/jarvis-studio/missions/${mid}/run`, {});
  md = await waitMission("jarvis-studio", mid, ["awaiting_approval", "failed"]);
  ok(md.status === "awaiting_approval" && md.steps[1].gateStatus === "pass" && md.steps[3].status === "blocked", tag("a restored mission runs again from the capsule"), md.steps.map(x => x.idx + ":" + x.status));
  const again = (await post(`/api/w/jarvis-studio/missions/${mid}/capsules/1/restore`, {})).body;
  ok(again.status === "paused" && again.chain.ok, tag("restore while waiting for approval is allowed"), again.status);
  // A failing gate stops the steps that need it; others carry on.
  s.missions.TEMPLATES["test-fail"] = { title: "Failing gate", goal: "Test", steps: [
    { phase: 1, kind: "gate", title: "Missing evidence", criteria: [{ check: "tests", evidence: "jarvis/replica/evidence/does-not-exist.log" }] },
    { phase: 1, kind: "gate", title: "Outside evidence", criteria: [{ check: "tests", evidence: "../../etc/passwd" }] },
    { phase: 2, kind: "tool", title: "Needs the gate", tool: "git.log", depends: [0] },
    { phase: 2, kind: "tool", title: "Independent", tool: "notes.read" },
  ] };
  const fm = (await post("/api/w/giant-core/missions", { template: "test-fail", title: "Failing gate test" })).body;
  delete s.missions.TEMPLATES["test-fail"];
  await post(`/api/w/giant-core/missions/${fm.id}/run`, {});
  const fd = await waitMission("giant-core", fm.id, ["succeeded", "failed"]);
  ok(fd.status === "failed" && fd.steps[0].gateStatus === "fail" && /No evidence file/.test(fd.steps[0].output.results[0].detail) && /must live under/.test(fd.steps[1].output.results[0].detail) && fd.steps[2].status === "skipped" && fd.steps[3].status === "done", tag("a failed gate skips what needs it; the rest still runs"), fd.steps && fd.steps.map(x => x.idx + ":" + x.status));
  ok((await post("/api/w/giant-core/missions", { template: "nope" })).status === 400 && (await post("/api/w/giant-core/missions", { template: "release-readiness", capsuleEvery: 20 })).status === 400, tag("mission create validates template and capsule interval"));
  // Pause saves a capsule.
  const pm = (await post("/api/w/giant-core/missions", { template: "release-readiness", capsuleEvery: 2 })).body;
  ok(pm.capsuleEvery === 2, tag("capsule interval is stored"));
  // Agent long-horizon mode: a run becomes a mission.
  const lhAgent = (await j("/api/w/giant-core/agents")).body.find(a => a.name === "Commit summariser");
  const patched = (await post(`/api/w/giant-core/agents/${lhAgent.id}`, { name: lhAgent.name, model: lhAgent.model, rolePrompt: lhAgent.rolePrompt, maxSteps: 12, tools: lhAgent.tools, skills: lhAgent.skills, mode: "long_horizon", capsuleEvery: 1 }, "PATCH")).body;
  ok(patched.mode === "long_horizon" && patched.capsuleEvery === 1, tag("agent editor stores the long-horizon mode"), patched);
  ok((await post(`/api/w/giant-core/agents/${lhAgent.id}`, { name: lhAgent.name, maxSteps: 12, tools: [], mode: "forever" }, "PATCH")).status === 400, tag("agent editor refuses an unknown mode"));
  const lhRun = (await post(`/api/w/giant-core/agents/${lhAgent.id}/runs`, {})).body;
  ok(typeof lhRun.mission === "string", tag("a long-horizon agent starts a mission"), lhRun);
  const lhd = await waitMission("giant-core", lhRun.mission, ["awaiting_approval", "succeeded", "failed"]);
  ok(lhd.status === "awaiting_approval" && lhd.agentId === lhAgent.id && lhd.steps[0].tool === "git.log" && lhd.steps[0].status === "done" && lhd.steps[lhd.steps.length - 1].category === "file_write", tag("the agent's mission ran its tools and waits for the note"), lhd.steps && lhd.steps.map(x => x.title + ":" + x.status));

  // Clean-room clone through the API
  const cc = await post("/api/studio/clean-clone", { url: "https://www.acmeflow.example/" });
  ok(cc.status === 200 && cc.body.report.sweep.leaks === 0 && !JSON.stringify(cc.body.blocks).includes("Acmeflow"), tag("clean-clone by URL keeps no source text"), cc.body.report);
  const types = cc.body.blocks.map(b => b.type).join(">");
  ok(types === "nav>hero>features>stats>table>faq>cta>footer", tag("clean-clone finds every section in order"), types);
  ok(cc.body.report.dropped.trackers === 1 && cc.body.report.dropped.scripts === 2 && cc.body.report.dropped.images === 3 && cc.body.report.dropped.frames === 1, tag("clean-clone reports what it dropped"), cc.body.report.dropped);
  const table = cc.body.blocks.find(b => b.type === "table");
  ok(table.cols === 4 && table.rows === 2, tag("table shape kept (4 columns, 2 rows)"), table);
  ok((await post("/api/studio/clean-clone", { html: FIXTURE })).body.report.source === "pasted HTML", tag("clean-clone from pasted HTML"));
  ok((await post("/api/studio/clean-clone", { url: "https://blocked.example/" })).status === 400, tag("clean-clone passes a refusal through"));
  ok((await post("/api/studio/clean-clone", {})).status === 400, tag("clean-clone needs a URL or HTML"));

  await s.close();
}

// Pure checks (no server)
for (const u of ["http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://localhost/", "http://intranet/", "file:///etc/passwd", "https://user:pw@example.com/", "https://example.com:8443/"]) {
  let e = null; try { checkUrl(u); } catch (x) { e = x; }
  ok(e instanceof FetchError, "checkUrl refuses " + u);
}
ok(checkUrl("https://example.com/a?b=1#frag").toString() === "https://example.com/a?b=1", "checkUrl keeps a public URL and drops the fragment");
ok(isBlockedAddress("::ffff:10.1.2.3") && isBlockedAddress("fd00::1") && !isBlockedAddress("93.184.216.34") && !isBlockedAddress("2606:4700::1111"), "address ranges");
const lk = await new Promise(r => safeLookup("localhost", {}, (err) => r(err)));
ok(lk instanceof FetchError && lk.code === "blocked", "safeLookup refuses a name that resolves to loopback");
ok(robotsAllows("User-agent: *\nDisallow: /private", "/private/x") === false && robotsAllows("User-agent: *\nDisallow: /private", "/public") === true, "robots: * group");
ok(robotsAllows("User-agent: *\nDisallow: /\n\nUser-agent: JarvisCleanClone\nAllow: /", "/x") === true, "robots: our own group wins");
ok(robotsAllows("User-agent: *\nDisallow: /a\nAllow: /a/b", "/a/b/c") === true, "robots: longest match wins");
const p = parse("<p>a &amp; b <script>x</script><style>y</style>c</p>");
ok(p.counts.scripts === 1 && p.counts.styles === 1, "parser skips script and style bodies");
const solo = cleanClone("<h2>Only text here</h2><p>Some words</p>");
ok(solo.blocks.some(b => b.type === "hero") && solo.report.sweep.leaks === 0, "a bare page still gets a hero and no leaks", solo.blocks.map(b => b.type));

// Capsule hashing, chain checks and the gate's evidence rules
ok(canonical({ b: 1, a: [1, "x", { d: null, c: "é" }] }) === '{"a":[1,"x",{"c":"é","d":null}],"b":1}', "canonical JSON sorts keys at every level (same as lhcommon.canonical)");
const c1 = { mission_id: "m", seq: 1, label: "one", state: { a: 1 }, prev_hash: "0".repeat(64), created_at: "2026-11-04T00:00:00.000Z" };
c1.hash = sealCapsule(c1);
const c2 = { mission_id: "m", seq: 2, label: "two", state: { a: 2 }, prev_hash: c1.hash, created_at: "2026-11-04T00:00:01.000Z" };
c2.hash = sealCapsule(c2);
ok(verifyChain([c1, c2], "m").ok, "a sealed chain verifies");
ok(!verifyChain([c1, { ...c2, state: { a: 3 } }], "m").ok, "an edited capsule breaks the chain");
ok(!verifyChain([c2], "m").ok && !verifyChain([c1, { ...c2, prev_hash: "f".repeat(64) }], "m").ok, "a missing or relinked capsule breaks the chain");
ok(judge("tests", "x\n12 passed, 0 failed\n").ok && !judge("tests", "12 passed, 1 failed").ok && !judge("tests", "0 passed, 0 failed").ok && judge("tests", "Ran 10 tests in 0.1s\n\nOK\n").ok, "tests evidence rules");
ok(judge("contrast", "118 checks, 0 failing AA").ok && !judge("contrast", "FAIL  dark 3.1:1\n118 checks, 1 failing").ok, "contrast evidence rules");
ok(judge("security", '{"summary":{"critical":0,"high":0}}').ok && !judge("security", '{"summary":{"critical":0,"high":2}}').ok && !judge("security", "not json").ok, "security evidence rules");
ok(judge("lint", "All checks passed!").ok && !judge("lint", "error: x\n0 errors").ok, "lint evidence rules");

await suite("sqlite", { mode: "sqlite" });
if (process.env.JARVIS_TEST_PG_URL) await suite("postgres", { mode: "postgres", databaseUrl: process.env.JARVIS_TEST_PG_URL });
else console.log("skip: PostgreSQL suite (set JARVIS_TEST_PG_URL to an empty local test database)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
