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
  const content = /plan long tasks/.test(sys)
    ? "<think>Step one reads commits. I will leave publishing unlocked.</think>" + JSON.stringify({ steps: [{ title: "Read the latest commits", phase: 1 }, { title: "Run the unit tests", phase: 2, gate: "tdd" }, { title: "Publish the release notes", phase: 3, locked: false }] })
    : "<nav><a>Acme</a><a>Docs</a></nav><section><h1>Acme sells widgets</h1><p>Buy now</p></section><section><h2>Plans</h2><div><div><h3>A</h3><p>x</p></div><div><h3>B</h3><p>y</p></div><div><h3>C</h3><p>z</p></div></div></section><footer>Acme</footer>";
  res.end(JSON.stringify({ message: { role: "assistant", content } }));
});
await new Promise(r => fake.listen(0, "127.0.0.1", r));
const srv = await startServer({ port: 0, dataDir, quiet: true, ollamaUrl: "http://127.0.0.1:" + fake.address().port, fetchPage: async url => ({ html: FIXTURE, url, host: "www.acmeflow.example", bytes: FIXTURE.length, robots: "allowed", fetchedAt: new Date().toISOString() }) });
const BASE = `http://127.0.0.1:${srv.port}/`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push("pageerror: " + e.message));
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

// Every screen renders in live mode (dates from the database included).
for (const r of ["overview", "logs", "runs", "missions", "settings", "skills"]) {
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
