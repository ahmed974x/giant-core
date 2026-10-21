# ADR-102: Retina spline charts with a glass loupe, triple performance rings, whale sonar and liquidity canyon

Date: 2026-10-21 · Status: Accepted (Ahmad's Phase 9 directive, 2026-10-21)

## Context
The Ops Room and the NABD portal drew straight-segment SVG lines with a plain tooltip on one chart. Canvases were capped at devicePixelRatio 2, so they were soft on a 3x iPhone. Ahmad asked for Apple Stocks style charts with a glowing area, event dots, a magnetic crosshair with a glass loupe showing price, microprice and time, Apple Watch style rings for the desk's three key numbers, and a whale sonar over an order-book depth canyon.

## Decision
- **`OMEGA_VIS`** is one small helper, inlined in the Ops Room (which must work from `file://`) and shipped as `site-landing/vis.js` for the portal. It provides:
  - Fritsch–Carlson monotone cubic splines, which never overshoot the data, so a smoothed line never shows a price that did not happen.
  - A vertical glow gradient whose stops take their colour from CSS classes, so they follow the theme.
  - Glowing event dots.
  - A magnetic crosshair that snaps to the nearest data point, with a glass loupe in tabular numbers. It follows mouse and touch (`touch-action: pan-y`, so the page still scrolls).
  - Text goes in with `textContent` only.
- **Charts upgraded**:
  - BTC daily: close, SMA 20 and SMA 50 in the loupe, crossovers as green and red glow dots.
  - Live price & microprice: time, mid, microprice and skew in bps in the loupe. Glow dots mark paper fills and sweeps taken from the receipt chain inside the window.
  - High-water-mark calculator in the Ops Room, and the portal's fee calculator and locked-base simulator: fee and sweep events as dots, localized loupe labels.
  - SVG is vector, so every line is sharp at any pixel ratio.
  - The OSIRIS map and the new canvases now use devicePixelRatio up to 3 (was 2).
- **Performance rings** (Command view and the phone; quadrant 4 of the wall). All three are computed from numbers already on screen:
  - Outer, green: locked-base growth toward the target value, with the sweep count and the amount swept to the safe vault.
  - Middle, blue to purple: the court's consensus, with its running accuracy, or "no closed trade yet".
  - Inner, orange to cyan: planet stability = 100 − PWSI, or "تعذر التحقق منها" with no live source.
  - The list beside the rings gives each value in words. The card says paper and carries `[INFERENCE - Quant Model]`.
- **Whale sonar & liquidity canyon** (Radar view; quadrant 2 of the wall). A Retina canvas from the same Binance public depth the desk already loads, so there is no new host:
  - Cumulative bid depth in green to the left and ask depth in red to the right, within ±1.5% of the mid.
  - Whale walls by the existing rule (≥ 8× the median level within 2%, at least 100k USDT).
  - The crowd radar's estimated liquidation pockets as orange bands, marked `[INFERENCE]`.
  - A wall that was not in the previous book fires one 1.6 s sonar pulse, then the canvas is still again. Pulses are static under reduced motion and paused off screen.
  - A crosshair loupe reads price, cumulative depth and distance from the mid, and the same text is written to the line below the canvas.
- The service-worker shells are bumped, `vis.js` is in the NABD app shell, and it is in the Pages build allowlist.

## Consequences
- Every chart reads like Apple Stocks on mouse and touch, with exact values in tabular numbers.
- The rings and the canyon add no data source and no network request, and they show "no data" states instead of filling in numbers.
- The only new continuous motion is the one-shot sonar pulse, which ends by itself.
