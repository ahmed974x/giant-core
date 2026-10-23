---
name: stablecoin-cyber-vuln-intel
description: Use when changing the DefiLlama liquidity flow index (LFI), the CIRCL Vulnerability-Lookup feed with MISP taxonomy tags, the 8-part CSTI or the Open-Meteo Marine sea state at the five straits. Keyless sources, one parser per source, fixed rules marked [INFERENCE].
---

# Stablecoin liquidity, cyber vulnerabilities and strait seas (ADR-112)

Three keyless sources feed the whale sonar, the agent court, CSTI and PWSI. Read `cyber-space-osint-grid` first; this skill adds the ADR-112 layer. Every number on screen names its source and time, or shows "تعذر التحقق منها".

## 1. Sources and routes

| Source | What it gives | Route | Tier order |
|---|---|---|---|
| DefiLlama `stablecoins.llama.fi/stablecoins?includePrices=true` | USD-pegged supply now, a day, a week and a month ago; price per coin | proxy `/market/llama` (all three in one), direct (CORS) | proxy → direct → snapshot |
| DefiLlama `api.llama.fi/v2/chains` | TVL per chain | same | same |
| DefiLlama `api.llama.fi/overview/dexs` (charts excluded) | DEX volume 24 h, the 24 h before, 7 days | same | same |
| CIRCL `vulnerability.circl.lu/api/last` | the latest CVE 5 and OSV records | proxy `/cyber/circl` (no browser CORS) | proxy → snapshot |
| Open-Meteo Marine `marine-api.open-meteo.com/v1/marine` | wave height, direction, period, swell, current speed and direction, sea temperature, 24 h wave curve | proxy `/osiris/marine`, direct (CORS) | proxy → direct → snapshot |

- Each host sits in `ALLOWED_UPSTREAM` of `scripts/omega-data-proxy.mjs`, in the Ops Room CSP `connect-src` when the browser calls it, and in `scripts/fetch-public-intel-snapshot.mjs`. Add all of them or none.
- `cve.circl.lu` now redirects to `vulnerability.circl.lu`; use the new host so no redirect leaves the allow list.
- Snapshot rows are amber with their fetch time and are ignored after 6 hours.

## 2. Parsers (one place: `scripts/lib/brain2-math.mjs`)

- `shape.llamaStable` keeps USD-pegged coins only, sums supply, gives pct1, pct7 and pct30, the top 8 coins and the largest peg gap among coins of $1 bn or more. `shape.llamaDex` gives chg1d = (24 h ÷ the 24 h before − 1) · 100. `shape.llamaSet` packs the three with `format: "omega-llama-v1"` and the LFI.
- `shape.circl` reads mixed CVE 5 and OSV records into `{id, aliases, published, title, cvss, cwe, vendor, product, osv, poc}`. `cvss3(vector)` computes the CVSS 3.0/3.1 base score with FIRST's Roundup; a record without a vector has no score, never a guessed one.
- `shape.marine` reads one point per strait from `MARINE_POINTS` (Hormuz, Bab el-Mandeb, Suez, Malacca, Panama). Currents arrive in km/h and are also given in knots.

## 3. Fixed rules (all [INFERENCE])

- LFI, −100 to +100: 35 % one-day supply change (±0.5 % is full scale), 30 % seven-day change (±2 %), 20 % DEX volume against the day before (±25 %), 15 % peg stress (0 within 50 bps, −1 at 200 bps). Weights are renormalised over the parts present; coverage is shown as `n of 4`. Inflow at ≥ 25, outflow at ≤ −25.
- MISP machine tags (github.com/MISP/misp-taxonomies, CC0): `priority-level` from CVSS and CISA KEV (emergency = CVSS ≥ 9 and in KEV, severe ≥ 9, high ≥ 7, medium ≥ 4, low > 0, baseline-minor with no score), `vulnerability:sighting="exploited"` when KEV lists it, `vulnerability:information="PoC"` when a reference is an exploit, `vulnerability:origin="software"` for OSV, `rsit` tags from a fixed CWE map. The tags are a classification aid, not CIRCL's own rating.
- CIRCL pressure, 0 to 100: 10 per critical record, 2 per high record, 25 per record in KEV, capped. It is CSTI's eighth part (`of: 8`); `csti()` never fills a missing part.
- Sea state, 0 to 100: (highest significant wave − 2 m) ÷ 4 m, plus 0.25 when any current is 4 kn or more. It merges into PWSI's weather part as the larger of gust and sea.

## 4. Where it shows

- Whale sonar card: the LFI table (`#snLiq`) with each part and its source line.
- Court: a liquidity witness line (not a weighted voice). LFI ≤ −40 or a peg gap ≥ 100 bps adds a red-team risk.
- CSTI note lists the top CIRCL records with their MISP tags and a link to `vulnerability.circl.lu/vuln/<id>`.
- Strait table and callouts: wave, current and a 24 h wave sparkline of real readings only.
- Neural inputs: LFI and DEX change in the chain group, highest wave, fastest current and CIRCL critical count in the intel group.

## 5. Never

- No paid feed, no key, no scraping of a page that has an API.
- A stablecoin outflow is a reading, not a trade signal by itself. Nothing here opens, sizes or sends an order; the desk is paper only.

## 6. Checks

`node scripts/test-brain2.mjs` (LFI, CVSS reference vectors, MISP tags, marine fixtures), self-test checks 6, 21 and 23 (`autonomous-24-selftest-gate`), `node scripts/omega-data-proxy.mjs --check` on the laptop.
