# OMEGA PRIME web

The four-screen app from `docs/ARCHITECTURE.md` (Phase 3 frontend): **Company**, **Market**, **Research**, **Earth**.
Arabic (RTL) is the default, English (LTR) is one tap away in the header, and the layout is built phone-first.

| Screen | Path | Data |
| --- | --- | --- |
| Company | `/ar`, `/en` | relay `/status` (service health), KPI counts |
| Market | `/…/market` | relay SSE `/events`: price pulse, anomalies, scored headlines |
| Research | `/…/research` | relay `POST /brain/ask`, then polls `/brain/jobs/:id` |
| Earth | `/…/earth` | relay `/geo/nodes` on a MapLibre 3D globe: Sentinel-2 satellite or vector map, zoom to z19, live alerts |

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
