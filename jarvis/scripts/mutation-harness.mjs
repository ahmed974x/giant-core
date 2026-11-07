#!/usr/bin/env node
// Mutation run for Jarvis's critical JavaScript (ADR-146): the SSRF address check, the AGENTS.md section 1
// lock rules, the formal prover and (ADR-150) the reversal engine. Each mutant is a copy of the module with
// one operator changed, written to a temporary folder and imported in a worker thread (no process is
// started, nothing comes from outside this repository). A fixed oracle, the expected answers for each function, runs against it; a mutant is
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
  { file: "passive-recon.mjs", functions: ["normalizeDomain", "parseRdap", "parseCt", "gradeHeaders", "parseSecurityTxt", "reconReport"], oracle: "recon" },
  { file: "reversal.mjs", functions: ["correctionVector", "sealed", "reversePlan", "hueOf", "rgbHue", "gradientColours", "fixGradients", "cssOf", "cssBlocks", "glassSelectors", "addCss", "reverseTemplate"], oracle: "reversal" },
];
const ORACLES = { fetch: oracleFetch, llmPlan: oracleLlmPlan, prover: oracleProver, reversal: oracleReversal, recon: oracleRecon };
// Mutants that cannot change any answer, each reviewed by hand. They are listed in the evidence with the
// reason and left out of the score's denominator; they are never counted as killed.
const EQUIVALENT = [
  { file: "fetch-public.mjs", line: "g.length !== 8 || g.some(", why: "net.isIPv6 has already accepted the address, so v6Groups always gives eight groups in 0..0xffff; the check is defence in depth" },
  { file: "fetch-public.mjs", line: "if (zeros(8)) return true;", why: "slice(0, 9) of eight groups equals slice(0, 8)" },
  { file: "fetch-public.mjs", line: "if (zeros(7) && g[7] === 1) return true;", why: "::1 is also refused by the compatible ::/96 rule two lines down" },
  { file: "fetch-public.mjs", line: "zeros(5) && g[5] === 0xffff", kind: "7 -> 8", why: "g[8] is undefined, so v4From keeps the first two octets; a mapped address is judged on them alone only when the last two are 0.0, which the oracle covers" },
  { file: "fetch-public.mjs", line: "zeros(4) && g[4] === 0xffff", kind: "7 -> 8", why: "as above, for the SIIT form" },
  { file: "fetch-public.mjs", line: "g[0] === 0x2001 && g[1] === 0)", why: "Teredo 2001::/32 is inside 2001::/23, refused three lines down" },
  { file: "reversal.mjs", line: "list[i] && typeof list[i]", kind: "&& -> ||", why: "a locked step is an object or a non-empty string, and a string has no gate, locked or status, so o reads the same" },
  { file: "reversal.mjs", line: "parseInt(h.slice(4, 6), 16)", kind: "6 -> 7", why: "h always has exactly six characters, so slice(4, 7) equals slice(4, 6)" },
  { file: "reversal.mjs", line: "((g - b) / d) % 6", kind: "6 -> 7", why: "when red is the largest, |g - b| <= d, so the quotient is in [-1, 1] and % 6 or % 7 leaves it unchanged" },
  { file: "reversal.mjs", line: "((Math.round(h * 60) % 360) + 360) % 360", kind: "360 -> 361", why: "h * 60 is always in [-60, 300], so the first % 360 changes nothing; the other two 360s are killed by the oracle" },
  { file: "reversal.mjs", line: "g.slice(g.indexOf(\"(\") + 1, -1)", kind: "+ -> -", why: "the extra two characters are always \"t(\" from \"-gradient(\", and \"t\" is not a colour" },
  { file: "reversal.mjs", line: "new Int32Array(n + 1)", why: "a longer buffer holds the same values at every index read" },
  { file: "reversal.mjs", line: "prevStop[0] = 0;", why: "prevStop[0] is read only for a gradient at index 0, which has no property before it, and prevStop[1] is written by the loop" },
  { file: "reversal.mjs", line: "for (let i = n - 1; i >= 0; i--)", kind: ">= -> >", why: "nextStop[0] is read only when a gradient ends at index 0, which cannot happen" },
  { file: "reversal.mjs", line: "for (let i = n - 1; i >= 0; i--)", kind: "0 -> 1", why: "as above: nextStop[0] is never read" },
  { file: "reversal.mjs", line: "for (let i = 0; i < n; i++) prevStop", kind: "< -> <=", why: "the extra turn reads text[n], which is undefined, and writes past the end of the buffer, which is ignored" },
  { file: "reversal.mjs", line: "if (g.index < last) continue;", kind: "< -> <=", why: "last is the index of a stop character or the end of the text, and a gradient starts with a letter" },
  { file: "reversal.mjs", line: "return head >= 0 ?", why: "a </head> at index 0 puts the new style first, which is exactly what the other branch does" },
  { file: "reversal.mjs", line: "if (!/^<style[\\s>]/.test(low.slice(i, i + 7)))", kind: "7 -> 8", why: "the test is anchored at the start, so one more character after '<style' and its space or '>' changes nothing" },
  { file: "reversal.mjs", line: "close = open < 0 ? -1 : low.indexOf", why: "open is found at least six characters in when the tag matched, so < 0 and <= 0 or < 1 agree; when no '>' follows, -1, -2 and +1 all end the loop before any rule can be read (at most the text's first character is kept)" },
  { file: "reversal.mjs", line: "if (close < 0) break;", why: "close, when found, is after open, so it is never 0" },
  { file: "reversal.mjs", line: "for (let i = 0; i < css.length; i++) {", kind: "< -> <=", why: "the extra turn reads css[css.length], which is undefined and matches no branch" },
  { file: "passive-recon.mjs", line: "if (slash >= 0) s = s.slice(0, slash);", why: "a / at index 0 left in place makes the first label contain /, which the label check refuses just as the empty name is refused" },
  { file: "passive-recon.mjs", line: "if (s.length < 3 || s.length > 253", kind: "< -> <=", why: "the shortest name the label rules accept is four characters (a.bc), so < 3 and <= 3 refuse the same names" },
  { file: "passive-recon.mjs", line: "if (s.length < 3 || s.length > 253", kind: "3 -> 4", why: "as above: no three- or four-character name differs, since a.bc is the shortest that passes" },
  { file: "passive-recon.mjs", line: "return /^[a-z]{2,63}$/.test(tld)", kind: "63 -> 64", why: "a label longer than 63 characters is already refused by the loop above" },
  { file: "passive-recon.mjs", line: "(a[0] < b[0] ? -1 : 1)", kind: "< -> <=", why: "issuer names are Map keys, so two of them are never equal" },
  { file: "passive-recon.mjs", line: "(a[0] < b[0] ? -1 : 1)", kind: "1 -> 2", why: "a comparator's sign is all that matters; -2 and 2 order the same as -1 and 1" },
  { file: "llm-plan.mjs", drop: "ادفع", why: "every text with ادفع also contains دفع, a word of the same rule" },
  { file: "llm-plan.mjs", drop: "انشر", why: "every text with انشر also contains نشر, a word of the same rule" },
  { file: "llm-plan.mjs", drop: "pip install", why: "every text with pip install also contains install, a word of the same rule" },
];
const isEquivalent = (file, src, mu) => EQUIVALENT.find(e => e.file === file && (e.drop ? mu.kind === "drop " + e.drop : src.split("\n")[mu.line - 1].includes(e.line) && (!e.kind || mu.kind === e.kind)));

// ADR-150: the reversal engine. Expected answers worked out by hand from the rules in reversal.mjs.
function oracleReversal(m) {
  const out = [];
  const plan = [{ title: "Read the docs" }, { title: "Pay the hosting invoice", locked: false }, { title: "Publish the site", gate: "approval", locked: true, status: "done" },
    { title: "Email the team", gate: "approval", locked: true, status: "pending_approval" }, { title: "Tidy", gate: "Approval", locked: true, status: "pending_approval" }, "Grant admin access"];
  const r = m.reversePlan(plan);
  out.push(["plan corrections", r.corrections.map(c => c.step + ":" + c.category).join() === "1:money,2:publish,4:outbound,5:permissions"]);
  out.push(["plan from", JSON.stringify(r.corrections.map(c => c.from)) === JSON.stringify([{ gate: null, locked: false, status: null }, { gate: "approval", locked: true, status: "done" }, { gate: "Approval", locked: true, status: "pending_approval" }, { gate: null, locked: false, status: null }])]);
  out.push(["plan locked steps", r.steps.filter(x => x.locked).length === 5 && r.steps.filter(x => x.locked).every(x => x.gate === "approval" && x.status === "pending_approval") && r.steps[0].locked === false && r.steps[0].status === undefined]);
  out.push(["plan titles", r.corrections.map(c => c.title).join("|") === "Pay the hosting invoice|Publish the site|Tidy|Grant admin access" && r.corrections.every(c => c.to.gate === "approval" && c.to.locked === true && c.to.status === "pending_approval" && c.rule === "lock-sensitive-step")]);
  out.push(["plan proof", r.proof.verified === true && r.proof.effects === 5 && r.proof.lockedStates === 5 && r.proof.violations === 0 && r.proof.states === 14]);
  out.push(["plan vector", r.vector.values.join() === "4,0,0,0,0" && r.vector.total === 4 && r.vector.rules.length === 5 && r.changed === true && r.kind === "plan"]);
  out.push(["plan hashes", /^[0-9a-f]{64}$/.test(r.before) && r.before !== r.after && /^[0-9a-f]{64}$/.test(r.proofHash) && r.proofHash !== r.after]);
  const again = m.reversePlan(r.steps);
  out.push(["plan fixed point", again.corrections.length === 0 && again.changed === false && again.vector.total === 0]);
  out.push(["plan bad input", m.reversePlan(null).steps.length === 0 && m.reversePlan(Array.from({ length: 25 }, (_, i) => ({ title: "s" + i }))).steps.length === 20 && m.reversePlan([{ title: "x", status: "pending_approval", locked: true }]).corrections.length === 1]);
  out.push(["vector", m.correctionVector([{ rule: "gradient" }, { rule: "overflow-wrap" }, { rule: "gradient" }]).values.join() === "0,0,2,0,1" && m.correctionVector([]).total === 0]);
  const hues = [["#0000ff", 240], ["#00f", 240], ["#ff0000", 0], ["#00ff00", 120], ["#ff00ff", 300], ["#800080", 300], ["#3b82f6", 217], ["#8b5cf6", 258], ["#ffff00", 60], ["#00ffff", 180], ["#ff8000", 30], ["#ff0080", 330], ["#808080", null], ["#808787", null], ["#80888f", 208], ["#808088", 240], ["#808087", null], ["#808890", 210],
    ["rgb(0, 0, 255)", 240], ["rgba(128,0,128,.5)", 300], ["rgb(255 0 0)", 0], ["hsl(280 50% 50%)", 280], ["hsla(-40, 50%, 50%)", 320], ["hsl(400 1% 1%)", 40], ["oklch(54.5% 0.197 257.4)", 235], ["oklch(50% 0.01 250)", null], ["oklch(50% 0.02 22)", 0], ["oklch(50% 0.2 10)", 348],
    ["lch(50% 0 300)", 278], ["blue", 240], ["Purple", 300], ["white", null], ["to", undefined], ["deg", undefined], ["#12345", undefined]];
  for (const [c, h] of hues) out.push(["hue " + c, m.hueOf(c) === h]);
  out.push(["colours", m.gradientColours("linear-gradient(to right, #fff, rgb(1, 2, 3) 40%, blue)").join("|") === "#fff|rgb(1, 2, 3)|blue"]);
  const t = m.reverseTemplate(".hero { background: linear-gradient(135deg, #3b82f6, #8b5cf6) }\n.bar, .nav { backdrop-filter: blur(16px) }\n.c { border-image: linear-gradient(red, orange) 1; color: red }\n.d{background-image:radial-gradient(teal,navy)}");
  out.push(["template rules", t.corrections.map(c => c.rule).join() === "ai-gradient,gradient,gradient,reduced-transparency,overflow-wrap"]);
  out.push(["template text", t.text === ".hero { background-color: #3b82f6 }\n.bar, .nav { backdrop-filter: blur(16px) }\n.c { border-image: none; color: red }\n.d{background-color:teal}\n@media (prefers-reduced-transparency: reduce) {\n  .bar, .nav { -webkit-backdrop-filter: none; backdrop-filter: none; background-color: Canvas; color: CanvasText; }\n}\n:where(h1, h2, h3, h4, p, li, td, th, dd, dt, a, blockquote, figcaption) { overflow-wrap: anywhere; }\n"]);
  out.push(["template details", t.corrections[0].property === "background" && t.corrections[0].to === "#3b82f6" && t.corrections[1].from === "linear-gradient(red, orange) 1" && t.corrections[3].selectors.join() === ".bar,.nav" && t.vector.values.join() === "0,1,2,1,1" && t.html === false]);
  out.push(["template fixed point", m.reverseTemplate(t.text).changed === false]);
  out.push(["no colour stop", m.reverseTemplate("a{background:linear-gradient(to right, 10%, 20%)}").text.startsWith("a{background-color:transparent}")]);
  out.push(["glass", m.glassSelectors(".a{backdrop-filter:blur(4px)} .b{backdrop-filter:none} @media (prefers-reduced-transparency: reduce){.c{backdrop-filter:none}} .c{-webkit-backdrop-filter:blur(2px)} .a{backdrop-filter:blur(1px)}").join() === ".a"]);
  out.push(["glass none", m.glassSelectors(".x{color:red}").length === 0 && m.glassSelectors("x{ backdrop-filter : saturate(2)}").join() === "x"]);
  const h1 = m.reverseTemplate("<html><head></head><body><p>x</p></body></html>");
  out.push(["html head", h1.text === "<html><head><style>\n:where(h1, h2, h3, h4, p, li, td, th, dd, dt, a, blockquote, figcaption) { overflow-wrap: anywhere; }\n</style>\n</head><body><p>x</p></body></html>" && h1.html === true]);
  const h2 = m.reverseTemplate("<STYLE>a{x:1}</STYLE><style>b{y:2}</style><p>x</p>");
  out.push(["html last style", h2.text === "<STYLE>a{x:1}</STYLE><style>b{y:2}:where(h1, h2, h3, h4, p, li, td, th, dd, dt, a, blockquote, figcaption) { overflow-wrap: anywhere; }\n</style><p>x</p>"]);
  out.push(["html no head", m.reverseTemplate("<div>x</div>").text.startsWith("<style>\n:where(") && m.reverseTemplate("<div>x</div>").text.endsWith("\n</style>\n<div>x</div>")]);
  out.push(["html wrap present", m.reverseTemplate("<style>p{overflow-wrap: anywhere}</style><p>x</p>").changed === false && m.reverseTemplate("p{overflow-wrap:anywhere}").changed === false]);
  out.push(["empty", m.reverseTemplate("").changed === false && m.reverseTemplate("   ").changed === false && m.reverseTemplate(null).text === "" && m.reverseTemplate("a{}").corrections.length === 1]);
  out.push(["long input cut", m.reverseTemplate("a".repeat(200005)).text.length === 200103]);
  // The hashes are SHA-256 of the exact text, and the one-correction case still counts as changed.
  const sha = x => createHash("sha256").update(x).digest("hex");
  const one = m.reversePlan([{ title: "Pay rent" }]);
  out.push(["sealed hashes", one.changed === true && one.before === sha(JSON.stringify([{ title: "Pay rent" }])) && one.after === sha(JSON.stringify(one.steps)) && one.proofHash === sha(one.before + "\n" + one.after + "\n" + JSON.stringify(one.corrections))]);
  const big = Array.from({ length: 25 }, (_, i) => ({ title: "s" + i }));
  out.push(["plan cut at 20", m.reversePlan(big).before === sha(JSON.stringify(big.slice(0, 20)))]);
  const tt = m.reverseTemplate("a{color:red}");
  out.push(["template hashes", tt.before === sha("a{color:red}") && tt.after === sha(tt.text) && tt.proofHash === sha(tt.before + "\n" + tt.after + "\n" + JSON.stringify(tt.corrections))]);
  for (const [c, h] of [["#ff8040", 20], ["#40ff80", 140], ["#8040ff", 260], ["oklch(50% 0.2 400)", 18], ["oklch(50% 0.2 -400)", 298]]) out.push(["hue " + c, m.hueOf(c) === h]);
  out.push(["no declaration", m.reverseTemplate("x linear-gradient(red, blue)").corrections.map(c => c.rule).join() === "overflow-wrap"]);
  out.push(["gradient at the end", m.reverseTemplate("a:linear-gradient(red,blue)").text.startsWith("a:none\n")]);
  out.push(["after a stop", m.reverseTemplate(";a:linear-gradient(red,blue)").text.startsWith(";a:none\n") && m.reverseTemplate("x;b:linear-gradient(red,blue)").text.startsWith("x;b:none\n")]);
  const longValue = m.reverseTemplate("a{background:linear-gradient(red," + " ".repeat(300) + "blue)}");
  out.push(["from is cut at 200", longValue.corrections[0].from.length === 200]);
  out.push(["style at 0", m.reverseTemplate("</style><p>x</p>").text.startsWith(":where(") && m.reverseTemplate("<p>x</p></head>").text.startsWith("<p>x</p><style>\n:where(")]);
  out.push(["blocks nested and after }", JSON.stringify(m.cssBlocks("a { b { c: 1 } }a{}b{y:2}").map(b => [b.selector, b.body])) === JSON.stringify([["b", " c: 1 "], ["a", ""], ["b", "y:2"]]) && m.glassSelectors("a;b{backdrop-filter:blur(1px)} @font-face{backdrop-filter:blur(1px)}").join() === "b"]);
  out.push(["blocks fallback", JSON.stringify(m.cssBlocks("@media (prefers-reduced-transparency: reduce) { .a { x: 1 } } b{y:2} } c{").map(b => [b.selector, b.fallback])) === JSON.stringify([[".a", true], ["b", false]])]);
  const css = t2 => m.reverseTemplate(t2).corrections.map(c => c.rule).join();
  out.push(["style blocks read", css("<styles>a</styles><style media=x>.g{backdrop-filter:blur(1px)}</style><p>") === "reduced-transparency,overflow-wrap" && css("<style<style>.g{backdrop-filter:blur(1px)}</style><p>") === "reduced-transparency,overflow-wrap"
    && css("<style>p{color:red}</style><style>p{overflow-wrap:anywhere}</style><p>") === "" && css("<style>.g{backdrop-filter:blur(1px)}") === "overflow-wrap" && css("<style>x<style></style><p>{overflow-wrap:anywhere}") === "overflow-wrap"]);
  out.push(["style content exact", css("<style>overflow-wrap: anywhere</style><p>") === "" && m.reverseTemplate("<style>.g{backdrop-filter:blur(1px)}</style><p>").corrections[0].selectors.join() === ".g" && m.glassSelectors("}b{backdrop-filter:blur(1px)}").join() === "b"]);
  return out;
}

// ADR-152: passive recon. Expected answers worked out by hand from the rules in passive-recon.mjs.
function oracleRecon(m) {
  const out = [], J = x => JSON.stringify(x), NOW = Date.parse("2026-11-07T00:00:00Z"), D = 86400000;
  const nd = m.normalizeDomain;
  out.push(["domains ok", J(["Example.com", "a.b.example.com.", "https://X.example.org/p", "ab.co", "a.bc", "xn--mgbh0fb.xn--kgbechtv", "a-b.com", "x".repeat(63) + ".com", ("a".repeat(63) + ".").repeat(3) + "a".repeat(57) + ".com"].map(nd)) ===
    J(["example.com", "a.b.example.com", "x.example.org", "ab.co", "a.bc", "xn--mgbh0fb.xn--kgbechtv", "a-b.com", "x".repeat(63) + ".com", ("a".repeat(63) + ".").repeat(3) + "a".repeat(57) + ".com"])]);
  out.push(["domains refused", ["1.2.3.4", "localhost", "a..com", "-a.com", "a-.com", "a.c", "ab", "x".repeat(64) + ".com", ("a".repeat(63) + ".").repeat(3) + "a".repeat(58) + ".com", "a.com:80", "a_b.com", "a.c0m", "http://[", "", null, "a.xn--", "a.b-"].every(x => nd(x) === null)]);
  out.push(["domain path", nd("example.com/x/y") === "example.com" && nd("Ex.com.") === "ex.com"]);
  const ev = (a, d) => ({ eventAction: a, eventDate: d });
  const r1 = m.parseRdap({ status: ["Client Transfer Prohibited", "x"], secureDNS: { delegationSigned: true }, events: [ev("registration", "2000-01-01T00:00:00Z"), ev("expiration", "2026-12-07T00:00:00Z"), ev("last changed", "2020-01-01T00:00:00Z"), ev("expiration", "bad")], nameservers: [{ ldhName: "NS1.X" }, {}, null] }, NOW);
  out.push(["rdap fields", J(r1) === J({ statuses: ["client transfer prohibited", "x"], dnssec: true, registered: "2000-01-01T00:00:00.000Z", expires: "2026-12-07T00:00:00.000Z", daysLeft: 30, nameservers: ["ns1.x"], findings: [{ level: "medium", id: "domain-expiring", text: "The domain expires in 30 days." }] })]);
  out.push(["rdap 31 days", m.parseRdap({ status: ["servertransferprohibited"], secureDNS: { delegationSigned: true }, events: [ev("expiration", "2026-12-08T00:00:00Z")] }, NOW).findings.length === 0]);
  out.push(["rdap day 0", J(m.parseRdap({ status: ["clienttransferprohibited"], secureDNS: { delegationSigned: true }, events: [ev("expiration", "2026-11-07T23:00:00Z")] }, NOW).findings.map(f => f.text)) === J(["The domain expires in 0 days."])]);
  out.push(["rdap expired", J(m.parseRdap({ status: ["client hold"], secureDNS: { delegationSigned: false }, events: [ev("expiration", "2026-11-06T23:00:00Z")] }, NOW).findings.map(f => f.id + ":" + f.text)) ===
    J(["domain-expired:The domain expired 1 days ago.", "dnssec-off:DNSSEC is off: the delegation is not signed.", "status-hold:The domain is on hold and does not resolve.", "transfer-unlocked:No transfer lock on the domain."])]);
  out.push(["rdap levels", J(m.parseRdap({ status: ["redemption period", "server hold"], events: [ev("expiration", "2025-01-01T00:00:00Z")] }, NOW).findings.map(f => f.level)) === J(["high", "low", "high", "high", "low"])]);
  out.push(["rdap pending delete", m.parseRdap({ status: ["pending delete"] }, NOW).findings.some(f => f.id === "status-deleting") && m.parseRdap({ status: ["serverHold"] }, NOW).findings.some(f => f.id === "status-hold")]);
  out.push(["rdap missing", J(m.parseRdap(null, NOW)) === J({ statuses: [], dnssec: null, registered: null, expires: null, daysLeft: null, nameservers: [], findings: [{ level: "high", id: "rdap-missing", text: "No RDAP record was returned." }] }) && m.parseRdap("x", NOW).findings[0].id === "rdap-missing"]);
  out.push(["rdap empty", J(m.parseRdap({ secureDNS: { delegationSigned: "yes" } }, NOW).findings.map(f => f.level + f.id)) === J(["lowrdap-no-expiry", "lowdnssec-unknown", "lowtransfer-unlocked"])]);
  const big = { status: Array.from({ length: 25 }, (_, i) => "s" + i), events: Array.from({ length: 60 }, (_, i) => ev(i < 50 ? "x" : "expiration", "2030-01-01T00:00:00Z")), nameservers: Array.from({ length: 25 }, (_, i) => ({ ldhName: "n" + i })) };
  const r2 = m.parseRdap(big, NOW);
  out.push(["rdap caps", r2.statuses.length === 20 && r2.nameservers.length === 20 && r2.expires === null]);
  out.push(["rdap 50th event", m.parseRdap({ events: Array.from({ length: 50 }, (_, i) => ev(i < 49 ? "x" : "expiration", "2030-01-01T00:00:00Z")) }, NOW).expires === "2030-01-01T00:00:00.000Z"]);
  const row = (names, after, iss) => ({ name_value: names, not_after: after, issuer_name: iss });
  const c1 = m.parseCt([row("B.x.com\n*.x.com\n\n b.x.com ", "2026-11-20T23:59:59", "CA b"), row("*.com\n" + "y".repeat(254), "2026-11-01T00:00:00", "CA a"), row("z.x.com", "2026-11-21T00:00:01", "CA a"), row("w.x.com", "2026-11-21T00:00:00", null), null, row(null, "bad", "")], NOW);
  out.push(["ct fields", J(c1) === J({ certificates: 6, nameCount: 5, names: ["*.com", "*.x.com", "b.x.com", "w.x.com", "z.x.com"], wildcards: ["*.com", "*.x.com"], expired: 1, active: 3, expiringSoon: 1, issuers: [{ name: "CA a", count: 2 }, { name: "CA b", count: 1 }],
    findings: [{ level: "high", id: "ct-broad-wildcard", text: "A wildcard covers a whole top-level domain: *.com" }, { level: "low", id: "ct-wildcards", text: "Wildcard names on certificates: 2." }, { level: "medium", id: "ct-expiring", text: "Certificates in use that expire within 14 days: 1." }] })]);
  out.push(["ct 253", m.parseCt([row("y".repeat(253), "2030-01-01T00:00:00")], NOW).nameCount === 1]);
  const five = m.parseCt([row("*.a.x\n*.b.x\n*.c.x\n*.d.x\n*.e.x", "2025-01-01T00:00:00")], NOW);
  out.push(["ct five wildcards", J(five.findings.map(f => f.id)) === J(["ct-many-wildcards", "ct-no-active"]) && five.findings[0].text === "Wildcard names on certificates: 5." && five.findings[0].level === "medium" && five.findings[1].level === "medium"]);
  out.push(["ct four wildcards", m.parseCt([row("*.a.x\n*.b.x\n*.c.x\n*.d.x", "2030-01-01T00:00:00")], NOW).findings[0].id === "ct-wildcards"]);
  out.push(["ct now boundary", (() => { const c = m.parseCt([row("a.x", "2026-11-07T00:00:00")], NOW); return c.active === 1 && c.expired === 0 && c.expiringSoon === 1; })()]);
  const many = Array.from({ length: 5001 }, (_, i) => row("h" + String(i).padStart(4, "0") + ".x", "2030-01-01T00:00:00", "I" + (i % 7)));
  const c2 = m.parseCt(many, NOW);
  out.push(["ct caps", c2.certificates === 5000 && c2.nameCount === 5000 && c2.names.length === 200 && c2.names[199] === "h0199.x" && c2.findings[0].text === "Only the first 5000 certificates were read." && c2.findings[0].level === "low" && c2.issuers.length === 5 && J(c2.issuers.map(x => x.count)) === J([715, 715, 714, 714, 714])]);
  out.push(["ct exactly 5000", m.parseCt(many.slice(0, 5000), NOW).findings.length === 0 && m.parseCt("x", NOW).certificates === 0 && m.parseCt([], NOW).findings.length === 0]);
  out.push(["ct issuer ties", J(m.parseCt([row("a", "", "Z"), row("a", "", "A"), row("a", "", "M")], NOW).issuers.map(x => x.name)) === J(["A", "M", "Z"]) && m.parseCt([row("a", "", "x".repeat(130))], NOW).issuers[0].name.length === 120]);
  const g = m.gradeHeaders;
  const full = { "content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000; includeSubDomains", "permissions-policy": "camera=()", "cross-origin-opener-policy": "same-origin", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
  out.push(["headers full", J(g(full)) === J({ score: 100, grade: "A", checks: [["content-security-policy", 30, "default-src 'none'"], ["strict-transport-security", 20, "max-age=31536000; includeSubDomains"], ["permissions-policy", 15, "camera=()"], ["cross-origin-opener-policy", 15, "same-origin"], ["x-content-type-options", 10, "nosniff"], ["referrer-policy", 10, "no-referrer"]].map(([header, max, value]) => ({ header, present: true, value, points: max, max, fix: null })) })]);
  const pts = h => g(h).checks.map(c => c.points + ":" + c.fix).join(",");
  out.push(["csp deductions", pts({ "content-security-policy": "script-src * 'unsafe-inline' 'unsafe-eval'" }).startsWith("0:unsafe-inline,") && pts({ "content-security-policy": "default-src 'self' 'unsafe-eval'" }).startsWith("22:unsafe-eval,") && pts({ "content-security-policy": "default-src 'self' 'unsafe-inline'" }).startsWith("22:unsafe-inline,") && pts({ "content-security-policy": "default-src *" }).startsWith("22:wildcard-source,") && pts({ "content-security-policy": "script-src 'self'" }).startsWith("24:no-default-src,") && pts({ "content-security-policy": "default-src x;img-src *" }).startsWith("22:wildcard-source,")]);
  out.push(["hsts", ["max-age=31536000", "max-age=31535999", "max-age=15552000", "max-age=15551999", "max-age=1", "max-age=0", "max-age = \"40000000\"; includesubdomains", "preload"].map(v => g({ "strict-transport-security": v }).checks[1]).map(c => c.points + ":" + c.fix).join() === "20:no-subdomains,15:short-max-age,15:short-max-age,8:short-max-age,8:short-max-age,0:short-max-age,20:null,0:short-max-age"]);
  out.push(["small headers", [["x-content-type-options", "nosniff"], ["x-content-type-options", "NoSniff"], ["x-content-type-options", "sniff"], ["referrer-policy", "origin, strict-origin"], ["referrer-policy", "unsafe-url"], ["referrer-policy", "origin"], ["referrer-policy", ","], ["cross-origin-opener-policy", "same-origin-allow-popups"], ["cross-origin-opener-policy", "unsafe-none"], ["permissions-policy", "x"]]
    .map(([k, v]) => g({ [k]: v }).checks.find(c => c.header === k)).map(c => c.points + ":" + c.fix).join() === "10:null,10:null,3:not-nosniff,10:null,0:weak-referrer,5:weak-referrer,5:weak-referrer,10:weak-coop,3:weak-coop,15:null"]);
  out.push(["grades", [90, 89, 75, 74, 60, 59, 40, 39].map(n => n) && g({ "content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000", "permissions-policy": "x", "cross-origin-opener-policy": "same-origin", "referrer-policy": "no-referrer" }).grade === "A" &&
    g({ "content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000", "permissions-policy": "x", "cross-origin-opener-policy": "same-origin", "referrer-policy": "origin" }).grade === "B" &&
    g({ "content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000", "permissions-policy": "x", "cross-origin-opener-policy": "same-origin" }).grade === "B" &&
    g({ "content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000", "permissions-policy": "x", "referrer-policy": "origin" }).grade === "C" &&
    g({ "content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000", "referrer-policy": "no-referrer" }).grade === "C" &&
    g({ "content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000", "referrer-policy": "origin" }).grade === "D" &&
    g({ "content-security-policy": "default-src 'none'", "referrer-policy": "no-referrer" }).grade === "D" && g({ "content-security-policy": "default-src 'none'", "x-content-type-options": "x" }).grade === "F"]);
  out.push(["header values", g({ "content-security-policy": ["default-src 'none'", "img-src x"] }).checks[0].value === "default-src 'none', img-src x" && g({ "permissions-policy": "a".repeat(400) }).checks[2].value.length === 300 && g({ "content-security-policy": "a".repeat(1989) + " default-src" }).checks[0].points === 24 && g({ "content-security-policy": "a".repeat(1988) + " default-src" }).checks[0].points === 30 && g("x").score === 0 && g({ "content-security-policy": "  " }).checks[0].fix === "missing"]);
  const s = m.parseSecurityTxt;
  out.push(["sectxt good", J(s("Contact: mailto:a@x\r\nExpires: 2027-01-01T00:00:00Z\nEncryption: https://k\nCanonical: HTTPS://x/.well-known/security.txt", NOW)) === J({ present: true, fields: { contact: ["mailto:a@x"], expires: ["2027-01-01T00:00:00Z"], encryption: ["https://k"], canonical: ["HTTPS://x/.well-known/security.txt"] }, contacts: ["mailto:a@x"], expires: "2027-01-01T00:00:00.000Z", valid: true, findings: [] })]);
  out.push(["sectxt pgp", J(s("-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n# c\nnocolon\n:x\nContact: tel:+1\nExpires: 2027-01-01T00:00:00+03:00\nEncryption: x\n-----BEGIN PGP SIGNATURE-----\niQEz\nContact: http://x\n-----END PGP SIGNATURE-----\nPolicy: https://p", NOW).fields) === J({ contact: ["tel:+1"], expires: ["2027-01-01T00:00:00+03:00"], encryption: ["x"], policy: ["https://p"] })]);
  out.push(["sectxt problems", J(s("Contact: http://a\nContact: HTTPS://b\nContact: mail\nExpires: 2026-11-06T23:59:59Z\nExpires: x\nCanonical: http://c", NOW).findings.map(f => f.level + ":" + f.id + ":" + (f.value || ""))) ===
    J(["medium:sectxt-contact-http:http://a", "medium:sectxt-contact-uri:mail", "medium:sectxt-many-expires:", "high:sectxt-expired:", "low:sectxt-canonical-http:", "low:sectxt-no-encryption:"]) && s("Expires: 2026-11-06T23:59:59Z", NOW).findings[1].text === "Expires is in the past: 2026-11-06" && s("Contact: a\nExpires: x\nExpires: y", NOW).findings[1].text === "Expires appears 2 times; it must appear once."]);
  out.push(["sectxt expiry window", s("Expires: 2027-11-08T00:00:01Z", NOW).findings.some(f => f.id === "sectxt-long-expiry" && f.level === "low") && !s("Expires: 2027-11-08T00:00:00Z", NOW).findings.some(f => f.id === "sectxt-long-expiry") && !s("Expires: 2026-11-07T00:00:00Z", NOW).findings.some(f => f.id === "sectxt-expired")]);
  out.push(["sectxt bad dates", ["2027-01-01", "2027-01-01T00:00", "2027-01-01T00:00Z", "2027-13-01T00:00:00Z", " 2027-01-01T00:00:00Z"].map(x => s("Expires: " + x, NOW).findings.filter(f => f.id === "sectxt-bad-expires").length).join() === "1,1,0,1,0" && s("Expires: nope", NOW).findings.find(f => f.id === "sectxt-bad-expires").text === "Expires is not an ISO 8601 date and time: nope"]);
  out.push(["sectxt missing", J(s(null, NOW)) === J({ present: false, fields: {}, contacts: [], expires: null, valid: false, findings: [{ level: "high", id: "sectxt-missing", text: "No security.txt at /.well-known/security.txt." }] }) && J(s("", NOW).findings.map(f => f.level + f.id)) === J(["highsectxt-no-contact", "highsectxt-no-expires", "lowsectxt-no-encryption"]) && s("", NOW).present === true]);
  out.push(["sectxt caps", s(Array.from({ length: 25 }, (_, i) => "Contact: mailto:" + i).join("\n"), NOW).contacts.length === 20 && s("Policy: " + "p".repeat(400), NOW).fields.policy[0].length === 300 && s("x".repeat(32760) + "\nContact: mailto:a", NOW).contacts.length === 0 && s("x".repeat(32740) + "\nContact: mailto:a", NOW).contacts.length === 1]);
  const rep = m.reconReport({ domain: "x.example", rdap: null, headers: {}, gaps: [1, 2, 3, 4, 5], now: NOW });
  out.push(["report", rep.at === "2026-11-07T00:00:00.000Z" && rep.ct === null && rep.securityTxt === null && rep.rdap.findings[0].id === "rdap-missing" && rep.headers.score === 0 && rep.gaps.length === 4 && J(rep.counts) === J({ high: 1, medium: 0, low: 0 }) && rep.sample === false]);
  out.push(["grade at 75", g({ "content-security-policy": "default-src 'none'", "strict-transport-security": "max-age=31536000", "permissions-policy": "x", "x-content-type-options": "nosniff" }).grade === "B" && g(null).score === 0]);
  out.push(["issuer order by count", J(m.parseCt([row("a", "", "A"), row("a", "", "Z"), row("a", "", "Z")], NOW).issuers.map(x => x.name)) === J(["Z", "A"]) && m.parseCt([row("*..com", "2030-01-01T00:00:00")], NOW).findings.every(f => f.id !== "ct-broad-wildcard")]);
  out.push(["sectxt lines", J(s("#Contact: mailto:z\nx: y\nContact:tel:+2\nExpires: 2027-01-01T00:00:00Z", NOW).fields) === J({ x: ["y"], contact: ["tel:+2"], expires: ["2027-01-01T00:00:00Z"] }) && s("Contact: mailto:a\nExpires: 2027-01-01T00:00:00Z", NOW).valid === true]);
  const sr = m.sampleReport();
  out.push(["sample", sr.sample === true && J(sr.counts) === J({ high: 1, medium: 4, low: 3 }) && sr.headers.score === 52]);
  return out;
}

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
