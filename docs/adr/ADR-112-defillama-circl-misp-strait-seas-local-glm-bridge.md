# ADR-112: DefiLlama liquidity flow, CIRCL vulnerabilities with MISP tags, strait seas, a local GLM bridge and the Windows-MCP launchers

Date: 2026-10-23 · Status: Accepted (Ahmad's Phase 15 directive of 2026-10-23, with approval to merge this phase's PR once CI is green and publish to GitHub Pages)

## Context
Phase 15 asked for:
- Keyless stablecoin and DEX data (DefiLlama) turned into a macro liquidity index in the whale sonar and the court.
- CIRCL vulnerability data classified with MISP taxonomies, feeding CSTI, PWSI and the circuit breaker.
- Waves and currents on the five strait cards.
- A local GLM model through Ollama for plain explanations.
- Windows-MCP adopted with one-click launchers.
- Three new skills, and the 24-check self-test kept as the gate.

Laptop Remote Control has been unreliable, so everything had to work from the public site and from `start-omega.bat` without it.

## Decision

### Sources (all keyless, all in `ALLOWED_UPSTREAM`, the snapshot and, where the browser calls them, the CSP)
| Source | Route | Tiers |
|---|---|---|
| DefiLlama `stablecoins.llama.fi/stablecoins?includePrices=true`, `api.llama.fi/v2/chains`, `api.llama.fi/overview/dexs` (charts excluded) | proxy `/market/llama` (15 min cache) | proxy → direct → snapshot |
| CIRCL Vulnerability-Lookup `vulnerability.circl.lu/api/last` (the old `cve.circl.lu` host now redirects there) | proxy `/cyber/circl` (30 min) | proxy → snapshot (no browser CORS) |
| Open-Meteo Marine `marine-api.open-meteo.com/v1/marine` at one sea point per strait | proxy `/osiris/marine` (30 min) | proxy → direct → snapshot |

The CSP adds `https://stablecoins.llama.fi` and `https://marine-api.open-meteo.com` (`api.llama.fi` was already listed). The snapshot now packs 23 sources. Parsers live once in `scripts/lib/brain2-math.mjs` (`shape.llamaStable`, `llamaChains`, `llamaDex`, `llamaSet`, `circl`, `marine`) and are inlined into the Ops Room by `scripts/build-brain2-inline.mjs`.

### Liquidity flow index (LFI) [INFERENCE]
`lfi(set)` returns a score from −100 to +100, built from these parts:

| Part | Weight | Full scale |
|---|---|---|
| USD stablecoin supply change over 1 day | 35 % | ±0.5 % |
| Supply change over 7 days | 30 % | ±2 % |
| DEX volume against the day before | 20 % | ±25 % |
| Peg stress of the largest gap among coins ≥ $1 bn | 15 % | 0 within 50 bps, −1 at 200 bps |

Weights are renormalised over the parts present, and coverage is reported as n of 4. The regime is inflow at ≥ 25 and outflow at ≤ −25.

Where it shows:
- In the whale sonar card (`#snLiq`).
- As a court witness line. It is not a weighted voice, because it has no hit record yet.
- As a red-team risk at LFI ≤ −40 or a peg gap ≥ 100 bps.
- In the ticker.
- As two neural inputs.

### CIRCL and MISP [INFERENCE]
`shape.circl` reads mixed CVE 5 and OSV records. `cvss3()` computes CVSS 3.0/3.1 base scores from the vector with FIRST's Roundup; the tests use the reference vectors for 9.8, 10, 6.1, 5.5 and 0. A record without a vector has no score.

`circlSummary()` adds MISP machine tags (github.com/MISP/misp-taxonomies, CC0):

| Taxonomy | Tag | Rule |
|---|---|---|
| `priority-level` | emergency | CVSS ≥ 9 and in CISA KEV |
| | severe | CVSS ≥ 9 |
| | high | CVSS ≥ 7 |
| | medium | CVSS ≥ 4 |
| | low | CVSS > 0 |
| | baseline-minor | no score |
| `vulnerability` | sighting="exploited" | listed in CISA KEV |
| | information="PoC" | an exploit reference |
| | origin="software" | an OSV record |
| `rsit` | vulnerable-system | every record |
| | intrusion-attempts exploit | listed in KEV |
| | fixed CWE map | 200 → information disclosure; 326/327/328 → weak crypto; 400/674/770/835 → DoS |

Pressure = 10 per critical record + 2 per high record + 25 per KEV record, capped at 100. It is CSTI's eighth possible part (`of: 8`). CSTI already feeds PWSI's fifth part, the risk judge's hard stop at the PWSI limit and the circuit breaker head, so CIRCL reaches all three without a new path. The cyber note lists the top records with tags and a link to `vulnerability.circl.lu/vuln/<id>`.

### Strait seas [INFERENCE]
`shape.marine` gives these readings per strait:
- Significant wave height, direction and period
- Swell
- Current speed (km/h and knots) and direction
- Sea surface temperature
- A 24 h wave curve

`seaState()` = clamp((highest wave − 2 m) / 4 m + 0.25 if any current ≥ 4 kn) · 100. It joins PWSI's weather part as the larger of the gust part and the sea part, so PWSI still has five parts.

Where it shows:
- The strait table adds waves and current.
- Each callout adds wave and current rows and a 24 h wave sparkline of real readings, or "تعذر التحقق منها".

### Neural flow
The shape stays 139 → 48 → 36 → 48 → 24 → 16 → 8.

New inputs:
- LFI
- DEX change
- Highest wave
- Fastest current
- CIRCL critical count

Removed inputs:
- Two PWSI part duplicates (weather, disaster)
- The Gulf aircraft box
- Baltic AIS
- BTC 24 h

The weights key moves to `omega-neural-v3`.

Heads 6, 7 and 8 now read as follows:
- Head 6: recover the pending $20 base.
- Head 7: move profit to the protected wallet.
- Head 8: SHA-256 head of the paper receipt chain.

Heads 6 and 7 are labelled proposals for Director 00 on the paper ledger: no real money moves.

The oscilloscope (top right at ≥ 600 px) says when it is frozen for the self-test.

A deterministic causal table (`#nfWhy`, `causal()`) explains each reading from page numbers only: LFI, microprice, VPIN and Hawkes, CSTI, seas, PWSI, the court and head 1, and the paper base.

### Local GLM bridge
`/llm/ollama/status` (GET) and `/llm/ollama/explain` (POST) on the proxy, with these limits:
- Accepted only from loopback sockets, even with `--lan`, and from allowed origins.
- Ollama must be on a loopback address (`OMEGA_OLLAMA_URL`).
- Names ending in `:cloud` or `-cloud` are refused.
- At most 40 facts in a body of at most 16 KB.
- A fixed paper-only Arabic system prompt; temperature 0.2; 500 tokens.

The answer is labelled `[INFERENCE - local LLM]`.

Model choice: `OMEGA_OLLAMA_MODEL`, else the first local `glm*`, else the first local model.

The MCP bridge gains a ninth read-only tool, `explain_with_local_model`. The Ops Room button sends only the causal rows.

Model facts, checked 2026-10-23:
- GLM-5.2 is offered in the Ollama library with a `:cloud` tag only, which runs on Ollama's servers, so it is not used.
- `glm4` (9B) is the local GLM in the Ollama library.

### Launchers and Windows-MCP
- `OMEGA-PRIME.bat` runs `scripts/setup-windows-mcp.ps1` once, and only when the Claude Desktop config lacks `windows-mcp==0.8.8`. That script is unchanged: 0.8.8, stdio, telemetry off, screen, mouse and keyboard tools only.
- `OMEGA-PRIME.bat` then does the following:
  - starts the proxy
  - waits for `/health`
  - prints the Ollama status
  - runs the bridge self-test
  - opens `?selftest=1`
- `start-omega.bat [selftest]` and `start-omega.sh [selftest]` wait for `/health`, print the Ollama status and open the Ops Room. The `.bat` also reports whether Windows-MCP is configured.

### Self-test (still 24 checks)
| Check | Change |
|---|---|
| 6 | Adds an LFI fixture (expects 85) and the live DefiLlama tier |
| 20 | Counts 23 sources |
| 21 | Adds a CIRCL/MISP fixture and the 8-part CSTI |
| 23 | Adds a sea-state fixture and the live marine tier |

Checks that need live data fail honestly when it is missing.

### Skills (text rules only, written from this repo's code)
- `stablecoin-cyber-vuln-intel`
- `neural-139-inputs-heads`
- `local-glm-agent-windows-mcp`

## Verification in the cloud sandbox (outbound data blocked)
| Check | Result |
|---|---|
| `node scripts/test-brain2.mjs` | 29 passed |
| Fake Ollama | Status picks a local glm model; explain answers; `:cloud` is refused; POST elsewhere gets 405; a foreign origin gets 403 |
| Ops Room with a fixture snapshot | All new panels render with no console errors |
| Self-test | 16 of 24; the 8 failures are live-only checks (Binance book and court, Deribit, satellites and Kp, live page sources, InfoCON and InternetDB, RIS and adsb, GIBS tile) |
| `scripts/ui-three-sizes.mjs` | 6 of 6, no overflow, after fixing a phone overflow in the LFI table |
| Contrast gate | Passes |
| SkillSpector | 0 critical, 0 high |

## Not verified here
- Live DefiLlama, CIRCL and Open-Meteo Marine answers in the browser. They are checked on the public site after the Pages snapshot run, and on the laptop with `node scripts/omega-data-proxy.mjs --check`.
- A real Ollama model answer.
- Windows-MCP on Windows.

## Declined or kept
- Submarine cables stay hand-drawn approximate corridors with landings. TeleGeography's route data is licensed, so the deep-zoom map does not claim exact routes.
- NASA thermal anomalies were already on the flat map (ADR-110).
- No cloud model, no paid API, no key.
- Nothing here signs or sends an order. The liquidity index, CIRCL pressure and sea state are readings, and the paper desk still opens only on the risk judge's OPEN.
