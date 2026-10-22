# ADR-109: Deep neural flow 139 → 8, oscilloscope, X-Ray HUD, chrono-scrubber, adaptive regime, and fallbacks for the perpetual premium and disaster alerts

Date: 2026-10-22 · Status: Accepted (Ahmad's Phase 13 directive, 2026-10-22; merge approval covers PR #30 only)

## Context
Ahmad asked for Phase 13 in one message with two overlapping directives. Taken together (the superset):
- a seven-layer neural flow in the Ops Room, 139 inputs → 48 → 36 → 48 → 24 → 16 → 8 decisions, with smooth weighted threads, light pulses and a floating oscilloscope in the top right that plots a neuron's activation;
- training of those weights in a Web Worker on the last 300 readings, keeping the $20 locked-base rule before any sweep;
- the two sources that failed in the first cloud snapshot (Phase 12: 14/16) fixed: the Binance perpetual premium (fapi.binance.com answers HTTP 451 to US runners) and GDACS;
- an Architect X-Ray HUD (key X), a chrono-scrubber with counterfactual replay, and a layout that adapts to the market regime;
- two skills, `neural-flow-decision-viz` and `supreme-software-ui-architect`; self-test 20/20; PR #30 merged once CI is green.

Limits kept:
- Paper only (ADR-091, ADR-092). Nothing signs or sends an order. The network is a decision aid; the rules decide.
- The geo-block is not bypassed with a proxy or VPN. Other public exchange endpoints are used as labelled fallbacks.
- Only measured numbers are shown. A source that still fails shows as failed.
- There is no `desk.js`: the trading desk lives inline in `omega-ops-room.html`, so the network is added there.

## Decision

### The network, in the shared maths library
`scripts/lib/brain2-math.mjs` gains `nnFactory()` / `nn`: initialisation (He for ReLU, Xavier for tanh), forward pass, backpropagation of half mean squared error with NaN targets skipped, Adam (lr 0.003, L2 1e-4, batch 16) and a (1+1)-ES on the output layer with the one-fifth rule. 11,792 weights and 180 biases in one Float64Array. `nnFactory` uses no outside name, so the Ops Room starts its Web Worker from `nnFactory.toString()`. `scripts/test-brain2.mjs` adds a gradient check against central differences (worst relative error below 1e-5), a learnable toy task and the time-ordered split.

### Inputs and targets
The 139 inputs are readings already on the page: 50 book-level size shares, 20 microprice returns, 10 signed trades, 12 flow readings (microprice gap, Hawkes, VPIN, Kalman, BOCPD, Kyle, icebergs, entropy, spread, imbalance), 12 derivative readings (Deribit gamma, flip, walls, IV, DVOL, skew, BTC and ETH funding and basis), the mempool fee and 34 OSIRIS readings (PWSI and its parts, the five straits, quakes, alerts, gusts, AIS, GDELT, OpenSky, KEV, RIPEstat, IODA, Kp, EONET, CelesTrak, cables, CSTI, four 24 h changes). Each has a stated squashing to about [-1, 1]; a missing one enters as 0 and is drawn hollow. Two read-only probe hooks were added for this: `OMEGA_PROBE.osiris.intel()` and `OMEGA_PROBE.desk.quant()`.

Head 1 learns the microprice change 6 readings (≈30 s) ahead. Heads 2–8 learn the desk's own rule values (half-Kelly, target, stop, breaker, base recovery, sweep, court confidence) so the picture shows how the data reaches them; the table prints the rule value next to each head. The newest 20 % of readings is held out with a 6-reading gap. The page reports held-out loss before and after, the always-0 baseline, the direction hit rate on moves of 0.3 bps or more, Adam steps and ES acceptances.

### Drawing
About 11,800 cubic Bézier threads are grouped by colour and binned opacity and width into a few dozen Path2D strokes on an offscreen buffer (6.8 ms measured on the laptop-size headless run). Cyan for w > 0, purple and pink for w < 0, orange and red for the last gap. Pulses travel along the 24 strongest |w·a| per gap only on a new reading, a 0.5 bps microprice move, a data pull, a training burst or hover and tap, at most once a second. Still under reduced motion and during the self-test (`omega:selftest-start`). Zoom 1–6× and pan. The oscilloscope (glass, opaque fallback) plots the activation function with the live operating point, the neuron's activation across the ring, its equation with numbers and its four strongest incoming w·a.

### Chrono-scrubber, X-Ray, regime
Each reading keeps inputs, activations, pre-activations, rule targets, microprice, court ruling and weight version (12 versions kept). Scrubbing back redraws the network as it was and prints a counterfactual: the network's call held to now, the court's ruling held to now, and every network call followed, with 0.1 % fee each way, labelled hypothetical. X-Ray (button or X) puts a glass badge on nine cards with the equation, the median time per call measured in this browser, the ring fill and the source. The regime is fixed rules on page numbers: shield when PWSI or CSTI ≥ 70, the breaker is tripped or the court says KILL; hunt when BOCPD shift odds ≥ 50 %, |network direction| ≥ 0.5 or the court says OPEN; calm otherwise. It sets `data-regime`, which colours the header line, outlines the cards that matter in that mode and shows MODE in the status island.

### Source fallbacks
- Perpetual premium: Binance USD-M, then OKX (funding-rate, mark-price, index-tickers; funding scaled to 8 h from the settlement interval), then the Deribit perpetual ticker (`funding_8h`). Same premium form plus `venue`. In the hourly snapshot and the proxy route `/market/fapi/premium/<BTCUSDT|ETHUSDT>`; in the browser Deribit is the direct fallback (it sends CORS headers).
- Disaster alerts: GDACS event list, then the GDACS search endpoint, then EMSC earthquakes of M6 or more with ReliefWeb alerts when ReliefWeb answers. EMSC has no alert level, so a stated magnitude rule (M6+ orange, M7+ red) stands in and every point says so. The snapshot and the proxy use one shape, `omega-alerts-v1`, with `via`.
- The snapshot entry records `via` and `fellBack` (why the earlier tiers failed). The snapshot's User-Agent is now the standard `Mozilla/5.0 (compatible; OMEGA-public-intel-snapshot/1.1; +repo URL)` form, which names the project and imitates no browser.
- New proxy upstreams: `www.okx.com`, `www.seismicportal.eu`, `api.reliefweb.int`. The page's CSP is unchanged: its new direct call goes to `www.deribit.com`, already listed.

### Self-test 20/20
Check 19 "Neural flow 139 → 8 & oscilloscope": layer sizes and weight count, ReLU and tanh ranges on fixed input, a gradient check, the oscilloscope's curve and fan-in, the canvas devicePixelRatio, and that motion stays frozen during the test. Check 20 "X-Ray, chrono-scrubber & 16/16 sources": at least eight badges with at least one measured time, an exact counterfactual on a fixed ring, the 300-reading ring, a valid regime, and data coverage (the snapshot reports 16/16, or all 15 page sources are online).

## Consequences
- The snapshot can reach 16/16 from a US runner if OKX or Deribit and EMSC answer there. That is only known after the first Pages run; the PR and the thread report the measured count.
- ReliefWeb now asks for a registered `appname`; until one is registered it may refuse, and EMSC carries the fallback alone.
- The network has 300 readings at most (25 minutes at 5 s), so its held-out numbers are small-sample and say so.
- localStorage gains `omega-neural-v1` (weights rounded to 6 decimals, about 120 KB, no credentials).
