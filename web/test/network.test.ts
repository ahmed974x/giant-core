import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { layout, neighbours, nodeState, validate, withAtlas, type NetNode, type Registry } from "../src/lib/network.ts";
import type { Atlas } from "../src/lib/awesome.ts";

const json = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const registry = json("../data/nervous-system.json") as Registry;
const atlas = json("../data/awesome-atlas.json") as Atlas;

test("the shipped registry is one connected, valid network", () => {
  const full = withAtlas(registry, atlas);
  assert.deepEqual(validate(full), []);
  // Every node can be reached from Ahmad, following edges in either direction.
  const seen = new Set(["ahmad"]), queue = ["ahmad"];
  while (queue.length) for (const l of neighbours(full, queue.shift()!)) if (!seen.has(l.node)) { seen.add(l.node); queue.push(l.node); }
  assert.equal(seen.size, full.nodes.length, full.nodes.filter(n => !seen.has(n.id)).map(n => n.id).join(", "));
});

test("health keys and screen links point at real things", () => {
  const healthKeys = new Set(["director", "caddy", "database", "relay", "web", "backup", "n8n", "immich"]);
  const screens = ["/", "/company", "/market", "/research", "/earth", "/atlas", "/send", "/network", "/library", "/review"];
  for (const n of registry.nodes) {
    if (n.health) assert.ok(healthKeys.has(n.health), `${n.id}: ${n.health}`);
    if (n.href) assert.ok(screens.includes(n.href), `${n.id}: ${n.href}`);
    assert.ok(n.descEn && n.descAr, `${n.id} needs both descriptions`);
  }
});

test("validate catches broken registries", () => {
  const bad = { nodes: [{ id: "a", kind: "core" }, { id: "a", kind: "nope" }, { id: "lonely", kind: "feed" }], edges: [{ from: "a", to: "ghost", type: "feeds" }] } as unknown as Registry;
  const errs = validate(bad).join("\n");
  assert.match(errs, /duplicate node a/);
  assert.match(errs, /unknown kind nope/);
  assert.match(errs, /edge to missing ghost/);
  assert.match(errs, /lonely is not connected/);
});

test("nodeState: key first, then health, else static", () => {
  const n = (x: Partial<NetNode>) => ({ id: "x", kind: "service", en: "", ar: "", descEn: "", descAr: "", ...x }) as NetNode;
  assert.equal(nodeState(n({ key: "K" }), {}, { K: false }).state, "needs-key");
  assert.equal(nodeState(n({ key: "K" }), {}, { K: true }).state, "static");
  assert.deepEqual(nodeState(n({ health: "web" }), { web: { state: "up", detail: "ok" } }, {}), { state: "up", detail: "ok" });
  assert.equal(nodeState(n({ health: "web" }), { web: { state: "weird" } }, {}).state, "unknown");
  assert.equal(nodeState(n({ health: "web" }), {}, {}).state, "unknown");
});

test("layout is deterministic, finite and keeps the core in the middle", () => {
  const full = withAtlas(registry, atlas);
  const a = layout(full), b = layout(full);
  assert.deepEqual(a, b);
  for (const p of Object.values(a)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 2.5 && Math.abs(p.y) < 2.5);
  const dist = (id: string) => Math.hypot(a[id].x, a[id].y);
  const atlasMean = full.nodes.filter(n => n.kind === "atlas").reduce((s, n) => s + dist(n.id), 0) / atlas.categories.length;
  assert.ok(dist("director") < atlasMean, "Director 00 sits inside the atlas ring");
});
