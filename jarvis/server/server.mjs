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
import { createOllamaBridge, BridgeError } from "./lib/ollama-bridge.mjs";
import { createPlatform } from "./lib/platform.mjs";
import { cleanClone } from "./lib/clean-clone.mjs";
import { fetchPublicPage, FetchError } from "./lib/fetch-public.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export async function startServer({ port = Number(process.env.JARVIS_PORT || 8798), mode = process.env.JARVIS_DB || "sqlite", databaseUrl = process.env.DATABASE_URL, dataDir = process.env.JARVIS_DATA_DIR || join(here, ".data"), sqliteFile, fetchPage = fetchPublicPage, ollamaUrl, ollamaFetch, quiet = false } = {}) {
  // Refuses at start any Ollama address that is not http://127.0.0.1:<port> (ADR-136).
  const llm = createOllamaBridge({ ...(ollamaUrl ? { baseUrl: ollamaUrl } : {}), ...(ollamaFetch ? { fetchImpl: ollamaFetch } : {}) });
  const db = mode === "postgres" ? await openPostgres(databaseUrl || "") : await openSqlite(sqliteFile || join(dataDir, "jarvis.sqlite"));
  await seed(db);
  const store = createStore(db);
  const runner = createRunner({ store, repoRoot, dataDir });
  let platform = null;
  const missions = createMissions({ store, runner, db, repoRoot, dataDir, onEvent: (slug, kind, data) => platform && platform.dispatch(slug, kind, data) });
  await missions.seedMissions();
  platform = createPlatform({ db, store, runner, missions, dataDir });
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
      const okHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (!okHosts.includes(String(req.headers.host || ""))) return fail(421, "Wrong Host header. Open http://127.0.0.1:" + actualPort + ".");
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

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
        if (origin && !okHosts.map(h => "http://" + h).includes(origin)) return fail(403, "Cross-origin writes are refused.");
        if (!/^application\/json\b/.test(String(req.headers["content-type"] || ""))) return fail(415, "Send JSON.");
        const limit = path === "/api/studio/clean-clone" ? 2.5 * 1024 * 1024 : 64 * 1024;
        const chunks = [];
        let size = 0;
        for await (const c of req) { size += c.length; if (size > limit) return fail(413, "The request is too large."); chunks.push(c); }
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch (e) { return fail(400, "The request is not valid JSON."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "The request must be a JSON object.");
      }

      const R = (method, re) => req.method === method && re.exec(path);
      let m;
      if (R("GET", /^\/api\/health$/)) return send(200, { ok: true, mode: db.kind, where: db.where, runs: "real (fixed-rule planner, no model)", version: 1 });
      if (R("GET", /^\/api\/workspaces$/)) return send(200, await store.listWorkspaces());
      if (R("GET", /^\/api\/llm\/status$/)) return send(200, await llm.status());
      if (R("POST", /^\/api\/llm\/run$/)) {
        const out = await llm.run({ mode: body.mode, prompt: body.prompt, lang: body.lang, model: body.model });
        if (typeof body.workspace === "string" && /^[a-z0-9-]{1,40}$/.test(body.workspace)) await usage(body.workspace, out.engine, out.model, String(body.prompt || "").length + JSON.stringify(out.text || out.steps || out.blocks || "").length + String(out.thinking || "").length, "llm." + out.mode);
        return send(200, { ok: true, ...out });
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
          const p = await llm.run({ mode: "plan", prompt: body.goal, model: body.model });
          await usage(slug, p.engine, p.model, String(body.goal || "").length + JSON.stringify(p.steps).length + String(p.thinking || "").length, "missions.plan");
          const planner = { engine: p.engine, model: p.model, thinking: p.thinking, planFrom: p.planFrom, warning: p.warning, label: p.label, at: new Date().toISOString() };
          return send(201, await missions.createFromPlan(slug, { goal: body.goal, steps: p.steps, planner, capsuleEvery: body.capsuleEvery }));
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
      if (e instanceof StoreError || e instanceof BridgeError) return fail(e.status, e.message);
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
  return { server, port: addr.port, store, runner, missions, llm, platform, db, async close() { clearInterval(ticker); for (const s of streams) s.end(); streams.clear(); await new Promise(r => server.close(r)); await db.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(e => { console.error("jarvis-server: " + e.message); process.exit(1); });
}
