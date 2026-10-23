---
name: autonomous-24-selftest-gate
description: Use when adding, changing or reading the Ops Room system self-test (shield button or ?selftest=1), now 24 checks. Fixed fixtures plus live data, read-only probes, honest failures, and the release gate before a PR.
---

# The 24-check self-test and the release gate (ADR-107 to ADR-110)

The self-test runs in the browser from the shield button or with `?selftest=1`. It reads the page through the frozen, read-only `window.OMEGA_PROBE` hooks and runs pure functions on fixed input. It never moves paper money, issues a receipt, opens a trade or sends a request other than reading public data or a tile.

## 1. Rules for a check

- Each entry in `CHECKS` is `[English name, Arabic name, async () => ({ ok, why })]`, with a 20 s limit per check.
- A check has two halves: a fixture half (fixed input, exact expected answer) and, where the feature depends on data, a live half. When the live data is missing the check fails and `why` says which source and its state, with "تعذر التحقق منها". Never pass a check on a fixture alone when its name promises live data, and never relax a threshold to get green.
- `why` lists the measured numbers (counts, ratios, µs, tiers), so a reader can see why it passed.
- Motion is frozen during the run (`omega:selftest-start`); a check may assert that nothing animates.
- Update the count in the shield button's `aria-label`, the header comment and DESIGN.md §5 when the list changes.

## 2. The 24 checks

1 to 18: CSP posture, vault round trip, OSIRIS map, live PWSI, performance rings, sonar canyon, quant physics, three-agent court, $20 locked-base sweep maths, SHA-256 receipt chain, cross-page sync, PWA readiness, synaptic web, Kalman and BOCPD, order-book alpha and L2 fill, Deribit GEX and funding trap, orbits and cyber radar, the gym (ADR-107, ADR-108). 19 and 20: neural flow and oscilloscope; X-Ray, chrono-scrubber and the 20 snapshot sources (ADR-109, counted from the snapshot, not hard-coded).

ADR-110 adds:

21. InfoCON, InternetDB and the 7-part CSTI: four InfoCON levels, a two-CVE InternetDB fixture, the CSTI mean, then both sources online (proxy or snapshot).
22. RIS Live and squawk 7700: a foreign origin and a more-specific route caught by `risSummary`, a 7700 fixture decoded, then RIS Live (stream or snapshot) and adsb.lol online.
23. Cables per strait and GIBS: every strait has corridors and landings, the GIBS URLs and the CSP `img-src` match, the offline coastline is present, and one real night-lights tile loads (256 px) or the check fails honestly.
24. Continuous time and the paper base: ODE settles to the feed-forward answer, Heun is second order, shocks shorten τ, motion is frozen, the base is at least $20.00 paper with a LOCK receipt and the receipt chain verifies.

In the cloud sandbox, outbound data is blocked, so the live halves fail; that is the expected, honest result there. On the laptop with `./start-omega.sh` running, 24/24 is the target.

## 3. Release gate before a PR (AGENTS.md §6)

1. `node scripts/test-brain2.mjs` all pass, `node scripts/build-brain2-inline.mjs --check` clean.
2. `node scripts/skillspector-audit.mjs --fix <changed html>` then `--strict <changed paths>` and `--strict .`: 0 critical, 0 high.
3. `node audits/verify-contrast.mjs <changed pages>` passes.
4. `node --check` on changed scripts and on the extracted inline scripts.
5. `node scripts/ui-three-sizes.mjs` on the Ops Room (views 1, 2, 5), THE CHAIN and the two landing pages: 6 URLs × 3 sizes × 2 themes = 36 runs, no console errors, no overflow.
6. Put each command and its result in the PR body. Say plainly what was not verified (for example the live halves in the sandbox).
