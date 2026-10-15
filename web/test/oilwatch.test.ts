import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assess, fireBot, loadHistory, OIL_SITES, record, tankerBot, type Snapshot, type SiteFires } from "../src/lib/oilwatch.ts";

test("the tanker bot counts tankers (AIS types 80-89), the moving ones, and those bound for Russian Baltic oil ports", () => {
  const vessels = [
    { mmsi: 1, shipType: 80, name: "OSAKA", destination: "UST LUGA" },
    { mmsi: 2, shipType: 84, name: "ARLAN", destination: "PRIMORSK" },
    { mmsi: 3, shipType: 70, name: "CARGO", destination: "UST LUGA" },   // cargo ship: ignored
    { mmsi: 4, shipType: 89, name: "STILL", destination: "HELSINKI" },
  ];
  const r = tankerBot(vessels, [{ mmsi: 1, sog: 11, lat: 60, lon: 27 }, { mmsi: 2, sog: 0.2, lat: 60, lon: 28 }, { mmsi: 3, sog: 12, lat: 60, lon: 27 }, { mmsi: 4, sog: 5, lat: 60, lon: 25 }]);
  assert.deepEqual([r.tankers, r.moving, r.toRussianOilPorts], [3, 2, 2]);
  assert.deepEqual(r.sample, ["OSAKA → UST LUGA", "ARLAN → PRIMORSK"]);
});

test("the fire bot counts only FIRMS fire pixels within 10 km of each oil site", () => {
  const abqaiq = OIL_SITES.find(s => s.id === "abqaiq")!;
  const out = fireBot([
    { lat: abqaiq.lat + 0.02, lon: abqaiq.lon, kind: "firePixel", mag: 12 },
    { lat: abqaiq.lat, lon: abqaiq.lon + 0.03, kind: "firePixel", mag: 8 },
    { lat: abqaiq.lat, lon: abqaiq.lon, kind: "earthquake", mag: 4 },
    { lat: abqaiq.lat + 1, lon: abqaiq.lon, kind: "firePixel", mag: 50 },
  ]);
  assert.deepEqual(out.find(s => s.id === "abqaiq"), { id: "abqaiq", name: "Abqaiq processing", nameAr: "بقيق", fires: 2, frp: 20 });
});

const sites = (n: number): SiteFires[] => [{ id: "abqaiq", name: "Abqaiq", nameAr: "بقيق", fires: n, frp: n * 5 }];
const hist = (fires: number, toRu: number, k = 8): Snapshot[] =>
  Array.from({ length: k }, (_, i) => ({ at: new Date(Date.UTC(2026, 9, 1, i)).toISOString(), sites: sites(fires), tankers: { tankers: 100, moving: 60, toRussianOilPorts: toRu, sample: [] } }));

test("flaring at its usual level stays calm; a jump far above the site's own normal raises an alert", () => {
  const now = (fires: number, toRu = 20): Snapshot => ({ at: "2026-10-10T12:00:00.000Z", sites: sites(fires), tankers: { tankers: 100, moving: 60, toRussianOilPorts: toRu, sample: [] } });
  assert.equal(assess(now(4), hist(4, 20)).level, "calm");
  const hot = assess(now(20), hist(4, 20));
  assert.equal(hot.level, "watch");
  assert.deepEqual(hot.reasons[0], { code: "site-fire", value: 20, normal: 4, site: "abqaiq" });
  const both = assess(now(30, 6), hist(4, 20));
  assert.equal(both.level, "alert");
  assert.deepEqual(both.reasons.map(r => r.code), ["site-fire", "tankers-down"]);
});

test("without enough history the bots say they are still learning", () => {
  const s = assess({ at: "2026-10-10T12:00:00.000Z", sites: sites(9), tankers: null }, hist(4, 20, 2));
  assert.deepEqual([s.level, s.history], ["learning", 2]);
});

test("history keeps one reading an hour", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "omega-oil-"));
  const a: Snapshot = { at: "2026-10-10T10:00:00.000Z", sites: null, tankers: null };
  assert.equal(await record(dir, a, []), true);
  assert.equal(await record(dir, { ...a, at: "2026-10-10T10:20:00.000Z" }, await loadHistory(dir)), false);
  assert.equal(await record(dir, { ...a, at: "2026-10-10T11:00:00.000Z" }, await loadHistory(dir)), true);
  assert.equal((await loadHistory(dir)).length, 2);
});
