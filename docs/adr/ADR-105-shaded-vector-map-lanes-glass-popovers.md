# ADR-105: Shaded vector map with lit shipping lanes, and glass popovers with sparklines

Date: 2026-10-22 · Status: Accepted (Ahmad's Phase 10 directive, 2026-10-22)

## Context
With tiles blocked or offline, OSIRIS drew flat land on a flat ocean. Ahmad asked for:
- an Apple Maps style shaded fallback, navy #0A192F by night and ceramic #E5EFF7 by day;
- lit maritime corridors through Hormuz, Bab el-Mandeb, Suez, Malacca and Panama;
- visionOS-style popovers: blur(30px) saturate(190%), a 0.5 px specular edge and SVG sparklines.

He also asked to remove "TEST z/x/y" tiles. Those tiles were never in the product. They came from the Playwright harness, which serves test-pattern tiles because the sandbox has no internet. Nothing in the page draws them.

## Decision
- **Vector base** (`vectorBase()`), drawn under every frame so tiles paint over it:
  - water is a radial wash from `--os-vec-ocean-hi` to `--os-vec-ocean` (ceramic / navy);
  - land (`--os-vec-land`) is lifted with a tinted shadow and a hairline coast;
  - the globe gets limb darkening.
  - The shadows are skipped while the camera moves, so dragging stays smooth on a phone.
  - The new tokens have light and dark values and are marks, not text.
- **Lanes**
  - Four reference routes through the five chokepoints:
    - Gulf to Hormuz to Bab el-Mandeb;
    - Red Sea to Suez to Gibraltar;
    - Arabian Sea to Malacca to the South China Sea;
    - the Panama transit.
  - Each leg is cut into 1° steps so it follows the globe's curve.
  - Each route is drawn as a soft glow and a bright core (`--os-lane`, `--os-lane-glow`) under the sea layer's points.
  - The attribution line says "Lanes: reference routes, approximate". They are geography, not live traffic.
- **Popover**
  - `.os-call` uses `--glass` with blur(30px) saturate(190%) where backdrop-filter is supported, over the opaque `--surface` fallback.
  - It has a 0.5 px border and a 0.5 px inset specular line (`--specular`).
  - A 296×48 SVG sparkline (`OMEGA_VIS` spline, area and glow) shows real readings only:
    - Quakes: the day's M2.5+ magnitudes, with this event marked (USGS).
    - Weather hubs: the next 24 hourly gusts (Open-Meteo forecast, ADR-104).
    - Straits, GDACS alerts and bookmarks: this session's PWSI line, marked `[INFERENCE]`.
  - With fewer than two readings the sparkline is hidden.

## Consequences
- The map looks finished with no network: shaded land, lit lanes and every live or snapshot point.
- DESIGN.md records the 30 px blur for these popovers next to the 32 px chrome glass.
- Verified offline in the sandbox: globe, Gulf, Suez, 11.6x wheel zoom, z15 street level and the flat map, light and dark, with no page errors. The Hormuz popover showed its NGA row and PWSI sparkline from the snapshot.
