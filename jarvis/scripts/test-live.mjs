#!/usr/bin/env node
// Live-mode flow tests (ADR-134): the real jarvis/server on SQLite in a throwaway folder, driven in
// Chromium through the page. Covers the workspace switcher, the agent editor, a real run that ends
// in an approved note on disk, locked cards, and the clean-room cloner (with a stub page fetcher,
// because the cloud sandbox has no outbound network; the real fetcher is tested in test-server.mjs).
//   npm i playwright-core@1.56.1 && node --disable-warning=ExperimentalWarning jarvis/scripts/test-live.mjs
import { chromium } from "playwright-core";
import { mkdtempSync, existsSync, readdirSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { startServer } = await import(join(here, "..", "server", "server.mjs"));
const FIXTURE = `<!doctype html><html><head><title>Acmeflow</title><script src="https://www.googletagmanager.com/gtag/js"></script></head><body>
<header><nav><a>Acmeflow</a><a>Product</a><a>Pricing</a><a class="btn">Try Acmeflow</a></nav></header><main>
<section><h1>Acmeflow ships code faster than anyone</h1><p>Loved by teams.</p><a class="btn">Start</a></section>
<section><h2>Why Acmeflow</h2><div class="grid-cols-3"><div><h3>Builds</h3><p>Fast</p></div><div><h3>Previews</h3><p>Every branch</p></div><div><h3>Rollback</h3><p>One click</p></div></div></section>
<section><h2>Compare</h2><table><tr><th>Plan</th><th>Hobby</th><th>Pro</th></tr><tr><td>Builds</td><td>100</td><td>1000</td></tr></table></section>
</main><footer>© 2026 Acmeflow</footer></body></html>`;

let passed = 0, failed = 0;
const ok = (cond, name, extra) => { if (cond) { passed++; console.log("PASS " + name); } else { failed++; console.log("FAIL " + name + (extra ? "  (" + String(extra).slice(0, 300) + ")" : "")); } };

const dataDir = mkdtempSync(join(tmpdir(), "jarvis-live-"));
// A fake Ollama on 127.0.0.1 (ADR-136): its plan tries to leave a publish step unlocked.

const http = await import("node:http");
const fake = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "jarvis-planner:latest" }, { name: "jarvis-designer:latest" }] }));
  const sys = JSON.parse(body).messages[0].content;
  if (/local assistant/.test(sys)) return res.end(JSON.stringify({ message: { role: "assistant", content: "<think>Recall the definition.</think>Breadth-first search visits a graph level by level." } }));
  const content = /plan long tasks/.test(sys)
    ? "<think>Step one reads commits. I will leave publishing unlocked.</think>" + JSON.stringify({ steps: [{ title: "Read the latest commits", phase: 1 }, { title: "Run the unit tests", phase: 2, gate: "tdd" }, { title: "Publish the release notes", phase: 3, locked: false }] })
    : "<nav><a>Acme</a><a>Docs</a></nav><section><h1>Acme sells widgets</h1><p>Buy now</p></section><section><h2>Plans</h2><div><div><h3>A</h3><p>x</p></div><div><h3>B</h3><p>y</p></div><div><h3>C</h3><p>z</p></div></div></section><footer>Acme</footer>";
  res.end(JSON.stringify({ message: { role: "assistant", content } }));
});
await new Promise(r => fake.listen(0, "127.0.0.1", r));
// ADR-139: no outbound network in the sandbox, so the official APIs are answered by fixtures on their fixed hosts.
const searchHosts = [];
const SEARCH_FIX = {
  "en.wikipedia.org": { query: { search: [{ title: "Breadth-first search", snippet: "<span>Breadth</span>-first search is a graph algorithm" }] } },
  "ar.wikipedia.org": { query: { search: [{ title: "بحث بالعرض أولا", snippet: "خوارزمية بحث" }] } },
  "api.openalex.org": { results: [{ id: "https://openalex.org/W1", display_name: "A study of graph search", publication_year: 2021, cited_by_count: 12 }] },
  "hn.algolia.com": { hits: [{ title: "BFS explained", url: "https://example.com/bfs", objectID: "1", points: 5 }] },
  "api.github.com": { items: [{ full_name: "acme/graph-search", html_url: "https://github.com/acme/graph-search", description: "Fast graph search", stargazers_count: 120, language: "Go" }] },
  "registry.npmjs.org": { objects: [{ package: { name: "lodash", version: "4.17.21", description: "Lodash modular utilities." } }] },
  "pypi.org": null,
  "api.osv.dev": { vulns: [{ id: "GHSA-p6mc-m468-83gw", summary: "Prototype pollution in lodash", aliases: ["CVE-2020-8203"] }] },
};
const searchRequest = async url => { const host = new URL(url).hostname; searchHosts.push(host); return SEARCH_FIX[host] || null; };
// ADR-142: GitHub's API for the skill loader, answered by a fixture on its fixed host.
const SKILL_MD = "---\nname: schema-reviewer\ndescription: Reviews a database schema for missing keys and indexes.\n---\n\n# schema-reviewer\n\n1. Read the schema file.\n2. List tables without a primary key.\n3. Stop before changing anything.\n";
const skillRequest = async url => {
  const u = new URL(url);
  if (u.pathname === "/search/repositories") return { items: [{ full_name: "acme/skills", html_url: "https://github.com/acme/skills", description: "Agent skills for databases", stargazers_count: 42, license: { spdx_id: "MIT" }, default_branch: "main" }] };
  if (u.pathname === "/repos/acme/skills") return { private: false, license: { spdx_id: "MIT" } };
  if (u.pathname === "/repos/acme/skills/contents/SKILL.md") return { type: "file", encoding: "base64", size: SKILL_MD.length, content: Buffer.from(SKILL_MD).toString("base64"), html_url: "https://github.com/acme/skills/blob/main/SKILL.md", sha: "abc123" };
  return null;
};
const srv = await startServer({ port: 0, dataDir, quiet: true, skillRequest, searchRequest, searxngUrl: "", ollamaUrl: "http://127.0.0.1:" + fake.address().port, fetchPage: async url => ({ html: FIXTURE, url, host: "www.acmeflow.example", bytes: FIXTURE.length, robots: "allowed", fetchedAt: new Date().toISOString() }) });
const BASE = `http://127.0.0.1:${srv.port}/`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push("pageerror: " + e.message));
const streamReqs = [];
page.on("request", r => { if (r.url().includes("/stream")) streamReqs.push(r.resourceType()); });
const go = async hash => { await page.goto(BASE + hash); await page.waitForSelector("main h1", { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(200); };

// Live mode and the workspace switcher
await go("#/agents");
ok(await page.getByText(/Live: real data from the local server \(SQLite\)/).first().isVisible(), "live mode says where the data comes from");
ok((await page.locator("#wsName").textContent()) === "OMEGA PRIME", "first workspace is OMEGA PRIME");
ok(await page.getByRole("link", { name: "ADR reader" }).isVisible() && !(await page.getByText("Design token auditor").count()), "OMEGA PRIME shows its own agents");
await page.locator("#wsBtn").focus();
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
ok((await page.locator("#wsName").textContent()) === "Jarvis Studio", "keyboard switch to Jarvis Studio");
ok(await page.getByRole("link", { name: "Design token auditor" }).isVisible() && !(await page.getByText("ADR reader").count()), "the agent list changes with the workspace");
await go("#/approvals");
await page.getByRole("tab", { name: /Locked/ }).click();
const lockedTitles = await page.locator("[role=tabpanel]:not([hidden]) article.locked h3").allTextContents();
ok(lockedTitles.includes("Publish the Studio site to a public domain") && !lockedTitles.includes("Move paper profit to a real account"), "locked cards belong to the workspace", lockedTitles.join(" | "));
ok((await page.locator("[role=tabpanel]:not([hidden])").getByRole("button", { name: "Approve" }).count()) === 0, "locked cards have no approve button");
ok(await page.locator("[role=tabpanel]:not([hidden])").getByText("Sample request").first().isVisible(), "seeded locked requests are labelled sample");
await page.locator("#wsBtn").click();
await page.getByRole("menuitemradio", { name: "OMEGA PRIME" }).click();
await page.waitForTimeout(400);
ok((await page.locator("#wsName").textContent()) === "OMEGA PRIME", "click switch back to OMEGA PRIME");

// Agent editor
await go("#/agents");
await page.getByRole("link", { name: "ADR reader" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Edit" }).click();
ok(await page.getByRole("dialog").getByRole("heading", { name: "Edit ADR reader" }).waitFor({ timeout: 5000 }).then(() => true, () => false), "edit dialog opens with the agent");
const lockedBoxes = page.getByRole("dialog").locator("input[name^=locked-]");
ok((await lockedBoxes.count()) === 5 && (await lockedBoxes.evaluateAll(l => l.every(x => x.disabled && !x.checked))), "five locked permissions, all off and disabled");
await page.getByLabel("Name").fill("ADR reader v2");
await page.getByLabel("Max steps per run").fill("10");
await page.getByLabel("Filter skills").fill("replica-diff");
await page.getByRole("dialog").getByText("replica-diff", { exact: true }).click();
await page.getByRole("button", { name: "Save changes" }).click();
await page.waitForTimeout(600);
ok(await page.getByRole("heading", { name: "ADR reader v2", level: 1 }).isVisible(), "the new name shows after saving");
ok(await page.getByText("replica-diff", { exact: true }).first().isVisible(), "the linked skill shows in Config");
const apiAgent = await page.evaluate(async () => (await (await fetch("/api/w/omega-prime/agents")).json()).find(a => a.name === "ADR reader v2"));
ok(apiAgent && apiAgent.maxSteps === 10 && apiAgent.skills.includes("replica-diff"), "the server stored the edit", JSON.stringify(apiAgent));

// A real run, approved into a real file
await page.getByRole("button", { name: "Run once" }).click();
ok((await page.getByLabel("Path to read").inputValue()) === "docs/adr/ADR-13*", "run dialog offers a default path");
await page.getByRole("button", { name: "Start run" }).click();
await page.waitForFunction(() => /#\/runs\//.test(location.hash), null, { timeout: 5000 });
await page.waitForFunction(() => /Succeeded|Failed/.test(document.querySelector("main .page-head")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
const head = await page.locator("main .page-head").textContent();
ok(/Succeeded/.test(head), "the real run succeeds", head);
ok(await page.getByText(/files: ADR-13/).isVisible(), "the files.read step lists the real files");
ok(!(await page.getByText("Simulated run").count()), "the run is not labelled simulated");
await go("#/approvals");
await page.getByRole("button", { name: "Approve" }).first().click();
await page.waitForTimeout(500);
const notes = join(dataDir, "workspaces", "omega-prime", "notes");
const files = existsSync(notes) ? readdirSync(notes) : [];
ok(files.length === 1 && readFileSync(join(notes, files[0]), "utf8").startsWith("# ADR reader v2"), "approving writes the note to disk", files.join(","));

// Clean-room clone in the Studio
await go("#/studio");
await page.getByLabel("Page address").fill("https://www.acmeflow.example/");
await page.getByRole("button", { name: "Clean-room clone" }).click();
await page.waitForSelector(".report dl", { timeout: 5000 }).catch(() => {});
const rep = await page.locator(".report").textContent();
ok(/0 leaks/.test(rep) && /1 tracker\b/.test(rep) && /1 script\b/.test(rep), "the report shows 0 leaks and what was dropped", rep);
const blockNames = await page.locator(".blk-head .name").allTextContents();
ok(blockNames.join(",") === "Navigation,Hero,Features,Table,Footer", "the clone rebuilt the sections in order", blockNames.join(","));
const frame = page.frames().find(f => f !== page.mainFrame());
await page.waitForTimeout(300);
ok((await frame.locator("table th").count()) === 3 && (await frame.locator("h1").textContent()) === "Your headline in one clear line", "the preview shows the rebuilt table and our own headline");
// The report names the source host on purpose (provenance). What the clone produced must not carry it:
// the preview, the section editors and the saved site.
const produced = (await frame.evaluate(() => document.documentElement.outerHTML)) + (await page.locator(".blocks").evaluate(n => n.innerText + [...n.querySelectorAll("input, textarea")].map(x => x.value).join(" "))) + (await page.evaluate(() => localStorage.getItem("jarvis-studio-v1")));
ok(!/Acmeflow/i.test(produced), "no source text in the preview, the editors or the saved site");
await page.getByRole("button", { name: "AR · RTL" }).click();
await page.waitForTimeout(250);
ok((await frame.evaluate(() => document.documentElement.dir)) === "rtl" && /عنوانك/.test(await frame.locator("h1").textContent()), "the clone flips to Arabic RTL");
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download HTML" }).click()]);
const file = join(mkdtempSync(join(tmpdir(), "jarvis-dl-")), dl.suggestedFilename());
copyFileSync(await dl.path(), file);
const html = readFileSync(file, "utf8");
ok(/script-src 'sha256-/.test(html) && !/Acmeflow/i.test(html) && /dir="rtl"/.test(html), "the download is clean, pinned and RTL");
await page.getByRole("button", { name: "Publish…" }).click();
ok(await page.getByRole("dialog").getByText("قيد الموافقة").isVisible(), "publishing the clone is a locked card");
await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

// Mission Control on the real engine: Jarvis Studio's design audit (contrast and security gates on
// the repo's saved evidence, a locked install step, a note that is written only after approval).
await page.locator("#wsBtn").click();
await page.getByRole("menuitemradio", { name: "Jarvis Studio" }).click();
await page.waitForTimeout(400);
await go("#/missions");
await page.locator(".mcard").first().click();
await page.waitForTimeout(300);
const missionId = page.url().split("/").pop();
await page.getByRole("button", { name: "Run mission" }).click();
await page.waitForFunction(() => /Awaiting approval/.test(document.querySelector("main .page-head .badge")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
ok((await page.locator("main .page-head .badge").first().textContent()).includes("Awaiting approval"), "live mission runs to its approvals");
ok(await page.locator(".gates").getByText("Contrast · pass").isVisible() && await page.locator(".gates").getByText("Security · pass").isVisible(), "live gates pass on the saved contrast report and SkillSpector scan");
ok(/files: .*contrast-report\.txt|4 files|files/.test(await page.locator(".mstep[data-idx='0']").textContent()), "live tool step read the design folder");
const lk = page.locator(".mstep.is-locked");
ok((await lk.count()) === 1 && await lk.getByText("بانتظار الموافقة").isVisible() && (await lk.getByRole("button", { name: "Approve" }).count()) === 0, "live locked install step waits with no approve button");
const planDir = join(dataDir, "workspaces", "jarvis-studio", "missions", missionId);
ok(existsSync(join(planDir, "task_plan.md")) && /Capsule #1/.test(readFileSync(join(planDir, "progress.md"), "utf8")), "the mission keeps task_plan.md and progress.md on disk");
await page.locator(".mstep:not(.is-locked)").getByRole("button", { name: "Approve" }).click();
await page.waitForFunction(() => /Done/.test(document.querySelector(".mstep[data-idx='5'] .badge")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
const mNotes = existsSync(join(dataDir, "workspaces", "jarvis-studio", "notes")) ? readdirSync(join(dataDir, "workspaces", "jarvis-studio", "notes")) : [];
ok(mNotes.some(n => n.startsWith("mission-design-audit")) && (await page.locator(".mstep[data-idx='5'] .badge").first().textContent()).includes("Done"), "approving the mission note writes it and the next step runs", mNotes.join(","));
await page.getByRole("button", { name: "Inspect capsule 1" }).click();
await page.getByRole("dialog").getByText("Hash check").waitFor({ timeout: 5000 }).catch(() => {});
ok(await page.getByRole("dialog").getByText("SHA-256 matches its content").isVisible(), "live capsule hash checks out");
await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
await page.getByRole("button", { name: "Restore capsule 1" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
await page.waitForFunction(() => /Paused/.test(document.querySelector("main .page-head .badge")?.textContent || ""), null, { timeout: 5000 }).catch(() => {});
ok((await page.locator("main .page-head .badge").first().textContent()).includes("Paused") && await page.getByText(/Chain intact/).isVisible(), "live restore pauses the mission and keeps the chain intact");

// Local model (ADR-136): the top bar, a planned mission with its thinking, and a design from a prompt.
await go("#/missions");
ok((await page.locator("#llmWord").textContent()) === "Ollama local · 0-token", "live top bar shows the local model");
await page.locator("#f-goal").fill("Release this branch");
await page.getByRole("button", { name: "Plan mission" }).click();
await page.waitForFunction(() => /#\/missions\/[0-9a-f-]{36}$/.test(location.hash), null, { timeout: 8000 }).catch(() => {});
await page.waitForSelector(".planner", { timeout: 8000 }).catch(() => {});
ok(await page.locator(".planner code").getByText("jarvis-planner:latest").isVisible() && await page.locator(".planner").getByText("[INFERENCE - local LLM]").isVisible(), "the mission says the local model planned it");
await page.locator(".planner summary").click();
ok(/leave publishing unlocked/.test(await page.locator(".planner pre").textContent()), "the model's thinking is shown, folded, as text");
await page.getByRole("button", { name: "Run mission" }).click();
await page.waitForFunction(() => /Awaiting approval/.test(document.querySelector("main .page-head .badge")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
ok((await page.locator(".mstep.is-locked").count()) === 1 && await page.locator(".mstep.is-locked").getByText("Publish the release notes").isVisible(), "the publish step the model left unlocked waits as a locked card");
await go("#/studio");
await page.locator("#f-design").fill("A product page");
await page.getByRole("button", { name: "Design with local model" }).click();
await page.waitForSelector(".report dl", { timeout: 8000 }).catch(() => {});
ok(await page.locator(".report").getByText("jarvis-designer:latest").isVisible() && /0 leaks/.test(await page.locator(".report").textContent()) && !/Acme/.test(await page.frames().find(f => f !== page.mainFrame()).locator("body").textContent()), "the Studio keeps only the layout of the model's page");

// ADR-137 live: a workflow runs as a mission, webhooks with HMAC secrets and locks, members,
// analytics, and server push instead of polling.
await page.locator("#wsBtn").click();
await page.getByRole("menuitemradio", { name: "giant-core" }).click();
await page.waitForTimeout(400);
await go("#/workflows");
await page.locator("tbody a").first().click();
await page.waitForSelector(".wf-node");
ok((await page.locator(".wf-node.locked").count()) === 1, "live workflow editor draws the locked publish step");
await page.getByRole("button", { name: "Run workflow" }).click();
await page.waitForFunction(() => /Awaiting approval/.test(document.querySelector("main .page-head .badge")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
ok((await page.locator(".mstep.is-locked").filter({ hasText: "Publish the release notes" }).count()) === 1 && await page.locator(".planner").getByText(/Built from the workflow graph/).isVisible(), "live workflow run says where it came from and waits on the locked publish step");
ok(streamReqs.includes("eventsource"), "live updates come over server-sent events", streamReqs.join(","));
await go("#/webhooks");
await page.locator("#f-whname").fill("CI results");
await page.getByRole("button", { name: "Add webhook" }).click();
await page.getByRole("dialog").getByRole("heading", { name: "Webhook secret" }).waitFor({ timeout: 5000 });
ok(/^[0-9a-f]{64}$/.test((await page.getByRole("dialog").locator("pre").textContent()).trim()), "a new webhook shows its HMAC secret once");
await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
await page.getByRole("button", { name: "Switch on" }).click();
await page.waitForTimeout(400);
ok(await page.locator("article").filter({ hasText: "CI results" }).getByText("On", { exact: true }).isVisible(), "an incoming webhook switches on");
await page.locator("#f-whname").fill("Team chat");
await page.locator("#f-whdir").selectOption("out");
await page.locator("#f-whurl").fill("https://hooks.example.com/x");
await page.getByRole("button", { name: "Add webhook" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
const ext = page.locator("article").filter({ hasText: "Team chat" });
ok(await ext.getByText("بانتظار الموافقة").isVisible(), "an outgoing webhook to an outside address shows as locked");
await ext.getByRole("button", { name: "Ask to switch on…" }).click();
await page.waitForTimeout(400);
ok(await page.locator("article").filter({ hasText: "Team chat" }).getByText("Draft", { exact: true }).isVisible(), "asking to switch it on leaves it a draft (locked request)");
await go("#/settings");
await page.locator("#f-memail").fill("ops@example.com");
await page.getByRole("button", { name: "Add member" }).click();
await page.waitForTimeout(400);
ok(await page.getByRole("cell", { name: "ops@example.com", exact: true }).isVisible(), "live: add a member");
await go("#/analytics");
ok(await page.getByText("Creator mode").isVisible() && (await page.locator(".bars").count()) >= 4, "live analytics renders");

// ADR-138 live: the memory bank on the server (BM25, self-check graded against the fake model,
// JSONL export) and the Skill Forge (mounted in the database, install locked).
const kinds0 = (await srv.db.all("select kind from agent_memory_episodes")).map(r => r.kind);
ok(kinds0.includes("design"), "live: the model's Studio design was kept as a memory episode", kinds0.join(","));
await go("#/memory");
await page.locator("#f-ntitle").fill("Acme widgets layout");
await page.locator("#f-nbody").fill("A hero, then three cards for the widgets, then a plan table.");
await page.getByRole("button", { name: "Add to memory" }).click();
await page.waitForSelector(".mem", { timeout: 8000 }).catch(() => {});
ok(await page.locator(".mem h3", { hasText: "Acme widgets layout" }).isVisible(), "live: a note is saved to the server's memory");
await page.locator("#f-mq").fill("Acme widgets");
await page.waitForTimeout(600);
ok(/score/.test(await page.locator(".mem").first().textContent()) && await page.locator(".mem").first().locator("mark.term").first().isVisible(), "live BM25 search ranks episodes with their matched words");
await page.locator("#f-mq").fill("");
await page.getByRole("button", { name: "Run a self-check" }).click();
await page.waitForSelector("text=/\\d+ \\/ 9 correct/", { timeout: 15000 }).catch(() => {});
ok(await page.getByText(/\d+ \/ 9 correct/).isVisible() && await page.locator(".panel").filter({ hasText: "Self-check" }).getByText("Local model", { exact: true }).isVisible(), "live self-check grades the local model against computed answers");
const memRows = await srv.db.all("select kind, source from agent_memory_episodes");
ok(memRows.filter(r => r.source === "self-check").length === 9, "live self-check stores nine lessons in the database", JSON.stringify(memRows.slice(0, 3)));
const dlLive = page.waitForEvent("download");
await page.getByRole("button", { name: "Export JSONL" }).click();
const liveMem = readFileSync(await (await dlLive).path(), "utf8").trim().split("\n");
const wsMem = await srv.db.all("select e.id from agent_memory_episodes e join workspaces w on w.id = e.workspace_id where w.slug = $1", ["giant-core"]);
ok(liveMem.length === wsMem.length && liveMem.every(l => JSON.parse(l).messages.length === 2), "live export downloads every episode of this workspace as JSONL", liveMem.length + " vs " + wsMem.length);
await go("#/skills");
await page.locator("#f-fname").fill("release-checklist");
await page.locator("#f-fdesc").fill("Lists what to check before a release, and stops at anything locked.");
await page.getByRole("button", { name: "Forge and mount" }).click();
await page.waitForSelector(".feed li.forged", { timeout: 5000 }).catch(() => {});
ok(await page.locator(".feed li.forged", { hasText: "release-checklist" }).isVisible() && (await srv.db.all("select name from forged_skills where status = 'mounted'")).some(r => r.name === "release-checklist"), "live forge mounts the skill in the database");
await page.locator(".feed li.forged", { hasText: "release-checklist" }).getByRole("button", { name: "Install into the repo…" }).click();
await page.waitForTimeout(400);
ok(await page.locator("dialog[open]").getByText("قيد الموافقة").isVisible() && (await srv.db.all("select status, category from approvals where category = 'install'")).some(r => r.status === "locked-pending" || r.status === "pending"), "live install request becomes a locked approval", JSON.stringify(await srv.db.all("select status, category from approvals where category = 'install'")));
await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
ok(!existsSync(join(here, "..", "..", ".claude", "skills", "release-checklist")), "nothing is written into .claude/skills");

// ADR-139 live: federated search through /api/search/live, results as links, saved to memory.
await go("#/search");
await page.locator("#f-wq").fill("breadth first search");
await page.locator("#f-wq").press("Enter");
await page.waitForSelector(".hit", { timeout: 8000 }).catch(() => {});
ok((await page.locator(".hit").count()) === 5 && await page.locator(".hit a[href='https://github.com/acme/graph-search'][rel='noopener noreferrer'][target=_blank]").isVisible(), "live web search shows results from five official APIs as safe links");
ok((await page.locator("#h-src ~ ul li").filter({ hasText: "Answered" }).count()) === 5 && await page.locator("#h-src ~ ul li").filter({ hasText: "No SearXNG address is set." }).isVisible(), "live search lists each source's status");
ok(await page.getByText("Saved to memory as a search episode: titles and links only.").isVisible() && (await srv.db.all("select title from agent_memory_episodes where kind = 'search'")).some(r => r.title === "web: breadth first search"), "live search is summarised into memory");
ok(!searchHosts.some(h => /duckduckgo|google|bing/.test(h)) && searchHosts.includes("ar.wikipedia.org"), "live search asks only the official API hosts", searchHosts.join(","));
await page.getByRole("button", { name: /OSV vulnerabilities/ }).click();
await page.locator("#f-wq").fill("npm:lodash@4.17.15");
await page.locator("#f-wq").press("Enter");
await page.waitForSelector(".hit a[href='https://osv.dev/vulnerability/GHSA-p6mc-m468-83gw']", { timeout: 8000 }).catch(() => {});
ok(await page.locator(".hit", { hasText: "CVE-2020-8203" }).isVisible(), "live OSV search lists the vulnerability with its CVE alias");
await page.getByRole("button", { name: /Open web/ }).click();

// ADR-140 live: a streamed answer from the local model in Settings, reasoning kept apart.
await go("#/settings");
await page.locator("#f-ask").fill("Explain breadth-first search");
await page.getByRole("button", { name: "Ask", exact: true }).click();
await page.waitForFunction(() => /cost 0/.test(document.querySelector(".ask .subtle.t-caption:last-child")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
ok((await page.locator(".stream-out").textContent()) === "Breadth-first search visits a graph level by level." && (await page.locator(".stream-think").textContent()) === "Recall the definition." && /UNTRUSTED_MODEL_OUTPUT/.test(await page.locator(".ask > p.subtle").last().textContent()), "live: a streamed answer shows its text, its reasoning apart and the untrusted label");
ok(!(await page.getByRole("button", { name: "Stop", exact: true }).isVisible()), "live: the Stop button hides again once the answer is done");

// ADR-141 live: founder-only access; a hosted endpoint is a draft with a locked card in the database.
await go("#/settings");
await page.locator("#f-epname").fill("DeepSeek API"); await page.locator("#f-epurl").fill("https://api.deepseek.com/v1");
await page.getByRole("button", { name: "Ask to add…" }).click();
await page.waitForTimeout(400);
ok(await page.locator("dialog[open]").getByText("قيد الموافقة").isVisible() && (await srv.db.all("select status, host from model_endpoints")).some(r => r.status === "draft" && r.host === "api.deepseek.com"), "live: a hosted endpoint is stored as a draft behind a locked card");
await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
await page.getByRole("button", { name: "Open to the public…" }).click();
await page.waitForTimeout(400);
ok(await page.locator("dialog[open]").getByText(/Open Jarvis to the public/).isVisible() && (await srv.db.one("select mode from access_settings")).mode === "founder_private", "live: asking to go public leaves the database founder_private");
await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();

// ADR-142 live: discover on GitHub, import one SKILL.md as text, mounted in the database at once.
await go("#/loader");
await page.locator("#f-dq").fill("database schema"); await page.locator("#f-dq").press("Enter");
await page.waitForSelector(".hit", { timeout: 8000 }).catch(() => {});
ok(await page.locator(".hit a[href='https://github.com/acme/skills']").isVisible() && await page.locator(".hit").getByText(/MIT/).isVisible(), "live: GitHub discovery lists the repository with its licence");
ok(!/\bnull\b/.test(await page.locator("#h-disc ~ .stack").first().innerText()), "live: discovery results print no stray null");
await page.getByRole("button", { name: "Import SKILL.md" }).click();
await page.waitForTimeout(500);
ok(await page.locator("#h-mnt ~ div li.forged").filter({ hasText: "schema-reviewer" }).getByText("GitHub (text only)").isVisible() && (await srv.db.all("select origin, licence from runtime_skills where status = 'mounted'")).some(r => r.origin === "github" && r.licence === "MIT"), "live: an imported SKILL.md is mounted in the database with its origin and licence");
ok((await srv.db.all("select evolution_type from skill_evolution_log")).length >= 1, "live: the import is in the evolution log");
ok(!existsSync(join(here, "..", "..", ".claude", "skills", "schema-reviewer")), "live: nothing is written into .claude/skills");

// ADR-144 live: the council on the fake model (it leaves publishing unlocked), the time machine in the
// database (append-only, chained) and the UX heatmap from the sandboxed preview's own boxes.
await go("#/missions");
await page.locator("#f-goal").fill("Release this branch");
await page.getByRole("button", { name: "Ask the council" }).click();
await page.waitForSelector(".council", { timeout: 10000 }).catch(() => {});
ok(await page.locator(".council-card.arch code").getByText("jarvis-planner:latest").isVisible() && await page.locator(".council-card.arch").getByText("proposed unlocked").first().isVisible(), "live: the architect is the local planner, and its unlocked publish step is shown as proposed");
ok(await page.locator(".council-card.crit").getByText(/high · LOCK/).first().isVisible() && await page.getByText("Locks hold: every sensitive step waits for Director 00").isVisible(), "live: the red team flags the unlocked step and the locks hold");
await page.getByRole("button", { name: "Make it a mission" }).click();
await page.waitForFunction(() => /#\/missions\/[0-9a-f-]{36}$/.test(location.hash), null, { timeout: 10000 }).catch(() => {});
await page.waitForSelector(".planner", { timeout: 8000 }).catch(() => {});
ok(await page.locator(".planner").getByText(/Agreed by the council/).isVisible(), "live: the mission says the council planned it");
const councilMission = (await srv.db.all("select id from missions where planner like '%council%'"))[0];
const cSteps = councilMission ? await srv.db.all("select category, status from mission_steps where mission_id = $1 and kind = 'approval' and category in ('money', 'publish', 'permissions', 'install', 'outbound')", [councilMission.id]) : [];
ok(cSteps.length >= 1 && cSteps.every(x => x.status !== "done"), "live: the council's sensitive steps are approvals in the database and not done", JSON.stringify(cSteps));
await go("#/studio");
await page.locator("#f-snap-label").fill("Live one");
await page.getByRole("button", { name: "Save snapshot" }).click();
await page.waitForTimeout(400);
await page.locator("#f-site").fill("Live renamed");
await page.getByRole("button", { name: "Save snapshot" }).click();
await page.waitForTimeout(400);
const snapRows = await srv.db.all("select seq, hash, prev_hash from studio_snapshots order by seq");
ok(snapRows.length === 2 && snapRows[1].prev_hash === snapRows[0].hash && await page.getByText("Chain verified · 2 snapshots").isVisible(), "live: snapshots are rows in the database, chained by SHA-256");
let snapErr = null; try { await srv.db.run("update studio_snapshots set label = 'x'"); } catch (e) { snapErr = e; }
ok(snapErr && /append-only/.test(snapErr.message), "live: the database refuses to edit a snapshot");
await page.getByRole("button", { name: "Compare" }).click();
await page.waitForTimeout(400);
ok(await page.locator(".sbs td.d-add", { hasText: "Live renamed" }).isVisible(), "live: the server's diff is shown side by side");
await page.getByRole("button", { name: "UX heatmap" }).click();
await page.waitForSelector(".ux-report:not([hidden]) dl", { timeout: 5000 }).catch(() => {});
ok((await page.locator(".heat rect.hc").count()) > 10 && /symmetry between English and Arabic/.test(await page.locator(".ux-report").innerText()), "live: the UX heatmap is drawn from the preview's own boxes");
await page.getByRole("button", { name: "UX heatmap" }).click();

// The whole live interface in Arabic (ADR-137): same rule as test-app's F15.
const KEEP = /\b(Jarvis|SkillSpector|Ollama|Claude|Code|Replica|HTML|SKILL\.md|TDD|Lint|EN|AR|LTR|RTL|Ctrl|Pro|CI|API|ADR|WCAG|APCA|OKLCH|HMAC|SHA|SQLite|PostgreSQL|Readex|Inter|Geist|Mono|POST)\b|[\w-]*[._/@:#][\w.\-/@:#]*|\b(run|ap|ms|wf)_\w+/g;
const TYPED = ["Live one", "Live renamed", "ADR reader v2", "CI results", "Team chat", "Release this branch", "A product page", "ops@example.com", "Lists what to check before a release, and stops at anything locked.", "Acme widgets layout", "database schema", "breadth first search", "npm:lodash@4.17.15", "Explain breadth-first search", "A hero, then three cards for the widgets, then a plan table."];
const englishLeft = () => page.evaluate(() => {
  const out = new Set(), skip = el => !el || el.closest("[translate=no], code, pre, .mono, .num, script, style, textarea, iframe, .stage, template");
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t && !skip(n.parentElement)) { const r = n.parentElement.getBoundingClientRect(); if (r.width || r.height) out.add(t); } }
  for (const el of document.querySelectorAll("[aria-label], [placeholder], [title]")) if (el.tagName === "TEXTAREA" ? el.getAttribute("translate") !== "no" && !skip(el.parentElement) : !skip(el)) for (const a of ["aria-label", "placeholder", "title"]) { const v = el.getAttribute(a); if (v) out.add(v); }
  return [...out];
}).then(l => l.filter(t => !TYPED.some(x => t.includes(x)) && !/[\u0600-\u06FF]/.test(t) && /[A-Za-z]{2,}/.test(t.replace(KEEP, " "))));
await go("#/overview");
await page.locator("#langBtn").click();
await page.waitForTimeout(300);
const leftLive = {};
for (const r of ["overview", "agents", "runs", "missions", "workflows", "approvals", "analytics", "logs", "studio", "skills", "memory", "search", "loader", "governance", "webhooks", "settings"]) {
  await go("#/" + r);
  const l = await englishLeft(); if (l.length) leftLive[r] = l;
}
ok(Object.keys(leftLive).length === 0, "live: no interface text is left in English in Arabic mode", JSON.stringify(leftLive).slice(0, 1500));
await page.locator("#langBtn").click();
await page.waitForTimeout(300);

// Every screen renders in live mode (dates from the database included).
for (const r of ["overview", "logs", "runs", "missions", "workflows", "analytics", "webhooks", "settings", "skills", "memory", "search", "loader", "governance", "agents/templates"]) {
  await go("#/" + r);
  ok(!(await page.locator(".error-box").count()) && await page.locator("main h1").first().isVisible(), "live " + r + " renders");
  if (r === "logs") ok(/ago|just now/.test(await page.locator("main time").first().textContent({ timeout: 5000 })), "live dates show as relative times");
}

ok(errors.length === 0, "no console or page errors", errors.join(" | "));
await browser.close();
await srv.close();
fake.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
