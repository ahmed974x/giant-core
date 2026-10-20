# ADR-097: Installable app and offline shell (PWA) for the Ops Room, THE CHAIN and NABD

Date: 2026-10-20 · Status: Accepted (Ahmad's Phase 8 directive, 2026-10-20)

## Context
Ahmad asked for `service-worker.js` and `manifest.json` with high-resolution icons, so the site installs as its own app on the Windows desktop and on the iPhone home screen. ADR-092 linked a manifest for the Ops Room but had no service worker. NABD had neither.

## Decision
1. **One app per folder.** The pages live in `omega-ops-room-v1/` and `site-landing/`, and that is how the local server (ADR-094) and the public site (ADR-098) serve them. Each folder gets its own `manifest.json` and `service-worker.js` with `scope: "./"`. There is no manifest at the repository root, because the root is never a web root. The Ops Room manifest moves from `manifest.webmanifest` to `manifest.json`.
2. **Manifests.**
   - Ops Room: `id`, `start_url` view 1, standalone display, a maskable 512 px icon next to the 180/192/512 icons, and shortcuts to Command, OSIRIS, the command wall and THE CHAIN.
   - NABD: Arabic and RTL, the pulse SVG icon plus PNG 180/192/512 and a maskable 512, and a shortcut to the English page.
   - The icons are drawn as SVG and rendered to PNG by Chromium. There are no third-party assets.
3. **Service workers.**
   - They cache only the app shell listed in the file: the pages, the manifest and the icons (NABD adds its style, scripts and fonts).
   - Pages are network-first, so a new version shows when the server has it. The cache is used only when the network fails.
   - Only same-origin GET requests inside the scope are touched. Proxy data routes (`/osiris`, `/market`, `/sec`, `/stooq`) are outside the scope, and other origins pass through. Offline, a live layer still says OFFLINE instead of showing old numbers.
   - Old cache versions are deleted on activate.
4. **Registration** only on http(s) in a secure context: 127.0.0.1, or HTTPS through Tailscale or the public site. From `file://` the pages work as before without install. NABD registers from a new same-origin `pwa.js`. The Ops Room and THE CHAIN register from their existing inline shell scripts, with hashes re-pinned.
5. **iPhone.** Apple web-app meta tags and a 180 px `apple-touch-icon` on every page. iOS installs from Safari's Share → "Add to Home Screen".
6. **CSP.** `manifest-src 'self'` and `worker-src 'self'` on every page, plus `img-src 'self'` on THE CHAIN for its icon.

## Consequences
- Verified in Chromium through the local server for all four pages:
  - the service worker controls the page;
  - the caches hold 7 Ops Room and 15 NABD files;
  - `Page.getAppManifest` reports no errors, and `Page.getInstallabilityErrors` returns an empty list;
  - with the network off, a reload still opens each page.
- Installing on the laptop and the iPhone are clicks only the person can make. They are listed in the PR as laptop steps.
