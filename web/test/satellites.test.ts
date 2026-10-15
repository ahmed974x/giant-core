import { test } from "node:test";
import assert from "node:assert/strict";
import { groundTrack, loadSats, positionOf, toSats } from "../src/lib/satellites.ts";

// A real ISS element set (CelesTrak OMM JSON), so the test needs no network.
const ISS = { OBJECT_NAME: "ISS (ZARYA)", OBJECT_ID: "1998-067A", EPOCH: "2026-10-09T22:48:38.797056", MEAN_MOTION: 15.4879578,
  ECCENTRICITY: 0.00066723, INCLINATION: 51.6312, RA_OF_ASC_NODE: 120.1, ARG_OF_PERICENTER: 80.2, MEAN_ANOMALY: 280.0,
  EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 50000,
  BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0 };

test("the ISS propagates to a low orbit at about 7.7 km/s within its inclination", () => {
  const [iss] = toSats([ISS], "stations");
  const p = positionOf(iss, new Date("2026-10-10T00:00:00Z"))!;
  assert.equal(p.name, "ISS (ZARYA)");
  assert.ok(p.altKm > 350 && p.altKm < 450, `alt ${p.altKm}`);
  assert.ok(p.speedKms > 7.4 && p.speedKms < 7.9, `speed ${p.speedKms}`);
  assert.ok(Math.abs(p.lat) <= 52);
});

test("a ground track covers one orbit and is split at the date line", () => {
  const [iss] = toSats([ISS], "stations");
  const segs = groundTrack(iss, new Date("2026-10-10T00:00:00Z"), 95);
  const pts = segs.flat();
  assert.ok(pts.length >= 90, String(pts.length));
  for (const seg of segs) for (let i = 1; i < seg.length; i++) assert.ok(Math.abs(seg[i][0] - seg[i - 1][0]) < 180);
});

test("bad element sets are skipped and duplicate satellites across groups load once", async () => {
  assert.deepEqual(toSats([{ OBJECT_NAME: "BAD", OBJECT_ID: "x", NORAD_CAT_ID: 1 } as never], "visual").length, 0);
  const f = (async () => Response.json([ISS])) as typeof fetch;
  const sats = await loadSats(f);
  assert.equal(sats.filter(s => s.id === 25544).length, 1);
  assert.equal(sats[0].group, "stations");
});
