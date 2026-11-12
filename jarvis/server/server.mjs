#!/usr/bin/env node
// Jarvis local server (ADR-134): serves the app and its API on 127.0.0.1 only.
//
//   node --disable-warning=ExperimentalWarning jarvis/server/server.mjs           # SQLite, zero setup
//   JARVIS_DB=postgres DATABASE_URL=postgres://jarvis@127.0.0.1:5432/jarvis \
//     node jarvis/server/server.mjs                                              # local PostgreSQL 16
//   open http://127.0.0.1:8798
//
// Guards: binds 127.0.0.1; the Host header must be 127.0.0.1 or localhost on this port (DNS
// rebinding); every write needs the X-Jarvis header and, when the browser sends one, a same-origin
// Origin (cross-site requests); JSON bodies only, size-capped; no CORS headers at all.
// What it never does: move money, publish, change permissions, install skills or send messages.
// Those exist only as approval rows the database refuses to approve (AGENTS.md §1).
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSqlite, openPostgres } from "./lib/db.mjs";
import { createStore, seed, StoreError } from "./lib/store.mjs";
import { createRunner } from "./lib/runner.mjs";
import { createMissions } from "./lib/missions.mjs";
import { createOllamaBridge, BridgeError, isLocalModelEngine } from "./lib/ollama-bridge.mjs";
import { createPlatform } from "./lib/platform.mjs";
import { createMemory } from "./lib/memory.mjs";
import { cleanClone } from "./lib/clean-clone.mjs";
import { fetchPublicPage, fetchPublicResource, FetchError } from "./lib/fetch-public.mjs";
import { createOpenWebSearch, SearchError } from "./lib/open-web-search.mjs";
import { createFounderGate, loginPage, GateError } from "./lib/founder-gate.mjs";
import { createAccess } from "./lib/access.mjs";
import { createSkillLoader } from "./lib/skill-loader.mjs";
import { createStudio } from "./lib/studio.mjs";
import { runCouncil } from "./lib/council.mjs";
import { provePlan } from "./lib/prover.mjs";
import { createAuditLog } from "./lib/audit-log.mjs";
import { createTelemetry } from "./lib/telemetry.mjs";
import { createReadiness } from "./lib/readiness.mjs";
import { createReversalLog } from "./lib/reversal-log.mjs";
import { createPassiveRecon } from "./lib/passive-recon.mjs";
import { solve as solveMath, localize as localizeMath, umText } from "./lib/universal-math.mjs";
import { hyper as hyperStudio, hyperSvg } from "./lib/hyper-studio.mjs";
import { solutionLines, typesetSvg } from "./lib/math-typeset.mjs";
import { compileCinematic, presetList } from "./lib/cinematic-presets.mjs";
import { fallbackPlan } from "./lib/llm-plan.mjs";
import { compileMetacodes, mcText } from "./lib/prompt-metacodes.mjs";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export async function startServer({ port = Number(process.env.JARVIS_PORT || 8798), mode = process.env.JARVIS_DB || "sqlite", databaseUrl = process.env.DATABASE_URL, dataDir = process.env.JARVIS_DATA_DIR || join(here, ".data"), sqliteFile, fetchPage = fetchPublicPage, ollamaUrl, ollamaFetch, openaiUrl, searchRequest, searxngUrl, skillRequest, reconFetch = fetchPublicResource, founderKey, publicHost, quiet = false } = {}) {
  // ADR-141: the founder gate is on when JARVIS_FOUNDER_KEY is set; a bad key or public host stops the start.
  const gate = createFounderGate({ ...(founderKey !== undefined ? { key: founderKey } : {}), ...(publicHost !== undefined ? { publicHost } : {}) });
  const login = loginPage(t => createHash("sha256").update(t).digest("base64"));
  // Refuses at start any Ollama address that is not http://127.0.0.1:<port> (ADR-136).
  // Live open-web search (ADR-139): official keyless JSON APIs on fixed hosts; a bad SearXNG address is refused at start.
  const search = createOpenWebSearch({ ...(searchRequest ? { request: searchRequest } : {}), ...(searxngUrl !== undefined ? { searxngUrl } : {}) });
  // ADR-140: an OpenAI-compatible server (vLLM, llama.cpp, Ollama /v1) may replace Ollama native; also pinned to 127.0.0.1.
  const llm = createOllamaBridge({ ...(ollamaUrl ? { baseUrl: ollamaUrl } : {}), ...(ollamaFetch ? { fetchImpl: ollamaFetch } : {}), ...(openaiUrl !== undefined ? { openaiUrl } : {}) });
  const db = mode === "postgres" ? await openPostgres(databaseUrl || "") : await openSqlite(sqliteFile || join(dataDir, "jarvis.sqlite"));
  await seed(db);
  const store = createStore(db);
  const runner = createRunner({ store, repoRoot, dataDir });
  let platform = null, memory = null;
  const missions = createMissions({ store, runner, db, repoRoot, dataDir, onEvent: async (slug, kind, data) => {
    if (platform) await platform.dispatch(slug, kind, data);
    // A finished mission becomes a remembered plan; one that passed every gate ranks higher.
    if (memory && kind === "mission.finished") {
      const m = await missions.detail(slug, data.id).catch(() => null);
      if (m) {
        const gates = m.steps.filter(s => s.kind === "gate");
        await memory.add(slug, { kind: "plan", title: m.title, body: m.goal + "\n\n" + m.steps.map(s => `${s.phase}. ${s.title} [${s.kind}${s.locked ? ", locked" : ""}] ${s.status}`).join("\n"),
          tags: ["mission", m.template], outcome: { succeeded: m.status === "succeeded", gatesPassed: gates.length > 0 && gates.every(s => s.gateStatus === "pass") }, source: "mission" }).catch(() => {});
      }
    }
  } });
  await missions.seedMissions();
  platform = createPlatform({ db, store, runner, missions, dataDir });
  memory = createMemory({ db, store, llm });
  const access = createAccess({ db, store });
  const studio = createStudio({ db, store });
  // ADR-147: sensitive events become leaves of the workspace's Merkle tree; telemetry is measured in process.
  const audit = createAuditLog({ db, store });
  store.onEvent = audit.append;
  const telemetry = createTelemetry({ db, store });
  // ADR-148: the five layers' readiness and the scrubbed diagnostics bundle (read-only).
  const readiness = createReadiness({ db, store, llm, search, audit, repoRoot, address: () => (server.address() || {}).address });
  // ADR-150: the reversal engine corrects plans and templates; each correction is logged, audited and remembered.
  const reversal = createReversalLog({ db, store, memory });
  // ADR-152: passive recon of a domain: RDAP, certificate logs, response headers, security.txt (four GETs).
  const recon = createPassiveRecon({ fetchResource: reconFetch });
  const latency = new Map();
  // Flushes run one after another, so awaiting one also waits for a timer flush that is still writing.
  let flushing = Promise.resolve();
  const flushLatency = () => (flushing = flushing.then(() => Promise.all([...latency].map(([slug, points]) => { latency.delete(slug); return telemetry.record(slug, { points: points.slice(-1000) }).catch(() => {}); }))));
  const latencyTimer = setInterval(flushLatency, 2000);
  // ADR-142: GitHub reads go through the open-web search's request function (fixed host, SSRF shield).
  const loader = createSkillLoader({ db, store, llm, ...(skillRequest ? { request: skillRequest } : {}) });
  await access.ensure();
  await platform.seed();
  // Scheduled runs (ADR-137): due schedules start every 30 s while the server runs.
  const ticker = setInterval(() => { platform.tick().catch(() => {}); }, 30000);
  ticker.unref();
  const streams = new Set();
  // Token use is estimated as characters ÷ 4 [INFERENCE] and always costs the creator 0.
  const usage = (slug, engine, model, chars, ref) => slug ? platform.recordUsage(slug, { engine, model, tokens: Math.ceil(chars / 4), ref }).catch(() => {}) : null;
  const pages = { "/": join(repoRoot, "jarvis", "app", "index.html"), "/design": join(repoRoot, "jarvis", "design", "index.html") };

  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = "application/json; charset=utf-8") => {
      res.writeHead(status, {
        "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Cross-Origin-Resource-Policy": "same-origin",
        ...(type.startsWith("application/json") ? { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" } : {}),
      });
      res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
    };
    const fail = (status, message) => send(status, { error: message });
    try {
      const actualPort = server.address().port;
      const okHosts = gate.hosts(actualPort);
      if (!okHosts.includes(String(req.headers.host || ""))) return fail(421, "Wrong Host header. Open http://127.0.0.1:" + actualPort + ".");
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      // ADR-147: how long each workspace request takes, as real telemetry (api.latency_ms); not the stream.
      const timed = /^\/api\/w\/([a-z0-9-]{1,40})\/(?!stream|telemetry|events\/stream)/.exec(path);
      if (timed) { const t0 = performance.now(); res.on("finish", () => { const list = latency.get(timed[1]) || []; list.push({ metric: "api.latency_ms", value: Math.round((performance.now() - t0) * 100) / 100, t: Date.now() }); latency.set(timed[1], list); }); }

      // ADR-141: founder gate. The sign-in page and its two routes are open; webhooks carry their own
      // HMAC signature; everything else needs the founder's session when the gate is on.
      if (req.method === "GET" && path === "/login") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": login.csp, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
        return res.end(login.html);
      }
      const gateOpen = path === "/api/founder/login" || path === "/api/founder/status" || path === "/api/founder/logout" || /^\/api\/hooks\//.test(path);
      if (!gateOpen && !gate.allowed(req)) {
        if (req.method === "GET" && pages[path]) { res.writeHead(302, { Location: "/login", "Cache-Control": "no-store" }); return res.end(); }
        return fail(401, "Founder sign-in needed.");
      }

      if (req.method === "GET" && pages[path]) {
        if (!existsSync(pages[path])) return fail(404, "Build the page first: node jarvis/scripts/build-app.mjs");
        return send(200, readFileSync(pages[path]), "text/html; charset=utf-8");
      }
      if (!path.startsWith("/api/")) return fail(404, "Not found.");

      // Incoming webhooks (ADR-137): a local tool posts JSON signed with the hook's HMAC-SHA256 secret.
      // No browser may post here (an Origin header is refused); the Host check above still applies.
      let hm;
      if (req.method === "POST" && (hm = /^\/api\/hooks\/([\w-]{1,64})$/.exec(path))) {
        if (req.headers.origin) return fail(403, "Browsers cannot post to a webhook.");
        if (!/^application\/json\b/.test(String(req.headers["content-type"] || ""))) return fail(415, "Send JSON.");
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > 64 * 1024) return fail(413, "The request is too large."); chunks.push(c); }
        return send(200, await platform.receive(hm[1], Buffer.concat(chunks), req.headers["x-jarvis-signature"]));
      }

      let body = {};
      if (req.method !== "GET") {
        if (req.headers["x-jarvis"] !== "1") return fail(403, "Missing the X-Jarvis header.");
        const origin = req.headers.origin;
        if (origin && !gate.origins(actualPort).includes(origin)) return fail(403, "Cross-origin writes are refused.");
        if (!/^application\/json\b/.test(String(req.headers["content-type"] || ""))) return fail(415, "Send JSON.");
        const limit = path === "/api/studio/clean-clone" ? 2.5 * 1024 * 1024 : /\/studio\/snapshots$/.test(path) ? 512 * 1024 : 64 * 1024;
        const chunks = [];
        let size = 0;
        for await (const c of req) { size += c.length; if (size > limit) return fail(413, "The request is too large."); chunks.push(c); }
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch (e) { return fail(400, "The request is not valid JSON."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "The request must be a JSON object.");
      }

      const R = (method, re) => req.method === method && re.exec(path);
      let m;
      // ADR-141: founder session and the locked access mode.
      if (R("GET", /^\/api\/founder\/status$/)) return send(200, { gate: gate.enabled, signedIn: gate.allowed(req), publicHost: gate.publicHost });
      if (R("POST", /^\/api\/founder\/login$/)) {
        const r = gate.login(req, body.key);
        if (r.cookie) res.setHeader("Set-Cookie", r.cookie);
        return send(200, { ok: true, gate: gate.enabled });
      }
      if (R("POST", /^\/api\/founder\/logout$/)) { res.setHeader("Set-Cookie", gate.logout(req)); return send(200, { ok: true }); }
      if (R("GET", /^\/api\/access$/)) return send(200, { ...(await access.status()), gate: gate.enabled, publicHost: gate.publicHost });
      if (R("PATCH", /^\/api\/access$/)) {
        if (body.mode === "founder_private") return send(200, await access.status());
        const ws = typeof body.workspace === "string" && /^[a-z0-9-]{1,40}$/.test(body.workspace) ? body.workspace : null;
        if (!ws) return fail(400, "Name the workspace the request belongs to.");
        // Changing the mode itself is refused (403); the request is recorded as a locked card.
        const r = await access.requestPublic(ws);
        return send(403, { error: "Opening Jarvis to the public is locked. A «قيد الموافقة» card waits for Director 00.", ...r });
      }
      if (R("GET", /^\/api\/health$/)) return send(200, { ok: true, mode: db.kind, where: db.where, runs: "real (fixed-rule planner, no model)", version: 1 });
      if (R("GET", /^\/api\/workspaces$/)) return send(200, await store.listWorkspaces());
      if (R("GET", /^\/api\/llm\/status$/)) return send(200, await llm.status());
      if (R("POST", /^\/api\/llm\/run$/)) {
        const ws = typeof body.workspace === "string" && /^[a-z0-9-]{1,40}$/.test(body.workspace) ? body.workspace : null;
        const examples = ws && body.mode !== "shell" ? await memory.examples(ws, String(body.prompt || "")) : [];
        const out = await llm.run({ mode: body.mode, prompt: body.prompt, lang: body.lang, model: body.model, examples });
        if (ws) {
          await usage(ws, out.engine, out.model, String(body.prompt || "").length + JSON.stringify(out.text || out.steps || out.blocks || "").length + String(out.thinking || "").length, "llm." + out.mode);
          // Remember what was made: a design that kept no source text and passes contrast ranks higher.
          const summary = out.mode === "design" ? "Sections: " + out.report.sections.join(", ") : out.mode === "plan" ? out.steps.map(s => `${s.phase}. ${s.title} [${s.kind}${s.locked ? ", locked" : ""}]`).join("\n") : String(out.text || "");
          await memory.add(ws, { kind: out.mode === "chat" ? "answer" : out.mode, title: String(body.prompt).slice(0, 160), body: summary.slice(0, 8000) || "(empty)", tags: ["llm", out.engine],
            outcome: out.mode === "design" ? { contrast: true, cleanRoom: out.report.sweep.leaks === 0 } : { engine: isLocalModelEngine(out.engine) }, source: out.engine }).catch(() => {});
        }
        // ADR-150: a model plan that left a sensitive step unlocked is corrected by rule anyway; the log says so.
        if (ws && out.mode === "plan" && out.rawSteps) out.reversal = await reversal.plan(ws, out.rawSteps, "local model " + (out.model || "")).catch(() => null);
        return send(200, { ok: true, ...out });
      }
      // ADR-140: a chat answer, token by token, as Server-Sent Events over this same-origin POST.
      if (R("POST", /^\/api\/llm\/stream$/)) {
        const ws = typeof body.workspace === "string" && /^[a-z0-9-]{1,40}$/.test(body.workspace) ? body.workspace : null;
        if (ws) await store.workspaceIdOf(ws);
        const prompt = String(body.prompt || "").trim();
        if (!prompt) return fail(400, "Write what you want first.");
        if (prompt.length > 8000) return fail(400, "Keep it under 8,000 characters.");
        const examples = ws ? await memory.examples(ws, prompt) : [];
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Connection: "keep-alive" });
        const ev = (name, data) => { if (!res.writableEnded) res.write("event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n"); };
        const stop = new AbortController();
        res.on("close", () => stop.abort());
        let out;
        try {
          out = await llm.streamChat({ prompt, model: body.model || undefined, examples, lang: body.lang === "ar" ? "ar" : "en", signal: stop.signal, onToken: t => ev("token", { t }), onThinking: t => ev("thinking", { t }) });
        } catch (e) { ev("error", { message: e.message }); return res.end(); }
        ev("done", { engine: out.engine, model: out.model, warning: out.warning, chars: out.content.length, memoryUsed: out.memoryUsed || [], label: isLocalModelEngine(out.engine) ? "[INFERENCE - local LLM] [UNTRUSTED_MODEL_OUTPUT]" : "fixed rules (no model)" });
        if (ws && isLocalModelEngine(out.engine) && out.content) {
          await usage(ws, out.engine, out.model, prompt.length + out.content.length + out.thinking.length, "llm.stream");
          await memory.add(ws, { kind: "answer", title: prompt.slice(0, 160), body: out.content.slice(0, 8000), tags: ["llm", "stream", out.engine], outcome: { engine: true }, source: out.engine }).catch(() => {});
        }
        return res.end();
      }
      // ADR-144: the council (architect, red team and UX critic, synthesizer); the rules have the last word.
      if (R("POST", /^\/api\/llm\/council$/)) {
        const ws = typeof body.workspace === "string" && /^[a-z0-9-]{1,40}$/.test(body.workspace) ? body.workspace : null;
        let out;
        try { out = await runCouncil(llm, { mode: body.mode, prompt: body.prompt, lang: body.lang }); }
        catch (e) { return fail(e.status || 500, e.message); }
        if (ws) {
          await store.workspaceIdOf(ws);
          await usage(ws, out.trace[0].engine, out.trace[0].model, String(body.prompt || "").length * 3, "llm.council");
          if (body.createMission && out.mode === "plan") {
            const planner = { engine: "council", model: out.trace[0].model, label: out.trace[0].label, planFrom: "council", at: new Date().toISOString() };
            out.mission = await missions.createFromPlan(ws, { goal: out.prompt, steps: out.final.steps, planner });
          }
        }
        return send(200, out);
      }
      if (R("GET", /^\/api\/search\/status$/)) return send(200, search.status());
      if (R("POST", /^\/api\/search\/live$/)) {
        const ws = typeof body.workspace === "string" && /^[a-z0-9-]{1,40}$/.test(body.workspace) ? body.workspace : null;
        if (!ws) return fail(400, "Name the workspace the search belongs to.");
        await store.workspaceIdOf(ws);
        let out;
        try { out = await search.search({ q: body.q, mode: body.mode, limit: body.limit }); }
        catch (e) { return fail(e instanceof SearchError ? e.status : 500, e.message); }
        // No internet (every source failed): fall back to this workspace's memory and say so.
        if (out.offline) {
          const local = await memory.search(ws, { q: out.q, limit: 8 });
          out.fallback = { from: "memory", note: "No source answered, so these come from this workspace's memory.", hits: local.hits };
        } else if (out.results.length) {
          // Summarise into memory (titles and links only), so later plans can find it with BM25.
          const saved = await memory.add(ws, { kind: "search", title: out.mode + ": " + out.q, body: out.results.slice(0, 8).map((r, i) => `${i + 1}. ${r.title} — ${r.url} (${r.source})`).join("\n"),
            tags: ["search", out.mode], outcome: { sources: out.sources.filter(x => x.ok && !x.skipped).length, results: out.results.length }, source: "open-web" }).catch(() => null);
          out.memoryId = saved ? saved.id : null;
        }
        return send(200, out);
      }
      if (R("POST", /^\/api\/studio\/clean-clone$/)) {
        let html = typeof body.html === "string" ? body.html : "", host = "", src = null;
        if (body.url) {
          try { const page = await fetchPage(body.url); html = page.html; host = page.host; src = { url: page.url, bytes: page.bytes, robots: page.robots, fetchedAt: page.fetchedAt }; }
          catch (e) { return fail(e instanceof FetchError && ["blocked", "bad_url", "robots"].includes(e.code) ? 400 : 502, e.message); }
        }
        if (!html.trim()) return fail(400, "Give a public https:// address or paste some HTML.");
        const out = cleanClone(html, { host, url: src && src.url });
        out.report.fetch = src;
        return send(200, out);
      }
      if ((m = /^\/api\/w\/([a-z0-9-]{1,40})(\/.*)?$/.exec(path))) {
        const slug = m[1], rest = m[2] || "";
        let k;
        if (req.method === "GET" && rest === "") return send(200, await store.workspace(slug));
        if (req.method === "PATCH" && rest === "") return send(200, await store.renameWorkspace(slug, body.name));
        if (req.method === "GET" && rest === "/members") return send(200, await store.members(slug));
        if (req.method === "GET" && rest === "/stats") return send(200, await store.stats(slug));
        if (req.method === "GET" && rest === "/version") return send(200, await store.version(slug));
        if (req.method === "GET" && rest === "/agents") return send(200, await store.listAgents(slug, { status: url.searchParams.get("status") || "", q: url.searchParams.get("q") || "" }));
        if (req.method === "POST" && rest === "/agents") return send(201, await store.createAgent(slug, body));
        if ((k = /^\/agents\/([\w-]{1,64})$/.exec(rest))) {
          if (req.method === "GET") return send(200, await store.getAgent(slug, k[1]));
          if (req.method === "PATCH") return send(200, await store.updateAgent(slug, k[1], body));
        }
        if (req.method === "POST" && (k = /^\/agents\/([\w-]{1,64})\/runs$/.exec(rest))) {
          const input = {};
          if (typeof body.path === "string" && body.path.trim()) input.path = body.path.trim().slice(0, 300);
          if (typeof body.url === "string" && body.url.trim()) input.url = body.url.trim().slice(0, 2000);
          const agent = await store.getAgent(slug, k[1]);
          if (agent.mode === "long_horizon") return send(201, { mission: await missions.fromAgent(slug, agent, input) });
          return send(201, { id: await runner.start(slug, k[1], input) });
        }
        if (req.method === "GET" && rest === "/runs") return send(200, await store.listRuns(slug));
        if (req.method === "GET" && (k = /^\/runs\/([\w-]{1,64})$/.exec(rest))) return send(200, await store.getRun(slug, k[1]));
        if (req.method === "POST" && (k = /^\/runs\/([\w-]{1,64})\/cancel$/.exec(rest))) return send(200, await store.cancelRun(slug, k[1]));
        if (req.method === "GET" && rest === "/approvals") return send(200, await store.listApprovals(slug));
        if (req.method === "POST" && (k = /^\/approvals\/([\w-]{1,64})\/decide$/.exec(rest))) {
          const decided = await store.decide(slug, k[1], body.decision, body.reason);
          let written = null;
          if (decided.status === "approved") {
            written = runner.applyApproval(slug, decided);
            if (written) await store.logEvent(await store.workspaceIdOf(slug), "member:owner", "file.written", written);
          }
          const mission = await missions.onDecision(slug, decided, written);
          return send(200, { ...decided, written, mission });
        }
        if (req.method === "GET" && rest === "/events") return send(200, await store.listEvents(slug));
        if (req.method === "GET" && rest === "/missions") return send(200, await missions.list(slug));
        // ADR-137: workflows, members, schedules, webhooks, creator mode and plans, analytics, live stream.
        if (req.method === "GET" && rest === "/workflows") return send(200, await platform.listWorkflows(slug));
        if (req.method === "POST" && rest === "/workflows") return send(201, await platform.createWorkflow(slug, body));
        if ((k = /^\/workflows\/([\w-]{1,64})(\/run)?$/.exec(rest))) {
          if (req.method === "GET" && !k[2]) return send(200, await platform.getWorkflow(slug, k[1]));
          if (req.method === "PUT" && !k[2]) return send(200, await platform.saveWorkflow(slug, k[1], body));
          if (req.method === "DELETE" && !k[2]) return send(200, await platform.deleteWorkflow(slug, k[1]));
          if (req.method === "POST" && k[2]) return send(201, await platform.runWorkflow(slug, k[1]));
        }
        if (req.method === "POST" && rest === "/members") return send(201, await platform.addMember(slug, body));
        if ((k = /^\/members\/([\w-]{1,64})$/.exec(rest))) {
          if (req.method === "PATCH") return send(200, await platform.setRole(slug, k[1], body.role));
          if (req.method === "DELETE") return send(200, await platform.removeMember(slug, k[1]));
        }
        if (req.method === "GET" && rest === "/schedules") return send(200, await platform.listSchedules(slug));
        if ((k = /^\/agents\/([\w-]{1,64})\/schedule$/.exec(rest))) {
          if (req.method === "PUT") return send(200, await platform.setSchedule(slug, k[1], body));
          if (req.method === "DELETE") return send(200, await platform.deleteSchedule(slug, k[1]));
        }
        if (req.method === "GET" && rest === "/webhooks") return send(200, await platform.listWebhooks(slug));
        if (req.method === "POST" && rest === "/webhooks") return send(201, await platform.createWebhook(slug, body));
        if ((k = /^\/webhooks\/([\w-]{1,64})(?:\/(activate|pause|test|secret))?$/.exec(rest))) {
          if (req.method === "DELETE" && !k[2]) return send(200, await platform.deleteWebhook(slug, k[1]));
          if (req.method === "POST" && k[2] === "activate") return send(200, await platform.activateWebhook(slug, k[1]));
          if (req.method === "POST" && k[2] === "pause") return send(200, await platform.pauseWebhook(slug, k[1]));
          if (req.method === "POST" && k[2] === "test") return send(200, await platform.testWebhook(slug, k[1]));
          if (req.method === "GET" && k[2] === "secret") { if (!(await platform.listWebhooks(slug)).some(h => h.id === k[1])) return fail(404, "No webhook with that id in this workspace."); return send(200, { secret: platform.secretFor(k[1]) }); }
        }
        if (req.method === "GET" && rest === "/billing") return send(200, await platform.billing(slug));
        if (req.method === "POST" && rest === "/billing/tiers") return send(200, await platform.saveTier(slug, body));
        if (req.method === "DELETE" && (k = /^\/billing\/tiers\/([\w-]{1,64})$/.exec(rest))) return send(200, await platform.deleteTier(slug, k[1]));
        if (req.method === "POST" && rest === "/billing/request") return send(200, await platform.requestMoney(slug, body.what === "billing" ? "billing" : String(body.what || "plan")));
        if (req.method === "GET" && rest === "/analytics") return send(200, await platform.analytics(slug));
        // ADR-147: telemetry (Welford, EWMA, VPIN, LTTB) and the Merkle audit log (RFC 6962).
        if (req.method === "POST" && rest === "/telemetry/record") return send(201, await telemetry.record(slug, body));
        if (req.method === "GET" && rest === "/telemetry/metrics") { await flushLatency(); return send(200, await telemetry.metrics(slug)); }
        if (req.method === "GET" && rest === "/telemetry/series") return send(200, await telemetry.series(slug, url.searchParams.get("metric"), url.searchParams.get("threshold")));
        if (req.method === "GET" && rest === "/audit/head") return send(200, await audit.head(slug));
        if (req.method === "GET" && rest === "/audit/leaves") return send(200, await audit.leaves(slug, url.searchParams.get("limit")));
        if (req.method === "GET" && rest === "/audit/merkle-proof") return send(200, await audit.proof(slug, url.searchParams.get("seq")));
        if (req.method === "GET" && rest === "/audit/verify") return send(200, await audit.verify(slug));
        if (req.method === "GET" && rest === "/diagnostics") return send(200, { layers: await readiness.layers(slug), at: new Date().toISOString() });
        if (req.method === "GET" && rest === "/diagnostics/bundle") return send(200, await readiness.bundle(slug));
        if (req.method === "POST" && rest === "/recon/passive") {
          let rep;
          try { rep = await recon(body.domain); } catch (e) { return fail(e.status || 500, e.message); }
          await store.logEvent(await store.workspaceIdOf(slug), "member:owner", "recon.passive", rep.domain);
          return send(200, rep);
        }
        // ADR-154: universal maths. Pure and bounded (400 characters, depth 40, 10 x 10, 10,000 steps); the
        // answer comes back in the language asked for (?lang=ar or body.lang), formulas as written.
        if (req.method === "POST" && rest === "/math/solve") {
          const lang = (url.searchParams.get("lang") || body.lang) === "ar" ? "ar" : "en";
          let out;
          try { out = localizeMath(solveMath(body), lang); } catch (e) { if (e.status !== 400) throw e; return send(400, { error: umText(e.message, lang), detail: e.detail }); }
          // ADR-157: the request typeset as SVG (box and glue), from the same parse the solver used.
          const lines = solutionLines(body, out);
          if (lines.length) out.formula_svg = typesetSvg(lines, body.theme === "light" ? "light" : "dark");
          await store.logEvent(await store.workspaceIdOf(slug), "member:owner", "math.solve", out.task + (out.verified ? " verified" : " unverified"));
          return send(200, out);
        }
        if (req.method === "POST" && rest === "/reversal/plan") return send(200, await reversal.plan(slug, body.steps, "person"));
        if (req.method === "POST" && rest === "/reversal/template") return send(200, await reversal.template(slug, body.text, "person"));
        if (req.method === "GET" && rest === "/reversal/log") return send(200, await reversal.list(slug, url.searchParams.get("limit")));
        if (req.method === "POST" && rest === "/audit/record") return send(201, await audit.record(slug, String(body.kind || ""), body.target));
        // ADR-155: the hyper studio. Pure and bounded (8 dimensions, a 40 x 40 grid, 24 particles, 600 ticks);
        // a projection also comes back as SVG text built from numbers only.
        if (req.method === "POST" && rest === "/studio/hyper") {
          let out;
          try { out = hyperStudio(body); } catch (e) { if (e.status !== 400) throw e; return send(400, { error: e.message, detail: e.detail }); }
          if (out.mode === "projection") out.svg = hyperSvg(out);
          await store.logEvent(await store.workspaceIdOf(slug), "member:owner", "hyper.solve", out.mode + (out.polytope ? " " + out.polytope : "") + (out.verified ? " verified" : " unverified"));
          return send(200, out);
        }
        // ADR-157: cinematic presets: starting values for a shot, its optics, light colours healed for text and
        // the golden-section composition as SVG.
        if (req.method === "GET" && rest === "/studio/cinematic/presets") return send(200, presetList());
        if (req.method === "POST" && rest === "/studio/cinematic") {
          let out;
          try { out = compileCinematic(body); } catch (e) { if (e.status !== 400) throw e; return send(400, { error: e.message, detail: e.detail }); }
          await store.logEvent(await store.workspaceIdOf(slug), "member:owner", "cinematic.compile", out.preset + " " + out.theme + (out.verified ? " verified" : " unverified"));
          return send(200, out);
        }
        // ADR-156: prompt meta-codes. Pure and bounded (4,000 characters, 20 addresses); it always answers, and
        // every money, publishing, permissions, install or outbound step comes back as a locked approval.
        if (req.method === "POST" && rest === "/metacodes/compile") {
          const lang = (url.searchParams.get("lang") || body.lang) === "ar" ? "ar" : "en";
          if (body.prompt != null && typeof body.prompt !== "string") return send(400, { error: mcText("err.prompt", lang), detail: "prompt" });
          const out = compileMetacodes({ prompt: body.prompt, codes: body.codes, lang });
          await store.logEvent(await store.workspaceIdOf(slug), "member:owner", "metacodes.compile", out.codes.join(" ") + (out.verified ? " verified" : " unverified"));
          return send(200, out);
        }
        // ADR-144: the Studio time machine.
        if (req.method === "GET" && rest === "/studio/snapshots") return send(200, await studio.list(slug));
        if (req.method === "POST" && rest === "/studio/snapshots") return send(201, await studio.save(slug, body));
        if (req.method === "GET" && rest === "/studio/verify") return send(200, await studio.verify(slug));
        if (req.method === "GET" && rest === "/studio/diff") return send(200, await studio.diff(slug, String(url.searchParams.get("a") || ""), String(url.searchParams.get("b") || "")));
        if ((k = /^\/studio\/snapshots\/([\w-]{1,64})(\/fork)?$/.exec(rest))) {
          if (req.method === "GET" && !k[2]) return send(200, await studio.get(slug, k[1]));
          if (req.method === "POST" && k[2]) return send(201, await studio.fork(slug, k[1]));
        }
        // ADR-142: the live skill loader.
        if (req.method === "GET" && rest === "/skills/runtime") return send(200, await loader.list(slug));
        if (req.method === "GET" && rest === "/skills/evolution") return send(200, await loader.evolutionLog(slug));
        if (req.method === "POST" && rest === "/skills/discover-online") return send(200, await loader.discover(slug, body));
        if (req.method === "POST" && rest === "/skills/import") return send(201, await loader.importFromGithub(slug, body));
        if (req.method === "POST" && rest === "/skills/synthesize-and-mount") return send(201, await loader.synthesize(slug, body));
        if (req.method === "POST" && rest === "/skills/evolve") return send(201, await loader.evolve(slug, body, missions));
        if ((k = /^\/skills\/runtime\/([\w-]{1,64})(\/install)?$/.exec(rest))) {
          if (req.method === "POST" && k[2]) return send(200, await loader.requestInstall(slug, k[1]));
          if (req.method === "DELETE" && !k[2]) return send(200, await loader.unmount(slug, k[1]));
        }
        // ADR-141: hosted model endpoints are recorded as drafts with a locked outbound approval.
        if (req.method === "GET" && rest === "/model-endpoints") return send(200, await access.listEndpoints(slug));
        if (req.method === "POST" && rest === "/model-endpoints") return send(202, await access.requestEndpoint(slug, body));
        if (req.method === "POST" && rest === "/access/request-public") return send(202, await access.requestPublic(slug));
        if ((k = /^\/model-endpoints\/([\w-]{1,64})(\/activate)?$/.exec(rest))) {
          if (req.method === "POST" && k[2]) await access.activateEndpoint(slug, k[1]);
          if (req.method === "DELETE" && !k[2]) return send(200, await access.removeEndpoint(slug, k[1]));
        }
        // ADR-138: memory bank and Skill Forge.
        if (req.method === "GET" && rest === "/memory") return send(200, await memory.search(slug, { q: url.searchParams.get("q") || "", kind: url.searchParams.get("kind") || "", limit: Math.min(50, Number(url.searchParams.get("limit")) || 20) }));
        if (req.method === "POST" && rest === "/memory") return send(201, await memory.add(slug, { ...body, source: "person" }));
        if (req.method === "POST" && rest === "/memory/self-check") return send(200, await memory.selfCheck(slug, { n: body.n }));
        if (req.method === "GET" && rest === "/memory/export") {
          const text = await memory.exportJsonl(slug);
          res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": `attachment; filename="jarvis-memory-${slug}.jsonl"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
          return res.end(text);
        }
        if (req.method === "DELETE" && (k = /^\/memory\/([\w-]{1,64})$/.exec(rest))) return send(200, await memory.remove(slug, k[1]));
        if (req.method === "GET" && rest === "/forge") return send(200, await memory.forgeList(slug));
        if (req.method === "POST" && rest === "/forge") return send(201, await memory.forge(slug, body));
        if ((k = /^\/forge\/([\w-]{1,64})(\/install)?$/.exec(rest))) {
          if (req.method === "POST" && k[2]) return send(200, await memory.requestInstall(slug, k[1]));
          if (req.method === "DELETE" && !k[2]) return send(200, await memory.unmount(slug, k[1]));
        }
        if (req.method === "GET" && rest === "/stream") {
          // Server-sent events: one "change" event whenever the workspace's change marker moves.
          if (streams.size >= 20) return fail(429, "Too many live streams are open.");
          await store.workspaceIdOf(slug);
          res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Connection": "keep-alive" });
          let last = null, open = true;
          const beat = async () => {
            if (!open) return;
            try { const v = (await store.version(slug)).v; if (v !== last) { res.write("event: change\ndata: " + JSON.stringify({ v }) + "\n\n"); last = v; } else res.write(": keep-alive\n\n"); } catch (e) { /* next beat */ }
          };
          const timer = setInterval(beat, 1000);
          const stream = { end: () => { open = false; clearInterval(timer); try { res.end(); } catch (e) { /* closed */ } } };
          streams.add(stream);
          req.on("close", () => { stream.end(); streams.delete(stream); });
          await beat();
          return;
        }
        if (req.method === "POST" && rest === "/missions") return send(201, await missions.create(slug, body));
        if (req.method === "POST" && rest === "/missions/plan") {
          const p = await llm.run({ mode: "plan", prompt: body.goal, model: body.model, lang: body.lang === "ar" ? "ar" : "en", examples: await memory.examples(slug, String(body.goal || "")) });
          await usage(slug, p.engine, p.model, String(body.goal || "").length + JSON.stringify(p.steps).length + String(p.thinking || "").length, "missions.plan");
          if (p.rawSteps) await reversal.plan(slug, p.rawSteps, "local model " + (p.model || "")).catch(() => null);
          const planner = { engine: p.engine, model: p.model, thinking: p.thinking, planFrom: p.planFrom, warning: p.warning, label: p.label, at: new Date().toISOString() };
          return send(201, await missions.createFromPlan(slug, { goal: body.goal, steps: p.steps, planner, capsuleEvery: body.capsuleEvery }));
        }
        // ADR-145: a Ctrl+K macro. The fixed rules turn the text into steps (no model), the prover checks the
        // state machine, and only a verified macro becomes a mission; sensitive steps wait as locked approvals.
        if (req.method === "POST" && rest === "/missions/macro") {
          const text = String(body.text || "").trim();
          if (!text || text.length > 2000) return fail(400, "Write the macro's steps, at most 2,000 characters.");
          const steps = fallbackPlan(text);
          const proof = provePlan(steps);
          if (!proof.verified) return fail(422, "The macro did not pass the formal proof (" + (proof.violations.length ? proof.violations.length + " unsafe path" : proof.deadlocks.length + " deadlock") + "); nothing was made.");
          const planner = { engine: "macro", model: null, planFrom: "Ctrl+K macro", label: "fixed rules (no model)", proof: { verified: true, states: proof.states, transitions: proof.transitions, effects: proof.effects, lockedStates: proof.lockedStates }, at: new Date().toISOString() };
          return send(201, await missions.createFromPlan(slug, { goal: text, steps, planner }));
        }
        if ((k = /^\/missions\/([\w-]{1,64})(\/.*)?$/.exec(rest))) {
          const id = k[1], sub = k[2] || "";
          let n;
          if (req.method === "GET" && sub === "") return send(200, await missions.detail(slug, id));
          if (req.method === "POST" && sub === "/run") return send(200, await missions.run(slug, id));
          if (req.method === "POST" && sub === "/pause") return send(200, await missions.pause(slug, id));
          if (req.method === "GET" && sub === "/verify") return send(200, await missions.verify(slug, id));
          if (req.method === "GET" && (n = /^\/capsules\/(\d{1,6})$/.exec(sub))) return send(200, await missions.capsule(slug, id, n[1]));
          if (req.method === "POST" && (n = /^\/capsules\/(\d{1,6})\/restore$/.exec(sub))) return send(200, await missions.restore(slug, id, n[1]));
          if (req.method === "POST" && (n = /^\/steps\/(\d{1,4})\/skip$/.exec(sub))) return send(200, await missions.skipStep(slug, id, n[1]));
        }
      }
      return fail(404, "No such route.");
    } catch (e) {
      if (e && e.locked && e.approvalId) return send(e.status || 403, { error: e.message, locked: true, approvalId: e.approvalId });
      if (e instanceof StoreError || e instanceof BridgeError || e instanceof GateError) return fail(e.status, e.message);
      // PostgreSQL refuses an id that is not a UUID (22P02); for the caller that is simply "not found".
      if (e && e.code === "22P02") return fail(404, "Nothing with that id.");
      if (e && e.status) return fail(e.status, e.message);
      if (!quiet) console.error("jarvis-server:", e);
      return fail(500, "The server hit an error. The log on this computer has the details.");
    }
  });

  await new Promise((ok, no) => { server.once("error", no); server.listen(port, "127.0.0.1", ok); });
  const addr = server.address();
  if (!quiet) console.log(`Jarvis on http://127.0.0.1:${addr.port}  (database: ${db.kind}, ${db.where})`);
  return { server, port: addr.port, store, runner, missions, llm, platform, memory, search, access, gate, loader, studio, audit, telemetry, reversal, db, async close() { clearInterval(ticker); clearInterval(latencyTimer); for (const s of streams) s.end(); streams.clear(); await new Promise(r => server.close(r)); await db.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(e => { console.error("jarvis-server: " + e.message); process.exit(1); });
}
