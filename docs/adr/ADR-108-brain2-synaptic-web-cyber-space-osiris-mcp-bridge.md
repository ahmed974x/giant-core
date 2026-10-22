# ADR-108: Brain 2 synaptic web, institutional maths, cyber and space OSIRIS, L2 paper fills, 18-check self-test, omega-local-mcp and laptop control

Date: 2026-10-22 · Status: Accepted (Ahmad's Phase 12 directive, 2026-10-22; merge approval covers PR #29 only)

## Context
Ahmad asked for Phase 12 in one message with three overlapping directives and pasted blueprints:
- a "Brain 2" spiderweb in the Ops Room that shows how every input feeds the desk;
- more OSIRIS layers: satellites, NASA EONET, NOAA space weather, CISA KEV, RIPEstat, IODA and submarine cables, with a cyber and space index that feeds PWSI and the judge's kill switch;
- institutional maths: Kalman, BOCPD, Kyle's lambda with iceberg detection, book entropy, Deribit gamma, DVOL, 25-delta risk reversal, funding and basis;
- a fast Web Worker "gym", a 25-level L2 fill engine and receipts that record both;
- self-test 18/18, five project skills, a local MCP bridge, Windows-MCP for laptop control and an updated one-click launcher.

Limits kept:
- Paper only (ADR-091, ADR-092). Nothing signs or sends an order, including to Testnet.
- Passive, keyless public sources only. The blueprints' search-engine dorking with a spoofed user agent, ZMap/Masscan/Sn1per scanning and the "unconstrained" framing were not built.
- TeleGeography cable data is sold under licence, so it was not vendored.
- Skills are our own text. No third-party scripts.

## Decision

### One maths library
`scripts/lib/brain2-math.mjs` (`OMEGA_MATH`) holds every model and every source shape. The proxy, the hourly snapshot, the MCP bridge and the Ops Room all use it. `scripts/build-brain2-inline.mjs` copies it into the page between generated markers, because the page must work from `file://`. `--check` fails when the copies differ, and `scripts/test-brain2.mjs` runs 14 Node tests (CI: skillspector workflow).

The models:
- **Kalman latent price.** A local-level model with q and r fitted by the method of moments.
- **BOCPD.** Adams & MacKay, with a Normal-Gamma prior, Student-t predictive and hazard 1/100.
- **Kyle's λ.** OLS of price change on signed volume in 5 s buckets.
- **Iceberg candidates.** Traded size of at least 2× the size still shown at that price within 60 s.
- **Book entropy.** Normalised Shannon entropy of the top 25 levels.
- **L2 fill.** VWAP across up to 25 levels, with slippage, impact, taker fee, and maker queue position and fill rate from the tape.
- **Options.** Black-Scholes gamma and naive dealer GEX (dealers assumed long calls and short puts), with the flip found by grid search, call and put walls, ATM IV, 25-delta risk reversal and DVOL.
- **Funding and basis trap.** Crowded longs when funding is at least 0.03% and basis at least 5 bps; crowded shorts when funding is at most −0.02%.
- **Orbits.** Two-body motion with J2 drift and GMST, labelled "not SGP4".
- **CSTI and receipts.** The CSTI formula, plus the receipt canonical form.

### Brain 2 synaptic web (`#brain2`, views 1 and 5)
- **Layout.** A canvas with:
  - an outer ring of 10 sensory nodes: BGP/IODA, Cables, Orbits/Kp, Straits, Quakes, Weather, Aviation, GDELT, Mempool, SEC;
  - a middle ring of 8 quant nodes: Microprice, Hawkes λ, VPIN, Kalman, BOCPD, Kyle λ/Ice, GEX/DVOL, Funding;
  - an inner ring of 6 agents: Bull, Bear, Judge, Researcher, Modeler, Auditor;
  - the vault at the core.
- **Edges and nodes.** There are 50 edges, each a link the desk uses. A node is filled when its source is live; its arc is a 0–1 reading from numbers already on the page.
- **Pulses.** These fire only on discrete events: a microprice move of 0.5 bps or more, a new whale wall or iceberg, a data pull, a gym burst, or hover or tap. At most one fires per second. Under reduced motion they become highlights.
- **Phones.** On a phone the web becomes an upright ellipse with labels above and below their nodes. Labels are placed after all nodes, at the first spot that covers no node or earlier label.
- **Causal card.** A glass card shows what a node reads, its source and time, and what it feeds. An "All 25 nodes" list carries the same content as text.
- **Tables.** These show the institutional readings, options gamma and funding, and the gym.
- **Gym.** A Blob Web Worker trains six rule agents with contextual EXP3 (γ 0.07) and multiplicative weights with fixed share (η 0.01, α 0.001) on Float64Array buffers.
  - Returns are bootstrapped from cached real Binance daily returns, with synthetic stress segments: flash crash, whale spoof, cable cut, cyber attack and strait closure.
  - Each stress regime is scored only inside its shock window.
  - It runs in bursts of 1.5 s every 60 s, and weights persist in `localStorage`.
  - The panel shows ticks per second measured on the visitor's machine.
  - The weights inform the web only and never open a trade.
- **Probe.** `window.OMEGA_BRAIN2` exposes read-only hooks: `receipt`, `nodes`, `edges`, `inspect`, `bench`, `gym`, `derivs` and `readings`.

### Desk
- **Opening a paper trade.** Opens are walked over 25 levels of the book. An order that 25 levels cannot fill is refused. A close may walk the whole book, and the receipt flags `beyond_25`.
- **What each receipt records.** Before hashing, each receipt records:
  - `exec`: engine `l2-vwap-25`, levels, vwap, slippage and impact in bps, the taker fee, the maker queue, `perp_funding_8h` and `funding_charged: 0` (spot pays no funding; the perpetual rate is kept for reference);
  - `brain2`: Kalman, BOCPD and the web state.
- **Kill switch.** The risk judge treats CSTI at or above the PWSI limit as a hard stop.

### OSIRIS
- **New sources.** Each goes through the proxy, then a direct fetch where the host allows CORS, then the snapshot:
  - CelesTrak GP (stations and the 100 brightest objects; a 2-hour cache, as CelesTrak asks);
  - NASA EONET;
  - NOAA SWPC Kp;
  - RIPEstat routing status for five tier-1 backbones (`sourceapp=omega-giant-core`);
  - CISA KEV and IODA (these two have no browser CORS, so proxy and snapshot only);
  - Deribit option summary and DVOL;
  - Binance premiumIndex.
- **Map layers.** Two new layers: orbit (satellites and the ISS ground track) and cables (8 hand-drawn approximate corridors and 21 landing sites, labelled approximate). The map redraws every 30 s while the orbit layer is on.
- **CSTI.** CSTI is the mean of the parts that have data: space (Kp), KEV (additions in 7 days, ransomware-linked counted extra), BGP (lowest backbone visibility) and IODA (country outages in 24 h). It is shown with its parts and becomes PWSI's fifth component. The ticker shows Kp and KEV.
- **Proxy.** It gains these routes, and the new upstream hosts are added to `ALLOWED_UPSTREAM` with per-host gaps:
  - `/osiris/celestrak/(stations|visual)`, `/osiris/eonet`, `/osiris/kp`;
  - `/cyber/kev`, `/cyber/ripe/AS…`, `/cyber/ioda`;
  - `/market/deribit/options/BTC`, `/market/deribit/dvol/BTC`;
  - `/market/depth/<SYM>`, `/market/trades/<SYM>`.
- **Snapshot.** The snapshot carries all of these sources. With `--prev`, CelesTrak is carried over on odd UTC hours while the previous copy is under 3 hours old.

### Self-test 18/18
The six new checks are:
- Synaptic spiderweb;
- Kalman latent price & BOCPD (planted jump);
- Order-book alpha & L2 fill (planted λ, flat versus walled entropy, iceberg, VWAP, refusal beyond 25 levels);
- Deribit GEX & funding trap (Black-Scholes gamma test value, test-chain flip, crowded-long trap, live state);
- Orbits, space weather & cyber radar;
- Supersonic gym (a measured rate of at least 1e5 ticks/s, weights summing to 1).

### omega-local-mcp (`scripts/omega-mcp-bridge.mjs`, `.mcp.json`)
A zero-dependency MCP server over stdio (protocol 2025-06-18, with 2025-03-26 and 2024-11-05 accepted). It has eight tools:
- `get_live_pwsi`;
- `get_whale_sonar_state`;
- `query_osiris_intel`;
- `query_quant_spiderweb`;
- `run_6_agent_court` (rule-based, every reason listed, opens nothing);
- `lock_base_and_sweep` (computes `max(0, NetEquity − LockedBase)`; the sweep itself stays the S key);
- `verify_sha256_receipt_chain` (the same canonical form as the Ops Room and NABD, including Merkle checkpoints);
- `run_selftest` (bridge checks plus the link to the 18 browser checks).

Every number names its source, tier and fetch time. No keys, no orders, no file writes. PWSI from the bridge has four of the five parts; the weather part is computed in the page only, and the answer says so.

### Laptop control
- **Setup script.** `scripts/setup-windows-mcp.ps1` installs uv through winget, only after asking, and Python 3.14 through uv.
  - It backs up Claude Desktop's config (classic and MSIX paths) and adds two servers.
  - **windows-mcp:** `windows-mcp==0.8.8`, stdio, `ANONYMIZED_TELEMETRY=false`, and only the screen, mouse and keyboard tools. These are the exact conditions of the 2026-10-16 security review.
  - **omega-local-mcp.**
  - `-BridgeOnly` skips Windows-MCP.
- **Config template.** `computer-control/claude_desktop_config.json` is the same config as a template.
- **osint-mcp-server.** It was requested but not added; it needs its own security review first.
- **Launcher.** `OMEGA-PRIME.bat` clones or fast-forwards `main` into `Desktop\OMEGA-PRIME`, starts the proxy on 8796, waits for `/health`, runs the bridge checks and opens `omega-ops-room.html?selftest=1`. It holds no e-mail address; SEC reads `~/.omega/sec-ua.txt`.

### Skills
Five project skills, written from this repo's code and the papers it cites, with no scripts:
- `apple-liquid-glass-hig`;
- `osint-bgp-cables`;
- `quant-microstructure-gex`;
- `synaptic-spiderweb-viz`;
- `safe-vault-cryptographic-ratchet`.

They are linked from `CLAUDE.md`, `AGENTS.md` §6a and `.claude/skills/README.md`.

## Consequences
- **Sandbox runs.** Outbound data is blocked in the sandbox, so behaviour was tested with mocked feeds that follow each upstream's documented shape. Live data is to be checked on the laptop.
- **Self-test.** The self-test scored 18/18. The gym measured 1.0–2.0 million ticks/s in headless Chromium in the sandbox; the laptop's number will differ.
- **Three sizes.** All 24 runs are clean (Ops Room, THE CHAIN, NABD Arabic and English, each in light and dark at all three sizes). The contrast gate passes.
- **Bridge.** With a mocked proxy, the bridge passed 6 of 7 of its checks; the published snapshot was unreachable from the sandbox. It verified a receipt chain exported from the Ops Room and rejected a tampered copy.
- **Not run.** The PowerShell setup and the batch launcher were not run, because the sandbox has no Windows.
- **What the readings are.** Every quant reading is a decision aid with `[INFERENCE - Quant Model]`, and heuristics carry `[INFERENCE]`. GEX rests on a public positioning convention, not observed dealer books. Orbits are approximate, and so are the cable corridors.
