# ADR-131: the whole OMEGA design in one file

Date: 2026-10-30 · Status: Proposed. Ahmad's message of 2026-10-30 20:44Z, «ابي عطني التصميم كامل جاهز لنسخ ابي كامل بملف وحد جاهز لنسخ بطوره», asked for the complete design as one copy-ready file. The merge waits for his go.

## Context
The suite is ten pages: NABD (Arabic and English, with a stylesheet, fonts and six scripts beside them) and eight self-contained pages under `omega-ops-room-v1/`. Moving, sending or copying them means moving two folders with the right layout. Ahmad wants one file he can copy anywhere and open with a double-click, without losing any page, rule or look.

## Decision
1. **Builder.** `node scripts/build-single-file.mjs [out.html]` writes `_site/OMEGA-PRIME-ALL-IN-ONE.html` by default (about 4.1 MB, not committed; `_site/` is ignored). `--check` fails when the file on disk is out of date. Node standard library only; no child process and no network.
2. **Pages unchanged.** Each page is stored as inert text in a `<script type="text/plain">` block. The only changes:
   - `</script` and `<!--` are written as `<#OMEGA#/script` and `<#OMEGA#!--` so the block cannot close early; the launcher turns them back before use. The build fails if a page already holds the marker.
   - NABD's `style.css` (fonts as data URIs) and scripts are inlined and its CSP is re-pinned. `pwa.js` is left out: a service worker cannot run inside the bundle.
   - One short shim after each page's CSP meta, pinned in that CSP, wraps `history.replaceState` / `pushState`. Inside the bundle a page's address is `about:srcdoc`, where the Ops Room's `?view=N` rewrite throws and stopped view switching; the shim retries with the fragment only, then gives up quietly.
3. **Launcher.** One glass bar (brand, a scrolling rail of the ten pages, copy code, download page, the light / dark / gold look switch, ع / EN) and a home view with a decorative SVG map of the suite (no text inside), one card per page and three notes: paper only (real trading, copy-trading and profit split «قيد الموافقة»), live data (needs the laptop proxy, otherwise «تعذر التحقق منها») and security. The first visit opens in the dark gold peak (ADR-127); after that the stored choice, shared with every page through `omega-theme`, `omega-tone` and the suite state.
4. **Opening a page.** A page opens in an `<iframe srcdoc>`, which shares the launcher's origin (so the suite's storage and BroadcastChannel sync keep working) and inherits the launcher's CSP. The launcher's CSP is therefore the union of every page's CSP plus its own two hashes and the data blocks' hashes; each page's own CSP still applies on top, so no page gains a host. Links between the pages (clicks and `location.href`, through the Navigation API) are caught and opened in the launcher; `?view=N` clicks the Ops Room view button and `#id` scrolls to it.
5. **Copy-ready.** Each card and the bar can copy a page's original HTML to the clipboard or download it under its own file name.

## Consequences
- Paper only, as before: the pages are the files on main, and the launcher adds no host, no order path and no key.
- A service worker and PWA install are not available inside the bundle; the GitHub Pages site keeps them.
- The bundle is rebuilt from main whenever a page changes; it is a delivery file, not a second source.

## Checks
`node --check scripts/build-single-file.mjs`; `node scripts/build-single-file.mjs --check`; `node scripts/skillspector-audit.mjs --strict scripts/build-single-file.mjs` (0 critical, 0 high); the launcher's stylesheet through `audits/verify-contrast.mjs` (all six modes pass); `ALLOW_NET_ERRORS=1 node scripts/ui-three-sizes.mjs file://…/OMEGA-PRIME-ALL-IN-ONE.html` (nine of nine pass); a Playwright run that opens all ten pages from `file://` with no page error and no CSP violation, switches the Ops Room view, follows a page link and a `location.href` change, and syncs the look into an open page.
