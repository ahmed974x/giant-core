#!/usr/bin/env node
// Mutation run for Jarvis's critical JavaScript (ADR-146): the SSRF address check, the AGENTS.md section 1
// lock rules and the formal prover. Each mutant is a copy of the module with one operator changed, written
// to a temporary folder and imported in a worker thread (no process is started, nothing comes from outside
// this repository). A fixed oracle, the expected answers for each function, runs against it; a mutant is
// killed when an answer changes, an error is thrown or it runs past the time limit, and survives otherwise.
//   node jarvis/scripts/mutation-harness.mjs [--out jarvis/replica/evidence/mutation-js.json]
import { Worker, isMainThread, workerData, parentPort } from "node:worker_threads";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const lib = join(repo, "jarvis", "server", "lib");

// ---- The oracles: what each target must answer. -------------------------------------------------------
const BLOCKED = ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255",
  "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.1", "198.51.100.7", "203.0.113.9", "::", "::1", "::2", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:0:10.0.0.1", "::10.0.0.1",
  "64:ff9b::7f00:1", "64:ff9b:1::a00:1", "2002:7f00:1::", "2001:0:4136::1", "2001:db8::1", "2001:10::1", "2001:1ff::1", "fc00::1", "fd12::1", "fe80::1", "febf::1", "fec0::1", "feff::1", "ff02::1", "ff01::1", "fd01::1", "100::1", "::ffff:10.1.8.8", "::ffff:0:10.1.8.8",
  "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "not-an-ip", "::ffff:192.168.0.1%eth0"];
const ALLOWED = ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.1.1", "169.255.0.1", "192.169.0.1", "11.0.0.1", "223.255.255.255", "198.17.0.1",
  "198.20.0.1", "198.51.101.1", "203.0.114.1", "192.0.1.1", "192.0.3.1", "9.255.255.255", "126.0.0.1", "128.0.0.1", "2606:4700:4700::1111", "2a00:1450:4001::1", "2001:200::1", "2003::1",
  "fbff::1", "fe7f::1", "100:1::1", "100:0:1::1", "100:0:0:1::1", "64:ff9a::1", "::ffff:8.8.4.4", "::ffff:0:8.8.4.4", "2a00::ffff:10.0.0.1", "2a00::ffff:0:10.0.0.1", "::ffff:192.0.1.1", "::ffff:0:192.0.1.1", "2001:db9::1", "1::1"];
const LOCK_SENTENCES = {
  money: ["pay the rent", "split the bill", "make a payment", "update billing", "send the invoice total", "change the price", "new pricing page", "start a subscription", "issue a refund", "transfer funds", "open the wallet", "move money", "charge the card", "set up stripe", "ادفع الآن", "دفع الرسوم", "راجع الفاتورة", "حوّل المال", "غيّر السعر", "حدّث الأسعار", "ألغ الاشتراك", "نفذ تحويل", "افتح المحفظة"],
  publish: ["publish the site", "deploy it", "go live today", "push to production", "release to users", "update the public site", "launch the page", "انشر الموقع", "نشر الصفحة", "إطلاق الصفحة", "اطلاق الموقع"],
  permissions: ["change a permission", "edit permissions", "give access", "assign a role", "grant rights", "make admin", "run sudo", "add a collaborator", "عدّل الصلاحيات"],
  install: ["install the tool", "add a plugin", "bump a dependency", "update dependencies", "npm i left-pad", "pip install x", "add a skill", "add the skill", "تثبيت الأداة", "ثبّت المهارة", "ثبت الحزمة"],
  outbound: ["email the team", "send it", "post a message", "call the webhook", "tweet the news", "ping slack", "notify users", "outbound call", "external report", "post to the forum", "أرسل التقرير", "ارسل الملف", "إرسال الملف", "ارسال الملف", "افحص البريد", "رسالة للفريق", "اتصال خارجي"],
};
const CLEAR = ["read the commits", "run the tests", "check contrast", "summarise the notes", "اقرأ الملفات"];

function oracleFetch(m) {
  const out = [];
  for (const a of BLOCKED) out.push(["blocked " + a, m.isBlockedAddress(a) === true]);
  for (const a of ALLOWED) out.push(["allowed " + a, m.isBlockedAddress(a) === false]);
  out.push(["v6Groups mapped", m.v6Groups("::ffff:127.0.0.1").join() === "0,0,0,0,0,65535,32512,1"]);
  out.push(["v6Groups full", m.v6Groups("2001:db8:0:0:0:0:2:1").join() === "8193,3512,0,0,0,0,2,1"]);
  out.push(["v6Groups dotted tail", m.v6Groups("::ffff:1.2.3.4").join() === "0,0,0,0,0,65535,258,772"]);
  out.push(["v6Groups zone", m.v6Groups("fe80::1%eth0").join() === "65152,0,0,0,0,0,0,1"]);
  return out;
}
function oracleLlmPlan(m) {
  const out = [];
  for (const [cat, list] of Object.entries(LOCK_SENTENCES)) for (const t of list) out.push([cat + ": " + t, m.lockCategory(t) === cat]);
  for (const t of CLEAR) out.push(["clear: " + t, m.lockCategory(t) === null]);
  const steps = m.enforceApprovalGates([
    { title: "Read the commits", phase: 1 },
    { title: "Run the tests", phase: 2, depends: [0, 0, 5, -1, 1] },
    { title: "Publish the site", phase: 3, locked: false, status: "done", depends: [1] },
    { title: "Tidy up", gate: "approval", phase: 3 },
    { title: "Check contrast", phase: 99, gate: "contrast" },
    { title: "Save a summary", phase: 0 },
    { title: "", phase: 2.5, depends: [4] },
    "Pay the hosting bill",
    { title: "x".repeat(300), phase: 2, depends: [6] },
  ]);
  out.push(["read is a tool", steps[0].kind === "tool" && steps[0].tool === "git.log" && steps[0].locked === false]);
  out.push(["tests are a gate", steps[1].kind === "gate" && steps[1].why === "gate: tests" && steps[1].depends.join() === "0"]);
  out.push(["publish is locked", steps[2].kind === "approval" && steps[2].category === "publish" && steps[2].locked === true && !("status" in steps[2])]);
  out.push(["declared approval stays locked", steps[3].category === "outbound" && steps[3].locked === true]);
  out.push(["phase is clamped high", steps[4].phase === 10 && steps[4].why === "gate: contrast"]);
  out.push(["a note waits for a person", steps[5].kind === "approval" && steps[5].category === "file_write" && steps[5].locked === false && steps[5].phase === 1]);
  out.push(["empty title and odd phase", steps[6].title === "Step 7" && steps[6].phase === 1 && steps[6].depends.length === 0]);
  out.push(["a bare string step", steps[7].category === "money" && steps[7].locked === true]);
  out.push(["titles are cut to 140", steps[8].title.length === 140 && steps[8].depends.join() === "6"]);
  const more = m.enforceApprovalGates([{ name: "Read the docs" }, { description: "Look around the repo" }, { title: "   " }, { title: "Tidy", locked: true }, { title: "Tidy the code", gate: "lint" }, { title: "Look around" }, { title: "Read the commits" }]);
  out.push(["name and description are titles", more[0].title === "Read the docs" && more[1].title === "Look around the repo" && more[2].title === "Step 3"]);
  out.push(["a declared lock stays locked", more[3].kind === "approval" && more[3].category === "outbound" && more[3].why === "locked by rule: outbound"]);
  out.push(["a gate alias works alone", more[4].kind === "gate" && more[4].why === "gate: lint" && more[4].locked === false && steps[1].locked === false]);
  out.push(["a read tool reads ADRs", more[5].tool === "files.read" && more[5].input.path === "docs/adr/ADR-13*" && more[5].why === "read tool: files.read" && JSON.stringify(more[6].input) === "{}"]);
  out.push(["at most 20 steps", m.enforceApprovalGates(Array.from({ length: 30 }, (_, i) => ({ title: "Read file " + i }))).length === 20]);
  out.push(["needs only earlier steps", m.enforceApprovalGates([{ title: "a", phase: 1 }, { title: "b", phase: 1, depends: [0, 1] }])[1].depends.join() === "0"]);
  out.push(["a later phase is not needed by an earlier one", m.enforceApprovalGates([{ title: "a", phase: 2 }, { title: "b", phase: 1, depends: [0] }])[1].depends.length === 0]);
  out.push(["fallback plan locks", m.fallbackPlan("read the docs then publish the site").some(s => s.locked && s.category === "publish")]);
  return out;
}
function oracleProver(m) {
  const out = [];
  const plan = [{ title: "Read", kind: "tool" }, { title: "Tests", kind: "gate", depends: [0] }, { title: "Publish", kind: "approval", category: "publish", locked: true, depends: [1] },
    { title: "Pay", kind: "approval", category: "money", locked: true, depends: [2] }, { title: "Note", kind: "approval", category: "file_write", locked: false, depends: [0] }];
  const mach = m.planMachine(plan);
  out.push(["machine size", mach.states.length === 10 && mach.transitions.length === 13]);
  out.push(["gate can fail", mach.transitions.some(t => t.from === "s1" && t.to === "stopped" && t.event === "fail")]);
  out.push(["note can be rejected", mach.transitions.some(t => t.from === "s4" && t.to === "stopped" && t.event === "rejected")]);
  out.push(["effects follow approval", mach.transitions.some(t => t.from === "s2" && t.to === "e2" && t.event === "approved") && mach.transitions.some(t => t.from === "e3" && t.to === "done")]);
  const p = m.prove(mach);
  out.push(["verified", p.verified === true && p.effects === 2 && p.lockedStates === 2 && p.reachable === 10 && p.deadlocks.length === 0 && p.unreachable.length === 0 && p.reachesDone === true && p.danglingTransitions === 0]);
  const open = m.provePlan(plan.map(s => s.category === "publish" ? { ...s, locked: false } : s));
  out.push(["unlocked publish fails with a path", open.verified === false && open.violations.length === 1 && open.violations[0].effect === "publish" && open.violations[0].path.join("|") === "start -begin-> s0|s0 -ok-> s1|s1 -ok-> s2|s2 -approved-> e2"]);
  const dead = m.planMachine(plan); dead.states.push({ id: "limbo" }); dead.transitions.push({ from: "s0", to: "limbo", event: "x" });
  out.push(["deadlock", m.prove(dead).deadlocks.join() === "limbo" && m.prove(dead).verified === false]);
  const orphan = m.planMachine(plan); orphan.transitions = orphan.transitions.filter(t => t.to !== "s4");
  out.push(["unreachable step", m.prove(orphan).unreachable.join() === "s4" && m.prove(orphan).verified === false]);
  const dangling = m.planMachine(plan); dangling.transitions.push({ from: "s0", to: "nowhere", event: "x" });
  out.push(["dangling transition", m.prove(dangling).danglingTransitions === 1 && m.prove(dangling).verified === false]);
  const noDone = m.planMachine([{ title: "Gate", kind: "gate" }]); noDone.transitions = noDone.transitions.filter(t => t.to !== "done");
  out.push(["done must be reachable", m.prove(noDone).reachesDone === false && m.prove(noDone).verified === false]);
  out.push(["empty plan", m.provePlan([]).verified === true && m.planMachine([]).transitions.length === 1]);
  out.push(["bad depends ignored", m.planMachine([{ title: "a", depends: [3, -1, 0] }]).transitions.filter(t => t.event === "begin").length === 0]);
  const st = m.planMachine([{ title: "y".repeat(200) }, { title: "b", kind: "gate", category: "x" }]).states;
  out.push(["state fields", st[3].title.length === 160 && st[3].kind === "tool" && st[3].category === null && st[4].kind === "gate" && st[4].category === "x" && m.planMachine([{}]).states[3].title === ""]);
  out.push(["no self-dependency", m.planMachine([{ title: "a", depends: [0] }]).transitions.some(t => t.from === "s0" && t.to === "done")]);
  out.push(["sensitive list", m.SENSITIVE.join() === "money,publish,permissions,install,outbound"]);
  return out;
}
const TARGETS = [
  { file: "fetch-public.mjs", functions: ["v4Blocked", "v6Groups", "isBlockedAddress"], oracle: "fetch" },
  { file: "llm-plan.mjs", functions: ["lockCategory", "enforceApprovalGates"], oracle: "llmPlan", regexConst: "LOCK_RULES" },
  { file: "prover.mjs", functions: ["planMachine", "search", "prove"], oracle: "prover" },
];
const ORACLES = { fetch: oracleFetch, llmPlan: oracleLlmPlan, prover: oracleProver };
// Mutants that cannot change any answer, each reviewed by hand. They are listed in the evidence with the
// reason and left out of the score's denominator; they are never counted as killed.
const EQUIVALENT = [
  { file: "fetch-public.mjs", line: "g.length !== 8 || g.some(", why: "net.isIPv6 has already accepted the address, so v6Groups always gives eight groups in 0..0xffff; the check is defence in depth" },
  { file: "fetch-public.mjs", line: "if (zeros(8)) return true;", why: "slice(0, 9) of eight groups equals slice(0, 8)" },
  { file: "fetch-public.mjs", line: "if (zeros(7) && g[7] === 1) return true;", why: "::1 is also refused by the compatible ::/96 rule two lines down" },
  { file: "fetch-public.mjs", line: "zeros(5) && g[5] === 0xffff", kind: "7 -> 8", why: "g[8] is undefined, so v4From keeps the first two octets; a mapped address is judged on them alone only when the last two are 0.0, which the oracle covers" },
  { file: "fetch-public.mjs", line: "zeros(4) && g[4] === 0xffff", kind: "7 -> 8", why: "as above, for the SIIT form" },
  { file: "fetch-public.mjs", line: "g[0] === 0x2001 && g[1] === 0)", why: "Teredo 2001::/32 is inside 2001::/23, refused three lines down" },
  { file: "llm-plan.mjs", drop: "ادفع", why: "every text with ادفع also contains دفع, a word of the same rule" },
  { file: "llm-plan.mjs", drop: "انشر", why: "every text with انشر also contains نشر, a word of the same rule" },
  { file: "llm-plan.mjs", drop: "pip install", why: "every text with pip install also contains install, a word of the same rule" },
];
const isEquivalent = (file, src, mu) => EQUIVALENT.find(e => e.file === file && (e.drop ? mu.kind === "drop " + e.drop : src.split("\n")[mu.line - 1].includes(e.line) && (!e.kind || mu.kind === e.kind)));

if (!isMainThread) {
  const { url, oracle } = workerData;
  import(url).then(m => {
    const res = ORACLES[oracle](m);
    parentPort.postMessage({ failed: res.filter(([, ok]) => !ok).map(([name]) => name) });
  }, e => parentPort.postMessage({ failed: ["import: " + String(e && e.message).slice(0, 120)] })).catch(e => parentPort.postMessage({ failed: ["error: " + String(e && e.message).slice(0, 120)] }));
} else {
  // ---- Mutants: one operator changed inside one target function. ----------------------------------------
  // Strings, template literals, comments and regex literals are masked so they are never mutated.
  function mask(src) {
    const m = new Uint8Array(src.length);
    let i = 0;
    const prevSig = k => { let j = k - 1; while (j >= 0 && /\s/.test(src[j])) j--; return j < 0 ? "" : src[j]; };
    while (i < src.length) {
      const c = src[i];
      if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") m[i++] = 1; continue; }
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2) + 2; while (i < e) m[i++] = 1; continue; }
      if (c === '"' || c === "'" || c === "`") { m[i++] = 1; while (i < src.length && src[i] !== c) { if (src[i] === "\\") m[i++] = 1; m[i++] = 1; } m[i++] = 1; continue; }
      if (c === "/" && /[(,=:[!&|?{};]|^$/.test(prevSig(i))) {
        m[i++] = 1; let cls = false;
        while (i < src.length && (src[i] !== "/" || cls)) { if (src[i] === "\\") m[i++] = 1; else if (src[i] === "[") cls = true; else if (src[i] === "]") cls = false; m[i++] = 1; }
        m[i++] = 1; while (/[a-z]/.test(src[i] || "")) m[i++] = 1; continue;
      }
      i++;
    }
    return m;
  }
  function bodyRange(src, name) {
    const at = new RegExp("(^|\\n)(export )?function " + name + "\\s*\\(").exec(src);
    if (!at) throw new Error("no function " + name);
    const msk = mask(src);
    let i = src.indexOf("{", src.indexOf(")", at.index + at[0].length)), depth = 0;
    const start = i;
    for (; i < src.length; i++) { if (msk[i]) continue; if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) return [start, i + 1]; }
    throw new Error("unbalanced " + name);
  }
  const OPS = [
    [/===/g, "!=="], [/!==/g, "==="], [/&&/g, "||"], [/\|\|/g, "&&"],
    [/(?<![<>=!])<=(?!=)/g, "<"], [/(?<![<>=!])>=(?!=)/g, ">"], [/(?<![<=>-])<(?![<=])/g, "<="], [/(?<![=>-])>(?![>=])/g, ">="],
    [/\btrue\b/g, "false"], [/\bfalse\b/g, "true"], [/(?<![\w.])(0x[0-9a-f]+|\d+)(?![\w.])/gi, n => String(Number(n) + 1)],
    [/\+(?![+=])/g, "-"], [/(?<![-=])-(?![->=])/g, "+"], [/!(?!=)/g, ""],
  ];
  function mutants(src, t) {
    const out = [], msk = mask(src);
    for (const fn of t.functions) {
      const [a, b] = bodyRange(src, fn);
      for (const [re, rep] of OPS) {
        for (const mm of src.slice(a, b).matchAll(re)) {
          const at = a + mm.index;
          if (msk[at]) continue;
          if (rep === "<=" || rep === ">=") { const prev = src[at - 1], next = src[at + 1]; if (prev === "=" || next === ">" || prev === ">" || prev === "<") continue; }
          const to = typeof rep === "function" ? rep(mm[0]) : rep;
          const line = src.slice(0, at).split("\n").length;
          out.push({ fn, line, kind: mm[0] + " -> " + (to || "(removed)"), text: src.slice(0, at) + to + src.slice(at + mm[0].length) });
        }
      }
    }
    if (t.regexConst) {
      // Each word of each lock rule taken out in turn: the oracle must notice every missing word.
      const at = src.indexOf("const " + t.regexConst + " = [");
      const end = src.indexOf("];", at);
      const block = src.slice(at, end);
      for (const rm of block.matchAll(/\["(\w+)", \/(.*)\/i\]/g)) {
        const alts = [];
        let depth = 0, cur = "", start = 0;
        const body = rm[2];
        for (let k = 0; k < body.length; k++) {
          const ch = body[k];
          if (ch === "\\") { cur += ch + body[++k]; continue; }
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if (depth <= 1 && ch === "|") { alts.push([start, k]); start = k + 1; }
          cur += ch;
        }
        alts.push([start, body.length]);
        for (const [s0, e0] of alts) {
          const piece = body.slice(s0, e0).replace(/^\\b\(|\)\\b$/g, "");
          if (!piece || piece === "(" ) continue;
          let nb = body.slice(0, s0) + body.slice(e0 + 1);
          if (e0 === body.length) nb = body.slice(0, Math.max(0, s0 - 1));
          const absAt = at + rm.index + rm[0].indexOf("/") + 1;
          const line = src.slice(0, absAt).split("\n").length;
          out.push({ fn: t.regexConst + "." + rm[1], line, kind: "drop " + body.slice(s0, e0).slice(0, 40), text: src.slice(0, absAt) + nb + src.slice(absAt + body.length) });
        }
      }
    }
    return out;
  }
  const runOne = (url, oracle) => new Promise(resolve => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { url, oracle } });
    const timer = setTimeout(() => { w.terminate(); resolve({ failed: ["timeout"] }); }, 4000);
    w.once("message", r => { clearTimeout(timer); w.terminate(); resolve(r); });
    w.once("error", e => { clearTimeout(timer); resolve({ failed: ["error: " + String(e && e.message).slice(0, 120)] }); });
  });

  const outArg = process.argv.indexOf("--out");
  const outPath = outArg > 0 ? process.argv[outArg + 1] : join(repo, "jarvis", "replica", "evidence", "mutation-js.json");
  const work = mkdtempSync(join(tmpdir(), "jarvis-mutants-"));
  cpSync(lib, work, { recursive: true });
  const report = { tool: "jarvis/scripts/mutation-harness.mjs", ranAt: new Date().toISOString(), targets: [] };
  try {
    for (const t of TARGETS) {
      const src = readFileSync(join(lib, t.file), "utf8");
      const base = await runOne(pathToFileURL(join(lib, t.file)).href, t.oracle);
      if (base.failed.length) throw new Error(t.file + ": the oracle fails on the real code: " + base.failed.join(", "));
      const list = mutants(src, t);
      const survived = [], equivalent = [];
      let killed = 0, k = 0;
      for (const mu of list) {
        const f = join(work, t.file.replace(/\.mjs$/, "") + ".m" + (k++) + ".mjs");
        writeFileSync(f, mu.text);
        const r = await runOne(pathToFileURL(f).href, t.oracle);
        rmSync(f);
        const eq = r.failed.length ? null : isEquivalent(t.file, src, mu);
        if (r.failed.length) killed++; else if (eq) equivalent.push({ fn: mu.fn, line: mu.line, kind: mu.kind, why: eq.why }); else survived.push({ fn: mu.fn, line: mu.line, kind: mu.kind });
      }
      const row = { file: relative(repo, join(lib, t.file)), sha256: createHash("sha256").update(src).digest("hex"), functions: t.functions.concat(t.regexConst ? [t.regexConst] : []), mutants: list.length, killed, equivalent: equivalent.length, survived: survived.length, score: list.length - equivalent.length ? Math.round(1000 * killed / (list.length - equivalent.length)) / 10 : 100, survivors: survived, equivalents: equivalent };
      report.targets.push(row);
      console.log(`${row.file}: ${killed}/${list.length - equivalent.length} killed (${row.score}%), ${equivalent.length} equivalent` + (survived.length ? "; survived: " + survived.map(s => `${s.fn}:${s.line} ${s.kind}`).join(" | ") : ""));
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  writeFileSync(outPath, JSON.stringify(report, null, 1) + "\n");
  const all = report.targets.reduce((n, t) => n + t.mutants - t.equivalent, 0), dead = report.targets.reduce((n, t) => n + t.killed, 0);
  console.log(`JavaScript: ${dead}/${all} mutants killed (${Math.round(1000 * dead / all) / 10}%) · wrote ${relative(repo, outPath)}`);
}
