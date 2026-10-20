# ADR-092: OSIRIS intelligence, order-flow physics, debate court, paper auto engine and the Apple-style shell

Date: 2026-10-19 · Status: Proposed (waiting for Ahmad's review)

## Context
On 2026-10-19 Ahmad approved merging PR #22 and chose "paper only" for the auto engine. His rule: never write code that signs or sends an order to any exchange, Binance or Testnet. He then asked for Phase 7:
- OSIRIS, a seven-layer open-source intelligence view with a Physical Shock Index (PWSI).
- A quant brain: microprice, Hawkes intensity and VPIN.
- A three-agent debate court before each automatic paper trade.
- Strict locked-base arithmetic.
- An Apple HIG shell for iPhone and laptop: views, a status island, a floating dock and home-screen install.

## Decision

**OSIRIS** (`#osiris`, its own inline script)
- The map is a Canvas 2D projection, 3D orthographic or 2D equirectangular. It reuses the Natural Earth land sample already in the page.
- DAY, MAP and SAT are colour styles. No satellite imagery is loaded.
- Drawing is on demand only, and pauses when the canvas is off screen or the tab is hidden.
- Direct browser sources, which send CORS: USGS earthquakes, Open-Meteo at 8 hubs, and Binance tickers.
- Sources served through the local proxy (`scripts/omega-data-proxy.mjs`, 127.0.0.1): OpenSky (Gulf and Red Sea box), GDACS, GDELT DOC and Digitraffic AIS. These send no CORS or have tight anonymous limits. AIS is compacted on the server to `[lon, lat, sog]`.
- Port pulse counts moored and moving AIS vessels around four Baltic ports.
- The four Gulf and Asian straits are drawn as reference points. No free source gives live ship counts there, and the data core says so.
- PWSI is the mean of the components that have live data:
  - seismic: max magnitude and M5+ count;
  - weather: max gust at the hubs;
  - disasters: GDACS red and orange alerts.
- PWSI is shown with its coverage (n/3), tagged `[INFERENCE]`, and reads "تعذر التحقق منها" when no component has live data.
- No placeholder or simulated data is drawn. The brief's "deterministic sandbox telemetry" was read as deterministic offline states, because DESIGN.md §6 forbids invented data.

**Order-flow physics** (desk script), computed from 1,000 Binance aggTrades every 10 s:
- Stoikov microprice: the mid weighted by the opposite queue sizes.
- Exponential Hawkes intensity: μ is the window's trade rate, α = 0.5, β = 1/3 s⁻¹. Shown as a multiple of baseline.
- VPIN over 20 equal-volume buckets, with trade side taken from `isBuyerMaker`.
- Together these become a fifth evidence. Weights: whales 0.25, contrarian crowd 0.2, analogues 0.15, quant odds 0.2, flow 0.2.

**Debate court**
- Bull agent: the strongest positive component.
- Red-team bear: trap pattern, VPIN or PWSI over its limit, crowd euphoria, or else the weakest component.
- Risk judge: OPEN, STAND ASIDE or KILL, with confidence and half-Kelly size.
- KILL runs the emergency stop whenever an open paper position meets VPIN or PWSI over its limit. Both limits can be edited in the circuit breaker.

**Auto engine**
- A toggle. When the judge says OPEN, it opens a paper long sized by half-Kelly on the locked base. A 15-minute cooldown follows every close.
- Fills walk the visible order book (VWAP, slippage reported in the receipt) and pay a 0.1% fee each side.
- There is no exchange client, signing code or key use anywhere in the desk.

**Locked base**
- `sweep = max(0, active − base)`, only while flat. A loss leaves the base short, and later profit refills it before anything moves.
- Tested: lock 20 → −10% gives 17.96 → +17% gives 20.98 → 0.98 swept, 20.00 keeps trading.
- The safe vault only receives money; no trade reads from it. Every sweep issues a SHA-256 receipt.

**Shell**
- Five views:
  1. Command
  2. OSIRIS
  3. Radar
  4. Receipts & shield
  5. All
- Laptops switch views with a segmented control; phones under 768 px use a floating glass dock (`blur(40px) saturate(200%)`, safe-area aware).
- The current view is stored in `?view=N` and localStorage.
- An anchor such as `#shield` opens the view that holds it.
- A status island shows OSIRIS PWSI, the engine state, the locked base and the vault.
- `manifest.webmanifest` and PNG icons are linked only over http(s), because browsers refuse manifests on `file://`.
- Telemetry arrays are capped ring buffers of 300 readings.

**CSP**
- `connect-src` adds `https://earthquake.usgs.gov` and `http://127.0.0.1:8796`.
- `img-src` adds `'self'`; `manifest-src 'self'` is new.

## Consequences
- With the proxy off, aviation, GDACS, GDELT and AIS show OFFLINE and PWSI runs on 2 of 3 components.
- The Hawkes and VPIN parameters are fixed, not fitted; the page labels them `[INFERENCE - Quant Model]`.
- The court is rule-based text built from the same numbers, not a language model.
- "View 5 · All" shows every section in the existing responsive grid. It is not a separate multi-monitor layout.
- Live upstream responses were not reachable from the build sandbox. Behaviour was verified against mocked responses; the first live run is on Ahmad's machine.
