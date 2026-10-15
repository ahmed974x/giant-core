import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLaunches, parseMil, parseNhc } from "../src/lib/spaceair.ts";

test("military aircraft need a position; callsigns are trimmed", () => {
  const m = parseMil({ ac: [{ hex: "ae04d9", flight: "CNV4900 ", r: "165831", t: "B737", lat: 21.58, lon: -157.33, alt_baro: 13250, gs: 372.5, track: 228 }, { hex: "x" }, { hex: "y", lat: 1, lon: 2, alt_baro: "ground" }] });
  assert.deepEqual(m.map(a => [a.id, a.callsign, a.altFt]), [["ae04d9", "CNV4900", 13250], ["y", null, null]]);
});

test("launches keep those with a pad position", () => {
  const l = parseLaunches({ results: [
    { id: "a", name: "Falcon 9 | X", net: "2026-10-12T00:00:00Z", status: { abbrev: "Go" }, launch_service_provider: { name: "SpaceX" }, pad: { name: "SLC-4E", latitude: "34.632", longitude: "-120.611", location: { name: "Vandenberg" } }, url: "u" },
    { id: "b", name: "No pad", net: "x", url: "u" }] });
  assert.deepEqual(l.map(x => [x.id, x.provider, x.lat]), [["a", "SpaceX", 34.632]]);
});

test("NHC storms become cyclone hazards with class and wind", () => {
  const s = parseNhc({ activeStorms: [{ id: "al092026", name: "Isaias", classification: "HU", intensity: "85", latitudeNumeric: 25.1, longitudeNumeric: -80.2, lastUpdate: "2026-10-10T21:00:00Z" }] });
  assert.deepEqual([s[0].kind, s[0].title, s[0].source], ["cyclone", "Hurricane Isaias (85 kt)", "NOAA NHC"]);
  assert.deepEqual(parseNhc(null), []);
});
