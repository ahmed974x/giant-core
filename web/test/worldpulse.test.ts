import { test } from "node:test";
import assert from "node:assert/strict";
import { fromGdacs, fromGdelt, fromUsgs, impact, lean, regionOf } from "../src/lib/worldpulse.ts";

test("regions: Hormuz is the Gulf, Houston the US refining coast, Taipei East Asia, Paris the rest of the world", () => {
  assert.equal(regionOf(26.5, 56.3), "gulf");
  assert.equal(regionOf(29.7, -95.3), "us-gulf-coast");
  assert.equal(regionOf(25.0, 121.5), "east-asia");
  assert.equal(regionOf(48.8, 2.3), "world");
});

test("rules of thumb: Gulf trouble lifts oil and gold; a US Gulf hurricane lifts oil and gas; an East Asia quake hits stocks", () => {
  assert.deepEqual(impact("conflict", "gulf", 2).filter(x => ["oil", "gold"].includes(x.asset)), [{ asset: "oil", dir: "up" }, { asset: "gold", dir: "up" }]);
  assert.deepEqual(impact("cyclone", "us-gulf-coast", 2), [{ asset: "oil", dir: "up" }, { asset: "gas", dir: "up" }]);
  assert.ok(impact("earthquake", "east-asia", 2).some(x => x.asset === "stocks" && x.dir === "down"));
  assert.deepEqual(impact("flood", "world", 2), []);
});

test("GDACS: only current orange/red alerts, with the report link as evidence", () => {
  const f = (eventtype: string, alertlevel: string, iscurrent: boolean, lon: number, lat: number) =>
    ({ geometry: { coordinates: [lon, lat] }, properties: { eventtype, eventid: 1, name: "X", alertlevel, iscurrent, country: "C", todate: "2026-10-10T00:00:00", url: { report: "https://www.gdacs.org/report.aspx?eventid=1" } } });
  const d = fromGdacs({ features: [f("TC", "Red", true, -94, 27), f("EQ", "Green", true, 0, 0), f("FL", "Orange", false, 0, 0)] });
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].kind, d[0].region, d[0].severity, d[0].url], ["cyclone", "us-gulf-coast", 3, "https://www.gdacs.org/report.aspx?eventid=1"]);
  assert.deepEqual(fromGdacs(null), []);
});

test("USGS keeps magnitude 6+; GDELT keeps widely reported conflict in sensitive regions only", () => {
  const hz = [{ id: "u1", kind: "earthquake", title: "near Hualien", lat: 24, lon: 121.6, mag: 7.1, at: "t", url: "https://usgs", source: "USGS" },
    { id: "u2", kind: "earthquake", title: "small", lat: 0, lon: 0, mag: 4.5, at: "t", url: null, source: "USGS" }];
  assert.deepEqual(fromUsgs(hz).map(d => [d.id, d.severity, d.region]), [["u1", 3, "east-asia"]]);
  const ev = (id: string, lat: number, lon: number, category: string, sources: number, mentions: number) => ({ id, lat, lon, place: id, category, sources, mentions, url: "https://news", at: "t" });
  const g = fromGdelt([ev("strait", 26.5, 56, "conflict", 5, 80), ev("rumour", 26, 56, "conflict", 1, 200), ev("paris", 48.8, 2.3, "conflict", 9, 90), ev("talks", 26, 56, "cooperation", 9, 90)]);
  assert.deepEqual(g.map(d => [d.title, d.severity]), [["strait", 3]]);
});

test("the lean adds up severity per asset", () => {
  const l = lean([
    { id: "a", source: "GDACS", kind: "cyclone", title: "", region: "us-gulf-coast", severity: 3, lat: 0, lon: 0, at: "", url: null, assets: [{ asset: "oil", dir: "up" }] },
    { id: "b", source: "GDELT", kind: "conflict", title: "", region: "gulf", severity: 2, lat: 0, lon: 0, at: "", url: null, assets: [{ asset: "oil", dir: "up" }, { asset: "btc", dir: "down" }] },
  ]);
  assert.deepEqual(l, [{ asset: "oil", up: 5, down: 0, net: 5 }, { asset: "btc", up: 0, down: 2, net: -2 }]);
});
