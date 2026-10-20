# ADR-093: Phase 8, open maritime warnings, NASA SAT imagery, live Hawkes/VPIN fit, self-learning court, encrypted capsule, command wall and one-click launcher

Date: 2026-10-20 · Status: Accepted (Ahmad asked for this phase and for its merge in the project thread on 2026-10-20)

## Context
PR #23 (ADR-092) left five limits on screen: the straits showed "تعذر التحقق منها", SAT was a colour style, Hawkes and VPIN used fixed constants, view 5 stacked every card vertically, and the project needed several manual steps to run on the laptop. Ahmad asked to merge PR #23, then close those limits with free and open sources and add four things: a court that learns from each closed paper trade, an on-chain fee and whale radar, an encrypted capsule to move the paper desk between laptop and iPhone with no server, and a one-click launcher.

Standing rules that apply: paper only, with no code that signs or sends an order to any exchange (Ahmad, 2026-10-19); free and keyless sources; no secret in plain text; the Profit Sweeper stays proposal-only for real money.

## Decision

**1. Maritime intelligence** (`scripts/omega-data-proxy.mjs`, OSIRIS)
- New proxy route `/osiris/nga`: NGA Maritime Safety Information broadcast warnings (`https://msi.nga.mil/api/publications/broadcast-warn?output=json`, keyless). The proxy keeps active warnings (`status` "A") and sorts each one into Hormuz, Bab el-Mandeb, Suez, Malacca or Panama. A warning matches a strait when a position in its text (NGA's `DD-MM.mmN DDD-MM.mmE` form) falls inside the strait's box, or when its text names the strait or its approaches. The response keeps the warning number (`NAVAREA area number/year`), the issue date, the issuing authority and the first 400 characters.
- New route `/osiris/gdelt-sea`: GDELT DOC 2.0 headlines from the last 24 h that name one of the five straits.
- OSIRIS adds Panama as the fifth chokepoint, a "Five straits" table (warning count, latest number and issue date, headline count), a list of the warnings, red diamonds on straits with active warnings, and a fourth PWSI component ("Strait warnings": `8 × warnings + 6 × straits with a warning`, capped at 100).
- Digitraffic AIS stays the ship-position source. It covers the Baltic only, and the page says that no free source has live ship counts in the five straits. The straits show official warnings and headlines, not ship counts.
- With the proxy off, each strait still reads "تعذر التحقق منها".

**2. SAT imagery**
- SAT draws NASA GIBS Blue Marble Next Generation. Choice: the EPSG:4326 "500m" tile set instead of the EPSG:3857 GoogleMapsCompatible URL in the brief. Its level 0 is two 512 px tiles of 180° each, which is exactly the plate carrée the 2D view already uses, so no Mercator conversion is needed. Same host, same imagery.
- 2D scales the 1024 × 512 texture into the map rectangle. 3D resamples it per pixel through the inverse orthographic projection into an off-screen canvas of at most 512 px, cached until the view rotates or resizes.
- The tiles load with `crossOrigin="anonymous"`. Without CORS on the tiles, 2D still shows the imagery and 3D falls back.
- Offline fallback: until both tiles load, or when they fail, SAT keeps the procedural colours. The data core lists "NASA GIBS Blue Marble (SAT)" as STANDBY, CHECKING, LIVE or OFFLINE.
- CSP: `img-src` adds `https://gibs.earthdata.nasa.gov`.

**3. Live Hawkes and VPIN calibration** (desk script)
- A ring buffer holds the last 300 Binance aggTrades, deduplicated by trade id, refreshed every 10 s.
- Hawkes, exponential kernel `λ(t) = μ + Σ αβe^(−β(t−tᵢ))`, method of moments on the window:
  - `λ̄` = 1 / mean inter-arrival time;
  - counts in 30 equal bins give the Fano factor `F`; for a stationary Hawkes process `F → 1/(1−α)²`, so `α = 1 − 1/√F`, clamped to 0…0.95;
  - the lag-1 autocorrelation `ρ₁` of the counts decays as `e^(−β(1−α)Δ)`, so `β = −ln ρ₁ / ((1−α)Δ)`, with `ρ₁` clamped to 0.01…0.99 (the table marks β with ≈ when it sits on the clamp);
  - `μ = λ̄(1−α)`.
  - Intensity is shown as a multiple of `λ̄`.
- VPIN uses a bucket size of 1/50 of the window's traded volume.
- The table shows μ, α, β, the Fano factor, ρ₁, the CV of the gaps, the bucket size and the bucket count in tabular numbers.

**4. Command wall**
- On view 5 at ≥ 1280 px, `main` gets `.walled`. A `.wall` grid (`1.15fr 1fr` × `1fr 1fr`, gap 12px, `height: calc(100dvh − header − 12px)`, `overflow: hidden`) receives the existing cards:
  - Q1: OSIRIS with PWSI;
  - Q2: a new live mid and microprice chart with the largest walls, the BTC chart, whales, trapped traders and FOMO;
  - Q3: signal cockpit (court, learning, flow physics, levels) and the 10-year matcher;
  - Q4: wallet, circuit breaker, receipts and the capsule.
- Cards are moved, not cloned. A comment marker keeps each card's place, and the cards go back on any other view or width, so ids and listeners never change.
- The header height is measured into `--header-h`.
- Each quadrant scrolls on its own and has a maximize button (`aria-pressed`). Esc restores.

**5. Self-learning court**
- At entry the three voices give P(up):
  - bull `0.5 + 0.5·best`;
  - red-team bear `0.5 − 0.5·max(|worst|, 0.25·risks)`;
  - OSIRIS `0.5 − (PWSI − 40)/120`, or 0.5 when PWSI is unverified.
- They are stored on the paper position.
- On full close (target, stop, by hand or emergency stop), `y = 1` if proceeds after fees beat the cost. Each weight becomes `w·(1 − η(p − y)²)` with η = 0.05, then the weights are normalised (multiplicative weights with the Brier loss).
- The judge needs the weighted P(up) above 50 % to OPEN.
- The display shows each voice's weight and hit rate, the Court Accuracy Score (hits of the weighted call over closed trades) and the rule.
- State is stored in `omega-court-learning-v1`.

**6. mempool.space**
- `https://mempool.space/api/v1/fees/recommended`, `/api/mempool` and `/api/mempool/recent`, keyless, with CORS, every 60 s. `connect-src` adds the host.
- The whale card shows fees, the backlog and any of the last 10 transactions of 100 BTC or more.
- A fastest fee of 100 sat/vB or more is added to the red-team bear's risks. `[INFERENCE]`.

**7. Encrypted capsule and keys**
- Export writes `omega-YYYY-MM-DD.omega-capsule.json`. It is `{format "omega-capsule-v1", created, kdf PBKDF2-SHA256, iter 600000, cipher AES-GCM-256, salt, iv, ct, fingerprint, contents}`. The plaintext holds the paper wallet, the receipt chain, the court weights and every `omega-notes*` key from THE CHAIN. The fingerprint is SHA-256 of the ciphertext.
- Import, step by step:
  - checks the format and the fingerprint;
  - decrypts with the passphrase (12 or more characters);
  - checks the wallet fields;
  - re-verifies the whole receipt chain;
  - asks before it replaces the paper wallet, receipts, weights and notes;
  - reloads.
- A wrong passphrase or a changed file changes nothing. No vault entry or API key is ever put in a capsule. There is no server: the file moves however the person likes (AirDrop, cable, USB).
- Keys `1`–`5` switch views, `K` runs the emergency stop and `S` sweeps the paper profit above the locked base now, with a receipt. `S` also has a "Sweep profit now" button. Keys use physical key codes, so an Arabic layout works, and they are ignored inside inputs, selects, text areas and editable content.
- Interpretation: `S` acts on the paper ledger only. A real-money sweep stays a Director 00 proposal.

**8. One-click launcher**
- `start-omega.sh` (macOS, Linux) and `start-omega.bat` (Windows) check for Node 18+, start the proxy and open the Ops Room.
- The proxy now:
  - serves `omega-ops-room-v1/` and `site-landing/` as static files (fixed folders and types, no dotfiles, path-traversal checked, `/` redirects to the Ops Room);
  - adds `/market/binance/<SYM>` and `/market/coingecko/<id>` pass-through routes;
  - prints a LIVE / DOWN / SKIP table for SEC EDGAR, GDELT, OpenSky, NGA, Digitraffic, GDACS, Binance, CoinGecko, mempool.space, NASA GIBS, USGS and Open-Meteo.
- `--check` prints the table and exits.
- It still binds to `127.0.0.1` only, and still sends CORS only to local pages.

**Also fixed**
- The 10-year analogue vote returned NaN when no historical day had positive similarity (0/0). It now abstains (score 0). The meter no longer gets a NaN position.

## Consequences
- Every new source is free and keyless. Nothing new can sign or send an order, and the desk has no exchange client.
- The page still opens from `file://`. The proxy-backed layers show OFFLINE there until the proxy runs.
- Live upstream behaviour (the NGA JSON field names, GIBS CORS, mempool.space limits) could not be tested from the cloud sandbox, which blocks outbound data. All of it was tested with mocked feeds in Playwright and needs one run of `start-omega` on the laptop. The parsers accept the documented NGA shape (`broadcast-warn` array with `navArea`, `msgNumber`, `msgYear`, `issueDate`, `status`, `text`) and skip anything else.
