// Assemble the public GitHub Pages site (ADR-098) into _site/ from a fixed allowlist of files.
//   node scripts/build-pages.mjs [out-dir]
// Layout: NABD at the root, the Ops Room, THE CHAIN and ORACLE (ADR-114) under omega-ops-room-v1/ (the same folder scopes the
// local server uses, so manifests and service workers work unchanged), plus two short redirect pages.
// The build refuses to publish anything outside the allowlist, any e-mail address, any key-shaped string and
// any reference to a local secret file, so no personal or wallet data can ride along. Paper only: the pages
// keep each visitor's paper wallet in that visitor's own browser and send no orders anywhere.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[2] || join(REPO, "_site"));

const FILES = [
  ["site-landing/index.html", "index.html"], ["site-landing/en.html", "en.html"], ["site-landing/style.css", "style.css"],
  ["site-landing/vis.js", "vis.js"], ["site-landing/suite.js", "suite.js"], ["site-landing/calc.js", "calc.js"], ["site-landing/desk-sim.js", "desk-sim.js"], ["site-landing/pwa.js", "pwa.js"],
  ["site-landing/manifest.json", "manifest.json"], ["site-landing/service-worker.js", "service-worker.js"],
  ["omega-ops-room-v1/omega-ops-room.html", "omega-ops-room-v1/omega-ops-room.html"],
  ["omega-ops-room-v1/the-chain.html", "omega-ops-room-v1/the-chain.html"],
  ["omega-ops-room-v1/omega-oracle.html", "omega-ops-room-v1/omega-oracle.html"],
  ["omega-ops-room-v1/manifest.json", "omega-ops-room-v1/manifest.json"],
  ["omega-ops-room-v1/service-worker.js", "omega-ops-room-v1/service-worker.js"]
];
const DIRS = [["site-landing/fonts", "fonts", /\.(woff2|txt)$/], ["site-landing/icons", "icons", /\.(png|svg)$/], ["omega-ops-room-v1/icons", "omega-ops-room-v1/icons", /\.png$/]];
for (const [src, dst, re] of DIRS) for (const f of readdirSync(join(REPO, src))) if (re.test(f) && !f.startsWith(".")) FILES.push([`${src}/${f}`, `${dst}/${f}`]);
// The hourly public intel snapshot (ADR-104) is optional: the workflow writes it just before this build.
// It is published only when it parses and carries the expected format tag.
const SNAP = "data/public-intel-snapshot.json";
try {
  const j = JSON.parse(readFileSync(join(REPO, SNAP), "utf8"));
  if (j && j.format === "omega-public-intel-v1" && j.sources && typeof j.sources === "object") FILES.push([SNAP, SNAP]);
  else console.warn(`${SNAP}: unexpected format, not published`);
} catch { console.log(`${SNAP}: not present, the site uses the proxy and direct tiers only`); }

// Checks every text file before it is published.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const KEYLIKE = /\b(sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|csk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/;
const LOCAL_SECRET = /sec-ua\.txt|\.env\.keys|DOTENV_PRIVATE_KEY/;
const problems = [];

rmSync(OUT, { recursive: true, force: true });
for (const [src, dst] of FILES) {
  const from = join(REPO, src), to = join(OUT, dst);
  if (!statSync(from).isFile()) throw new Error(`missing ${src}`);
  mkdirSync(dirname(to), { recursive: true });
  if (/\.(html|js|json|css|svg|txt)$/.test(src)) {
    const text = readFileSync(from, "utf8");
    if (EMAIL.test(text)) problems.push(`${src}: contains an e-mail address`);
    if (KEYLIKE.test(text)) problems.push(`${src}: contains a key-shaped string`);
    if (LOCAL_SECRET.test(text)) problems.push(`${src}: names a local secret file`);
  }
  copyFileSync(from, to);
}

// Short addresses, same as the local server (ADR-094). A static host cannot answer 302, so each is a tiny
// page with a strict CSP, a meta refresh and a plain link.
function redirect(name, target, title) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<meta http-equiv="refresh" content="0; url=${target}" />
<title>${title}</title>
</head>
<body>
<p><a href="${target}">${title}</a></p>
</body>
</html>
`;
  writeFileSync(join(OUT, name), html);
}
redirect("omega-ops-room.html", "omega-ops-room-v1/omega-ops-room.html", "OMEGA Ops Room");
redirect("the-chain.html", "omega-ops-room-v1/the-chain.html", "THE CHAIN");
redirect("omega-oracle.html", "omega-ops-room-v1/omega-oracle.html", "ORACLE");
writeFileSync(join(OUT, ".nojekyll"), "");

if (problems.length) { console.error("Refusing to publish:\n  " + problems.join("\n  ")); process.exit(1); }
const list = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else list.push(p); } };
walk(OUT);
for (const p of list.sort()) console.log(createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12), relative(OUT, p));
console.log(`${list.length} files in ${OUT}`);
