# ADR-104: Hourly public intel snapshot and a three-tier data cascade

Date: 2026-10-22 · Status: Accepted (Ahmad's Phase 10 and 11 directives, 2026-10-22)

## Context
On the public GitHub Pages site the local proxy (127.0.0.1:8796) is not there. NGA navigation warnings and GDACS alerts reached the page only through that proxy, so PWSI had at most two of four components, often none. The planet ring then sat at 0 %. Ahmad asked for:
- a snapshot script that the Pages workflow runs before each build, on an hourly schedule;
- a cascade on the page: proxy, then a direct browser fetch, then the packaged snapshot.

## Decision
- **Shared parsers.** `scripts/lib/osiris-sources.mjs` now holds the five strait boxes, the NGA position parser and classifier, and the AIS compaction. Both the proxy and the snapshot script import it, so both sort warnings into straits the same way.
- **Snapshot script.** `scripts/fetch-public-intel-snapshot.mjs` fetches six keyless sources once and writes `data/public-intel-snapshot.json` (`omega-public-intel-v1`):
  - USGS M2.5+ past day;
  - Open-Meteo at the nine hubs, with 24 hourly gusts;
  - Binance spot 24 h tickers;
  - NGA broadcast warnings, classified into the five straits;
  - GDACS orange and red alerts;
  - Digitraffic AIS, compacted to [lon, lat, sog] and sampled to 6,000 positions, with the full count kept.

  For each source it records:
  - its name, URL and fetch time;
  - `ok`, plus the data or the error.

  It also:
  - retries each source three times with backoff;
  - replaces any e-mail address in upstream text, because the public build refuses e-mail addresses.

  It exits 1 only when no source answered.
- **Workflow.**
  - `deploy-pages.yml` now also runs on `schedule: cron "15 * * * *"`.
  - It runs the snapshot step before `build-pages.mjs`. A snapshot failure never blocks the deploy.
  - `build-pages.mjs` publishes the file only when it parses and carries the format tag.
  - The file is in `.gitignore` and is never committed.
  - The proxy serves this one file at `/data/public-intel-snapshot.json`. It serves nothing else from `data/`.
- **Cascade in the Ops Room** (`cascade(key, steps, apply)`):

  | Source | Tiers, in order |
  |---|---|
  | NGA strait warnings | proxy → snapshot |
  | GDACS | proxy → snapshot |
  | Digitraffic AIS | proxy → direct (only while the sea layer is on) → snapshot |
  | USGS, Open-Meteo, Binance tickers | direct → snapshot |
  | OpenSky, GDELT | proxy only (the snapshot does not carry them) |

  - Direct fetches go only to hosts that send CORS headers: USGS, Open-Meteo, Binance and Digitraffic. `https://meri.digitraffic.fi` is added to `connect-src`.
  - NGA and GDACS are not fetched from the browser.
- **Honesty**
  - The source table says `LIVE · proxy`, `LIVE · direct` or `SNAPSHOT · as of HH:MM UTC` (amber).
  - A snapshot source older than 6 hours is ignored.
  - PWSI says how many of its components came from the snapshot. The strait rows give the snapshot time, and the rings repeat it.
  - Nothing is filled in when every tier fails.

## Consequences
- The public site shows PWSI from up to 4 of 4 components, dated within the last hour, without any server.
- The hourly schedule adds a gh-pages commit each hour when a source changed.
- Verified in the sandbox with a mocked fetch: 6/6 sources written, the site built with the file, and the page showing PWSI 4/4 from the snapshot with no page errors. Live fetches from GitHub's runners are checked on the first scheduled run.
- Digitraffic CORS for the direct tier is assumed from its open-data documentation. If the browser refuses it, the snapshot tier takes over.
