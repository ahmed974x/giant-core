# ADR-113: Four-reviewer pass over the whole site: local-model and DNS-rebinding hardening, data fixes, layout and honest copy

Date: 2026-10-23 · Status: Proposed (Ahmad's request of 2026-10-23 11:52Z: redesign and correct the whole site professionally, run a trial, review the plan with a team and pick the best fixes; merge waits for his go)

## Context
After Phase 15 (ADR-112) went live, all 23 snapshot sources answered in Pages run 39948702492. Two problems showed up in that live data:
- CIRCL pressure sat at 100, because 15 of the latest 30 records were critical.
- The Suez sea point returned no wave height.

A trial then ran the four pages (NABD Arabic and English, the Ops Room, THE CHAIN) at three sizes in light and dark. All 24 runs passed the overflow and console gate. Four read-only reviewers then looked at:
- design: screenshots plus Playwright measurements
- code correctness: reproductions with node and Playwright
- security: probes against a running proxy and a fake Ollama
- data honesty and copy: file and line checks

They reported 40 findings. This ADR records what was fixed and what was left, with reasons.

## Decision

### Security (proxy `scripts/omega-data-proxy.mjs`)
- **DNS rebinding.** Every request whose `Host` is not a known name is refused with 421. Known names are `127.0.0.1`, `localhost` and `[::1]`; under `--lan` this machine's interface addresses and `*.ts.net` (Tailscale Serve); plus anything listed in `OMEGA_ALLOWED_HOSTS`.
  - Before: `Host: rebind.attacker.test:8796` with a matching Origin got 200 and the model list.
  - After: 421.
- **Local model reachable from any website.** A sandboxed iframe sends `Origin: null`, and a `text/plain` POST needs no preflight.
  - `/llm/*` now refuses `Origin: null` and any non-loopback origin (403).
  - It requires `Content-Type: application/json` (415).
- **Local model limits.**
  - One generation at a time; the rest get 429.
  - A request body that stalls for 10 s gets 408. Before, the socket was held until Node's 300 s limit.
  - The Ollama call is aborted when the page closes the connection.
  - A non-JSON answer from Ollama is reported as such, not as "Ollama is not running".
- **Model name.** `OMEGA_OLLAMA_MODEL=glm4` now matches `glm4:latest`, which is how Ollama lists it. Before, following the proxy's own `ollama pull glm4` hint still ended in "not pulled yet".
- **MCP `verify_receipts`.** A JSON parse error no longer quotes part of the file to the model.
- **`OMEGA-PRIME.bat` no longer pulls and runs new code silently.** It fetches main, lists the incoming commits and pulls only after Y within 60 s. With no answer it keeps the copy on disk.

### Code correctness
- `shape.llamaSet` needs only the stablecoin answer. A failed chains or DEX answer becomes `null`, and the LFI renormalises over the parts it has. Before, one failing DefiLlama endpoint removed the whole index.
- `shape.llamaDex` treats a `null` total as missing, not $0.
- **CIRCL pressure recalibrated.** New value = 25 per CISA KEV record + 40 × the share of critical records among scored ones, capped at 100.
  - Why: the feed is always the latest 30 records, so the old count (10 per critical + 2 per high + 25 per KEV) measured the sample size.
  - Effect: a normal day now scores about 20, and an exploited record still adds 25.
  - Tests and the self-test fixture now expect 45 for one critical KEV record plus one high record.
- **Suez sea point.** It moves from the Gulf of Suez (29.7 N 32.6 E, no wave cell) to the Port Said approach (31.45 N 32.35 E). Not verified from the sandbox; the next Pages snapshot shows it.
- **MCP bridge CSTI** now includes CIRCL and reports `n of 8 possible parts`. It says that InfoCON, RIS Live and InternetDB are read on the page only. Before, its kill-switch could disagree with the page.
- **Ops Room**
  - The PWSI line said "CSTI from n of 7 parts"; it now uses the real part count (8).
  - The local-model button posts to the proxy that served the page, else 127.0.0.1:8796.
- **NABD receipt simulator:** each run builds its own list, so two quick edits no longer interleave into one broken chain.
  - Before: 46 receipts, "chain broken at receipt 2".
  - After: one intact chain.

### Layout and design
- **Ops Room and THE CHAIN header bar.** When it wraps (below 1280 px) it becomes a 28 px rounded rectangle instead of a stretched pill. THE CHAIN uses logical padding.
- **Ops Room oscilloscope.** At ≥ 900 px it sits in its own 264 px column beside the neural canvas, so all eight decision heads stay readable. Below that it sits under the canvas.
- **Touch targets** are 44 × 44 px under `pointer: coarse`:
  - icon buttons
  - Ops Room chips and the segmented control
  - THE CHAIN tabs
  - NABD source chips
- **Empty states end.** After 15 s with no Binance price, the signal box reads "NO DATA · Binance not reached · تعذر التحقق منها" in the danger colour, and the live chart says "No price yet". Before, both stayed "Loading…".
- **THE CHAIN Arabic text**
  - Tabs use the Arabic face with letter-spacing 0.
  - Arabic placeholders in monospace fields read right to left.
  - URL fields read left to right.
- **NABD**
  - Simulator numbers line up under their headers in both languages.
  - The Arabic receipt reason column uses the Arabic face.
  - The 4-card grid is 2 × 2, and the 5 agent cards share one row at ≥ 1200 px.
  - Status callouts use a straight bar inside the padding instead of a thick border bent by the 32 px corner.
  - `code` is never below 12 px.
  - The disabled waitlist button is a muted ghost button, not a gold CTA.
- Both service worker caches are bumped (`nabd-shell-2026-10-23-p16`, `omega-ops-shell-2026-10-23-p16`). Phase 15 had not bumped the Ops Room cache.

### Honest copy
- **NABD physics AUC table.** Its cited report (`physics_lab/results/REPORT.md`, ADR-065) is not in the repository or its history. The note now says the figures are unverified until the report is published with its run date.
- **Copy-trading card.** It no longer claims "an audited performance board from real data". The board stays empty until an audited record exists.
- **Hero and meta.** "Five AI agents that check every number" becomes "five planned agents, two of them partly working today", matching the status cards below.
- **High-water-mark example.** Labelled «مثال تعليمي — أرقام افتراضية». The missing period-3 value (11,000) is added, so "20% × 40" can be followed.
- **Waitlist.** "Opens soon" becomes "Closed until legal review".
- **Sea and sky card.**
  - The duplicated "satellites" wording is fixed, and orbits are called approximate.
  - The AISStream link (needs a key) is replaced with adsb.lol, which the Ops Room uses.
  - External links carry `noopener noreferrer`.
- **Ops Room wallet**
  - Labels say paper vault.
  - The emergency stop reads «إيقاف طارئ ورقي», with an Arabic line saying it moves only the paper base.
- **Error messages now say what to do next:**
  - the hashing failure
  - wrong-file messages in the NABD verifier
  - THE CHAIN fetch errors
  - the Ops Room futures line

### Left as is, with reasons
| Item | Why it is left |
|---|---|
| Windows-MCP `Shortcut` + `Type` can open the Run box and type a command | Ahmad approved this tool list in ADR-108. Narrowing it may break his computer-control workflow, so it is his call. The skill and this ADR name the residual risk. |
| `uvx` pins `windows-mcp` 0.8.8 but not its dependencies | A hash-locked requirements file is a follow-up for the next Windows-MCP review. |
| The "two independent ways" claim on NABD | Not checked; `services/loop/critic.py` was not read in this pass. |
| Ops Room `dir="ltr"` with Arabic second lines | A product choice, not a defect. |

## Verification (cloud sandbox, outbound data blocked)
| Check | Result |
|---|---|
| `node scripts/test-brain2.mjs` | 29 passed, with new cases for a partial DefiLlama set, null DEX totals, CIRCL pressure 45 and the Port Said marine URL |
| `node scripts/build-brain2-inline.mjs --check` | Inline copy matches |
| `node --check` on the changed scripts | Pass |
| Proxy probes against a fake Ollama | `glm4` → `glm4:latest`; JSON POST 200; `text/plain` 415; `Origin: null` 403; rebinding Host 421; `localhost` health 200; stalled body 408 |
| `scripts/ui-three-sizes.mjs` | 24 of 24: four pages × three sizes × light and dark, no overflow, no console errors |
| Ops Room self-test | 16 of 24, with fixtures exact. The 8 failures need live data (Binance book and court, Deribit, satellites and Kp, page sources, InfoCON and InternetDB, RIS and adsb, GIBS tile) |
| Playwright checks | The oscilloscope starts where the canvas ends (1139 px = 1139 px); icon buttons are 44 × 44 on a phone; two quick simulator edits give one intact 13-receipt chain |
| SkillSpector strict | 0 critical, 0 high; CSP hashes re-pinned |
| Contrast gate | Passes on the changed pages and the stylesheet |
