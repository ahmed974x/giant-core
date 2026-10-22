# ADR-107: System self-test (12 checks), one app switcher across the three pages, cross-page sync

Date: 2026-10-22 · Status: Accepted (Ahmad's Phase 11 directive, 2026-10-22)

## Context
Ahmad asked for:
- a "Verify System (فحص المنظومة 12/12)" button and `?selftest=1`, running twelve end-to-end checks in the browser;
- one frosted-glass app switcher across NABD, the Ops Room and THE CHAIN;
- cross-page state sync.

## Decision
- **Suite script** (inline in the Ops Room and THE CHAIN, which must work from `file://`, and `site-landing/suite.js` for NABD):
  - It adds an app-grid button next to the theme toggle. The button opens a glass popover (blur(32px) saturate(190%), radius 24 = 16 + 8) with the three apps and a live line for each:
    - the paper base and safe vault;
    - PWSI;
    - THE CHAIN's last ticker.
  - Links work on GitHub Pages, on the local server and from disk.
  - Sync uses a BroadcastChannel `omega-suite`, mirrored to `localStorage` (`omega-suite-state-v1`). It carries only:
    - the theme;
    - `{base, safe}` of the paper wallet;
    - PWSI;
    - the ticker;
    - a self-test ping.
  - Each value is validated before use. A theme change on one page is applied on the others.
  - The script also counts CSP violations from the first moment.
- **Probes.** `window.OMEGA_PROBE` gives read-only hooks:
  - **vault:** a throwaway PBKDF2-SHA256 600k / AES-GCM-256 round trip that never touches the stored vault;
  - **osiris:** camera, coastline, lanes, projection round trip, PWSI;
  - **desk:** calibrate, `vpinOf`, the one sweep rule `excess(equity, base) = max(0, equity − base)`, SHA-256 (WebCrypto and pure JS), `verifyChain`, copies of receipts, wallet and court, canyon and stream state.

  None can move paper money, issue a receipt or change a setting. The sweep and VPIN code were refactored into these functions, so the test checks the code the desk runs.
- **The twelve checks**
  1. CSP posture: the directives, no unsafe sources, 0 violations, 0 inline handlers.
  2. Vault round trip.
  3. OSIRIS map: zoom range, coastline, 4 lanes, projection error.
  4. Live PWSI: a finite value from at least 1 of 4 components, naming snapshot use.
  5. Rings: three caps and gradients, title at least 16 px below the card edge.
  6. Sonar canyon: a real book of at least 20 tiers per side. The simulation does not pass.
  7. Quant physics: Hawkes α is near 0 for regular arrivals and above 0.3 for bursts; VPIN is 0 for a balanced tape and 1 for a one-sided one.
  8. Court: 3 voices, weights summing to 1, a valid ruling.
  9. Sweep math on four cases, and a paper base above 0.
  10. Receipt chain: the SHA-256 "abc" vector, an intact chain, and a tampered copy rejected.
  11. Cross-page sync: a ping delivered to a second listener.
  12. PWA readiness: http(s), manifest, an active service worker, a secure context.

  A check that needs live data fails and says why. The results show in a dialog with PASS/FAIL, the reason and the time.

## Consequences
- In the sandbox, the built site served on 127.0.0.1 with a synthetic Binance book scored 12/12 at 1440 light and 390 dark, with no page errors. Opened from disk, PWA readiness fails by design and says to use http(s).
- On the phone the header wraps the status pill onto its own row, so the three round buttons fit without horizontal scroll.
- Both service-worker caches are bumped to 2026-10-22. NABD caches `suite.js`.
