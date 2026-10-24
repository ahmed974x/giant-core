# ADR-125: Self-test recovery, open cameras on the map, the oil and gold watch, and the open-source library

- Status: proposed (waits for Director 00's merge go)
- Date: 2026-10-24
- Stacked on: ADR-124 (PR #44)

## Context

Ahmad pasted the Ops Room status from the public site: 21 of 24 self-test checks passed. The three failures were
"Orbits, space weather & cyber radar", "InfoCON, InternetDB, CIRCL & 8-part CSTI" and "RIS Live BGP & squawk 7700".
Each failed because its live sources (CISA KEV, RIPEstat, IODA, SANS InfoCON, Shodan InternetDB, CIRCL, adsb.lol)
were offline on the page, while the X-Ray check in the same run found the hourly snapshot with 23 of 23 sources.
n8n (5678) and Newton (8095) showed red because the page was not served from the laptop.

He also asked for live, trusted, open cameras he can tap on the map and see with his own eyes; a stronger bot for
oil, tankers and gold that forecasts, while trading stays on paper; and free open-source tools and skills organised
in the second brain.

## Cause of the three failures

`snapshotFile()` kept its promise for 10 minutes even when the fetch failed or timed out (10 s), and `loadCyber`
runs every 15 minutes. One slow first fetch of the 244 KB snapshot, common on a phone while the page loads tiles,
streams and a 1 MB page, left every proxy-or-snapshot source offline for up to 15 minutes. The fixtures inside the
checks were exact; only the live half failed. Reproduced headless: the first snapshot request answers 503, and the
cyber sources stayed offline.

## Decision

1. Recovery (Ops Room):
   - a failed snapshot fetch is not cached; the next source asks again; timeout 20 s;
   - cyber sources that found no tier are asked again after 1, 2 and 4 minutes (a reading stops the retries);
   - the three self-test checks ask once more (at most 25 s, a real fetch, nothing filled in) before judging;
   - `OMEGA_PROBE.osiris.refreshCyber()` exposes that one refresh.
   Verified headless: offline at 15 s after a failed first fetch, online at 80 s, self-test checks pass.
2. n8n and Newton: when the page is not on the laptop (not 127.0.0.1, `file://`, port 8796, Tailscale or `/ops/`)
   and the Core API did not answer, a closed port is expected, so the card says "OPTIONAL · LAPTOP ONLY" in grey with
   the command to start it, and the header count leaves those services out and says how many are on the laptop. The
   Newton gate stays closed. `newton/http_api.py` now sends CORS for `GET /api/health` to the Ops Room origins only
   (127.0.0.1:8796, localhost:8796, the Pages site, `file://`) with a private-network preflight answer; tool calls
   (POST) get no CORS header. Before this the gate could never open from a page, because the health body was opaque.
3. Open cameras (OSIRIS layer "Live cameras", key `cams`):
   - TfL JamCams (London, Powered by TfL Open Data), Fintraffic road weather cameras (Finland, CC BY 4.0) and LTA
     traffic cameras through data.gov.sg (Singapore, Singapore Open Data Licence). Keyless; up to 600 per group;
   - `OMEGA_MATH.shape.cams*` cut each list to id, name, position and one still-image URL whose host is in
     `CAM_HOSTS` (https only, the TfL bucket path only); the page checks the host again before it keeps a camera;
   - tiers: proxy `/osiris/cams`, direct (all three send CORS headers), hourly snapshot `cams` (lists only, images
     always load live); a failed group is named in the set, never filled;
   - tapping a camera opens the glass callout with the live still, refreshed every 60 s while open, its network,
     licence and list time; a failed image says "تعذر التحقق منها". Fly-to chips for London, Singapore and Helsinki;
   - Gulf states publish no open camera feed; the existing Gulf link-out pins stay as they are.
4. Oil and gold watch (card in views 1 and 5):
   - WTI (DCOILWTICO) and Brent (DCOILBRENTEU) daily spot from the U.S. EIA through FRED's keyless CSV, gold through
     PAXGUSDT daily candles on Binance; proxy `/market/oilgold`, snapshot `oilgold`, and gold alone directly;
   - `OMEGA_MATH.oilGold` gives the trend (close against 20- and 50-day means), yearly volatility, 20-day z-score and
     the 5-day 1σ range under a random walk, labelled [INFERENCE - Quant Model]; the paper reading is fixed rules;
   - tanker routes come from the OSIRIS probe: NGA warnings, waves at Hormuz, Bab el-Mandeb and Suez, and PWSI;
   - the card reads only. Real trading stays «قيد الموافقة»; no code here sizes, signs or sends an order.
5. Second brain: `OMEGA_BRAIN.LIBRARY`, 39 free open-source tools in eight groups (maps, cameras, forecasting,
   OSINT and cyber, local AI, knowledge, design, security), each with licence, repository and status ("in use" or
   "idea"). The page lists them and, on by default, adds them to the ideas so the clustering groups them. Nothing is
   installed; installing any of them needs Ahmad's approval and a written security review. n8n is listed honestly
   as fair-code (Sustainable Use License), not OSI open source.

6. Launchers: `start-omega.bat` and `start-omega.sh` also say whether n8n (5678) and Newton (8095) answer, and how to
   start each, so one launcher shows the whole laptop state. n8n needs the `.env` of the folder Docker was set up in
   (the compose project is named `omega`, so either folder reaches the same containers and volumes); a fresh clone has
   no `.env`, so n8n is started from the folder that holds it.

## Consequences

- New upstream hosts in the proxy allowlist: api.tfl.gov.uk, tie.digitraffic.fi, api.data.gov.sg,
  fred.stlouisfed.org. Ops Room CSP: `img-src` adds weathercam.digitraffic.fi and images.data.gov.sg; `connect-src`
  adds api.tfl.gov.uk, tie.digitraffic.fi and api.data.gov.sg.
- Two new proxy routes, documented in `docs/api/omega-data-proxy.openapi.json`.
- The snapshot gains `cams` and `oilgold` (about 170 KB more at most).
- Not verified in the cloud sandbox (no outbound network): the live camera lists and images, FRED and PAXG answers,
  and Newton's CORS from the real Pages origin. These are checked on the laptop (`node scripts/omega-data-proxy.mjs
  --check` prints the four new rows).

## Checks

- `node scripts/test-brain2.mjs` 31/31 (camera shapes, host allowlist, FRED CSV, PAXG, oilGold maths)
- `node scripts/test-brain.mjs` 18/18 (library joins only when asked and forms themes)
- `python -m pytest -q newton/tests` 9/9 (health CORS only for the Ops Room origins, never for tools)
- `node scripts/selftest-headless.mjs --mock` 22/24, the two failures need internet (RIPEstat timed out in the
  snapshot, GIBS tiles), same as before this change
- skillspector strict 0 critical, 0 high; contrast gate passes; ui-three-sizes: no overflow, the only console errors
  are blocked outbound requests in the sandbox
