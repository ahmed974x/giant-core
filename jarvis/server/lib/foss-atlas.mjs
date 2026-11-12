// The FOSS atlas and privacy shield (ADR-158), pure: used by the server (GET /api/w/:slug/atlas,
// POST …/atlas/plan, POST …/privacy-shield/scrub, GET …/atlas/personas) and inlined into the page (#/atlas).
//   - The atlas: open-source tools that replace hosted products, open lists, and seven agent-skill projects
//     kept as ideas. Every licence was read from the project's own licence file on FA_READ, with its URL;
//     where no file could be read the licence is null and the page says «تعذر التحقق منها».
//   - The planner: the picked tools as a plan whose installs and outbound connections are locked approvals,
//     proved by prover.mjs; a data-sovereignty share and savings only from prices the person types in; an
//     inert n8n workflow blueprint and an MCP list that configures nothing.
//   - The privacy shield: the ADR-148 key patterns and entropy rule plus personal data (e-mail addresses,
//     phone numbers, IBANs, card numbers that pass Luhn, IPv4 addresses), replaced before text goes anywhere.
//   - k-anonymity: SHA-1 of a secret computed here; only the first 5 hex characters would ever leave, with
//     the Shannon entropy. The secret itself is never returned, stored or logged.
//   - Personas: seeded teaching examples, labelled «مثال تعليمي — أرقام افتراضية».
// Nothing here installs, fetches or sends anything. The same engine is in
// .claude/skills/replica-foss-atlas/foss_atlas.py, and for the same request both give the same JSON.
import { SECRET_PATTERNS, entropy, ENTROPY_LIMIT } from "./diagnostics.mjs";
import { provePlan } from "./prover.mjs";

export const FA_READ = "2026-11-12";
export const FA_LIMITS = { picks: 40, price: 10000000, text: 20000, personas: 12 };
export const FA_CATEGORIES = ["office", "files", "chat", "analytics", "automation", "images", "design", "photos", "music", "video", "screen", "voice", "ai", "scraping", "browser", "books", "apis", "mcp", "free-tiers", "skills"];
const RAW = "https://raw.githubusercontent.com/";
// id, name, category, kind (tool | list | skill-idea), what it replaces, repository, licence file, licence as
// the file states it, licence family (osi | fair-code | mixed | public-domain | null), runs on your own machine.
export const FOSS_ATLAS = [
  ["libreoffice", "LibreOffice", "office", "tool", "Microsoft 365, Google Docs", "LibreOffice/core", "COPYING.MPL", "MPL-2.0 (COPYING holds the GPL-3.0 text too)", "mixed", true],
  ["nextcloud", "Nextcloud", "files", "tool", "Google Drive, Dropbox", "nextcloud/server", "COPYING", "AGPL-3.0", "osi", true],
  ["mattermost", "Mattermost", "chat", "tool", "Slack", "mattermost/mattermost", "LICENSE.txt", "AGPL-3.0 source, MIT compiled builds, Apache-2.0 templates", "mixed", true],
  ["matomo", "Matomo", "analytics", "tool", "Google Analytics", "matomo-org/matomo", "LICENSE", "GPL-3.0", "osi", true],
  ["n8n", "n8n", "automation", "tool", "Zapier, Make", "n8n-io/n8n", "LICENSE.md", "Sustainable Use License (source-available, not OSI)", "fair-code", true],
  ["gimp", "GIMP", "images", "tool", "Adobe Photoshop", "GNOME/gimp", "LICENSE", "GPL-3.0 with a plug-in exemption", "osi", true],
  ["penpot", "Penpot", "design", "tool", "Figma", "penpot/penpot", "LICENSE", "MPL-2.0", "osi", true],
  ["immich", "Immich", "photos", "tool", "Google Photos, iCloud Photos", "immich-app/immich", "LICENSE", "AGPL-3.0", "osi", true],
  ["navidrome", "Navidrome", "music", "tool", "Spotify, for your own library", "navidrome/navidrome", "LICENSE", "GPL-3.0", "osi", true],
  ["opencut", "OpenCut", "video", "tool", "CapCut", "OpenCut-app/OpenCut", "LICENSE", "MIT", "osi", true],
  ["cap", "Cap", "screen", "tool", "Loom", "CapSoftware/Cap", "LICENSE", "AGPL-3.0, with MIT camera crates", "mixed", true],
  ["handy", "Handy", "voice", "tool", "Cloud dictation", "cjpais/Handy", "LICENSE", "MIT", "osi", true],
  ["anythingllm", "AnythingLLM", "ai", "tool", "Hosted chat workspaces", "Mintplex-Labs/anything-llm", "LICENSE", "MIT", "osi", true],
  ["scrapling", "Scrapling", "scraping", "tool", "Hosted scraping APIs", "D4Vinci/Scrapling", "LICENSE", "BSD-3-Clause", "osi", true],
  ["brave", "Brave", "browser", "tool", "Google Chrome", "brave/brave-browser", "LICENSE", "MPL-2.0", "osi", true],
  ["gutenberg", "Project Gutenberg", "books", "list", "Paid e-book stores, for public-domain books", null, null, null, null, null],
  ["public-apis", "Public APIs", "apis", "list", "Paid API directories", "public-apis/public-apis", "LICENSE", "MIT", "osi", null],
  ["awesome-mcp", "Awesome MCP Servers", "mcp", "list", "Closed connector catalogues", "punkpeye/awesome-mcp-servers", "LICENSE", "MIT", "osi", null],
  ["free-for-dev", "free-for-dev", "free-tiers", "list", "Paid developer tiers", "ripienaar/free-for-dev", null, null, null, null],
  ["browser-use", "browser-use", "skills", "skill-idea", "Hand-run browser checks", "browser-use/browser-use", "LICENSE", "MIT", "osi", true],
  ["agentmemory", "agentmemory", "skills", "skill-idea", "Hosted agent memory", "rohitg00/agentmemory", "LICENSE", "Apache-2.0", "osi", true],
  ["scientific-agent-skills", "Scientific Agent Skills", "skills", "skill-idea", "Hosted maths notebooks", "K-Dense-AI/scientific-agent-skills", "LICENSE.md", "MIT", "osi", true],
  ["cybersecurity-skills", "Anthropic-Cybersecurity-Skills", "skills", "skill-idea", "Paid security playbooks", "mukul975/Anthropic-Cybersecurity-Skills", "LICENSE", "Apache-2.0", "osi", true],
  ["awesome-harness", "awesome-harness-engineering", "skills", "skill-idea", "Closed agent-harness guides", "ai-boost/awesome-harness-engineering", "LICENSE", "CC0-1.0", "public-domain", null],
  ["openviking", "OpenViking", "skills", "skill-idea", "Hosted context stores", "volcengine/OpenViking", "LICENSE", "AGPL-3.0", "osi", true],
  ["ui-ux-pro-max", "ui-ux-pro-max-skill", "skills", "skill-idea", "Paid design reviews", "nextlevelbuilder/ui-ux-pro-max-skill", "LICENSE", "MIT", "osi", true],
].map(([id, name, category, kind, replaces, repo, file, licence, family, selfHost]) => ({
  id, name, category, kind, replaces, url: repo ? "https://github.com/" + repo : null,
  licence: licence ? { text: licence, family, file: RAW + repo + "/HEAD/" + file, read: FA_READ } : null, selfHost,
  status: kind === "skill-idea" ? "idea" : kind === "list" ? "reference" : "option",
}));
// What the page and the plan say about two entries, in words, not in code paths.
export const FA_NOTES = {
  scrapling: "Listed for parsing pages you are allowed to read. Its anti-bot features are not used (AGENTS.md §3).",
  n8n: "Fair-code: the source is open to read and self-host, but the licence is not OSI-approved.",
};

const faFail = (message, detail) => { const e = new Error(message); e.status = 400; if (detail !== undefined) e.detail = String(detail).slice(0, 80); throw e; };
const faR = (v, d = 2) => { const p = 10 ** d, x = Math.round(v * p) / p; return Object.is(x, -0) ? 0 : x; };

// ---- k-anonymity: SHA-1 in plain JavaScript, so the page needs no WebCrypto and the server no node:crypto.
export function sha1Hex(text) {
  const b = new TextEncoder().encode(String(text)), n = b.length, words = new Array((((n + 8) >> 6) + 1) * 16).fill(0);
  for (let i = 0; i < n; i++) words[i >> 2] |= b[i] << (24 - (i % 4) * 8);
  words[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
  words[words.length - 1] = n * 8;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array(80);
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 80; t++) { w[t] = t < 16 ? words[i + t] : rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1); }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & d) : t < 40 ? bb ^ c ^ d : t < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rotl(a, 5) + f + e + k + w[t]) | 0;
      e = d; d = c; c = rotl(bb, 30); bb = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
function rotl(x, s) { return (x << s) | (x >>> (32 - s)); }

// The prefix a range query would send (5 hex characters of 40, so about a million other hashes share it),
// and how unpredictable the text is. The secret and the rest of its hash are not returned.
export function kAnonymity(secret) {
  if (typeof secret !== "string" || !secret.length) faFail("Give the text to check.", "secretCheck");
  if (secret.length > 256) faFail("The text to check is longer than 256 characters.", "secretCheck");
  const hex = sha1Hex(secret).toUpperCase(), perChar = entropy(secret);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(secret)).length;
  return { method: "SHA-1, first 5 hex characters (k-anonymity range)", prefix: hex.slice(0, 5), hidden: 35, length: secret.length, classes,
    entropy_bits_per_char: faR(perChar), entropy_bits: faR(perChar * secret.length), looked_up: false };
}

// ---- The privacy shield ---------------------------------------------------------------------------------
export const PII_PATTERNS = [
  ["e-mail address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["iban", /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/g],
  ["card number", /\b[0-9](?:[ -]?[0-9]){12,18}\b/g],
  ["phone number", /\+[0-9](?:[ -]?[0-9]){7,14}\b/g],
  ["ipv4 address", /\b(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\b/g],
];
const FA_RANDOMISH = /[A-Za-z0-9+/_=-]{24,}/g;
// Luhn's check, so a run of digits is called a card number only when it could be one.
export function luhnOk(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) { let d = Number(digits[digits.length - 1 - i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
export function scrubPrivate(text) {
  if (typeof text !== "string") faFail("Give the text to scrub.", "text");
  if (text.length > FA_LIMITS.text) faFail("The text is longer than 20,000 characters.", "text");
  const counts = new Map(), hit = rule => counts.set(rule, (counts.get(rule) || 0) + 1);
  let out = text;
  for (const [rule, re] of SECRET_PATTERNS) out = out.replace(re, (m, g1) => { hit(rule); return rule === "password in a url" ? g1 + "[REDACTED]@" : "[REDACTED]"; });
  out = out.replace(FA_RANDOMISH, m => { if (/^[0-9a-f]+$/i.test(m) || entropy(m) < ENTROPY_LIMIT) return m; hit("high entropy"); return "[REDACTED]"; });
  for (const [rule, re] of PII_PATTERNS) {
    out = out.replace(re, m => {
      if (rule === "card number" && !luhnOk(m.replace(/[ -]/g, ""))) return m;
      hit(rule); return "[" + rule.toUpperCase().replace(/ /g, "_") + "]";
    });
  }
  const redactions = [...counts].map(([rule, count]) => ({ rule, count }));
  return { text: out, redactions, total: redactions.reduce((n, r) => n + r.count, 0), framework: "NIST CSF 2.0 · Protect · PR.DS (data security)", changed: out !== text };
}

// ---- The planner ----------------------------------------------------------------------------------------
export function planSteps(picks) {
  const steps = [{ kind: "tool", title: "Read each pick's atlas entry and licence", category: null }];
  for (const e of picks) {
    if (e.kind === "skill-idea") steps.push({ kind: "gate", title: "Write a security review of " + e.name, category: null });
    if (e.kind !== "list") steps.push({ kind: "approval", title: "Install " + e.name + " on this computer", category: "install", gate: "approval", locked: true, status: "pending_approval" });
    if (e.id === "n8n") steps.push({ kind: "approval", title: "Connect n8n to outside services", category: "outbound", gate: "approval", locked: true, status: "pending_approval" });
  }
  steps.push({ kind: "gate", title: "Run the checks: tests and SkillSpector", category: null });
  return steps.map((s, i) => ({ ...s, depends: i ? [i - 1] : [] }));
}
export function n8nBlueprint(steps) {
  const names = steps.map((s, i) => (i + 1) + ". " + s.title);
  const nodes = [{ name: "Start", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 0], parameters: {} }]
    .concat(steps.map((s, i) => ({ name: names[i], type: "n8n-nodes-base.noOp", typeVersion: 1, position: [240 * (i + 1), 0], parameters: {},
      notes: s.locked ? "Locked: waits for Director 00 (AGENTS.md §1). Nothing runs here." : "Inert step. Nothing runs here." })));
  const connections = {};
  ["Start"].concat(names).forEach((n, i, all) => { if (i < all.length - 1) connections[n] = { main: [[{ node: all[i + 1], type: "main", index: 0 }]] }; });
  return { name: "Jarvis FOSS stack (inert)", nodes, connections, active: false };
}
export function planFossStack(req) {
  const r = req && typeof req === "object" ? req : {};
  const ids = r.selectedIds;
  if (!Array.isArray(ids) || !ids.length) faFail("Pick at least one tool from the atlas.", "selectedIds");
  if (ids.length > FA_LIMITS.picks) faFail("Pick at most 40 entries.", "selectedIds");
  const picks = [];
  for (const id of ids) {
    const e = FOSS_ATLAS.find(x => x.id === id);
    if (!e) faFail("This entry is not in the atlas.", typeof id === "string" ? id : "");
    if (!picks.includes(e)) picks.push(e);
  }
  const tools = picks.filter(e => e.kind === "tool");
  const own = tools.filter(e => e.selfHost === true).length;
  const sovereignty = tools.length ? { percent: faR(100 * own / tools.length, 1), self_hosted: own, tools: tools.length, tag: "[INFERENCE]" } : null;
  const prices = r.prices && typeof r.prices === "object" && !Array.isArray(r.prices) ? r.prices : {};
  const items = [];
  for (const e of picks) {
    if (!Object.prototype.hasOwnProperty.call(prices, e.id)) continue;
    const v = prices[e.id];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > FA_LIMITS.price) faFail("A yearly price is a number from 0 to 10,000,000.", e.id);
    items.push({ id: e.id, replaces: e.replaces, usd_per_year: v });
  }
  const savings = items.length ? { usd_per_year: faR(items.reduce((n, x) => n + x.usd_per_year, 0)), items, source: "prices you entered" } : null;
  const steps = planSteps(picks), proof = provePlan(steps);
  const out = { picks: picks.map(e => e.id), sovereignty, savings, steps, proof, blueprint: n8nBlueprint(steps),
    mcp: { servers: {}, locked: picks.filter(e => e.kind === "skill-idea").map(e => e.name), note: "No MCP server is configured; each would be an install, locked until reviewed and approved." },
    notes: picks.filter(e => FA_NOTES[e.id]).map(e => ({ id: e.id, text: FA_NOTES[e.id] })) };
  if (r.secretCheck !== undefined) out.secret = kAnonymity(r.secretCheck);
  out.verified = proof.verified;
  return out;
}

// ---- Seeded personas (teaching examples) ----------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FA_NAMES = [["Salem", "سالم"], ["Noura", "نورة"], ["Faisal", "فيصل"], ["Maha", "مها"], ["Khalid", "خالد"], ["Reem", "ريم"], ["Yousef", "يوسف"], ["Hessa", "حصة"]];
const FA_ROLES = [["Studio founder", "مؤسس استوديو"], ["Clinic manager", "مدير عيادة"], ["Teacher", "معلّم"], ["Shop owner", "صاحب متجر"], ["Researcher", "باحث"], ["Designer", "مصمم"]];
export function personas(req) {
  const r = req && typeof req === "object" ? req : {};
  const seed = Number.isInteger(r.seed) ? r.seed : 158, count = Number.isInteger(r.count) ? r.count : 3;
  if (count < 1 || count > FA_LIMITS.personas) faFail("Ask for 1 to 12 personas.", "count");
  const rnd = mulberry32(seed), tools = FOSS_ATLAS.filter(e => e.kind === "tool"), out = [];
  for (let i = 0; i < count; i++) {
    const name = FA_NAMES[Math.floor(rnd() * FA_NAMES.length)], role = FA_ROLES[Math.floor(rnd() * FA_ROLES.length)];
    const team = 1 + Math.floor(rnd() * 24), picks = [];
    while (picks.length < 3) { const e = tools[Math.floor(rnd() * tools.length)]; if (!picks.includes(e.id)) picks.push(e.id); }
    const prices = Object.fromEntries(picks.map(id => [id, 10 * Math.round(rnd() * 120) * team]));
    out.push({ name: { en: name[0], ar: name[1] }, role: { en: role[0], ar: role[1] }, team, picks, prices });
  }
  return { seed, label: { en: "Teaching example: made-up numbers", ar: "مثال تعليمي — أرقام افتراضية" }, personas: out };
}

export function atlasView() { return { read: FA_READ, categories: FA_CATEGORIES, entries: FOSS_ATLAS, notes: FA_NOTES }; }
