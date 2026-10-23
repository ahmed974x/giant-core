# ADR-110: Cyber storm radar (InfoCON, InternetDB, RIS Live, squawk 7700), cables per strait, NASA GIBS overlays, continuous-time neural flow, 24-check self-test

Date: 2026-10-23 · Status: Accepted (Ahmad's Phase 14 directive, 2026-10-23; merge approval covers PR #31 only)

## Context
Ahmad's Phase 14 message (several drafts in one file) asks for:
- more free keyless cyber, space and air sources: SANS InfoCON, Shodan InternetDB, RIS Live BGP, ADS-B squawk 7700 over the five straits and Taiwan, cable links per strait and NASA GIBS night and thermal imagery;
- the 139 → 48 → 36 → 48 → 24 → 16 → 8 flow in continuous time with adaptive τ, and an oscilloscope that shows τ;
- three new text-only skills, a 24/24 self-test, SkillSpector with 0 critical and 0 high, the three-size check, and PR #31 merged when CI is green.

Limits kept:
- Paper only (ADR-091, ADR-092). Nothing signs or sends an order. Shocks change how fast the drawing moves, nothing else.
- OSINT stays passive (AGENTS.md §6a). No scanning, no login, no anti-bot bypass. Shodan InternetDB is read only for four fixed public resolvers.
- No invented data. A source that does not answer shows as offline or "تعذر التحقق منها".

## Decision

### Sources
| Source | Use | Route | Why this one |
|---|---|---|---|
| SANS ISC InfoCON `isc.sans.edu/api/infocon?json` | global threat level, 0–3 | proxy `/cyber/infocon` (15 min), snapshot | keyless, stable since 2001; no browser CORS |
| Shodan InternetDB `internetdb.shodan.io/<ip>` | open ports and CVEs of 1.1.1.1, 8.8.8.8, 9.9.9.9, 208.67.222.222 | proxy `/cyber/internetdb/<one of four>` (6 h), snapshot | keyless, read-only lookups; the fixed list keeps it from becoming a reconnaissance tool |
| RIS Live `wss://ris-live.ripe.net/v1/ws/` | BGP updates for 1.1.1.0/24, 8.8.8.0/24, 9.9.9.0/24, 208.67.222.0/24 with more-specifics | WebSocket in the page; the snapshot samples 25 s with Node's WebSocket | keyless stream from RIPE NCC; the page only subscribes |
| adsb.lol v2 `api.adsb.lol` (ODbL 1.0) | squawk 7500/7600/7700 worldwide; aircraft within 150 nm of Hormuz, Bab el-Mandeb, Suez, Malacca, Panama, Taiwan | proxy `/osiris/adsb/sqk/<code>` (2 min) and `/osiris/adsb/zone/<key>` (5 min), snapshot | keyless, open licence, ADS-B Exchange v2 schema |
| NASA GIBS WMTS | VIIRS Black Marble 2016 night lights, MODIS thermal anomalies (latest day) | `<img>` tiles, `img-src` already lists the host | keyless, public domain |

The parsers live once in `scripts/lib/brain2-math.mjs` (`shape.infocon`, `internetdb`, `internetdbSet`, `adsb`, `adsbSet`, `ris`, `risSummary`, `risSubscribe`) and are tested in `scripts/test-brain2.mjs`. The proxy adds the three hosts to `ALLOWED_UPSTREAM` with polite gaps; the page CSP adds `wss://ris-live.ripe.net` to `connect-src`. The hourly snapshot goes from 16 to 20 sources.

RIS Live instability index (`[INFERENCE]`): `min(100, 2·withdrawals/min + 0.25·announcements/min + 30·foreign origins + 15·more-specific routes)` over 5 minutes. A foreign origin is an origin AS that is not the prefix's operator. The socket closes while the tab is hidden and reconnects with backoff from 30 s to 10 min.

CSTI now has seven possible parts: Kp, KEV, BGP share, IODA, InfoCON (level ÷ 3 × 100), RIS index, exposed CVEs (25 each, capped at 100). It averages the parts it has and says how many.

### Straits and cables
A corridor "Caribbean to the Pacific via Panama" with landings at Boca Raton, Colón, Panama City and Punta Carnero was added (approximate and hand-drawn like the others), so all five straits have at least one. `straitLinks(i)` gives each strait's corridors, landings within 600 km and stressed corridors; the strait callout lists them with the aircraft within 150 nm and the line "Ships with AIS switched off: NO FREE SOURCE".

### Night and heat overlays
Layer "Night & heat": Black Marble is screened onto the flat map in the MAP and SAT styles; thermal anomalies are drawn on top in all styles. Each overlay turns itself off after four failed tiles and the source table says so.

### Continuous-time flow
Between readings every hidden and decision neuron follows `dx/dt = (σ(Wx + b) − x) / τ`, solved with Heun steps of at most τmin/2. This normalised form keeps the trained feed-forward answer as the resting state, so training and the decision table stay as in ADR-109; τ only sets the speed. τ = τ_layer · spread / (1 + 4E), floored at /8, τ_layer = 0.6 to 2.5 s by depth, E the shock level decaying over 30 s. Shocks (`omega:shock`) come from a new whale wall, a microprice move of 0.5 bps or more, a higher InfoCON, a new emergency squawk and a new foreign or more-specific route. After a reading the canvas settles for at most 6 s, and not at all under reduced motion or during the self-test. The oscilloscope shows x(t) and τ now and at calm; X-Ray times one `odeStep`.

Four OSIRIS inputs of the 139 were swapped so the count stays 139: tracked satellites → InfoCON level, and the ETH, SOL and BNB 24 h changes → RIS instability, squawk count and aircraft near the straits. The saved weights move to `omega-neural-v2` because the inputs changed.

This is called continuous-time or liquid-style. It is not a liquid time-constant network from the literature, where τ depends on the input through a learned gate.

### Self-test 24
Checks 21–24: InfoCON, InternetDB and the 7-part CSTI; RIS Live and squawk 7700; cables per strait and GIBS overlays with one real tile; ODE convergence, Heun order, τ under shock, frozen motion, the $20 paper base, a LOCK receipt and the receipt chain. Each has a fixture half and, where it needs data, a live half that fails honestly. Check 20 now counts the snapshot sources instead of expecting 16.

### Skills
`cyber-space-osint-grid`, `liquid-neural-139-flow` and `autonomous-24-selftest-gate`, text rules only, written from this repo's code.

## Considered and declined
- abuse.ch URLhaus and ThreatFox: now need an Auth-Key.
- NASA FIRMS fire points: need a MAP_KEY registration. The GIBS thermal tiles show the same MODIS anomalies keylessly.
- Shadowserver dashboards: need an API key.
- TeleGeography cable data: licensed. Corridors stay hand-drawn and approximate.
- Dark ships from SAR (Sentinel-1): need a Copernicus account and heavy processing. Shown as NO FREE SOURCE.
- RIPE Atlas measurements: creating them needs an account and credits; reading RIS Live is enough for routing changes.
- Shodan InternetDB for arbitrary addresses: declined on purpose (passive OSINT rule).

## Not verified
Outbound data is blocked in the cloud sandbox, so no live answer from SANS, InternetDB, RIS Live, adsb.lol or GIBS was seen during this change; the parsers were tested on fixtures that follow each service's documented answer. The GIBS paths follow the documented REST pattern on the "best" endpoint. The thermal layer id `MODIS_Combined_Thermal_Anomalies_All` and its `GoogleMapsCompatible_Level9` matrix set are not confirmed (the std listing shows `MODIS_Combined_Thermal_Anomalies_All_v6_STD`); if the tiles fail on the laptop the overlay turns off and check 23 says why.

## Consequences
- The snapshot workflow needs Node 22 (built-in WebSocket) for the RIS sample; it already runs on Node 22.
- The page keeps one more open socket while visible.
- Self-test 24/24 needs the local proxy or a fresh snapshot.
