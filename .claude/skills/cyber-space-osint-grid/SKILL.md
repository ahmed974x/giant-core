---
name: cyber-space-osint-grid
description: Use when adding or changing an OSIRIS cyber, space or air source in the Ops Room (SANS InfoCON, Shodan InternetDB, RIS Live BGP, adsb.lol squawks, NASA GIBS overlays, cables per strait, CSTI). Passive keyless sources only, a named tier for every reading, honest gaps.
---

# Cyber, space and air grid · OSIRIS (ADR-108, ADR-110)

OSIRIS reads public keyless data to show the risk around the five straits (Hormuz, Bab el-Mandeb, Suez, Malacca, Panama) and Taiwan. It never scans, never logs in and never sends anything but a GET or a read-only WebSocket subscription. Read `osint-bgp-cables` first; this skill adds the ADR-110 layer.

## 1. Sources and how each one reaches the page

| Source | What it gives | Route | Tier order |
|---|---|---|---|
| SANS ISC InfoCON (`isc.sans.edu/api/infocon?json`) | green / yellow / orange / red | proxy `/cyber/infocon` (no browser CORS) | proxy → snapshot |
| Shodan InternetDB (`internetdb.shodan.io/<ip>`) | open ports and CVEs of 1.1.1.1, 8.8.8.8, 9.9.9.9, 208.67.222.222 | proxy `/cyber/internetdb/<ip>`, these four addresses only | proxy → snapshot |
| RIS Live (`wss://ris-live.ripe.net/v1/ws/`) | BGP updates for the four DNS anycast prefixes | WebSocket in the page; the snapshot samples 25 s with Node's WebSocket | stream → snapshot |
| adsb.lol v2 (`api.adsb.lol`, ODbL 1.0) | squawk 7500 / 7600 / 7700 worldwide; aircraft within 150 nm of each zone | proxy `/osiris/adsb/sqk/<code>` and `/osiris/adsb/zone/<key>` | proxy → snapshot |
| NASA GIBS WMTS | VIIRS Black Marble night lights (2016), MODIS thermal anomalies (latest day) | `<img>` tiles over the flat map | direct only |

- Every upstream host is listed in `ALLOWED_UPSTREAM` in `scripts/omega-data-proxy.mjs`, in the page CSP (`connect-src` or `img-src`) and, if the snapshot uses it, in `scripts/fetch-public-intel-snapshot.mjs`. Add all three or none.
- InternetDB is queried only for the four public resolvers named in `INTERNETDB_HOSTS`. Never accept an address from the page, a URL or a user: that would turn a lookup into reconnaissance.
- Each source sets `S.src[key]` with `state`, `tier`, `n` and `at`. Snapshot rows are amber and ignored after 6 hours.

## 2. Parsing (one place: `scripts/lib/brain2-math.mjs`)

- `shape.infocon` accepts the JSON or the plain-text answer and throws on any other colour.
- `shape.internetdb` treats `{"detail": "No information available"}` as `none: true`, which is not the same as zero ports.
- `risSummary(msgs, now, 5 min)` counts announcements, withdrawals, foreign origins (origin AS not the operator's) and more-specific routes inside the watched prefixes. Index = `min(100, 2·wd/min + 0.25·ann/min + 30·foreign + 15·specific)`, carried as `[INFERENCE]`.
- `shape.adsb` keeps only aircraft squawking 7500, 7600 or 7700 or flagged `emergency`, with a position; `shape.adsbSet` takes exactly seven answers (the squawk list, then the six zones in `AIR_ZONES` order).
- `csti()` averages the parts it has: space (Kp), KEV, BGP share, IODA, InfoCON (level ÷ 3), RIS index, exposed CVEs (25 each, capped). It reports `coverage` and `of: 7`. Never fill a missing part.

## 3. What the map may say

- Squawk 7700 is a pilot's declared emergency, not an attack; the callout says what the code means and links the raw adsb.lol record.
- A foreign origin or more-specific route can be a routine change or a leak; the line says "possible hijack or leak [INFERENCE]", never "hijacked".
- Ships with AIS switched off have no free keyless source (SAR needs a Copernicus account). Show "NO FREE SOURCE", never dots.
- Cable corridors are hand-drawn and approximate (TeleGeography is licensed). `straitLinks(i)` counts the corridors and the landings within 600 km for each strait; all five straits, Panama included, must have at least one.
- Night lights are a 2016 composite, not tonight; thermal anomalies are the latest day. Their credits stay on the map.

## 4. Shocks

New InfoCON level, a new emergency hex, a new foreign or more-specific route and a new whale wall each dispatch `omega:shock` with `{why, w, src, t}`. The continuous-time neural flow (`liquid-neural-139-flow`) listens; nothing else may act on a shock.

## 5. Checks

`node scripts/test-brain2.mjs` (fixtures for every parser), self-test checks 21 to 23 (`autonomous-24-selftest-gate`), `node scripts/omega-data-proxy.mjs --check` on the laptop for the live status table.
