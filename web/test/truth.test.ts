// Parity test: the web's TypeScript Truth Layer must score exactly like services/truth/truth_layer.py (ADR-021, ADR-024).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
process.env.OMEGA_TRUTH_SOURCES = path.join(ROOT, "services", "truth", "sources.json");
const { score } = await import("../src/lib/truth.ts");
const PY = path.join(ROOT, "services", "director00", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

const ITEMS = [
  { id: "a", url: "https://www.reuters.com/world/tanker-traffic-hormuz/", tone: -1, num_sources: 5 },
  { id: "b", url: "https://www.rt.com/news/strait-closure/", tone: -3, num_sources: 2 },
  { id: "c", url: "https://smallblog.example/x/", tone: -1, num_sources: 1 },
  { id: "d", url: "https://regional-news.example/shocking-truth-about-the-traitors/", title: "EXPOSED: cover-up", tone: -7.5, num_sources: 3 },
  { id: "e", url: "https://www.nytimes.com/2026/10/09/opinion/oil-shock.html", tone: -4, num_sources: 3 },
  { id: "f", url: "https://www.mof.gov.kw/news/budget", tone: 0.5, num_sources: 4 },
  { id: "g", url: "https://edition.bbc.com/news/world", tone: -2, num_sources: 2 },
  { id: "h", url: "http://192.0.2.4/item?id=1", tone: 0 },
];

test("TypeScript scores match the Python Truth Layer", { skip: !existsSync(PY) }, () => {
  const py = `
import json, sys
sys.path.insert(0, r"${path.join(ROOT, "services", "truth")}")
import truth_layer as tl
items = json.loads(sys.stdin.read())
print(json.dumps([tl.score(tl.Item(id=i["id"], url=i["url"], title=i.get("title", ""), tone=i.get("tone", 0), num_sources=i.get("num_sources"))) for i in items]))`;
  const expected = JSON.parse(execFileSync(PY, ["-c", py], { input: JSON.stringify(ITEMS), encoding: "utf8" }));
  ITEMS.forEach((item, i) => {
    const got = score(item);
    assert.ok(Math.abs(got.score - expected[i].score) < 0.0015,   // only the 3rd-decimal rounding may differ (JS half-up vs Python half-even)
      `${item.id}: ${got.score} vs ${expected[i].score}`);
    assert.equal(got.status, expected[i].status, item.id);
    assert.deepEqual(got.flags, expected[i].flags, item.id);
    assert.equal(got.source_tier, expected[i].source_tier, item.id);
  });
});

test("verified needs a reputable source carried by others", () => {
  assert.equal(score(ITEMS[0]).status, "verified");
  assert.equal(score({ ...ITEMS[0], num_sources: 1 }).status, "unverified");
});
