#!/usr/bin/env node
// Awesome atlas MCP server (ADR-027): lets Claude search the ~700 curated awesome-lists from sindresorhus/awesome.
// Read-only, offline (reads web/data/awesome-atlas.json), no dependencies: a minimal MCP stdio server
// (newline-delimited JSON-RPC 2.0) with two tools. Search logic is shared with the web app (web/src/lib/awesome.ts).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { searchAtlas } from "../../web/src/lib/awesome.ts";

const ATLAS_FILE = process.env.AWESOME_ATLAS ?? new URL("../../web/data/awesome-atlas.json", import.meta.url);
const atlas = JSON.parse(readFileSync(ATLAS_FILE, "utf8"));
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: "awesome_search",
    title: "Search the Awesome atlas",
    description: "Find curated awesome-lists (GitHub) for a tool, language, topic or field, e.g. 'hacking', 'geospatial', " +
      "'langgraph', 'security'. Every word must match. Returns name, url, description, category and parent list. " +
      "Use it to discover vetted open-source tools before proposing one; then vet the tool itself (license, RAM, activity).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to search for", maxLength: 120 },
        category: { type: "string", description: "Optional exact category from awesome_categories" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "awesome_categories",
    title: "Awesome atlas categories",
    description: "List the atlas categories with how many awesome-lists each holds, and when the snapshot was taken.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
];

function call(name, args = {}) {
  if (name === "awesome_search") {
    if (typeof args.query !== "string") throw new Error("query must be a string");
    const category = atlas.categories.includes(args.category) ? args.category : undefined;
    if (args.category && !category) throw new Error(`unknown category; call awesome_categories`);
    const results = searchAtlas(atlas, args.query.slice(0, 120), { category, limit: Math.min(Number(args.limit) || 20, 100) });
    return { query: args.query, count: results.length, results };
  }
  if (name === "awesome_categories") {
    const counts = Object.fromEntries(atlas.categories.map(c => [c, atlas.entries.filter(e => e.category === c).length]));
    return { fetchedAt: atlas.fetchedAt, total: atlas.entries.length, source: atlas.source, categories: counts };
  }
  throw new Error(`unknown tool: ${name}`);
}

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      return { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} },
        serverInfo: { name: "awesome-atlas", version: "0.1.0" } };
    case "ping": return {};
    case "tools/list": return { tools: TOOLS };
    case "tools/call":
      try {
        const data = call(params?.name, params?.arguments);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }], structuredContent: data };
      } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    default:
      if (id === undefined) return undefined; // notification (e.g. notifications/initialized)
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

const send = obj => process.stdout.write(JSON.stringify(obj) + "\n");
createInterface({ input: process.stdin }).on("line", line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
  try {
    const result = handle(msg);
    if (msg.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (e) {
    if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: e.code ?? -32603, message: e.message } });
  }
});
