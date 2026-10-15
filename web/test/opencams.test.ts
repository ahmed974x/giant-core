import { test } from "node:test";
import assert from "node:assert/strict";
import { openCamsNear, parseFintraffic, parseTfl } from "../src/lib/opencams.ts";

test("Fintraffic road-weather stations become cameras with their first collected preset image", () => {
  const cams = parseFintraffic({ features: [
    { id: "C01503", geometry: { coordinates: [23.99, 60.05, 0] }, properties: { name: "kt51_Inkoo", collectionStatus: "GATHERING", presets: [{ id: "C0150301", inCollection: true }] } },
    { id: "C9", geometry: { coordinates: [24, 60] }, properties: { name: "off", collectionStatus: "REMOVED_TEMPORARILY", presets: [{ id: "C901" }] } },
    { id: "C8", geometry: { coordinates: [24, 60] }, properties: { name: "no presets", collectionStatus: "GATHERING", presets: [] } },
  ] });
  assert.deepEqual(cams.map(c => [c.id, c.title, c.preview]), [["fi-C0150301", "kt51 Inkoo (Fintraffic)", "https://weathercam.digitraffic.fi/C0150301.jpg"]]);
  assert.deepEqual(parseFintraffic(null), []);
});

test("TfL JamCams keep only available cameras with an https still", () => {
  const p = (id: string, available: string, imageUrl: string) => ({ id, commonName: id, lat: 51.5, lon: -0.1,
    additionalProperties: [{ key: "available", value: available }, { key: "imageUrl", value: imageUrl }] });
  const cams = parseTfl([p("a", "true", "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/a.jpg"), p("b", "false", "https://x/b.jpg"), p("c", "true", "http://x/c.jpg")]);
  assert.deepEqual(cams.map(c => c.id), ["tfl-a"]);
  assert.deepEqual(parseTfl({}), []);
});

test("cameras come back nearest first within the view", async () => {
  const f = (async (u: string | URL) => String(u).includes("digitraffic")
    ? Response.json({ features: [
        { id: "A", geometry: { coordinates: [25.0, 60.2] }, properties: { name: "far", collectionStatus: "GATHERING", presets: [{ id: "A1" }] } },
        { id: "B", geometry: { coordinates: [24.95, 60.17] }, properties: { name: "near", collectionStatus: "GATHERING", presets: [{ id: "B1" }] } }] })
    : Response.json([])) as typeof fetch;
  const near = await openCamsNear(60.17, 24.94, 50, 10, f);
  assert.deepEqual(near.map(c => c.id), ["fi-B1", "fi-A1"]);
});

test("Caltrans keeps in-service cameras with coordinates; Iceland reads its lat/lon fields", async () => {
  const { parseCaltrans, parseIceland } = await import("../src/lib/opencams.ts");
  const rec = (index: string, inService: string, lat: string) => ({ cctv: { index, inService, location: { district: "4", locationName: "TV102 -- I-580 : West of SR-24", nearbyPlace: "Oakland", latitude: lat, longitude: "-122.27" },
    imageData: { static: { currentImageURL: "https://cwwp2.dot.ca.gov/data/d4/cctv/image/x/x.jpg" } } } });
  const ca = parseCaltrans({ data: [rec("1", "true", "37.8"), rec("2", "false", "37.8"), rec("3", "true", "0")] });
  assert.deepEqual(ca.map(c => [c.id, c.title]), [["ca-4-1", "I-580 : West of SR-24 (Oakland) (Caltrans)"]]);
  const is = parseIceland([{ Maelist_nr: 7001, Myndavel: "Hellisheiði", Skyring: "Hellisheiði séð til vesturs", Slod: "https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg", Breidd: 64.0, Lengd: -21.3 }, { Maelist_nr: 1 }]);
  assert.deepEqual(is.map(c => [c.lat, c.lon, c.source]), [[64.0, -21.3, "iceland"]]);
});

test("camera news bots: each kind of event reaches its own distance, nearest first, at most 3", async () => {
  const { nearbyFor } = await import("../src/lib/opencams.ts");
  const cam = { lat: 37.8, lon: -122.27 };
  const h = (kind: string, dLat: number, title: string) => ({ kind, title, lat: cam.lat + dLat, lon: cam.lon, source: "S", at: null, url: null });
  const out = nearbyFor(cam, [({ ...h("earthquake", 2, "quake 220 km"), mag: 6.2 }), ({ ...h("earthquake", 1, "small quake 111 km"), mag: 3.1 }), h("firePixel", 0.1, "fire 11 km"), h("firePixel", 1, "fire 111 km"), h("conflict", 3, "far news")]);
  assert.deepEqual(out.map(n => [n.title, n.km]), [["fire 11 km", 11], ["quake 220 km", 222]]);
});

test("Gulf live views are public pages linked out, never embedded", async () => {
  const { gulfViews } = await import("../src/lib/gulfviews.ts");
  const v = gulfViews();
  assert.ok(v.length >= 5);
  for (const g of v) { assert.equal(g.preview, null); assert.match(g.url!, /^https:\/\//); assert.equal(g.source, "gulf-live"); }
});
