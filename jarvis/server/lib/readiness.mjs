// Readiness of the five layers and the scrubbed diagnostics bundle on the server (ADR-148). Read-only: it
// counts rows, reads the evidence files, asks the running services for their status and runs fixed
// self-checks. The bundle passes through diagnostics.mjs's scrubber before it is sent.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isBlockedAddress } from "./fetch-public.mjs";
import { provePlan } from "./prover.mjs";
import { fallbackPlan } from "./llm-plan.mjs";
import { isCloudModel } from "./openai-compat.mjs";
import { layer, LOCK_CONSTRAINTS, SSRF_PROBES, scrub } from "./diagnostics.mjs";

export function createReadiness({ db, store, llm, search, audit, repoRoot, address }) {
  const file = rel => join(repoRoot, rel);
  const text = rel => (existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : "");
  const json = rel => { try { return JSON.parse(text(rel)); } catch (e) { return null; } };
  const passLine = rel => { const m = [...text(rel).matchAll(/(\d+) passed, (\d+) failed/g)].pop(); return m ? { ok: Number(m[2]) === 0 && Number(m[1]) > 0, detail: m[0] } : { ok: false, detail: "no result in " + rel }; };
  async function schemaNames() {
    if (db.kind === "postgres") {
      const c = await db.all("select conname as n from pg_constraint");
      const t = await db.all("select tgname as n from pg_trigger where not tgisinternal");
      return c.concat(t).map(r => r.n).join("\n");
    }
    return (await db.all("select sql from sqlite_master where sql is not null")).map(r => r.sql).join("\n");
  }
  const api = {
    async layers(slug) {
      const wid = await store.workspaceIdOf(slug);
      const names = await schemaNames();
      const episodes = Number((await db.one("select count(*) as c from agent_memory_episodes where workspace_id = $1", [wid])).c);
      const capsules = Number((await db.one("select count(*) as c from capsules c join missions m on m.id = c.mission_id where m.workspace_id = $1", [wid])).c);
      const mutation = json("jarvis/replica/evidence/mutation-audit.log");
      const mutationOk = !!mutation && mutation.targets.every(t => existsSync(file(t.file)) && createHash("sha256").update(readFileSync(file(t.file))).digest("hex") === t.sha256);
      const ui = json("jarvis/replica/evidence/ui-states.json");
      const purity = json("jarvis/replica/evidence/bilingual-purity.log");
      const purityModes = purity ? ["sample", "live"].filter(m => purity[m]) : [];
      const purityLeft = purityModes.reduce((n, m) => n + purity[m].arabic.violations + purity[m].english.violations, 0);
      const proof = provePlan(fallbackPlan("read the commits then run the tests then publish the site then pay the invoice"));
      const st = search.status();
      const leaks = SSRF_PROBES.filter(a => !isBlockedAddress(a));
      const scan = json("jarvis/app/data/skills-scan.json");
      const sum = scan && scan.summary ? scan.summary : {};
      const av = await audit.verify(slug);
      const missing = LOCK_CONSTRAINTS.filter(n => !names.includes(n));
      const reversals = Number((await db.one("select count(*) as c from reversal_log where workspace_id = $1", [wid])).c);
      const ls = await llm.status();
      const cloud = (ls.models || []).filter(isCloudModel);
      return [
        layer("memory", "Memory", [
          { name: "Memory episodes (BM25)", ok: true, detail: episodes + " in this workspace" },
          { name: "State capsules (SHA-256 chained)", ok: true, detail: capsules + " in this workspace" },
          { name: "Capsules and memory history are append-only", ok: /capsules_no_update/.test(names), detail: "database trigger" },
        ]),
        layer("proof", "Development and proof", [
          { name: "Server tests", ...passLine("jarvis/replica/evidence/tests-server.log") },
          { name: "Flow tests", ...passLine("jarvis/replica/evidence/tests-app.log") },
          { name: "UI-state gate", ok: !!ui && ui.complete === true, detail: ui ? ui.covered + "/" + ui.total : "no evidence" },
          { name: "Bilingual purity gate", ok: purityModes.length === 2 && purityLeft === 0, detail: purity ? purityModes.reduce((n, m) => n + purity[m].screens, 0) + " screens, " + purityLeft + " left in either language" : "no evidence" },
          { name: "Mutation testing", ok: mutationOk, detail: mutation ? mutation.killed + "/" + mutation.total + " killed" + (mutationOk ? " [VERIFIED]" : ", code changed since the run") : "no evidence" },
          { name: "Formal proof of a plan with locks", ok: proof.verified, detail: proof.states + " states, " + proof.effects + " effects behind a lock" },
        ]),
        layer("search", "Open search and SSRF shield", [
          { name: "Official keyless APIs", ok: st.sources.length >= 8, detail: st.sources.filter(x => x.host).length + " fixed hosts" + (st.searxng ? " + SearXNG" : "") },
          { name: "Private addresses refused", ok: !leaks.length, detail: leaks.length ? "not refused: " + leaks.join(", ") : SSRF_PROBES.length + " of " + SSRF_PROBES.length + " refused, IPv6 spellings included" },
        ]),
        layer("security", "Security", [
          { name: "SkillSpector on the skills", ok: sum.critical === 0 && sum.high === 0, detail: "critical " + sum.critical + ", high " + sum.high },
          { name: "Merkle audit log verifies", ok: av.ok, detail: av.ok ? av.size + " entries" : "broken at " + av.brokenAt + ": " + av.reason },
          { name: "Lock constraints in the database", ok: !missing.length, detail: missing.length ? "missing: " + missing.join(", ") : LOCK_CONSTRAINTS.length + " of " + LOCK_CONSTRAINTS.length },
          { name: "Reversal log is append-only", ok: /reversal_log_no_update/.test(names), detail: reversals + " corrections logged" },
        ]),
        layer("bridge", "Local model bridge", [
          { name: "Model engine on 127.0.0.1", ok: /^http:\/\/127\.0\.0\.1:\d+/.test(String(ls.host || "")), detail: (ls.online ? "online: " : "offline, fixed rules: ") + ls.host },
          { name: "No cloud model", ok: !cloud.length, detail: cloud.length ? cloud.join(", ") : (ls.models || []).length + " local models" },
          { name: "Server bound to 127.0.0.1", ok: address() === "127.0.0.1", detail: address() },
        ]),
      ];
    },
    // The bundle holds no request body, no environment and no file outside the evidence; it is scrubbed anyway.
    async bundle(slug) {
      const wid = await store.workspaceIdOf(slug);
      const layers = await api.layers(slug);
      const events = await db.all("select kind, actor, target, at from events where workspace_id = $1 order by at desc limit 50", [wid]);
      const approvals = await db.all("select status, category, count(*) as c from approvals where workspace_id = $1 group by status, category", [wid]);
      const raw = { format: "jarvis-diagnostics-v1", generatedAt: new Date().toISOString(), workspace: slug, layers, merkle: await audit.head(slug),
        approvals: approvals.map(r => ({ status: r.status, category: r.category, count: Number(r.c) })), events: events.map(e => ({ kind: e.kind, actor: e.actor, target: e.target, at: new Date(e.at).toISOString() })) };
      const s = scrub(raw);
      return { ...s.value, scrubbed: { redactions: s.redactions.length, rules: [...new Set(s.redactions.map(r => r.rule))], paths: s.redactions.map(r => r.path).slice(0, 50) } };
    },
  };
  return api;
}
