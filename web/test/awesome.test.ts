import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAwesome, searchAtlas, type Atlas } from "../src/lib/awesome.ts";

const MD = `# Awesome
## Contents
- [Platforms](#platforms)
## Platforms
- [Node.js](https://github.com/a/awesome-nodejs#readme) - Async runtime.
\t- [Cross-Platform](https://github.com/b/cross#readme) - Writing cross-platform code.
- Linux
\t- [Containers](https://github.com/c/containers#readme)
## Security
- [OSINT](https://github.com/d/awesome-osint#readme) - Open source intelligence tools.
- [Bad](javascript:alert(1)) - not a web link
## Empty
`;

test("parseAwesome flattens categories and nested lists", () => {
  const a = parseAwesome(MD, "2026-10-10T00:00:00Z");
  assert.deepEqual(a.categories, ["Platforms", "Security"]);
  assert.deepEqual(a.entries.map(e => [e.name, e.parent]), [["Node.js", ""], ["Cross-Platform", "Node.js"], ["Containers", "Linux"], ["OSINT", ""]]);
  assert.equal(a.entries[0].desc, "Async runtime.");
});

test("searchAtlas ranks name hits first and requires every word", () => {
  const a = parseAwesome(MD);
  assert.equal(searchAtlas(a, "osint")[0].name, "OSINT");
  assert.equal(searchAtlas(a, "linux")[0].name, "Containers", "parent match");
  assert.deepEqual(searchAtlas(a, "node cross").map(e => e.name), ["Cross-Platform"]);
  assert.equal(searchAtlas(a, "osint", { category: "Platforms" }).length, 0);
  assert.equal(searchAtlas(a, "").length, 4);
});

test("the shipped snapshot is healthy", () => {
  const a = JSON.parse(readFileSync(new URL("../data/awesome-atlas.json", import.meta.url), "utf8")) as Atlas;
  assert.ok(a.entries.length > 600, String(a.entries.length));
  assert.ok(a.entries.every(e => /^https:\/\//.test(e.url)));
  assert.equal(searchAtlas(a, "hacking")[0].name, "Hacking");
});
