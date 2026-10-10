// Speaks real MCP stdio to the server: initialize, list tools, search, categories, bad input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

test("awesome-atlas answers MCP over stdio", async () => {
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    new URL("./server.mjs", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: proc.stdout });
  const waiting = new Map();
  lines.on("line", l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  let n = 0;
  const rpc = (method, params) => new Promise(r => { const id = ++n; waiting.set(id, r); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    assert.equal(init.result.serverInfo.name, "awesome-atlas");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const list = await rpc("tools/list");
    assert.deepEqual(list.result.tools.map(t => t.name), ["awesome_search", "awesome_categories"]);
    const s = await rpc("tools/call", { name: "awesome_search", arguments: { query: "hacking", limit: 5 } });
    assert.ok(s.result.structuredContent.count >= 1, "hacking list exists");
    assert.match(s.result.structuredContent.results[0].url, /^https:\/\/github\.com\//);
    const c = await rpc("tools/call", { name: "awesome_categories", arguments: {} });
    assert.ok(c.result.structuredContent.total > 300);
    const bad = await rpc("tools/call", { name: "awesome_search", arguments: { query: "x", category: "Nope" } });
    assert.equal(bad.result.isError, true);
    const unknown = await rpc("nope/method");
    assert.equal(unknown.error.code, -32601);
  } finally {
    proc.kill();
  }
});
