# ADR-100: OSIRIS deep zoom 1–18, keyless map tiles, fly-to bookmarks and point callouts

Date: 2026-10-21 · Status: Accepted (Ahmad's Phase 9 directive, 2026-10-21)

## Context
The OSIRIS map (ADR-092, ADR-093) drew a fixed-size orthographic globe or a fixed plate carrée, with drag-to-rotate only. There was no zoom, so straits, ports and cities could not be inspected, and SAT was a single 1024 px NASA Blue Marble texture. Ahmad asked for Apple Maps style navigation from the whole planet down to ports and streets, real keyless tiles in DAY / MAP / SAT, one-click flights to the strategic areas and a callout for every point.

## Decision
- **One camera** `{lat, lon, z}`; `z` is the standard web-map zoom level (world = 256·2^z CSS px), 1 to 18. The 3D globe (orthographic, radius = world / 2π, so both views share one scale) is drawn up to z 6 and hands over to the flat Web Mercator map above it ("Auto 2D"); 2D can be chosen at any zoom. The camera is kept in `localStorage` (`omega-osiris-cam`).
- **Input**: wheel with exponential easing anchored under the cursor (trackpad pinch through `ctrlKey`), drag to pan or rotate with release inertia, two-finger pinch with a moving anchor, double-click +1 (Shift −1), and keys on the focused map (arrows, + / −, 0 reset, Enter opens the centre point). Motion is off under `prefers-reduced-motion`: flights jump and there is no inertia.
- **Camera panel** (glass, right edge): +, a vertical 1–18 slider with its label, the zoom read-out, −, 3D / 2D and Reset.
- **Tiles**, keyless, each with the credit its provider requires on the map:
  - DAY: CARTO Voyager `@2x` (`© OpenStreetMap contributors © CARTO`), falling back to OpenStreetMap standard tiles (`© OpenStreetMap contributors`, sent with a `strict-origin` referrer as the OSM tile policy asks).
  - MAP: CARTO Dark Matter `@2x`.
  - SAT: Esri World Imagery (`Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community`), and NASA GIBS Blue Marble as the globe and low-zoom fallback.
  - Tile level = round(log2(world · devicePixelRatio / tile size)), capped at each provider's maximum, so tiles stay sharp on Retina. A missing tile borrows its nearest loaded ancestor. The cache holds 320 tiles, with at most 12 loading at once. A provider is skipped after six failures with no success, and its row in the data core turns OFFLINE.
  - The globe resamples each visible pixel from the same Mercator tiles at a level matched to its size (half resolution while moving). This needs CORS on the tiles; without it the globe keeps the vector map.
- **Offline vector map**: Natural Earth 1:50m land (public domain, via world-atlas 2.0.2, ISC), simplified to 0.03° and embedded as 80 KB of varint deltas. It is drawn under every frame, so with no internet (CI, the cloud sandbox, a blocked host) the map still shows land, an adaptive graticule and every live point. "Tiles offline · vector map" says so on the map.
- **Fly-to bookmarks**: planet, Kuwait / Gulf / Hormuz, Bab el-Mandeb / Red Sea, Suez Canal, Wall Street NYC, Strait of Malacca and Taiwan. A flight eases with `cubic-bezier(0.32, 0.72, 0, 1)` (`--ease-apple-fluid`) and zooms out by an amount that grows with distance, then in.
- **Callouts**: a tap on any quake, GDACS alert, strait, weather hub, port, aircraft (z > 5) or vessel (z > 9) flies to it and opens a glass callout. It shows the raw numbers, a rule-based reading for the desk marked `[INFERENCE]` and "decision aid for paper trading only", and a link to the raw source (USGS event page, GDACS report, NGA MSI warnings, Open-Meteo, Digitraffic, OpenSky). Bookmarks for places with no live layer (Wall Street, Taiwan) say that in plain words instead of inventing a number.
- **CSP**: `img-src` adds `https://basemaps.cartocdn.com https://server.arcgisonline.com https://tile.openstreetmap.org` (GIBS was already allowed). Tiles are images, so `connect-src` stays unchanged.

## Terms of use (checked from what the providers publish; the cloud sandbox cannot reach them, so the live pages were not re-read today)
- CARTO basemaps are free for non-commercial use with the credit shown. Commercial use needs a CARTO licence.
- OpenStreetMap tiles are a donated service: light use only, the credit is required, no bulk downloads. Here they are only the DAY fallback.
- Esri World Imagery: Esri ties basemap use to an ArcGIS account, and the credit is required. This page uses the public tile endpoint for personal, non-commercial viewing. If the public site grows or turns commercial, switch SAT to NASA GIBS only or register a free ArcGIS Location Platform key. That is Ahmad's decision.
- NASA GIBS imagery is open with attribution. Natural Earth is public domain.

## Consequences
- The map now goes from the planet down to street and berth level, using real imagery wherever the network allows it. CI and offline use get the embedded vector map, so no check depends on the network.
- The Ops Room grows by about 80 KB of coastline data. Tiles load only while the map is on screen and are bounded by the cache.
- Every point on the map is still clickable to its raw evidence, now with a callout in place.
