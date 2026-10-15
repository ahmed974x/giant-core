import { test } from "node:test";
import assert from "node:assert/strict";
import { openShipsNear, parseOpenAis } from "../src/lib/ais.ts";

const now = 1_791_670_000_000;
const feat = (mmsi: number, lon: number, lat: number, ageMs: number, heading = 180) =>
  ({ mmsi, type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { mmsi, sog: 10.2, cog: 90, heading, timestampExternal: now - ageMs } });

test("the keyless Baltic feed keeps fresh positions only and maps heading 511 to unknown", () => {
  const ships = parseOpenAis({ type: "FeatureCollection", features: [feat(1, 24.9, 60.1, 60_000), feat(2, 25, 60, 2 * 3600_000), feat(3, 22, 59, 1000, 511), { mmsi: 4 }] }, now);
  assert.deepEqual(ships.map(s => [s.mmsi, s.heading]), [[1, 180], [3, null]]);
  assert.deepEqual(parseOpenAis(null), []);
});

test("ships are filtered to the view, from the shared one-minute cache", async () => {
  const live = Date.now();
  const ok = (async () => Response.json({ features: [{ ...feat(7, 24.9, 60.1, 0), properties: { timestampExternal: live } }, { ...feat(8, 47.9, 29.3, 0), properties: { timestampExternal: live } }] })) as typeof fetch;
  const near = await openShipsNear(60.1, 24.9, 100, ok);
  assert.deepEqual(near.map(s => s.mmsi), [7]);
});
