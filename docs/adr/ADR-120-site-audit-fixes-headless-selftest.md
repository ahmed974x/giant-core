# ADR-120: Site audit after ADR-115 to ADR-119, with fixes, a headless self-test and static page checks

Date: 2026-10-24 · Status: Proposed (Ahmad's message of 2026-10-24 12:26Z, "شغل الموقع وجربه و افحصه و طور الموقع"; merge waits for his go). Based on main 4f70451, after PRs #36 to #39 merged.

## Context
Ahmad asked for the site to be run, tested, audited and improved after four phases landed in one day. The cloud sandbox has no outbound internet, so live sources cannot answer there. Pages were served from the Pages build (`node scripts/build-pages.mjs`) on 127.0.0.1 and checked in Chromium at 390×844 @3x, 1440×900 and 2560×1080, light and dark, in Arabic and English. The published site's last deploy (run 27 for 4f70451) succeeded.

## What the audit found

| # | Where | Problem | Cause |
|---|---|---|---|
| 1 | Ops Room, Arabic | Status words such as «هادئ» and «بانتظار» drew as broken letters («ها دئ», «با نتظار») | Arabic written into monospace boxes (`.num`, the island, the signal label); the monospace fallback puts each letter in a fixed cell and breaks the joins |
| 2 | Second brain, laptop and desktop | The theme grid, map colours and own-idea list had no styles with a mouse | The `@media (pointer: coarse)` block lost its closing brace, so every later rule only applied on touch screens |
| 3 | Second brain, TRADE LAB, ORACLE | Text written by page code stayed Arabic on first load in English (for example «لا أفكار بعد») | The engine fired its first `omega-lang` event inside `mount()`, before the page stored the handle in `window.OMEGA_LANG`, so the re-render still read Arabic |
| 4 | Second brain, THE CHAIN | Textarea placeholders stayed Arabic in English | The engine skipped a textarea's attributes along with its typed value |
| 5 | ORACLE | «لم يبدأ» and the intel-mode description had no English | Missing dictionary pairs |
| 6 | Ops Room self-test | "Neural flow" failed offline with "thread inspector wrong" | Before the first reading the edge's activation and w·a are both NaN, and `NaN − NaN` is not below 1e-12 |
| 7 | Ops Room | The self-test badge said 12 before a run; the self-test has 24 checks | Stale number from ADR-107 |
| 8 | Arabic-source pages | The brand and status pill kept 0.04 to 0.06 em tracking and number-column headers were monospace in Arabic; English showed the brand twice ("Second brain SECOND BRAIN") | Latin styling applied to Arabic text; Latin caption kept beside the translated brand |
| 9 | NABD calculator | The «البداية» row label was set in monospace | Same as 1 |

## Decision

### Fixes
- `scripts/lib/i18n.mjs`: `fitBox()` also gives a monospace box the Arabic face (`var(--font-ar)`) while it shows Arabic, and puts the page's own face back when the text returns to Latin. The first `omega-lang` event waits one microtask. Attributes of a textarea switch with the language; its typed value is still never touched. Inline copies are rebuilt with `node scripts/build-i18n-inline.mjs`.
- `scripts/lib/i18n/oracle.mjs`: two pairs added.
- `omega-second-brain.html`: the coarse-pointer block is closed and gains the 44 px back-link rule the other pages have.
- ORACLE, TRADE LAB, the second brain and THE CHAIN: under `:root[lang="ar"]` the brand and status pill lose their tracking and `th.n` uses the Arabic face; under `:root[lang="en"]` the brand's Latin caption is hidden.
- `site-landing/style.css`: the calculator's first column uses the Arabic face on the Arabic page.
- Ops Room: the neural check accepts an unknown w·a when the activation is unknown; the badge reads 24. THE CHAIN's ticker placeholder is `AAPL…`, which needs no translation (the field is `translate="no"`).

### New checks
- `scripts/test-pages.mjs` (no network, no dependencies, added to the skillspector workflow): brace balance of every inline `<style>` block and `style.css`; the Arabic face and tracking rules above; the self-test badge and label against the number of checks; the deferred first language event. Run against main before the fixes, it fails 8 of its tests; after them, 15 of 15 pass.
- `scripts/selftest-headless.mjs`: serves the repository on 127.0.0.1, opens `omega-ops-room.html?selftest=1` in Chromium, blocks every outside request and prints each of the 24 checks. `--mock` answers Binance public REST (depth, klines, aggTrades, 24 h tickers, futures premium index) from a deterministic synthetic market so the desk, court, PRIME, neural flow and knock-out code paths run in a sandbox without internet. The synthetic market lives only in the test process; it is never written to a page, file or the published site, and every output line says MOCK. `--min N` sets the exit gate.

## Results
- Engine tests: brain2 29/29, research 19/19, TRADE LAB 21/21, brain + i18n 17/17, pages 15/15. All inline-copy `--check` builds and `build-api-docs --check` pass.
- Self-test with outside sources blocked: 15/24 (14/24 before the fix). With `--mock`: 17/24. The seven that still fail are honest: PWSI, DefiLlama LFI, CelesTrak/NOAA/RIPEstat/IODA, X-Ray source count, CIRCL/InfoCON/InternetDB, RIS Live/adsb.lol, Open-Meteo Marine/GIBS each need the internet or the local proxy. They are checked on the laptop with `start-omega`.
- Three sizes, light and dark: all pages pass with no overflow. The Ops Room logs one 404 for `data/public-intel-snapshot.json`, which the Pages workflow fetches hourly and a local build cannot.
- Contrast gate passes on every changed page and stylesheet. SkillSpector strict: 0 critical, 0 high.

## Not changed
Real trading stays locked; no order, signing or Testnet code exists. No third-party package is added to the site; Playwright is a local test tool already used by `ui-three-sizes.mjs`.
