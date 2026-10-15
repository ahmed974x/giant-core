# OMEGA PRIME web

The four-screen app from `docs/ARCHITECTURE.md` (Phase 3 frontend): **Company**, **Market**, **Research**, **Earth**.
Arabic (RTL) is the default, English (LTR) is one tap away in the header, and the layout is built phone-first.

| Screen | Path | Data |
| --- | --- | --- |
| Company | `/ar`, `/en` | relay `/status` (service health), KPI counts |
| Market | `/…/market` | relay SSE `/events`: price pulse, anomalies, scored headlines |
| Research | `/…/research` | relay `POST /brain/ask`, then polls `/brain/jobs/:id` |
| Earth | `/…/earth` | 3D globe (spin, day/night, 3D buildings, terrain), flight trails, ship radar, public webcams with a left sidebar, phone AR mode, my-location dot |

When the relay is offline every screen still renders, using clearly labelled demo data.

## Run

```bash
cd web
npm install
npm run build
npm start            # http://127.0.0.1:3100 (about 110 MB RAM)
```

`npm run dev` for hot reload (heavier, around 500 MB). Set `RELAY_URL` if the relay is not on `http://127.0.0.1:8088`
(see `.env.example`), and `OMEGA_TZ` to change the display time zone (default `Asia/Qatar`).

## How it is wired

- **Next.js 16 App Router + next-intl 4.** Locale routing lives in `src/proxy.ts`; strings are in `messages/{ar,en}.json`.
  The next-intl Next plugin is not used: it loads `@swc/core`'s native addon, which this laptop's application-control
  policy blocks. `next.config.ts` sets the one alias the plugin would have added.
- **One relay proxy.** The browser only talks to `/relay/*` on this app (`src/app/relay/[...path]/route.ts`), which
  forwards an allow-list of relay paths server-side. No relay URL or token reaches the client.
- **Tailwind CSS 4** with logical properties (`ms-`, `text-start`), so RTL/LTR mirror without separate styles.
  Fonts (Cairo, Inter) are self-hosted at build time by `next/font`.
- **MapLibre GL 6** is loaded only on the Earth screen. Its worker file is copied to `public/maplibre/` by
  `scripts/copy-maplibre-worker.mjs` (runs before `dev` and `build`). Arabic labels are shaped by MapLibre itself.
- **PWA:** `manifest.webmanifest` and an SVG icon, so the app can be added to the phone's home screen.

## Next steps

- Serve it behind the relay (or Caddy) so the phone can reach it over the LAN or a tunnel.
- Screen 2 charts (Lightweight Charts) and the correlation heatmap once Phase 2 data lands.
- deck.gl vessel layer on Earth when `maritime-agent` publishes positions.

## Map imagery

- **Satellite:** Sentinel-2 cloudless 2024 by EOX (10 m per pixel, native to zoom 14; deeper zoom enlarges those pixels, so the vector labels and roads carry the detail there).
  Licence CC BY-NC-SA 4.0: fine for this personal, non-commercial platform; swap the tile URL in
  `src/components/EarthMap.tsx` before any commercial use.
- **Map:** OpenFreeMap vector tiles (OSM data), sharp at every zoom.
- The map renders at 2x to 3x pixel density, so labels and coastlines stay crisp when zoomed in.

## Live radar layers (Earth screen)

| Layer | Source | Key | Notes |
| --- | --- | --- | --- |
| Flights | [adsb.lol](https://adsb.lol) community ADS-B, open data (ODbL) | none | `/api/flights`, cached 10 s, polled every 15 s. Military aircraft and owners who opted out (LADD/PIA) are dropped server-side (ADR 006). |
| Ships | [aisstream.io](https://aisstream.io) live AIS | free, `AISSTREAM_API_KEY` | One WebSocket per server, subscribed only to the five watched choke-points, capped at 4,000 vessels. |
| Webcams | [Windy Webcams API](https://api.windy.com/webcams) | free, `WINDY_WEBCAMS_KEY` | Only cameras their owners publish (weather, ports, beaches, skylines). No CCTV or private feeds (ADR 006). |
| 3D terrain | Mapzen Terrarium on [AWS Open Data](https://registry.opendata.aws/terrain-tiles/) | none | Real elevation with hillshade; toggle with the 3D button. |
| My location | the browser's own Geolocation API | none | Asks permission, stays in the browser, never sent to a server. Needs `localhost` or HTTPS. |

Put keys in `web/.env.local` (git-ignored) and restart `npm start`. Without a key the layer shows "needs free key".

## Globe engine research (2026-10-09)

| Engine | Licence | Package size | Verdict |
| --- | --- | --- | --- |
| **MapLibre GL JS 6** (current) | BSD-3 | ~28 MB unpacked, lazy-loaded | Kept: globe, 3D terrain, sky, SDF icons and Arabic shaping in one light engine. |
| [AntV L7](https://github.com/antvis/L7) (Alibaba, China) | MIT | ~1.5 MB | Strong for large point/flow/heatmap layers. Candidate to add on top of MapLibre for AIS density heatmaps if needed. |
| [CesiumJS](https://github.com/CesiumGS/cesium) | Apache-2.0 | ~80 MB unpacked | Best true-3D (photogrammetry, 3D Tiles), but several times heavier; too much for this 7 GB laptop today. |
| [deck.gl](https://github.com/visgl/deck.gl) | MIT | — | GPU layers for 100k+ moving points; add when the AIS feed outgrows symbol layers. |

## Augmented globe (Earth screen)

- **Left sidebar** with tabs for Cameras (thumbnail grid and a large live preview), Flights, Ships, Nodes and Alerts.
  Tapping any row flies the globe there. It stays on the physical left in Arabic and English.
- **Day/night:** the night half of the planet is shaded from the real sun position, updated every minute (`src/lib/sun.ts`).
- **3D buildings:** OpenStreetMap building heights extruded from zoom 14 (`buildings-3d` layer).
- **Flight trails:** each aircraft keeps its last 14 fixes as a fading line.
- **Spin:** slow cinematic rotation while zoomed out, throttled to about 12 fps and paused while you touch the map.
- **AR mode (phones):** the phone's compass turns the globe and its tilt sets the camera pitch (DeviceOrientation API;
  iOS asks permission). Needs HTTPS or localhost.
- **Shareable views:** the camera lives in the URL hash (`#zoom/lat/lon/bearing/pitch`), e.g.
  `/en/earth#15.6/25.1972/55.2744/30/62` opens downtown Dubai in 3D.
- **Light on the laptop:** 2x render scale, terrain only from zoom 4, and a clear message instead of a blank box if the
  browser loses WebGL2.
