// Writes the Markdown reference of the local data proxy from its OpenAPI 3.1 document (ADR-116), with no third-party
// generator: docs/api/omega-data-proxy.openapi.json → docs/api/OMEGA-DATA-PROXY-API.md. It also checks the document
// against the proxy's real route table, so a route cannot be added without being documented:
//   node scripts/build-api-docs.mjs            write the Markdown
//   node scripts/build-api-docs.mjs --check    exit 1 when a route is undocumented, an example matches no route,
//                                              or the Markdown is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(REPO, "docs", "api", "omega-data-proxy.openapi.json"), MD = join(REPO, "docs", "api", "OMEGA-DATA-PROXY-API.md");
const PROXY = join(REPO, "scripts", "omega-data-proxy.mjs");

const spec = JSON.parse(readFileSync(SPEC, "utf8"));
const problems = [];
if (spec.openapi !== "3.1.0") problems.push("openapi must be 3.1.0");

// The route table is read as text: the proxy starts a server when imported, so its regex literals are parsed here.
const src = readFileSync(PROXY, "utf8"), a = src.indexOf("const ROUTES = ["), b = src.indexOf("\nconst ALLOWED_UPSTREAM");
if (a < 0 || b < a) throw new Error("omega-data-proxy.mjs: ROUTES table not found");
const routes = [...src.slice(a, b).matchAll(/\{ re: \/(\^.*?\$)\/, url:/g)].map(m => new RegExp(m[1]));
if (routes.length < 20) problems.push(`only ${routes.length} routes parsed from the proxy`);

const ops = [];
for (const [path, item] of Object.entries(spec.paths || {})) for (const [method, op] of Object.entries(item)) ops.push({ path, method, op });
const examples = ops.flatMap(o => (o.op["x-omega-examples"] || []).map(e => ({ e, o })));
for (const r of routes) if (!examples.some(x => r.test(x.e))) problems.push(`proxy route ${r} has no documented example`);
for (const { e, o } of examples) {
  if (o.op["x-omega-special"]) continue;
  if (e === "/health") continue;
  if (!routes.some(r => r.test(e))) problems.push(`documented example ${e} matches no proxy route`);
  const shape = new RegExp("^" + o.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\\{[a-z]+\\\}|\{[a-z]+\}/gi, "[^/]+") + "$");
  if (!shape.test(e)) problems.push(`example ${e} does not fit its path ${o.path}`);
}
for (const o of ops) if (!o.op["x-omega-special"] && o.path !== "/health" && !(o.op["x-omega-examples"] || []).length) problems.push(`${o.path} has no x-omega-examples`);
for (const special of ["/research/{source}", "/llm/ollama/status", "/llm/ollama/explain", "/llm/ollama/research"]) if (!spec.paths[special]) problems.push(`${special} is missing`);

const esc = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const hms = s => !Number.isFinite(s) ? "—" : s >= 3600 ? `${+(s / 3600).toFixed(2)} h` : s >= 60 ? `${+(s / 60).toFixed(1)} min` : `${s} s`;
const lines = [
  `# ${spec.info.title} · API reference`,
  "",
  `Generated from [omega-data-proxy.openapi.json](omega-data-proxy.openapi.json) (OpenAPI ${spec.openapi}, version ${spec.info.version}) by \`node scripts/build-api-docs.mjs\`. Do not edit by hand.`,
  "",
  spec.info.summary,
  "",
  spec.info.description,
  "",
  `Server: \`${spec.servers[0].url}\` (${spec.servers[0].description}).`,
  "",
  "## Routes",
  "",
  "| Method | Path | Summary | Cache | Upstream |",
  "|---|---|---|---|---|"
];
for (const o of ops) lines.push(`| ${o.method.toUpperCase()} | \`${o.path}\` | ${esc(o.op.summary)} | ${hms(o.op["x-cache-seconds"])} | ${esc(o.op["x-upstream"] || "—")} |`);
for (const tag of spec.tags.map(t => t.name)) {
  const list = ops.filter(o => (o.op.tags || []).includes(tag));
  if (!list.length) continue;
  lines.push("", `## ${tag[0].toUpperCase() + tag.slice(1)}`);
  for (const o of list) {
    lines.push("", `### ${o.method.toUpperCase()} \`${o.path}\``, "", o.op.description);
    const params = o.op.parameters || [];
    if (params.length) {
      lines.push("", "| Parameter | In | Rule | Description |", "|---|---|---|---|");
      for (const p of params) lines.push(`| \`${p.name}\` | ${p.in} | ${p.schema.enum ? p.schema.enum.map(v => "`" + v + "`").join(", ") : p.schema.pattern ? "`" + esc(p.schema.pattern) + "`" : p.schema.format || p.schema.type} | ${esc(p.description)} |`);
    }
    if (o.op.requestBody) lines.push("", "Body (`application/json`): `" + JSON.stringify(o.op.requestBody.content["application/json"].schema.properties ? Object.keys(o.op.requestBody.content["application/json"].schema.properties) : []) + "`");
    const ex = o.op["x-omega-examples"] || [];
    if (ex.length) lines.push("", "Example: " + ex.map(e => "`" + e + "`").join(", "));
    lines.push("", "Answers: " + Object.entries(o.op.responses).map(([c, r]) => `${c} ${r.$ref ? spec.components.responses[r.$ref.split("/").pop()].description : r.description}`).join("; ") + ".");
  }
}
lines.push("");
const md = lines.join("\n");

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(MD, "utf8"); } catch { problems.push("OMEGA-DATA-PROXY-API.md is missing"); }
  if (current && current !== md) problems.push("OMEGA-DATA-PROXY-API.md is out of date; run node scripts/build-api-docs.mjs");
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  console.log(`API document OK: ${ops.length} operations, ${routes.length} proxy routes covered, Markdown up to date`);
} else {
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  writeFileSync(MD, md);
  console.log(`Wrote docs/api/OMEGA-DATA-PROXY-API.md (${ops.length} operations, ${routes.length} proxy routes covered)`);
}
