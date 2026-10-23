# Claude skills for giant-core

Vendored from [anthropics/skills](https://github.com/anthropics/skills) at commit `683bc88` (Apache 2.0, each folder keeps its `LICENSE.txt`).
Claude Code loads every folder here automatically when it runs inside this repo.

| Skill | Use it for |
|---|---|
| `frontend-design` | Visual direction, typography and layout for the OMEGA dashboards, so they don't look templated |
| `web-artifacts-builder` | Multi-component React + Tailwind + shadcn/ui pages bundled into one HTML file |
| `theme-factory` | Colour and font themes; can generate a custom dark "neural" theme |
| `algorithmic-art` | p5.js particle systems and flow fields for live neural backgrounds |
| `mcp-builder` | Designing and testing MCP servers: tool naming, schemas, errors, evaluations (used for `mcp/omega-sentinel`) |
| `build-mcpb` | Packaging an OMEGA tool server as a one-file `.mcpb` bundle you drag onto Claude Desktop (from [claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/mcp-server-dev) at `f713a7c`) |
| `webapp-testing` | Playwright screenshots and checks of the dashboard running locally |

To update: re-copy the folders from a fresh clone of the source repo named in each row (anthropics/skills unless stated).

## Project skills (written for OMEGA, ADR-088)

| Skill | Use it for |
|---|---|
| `omega-design` | Any OMEGA / NABD page: applies `DESIGN.md`, the Vercel Web Interface Guidelines (copy in `omega-design/references/`, MIT) and the three-size browser loop `scripts/ui-three-sizes.mjs` |
| `omega-finance-chain` | Stock research, valuation models, earnings-call reviews and per-ticker notes.md, following THE CHAIN rules (research only, never trading) |
| `apple-liquid-glass-hig` | Glass chrome, popovers, rings and charts on OMEGA pages: where glass is allowed, opaque fallbacks, contrast and motion (ADR-108) |
| `osint-bgp-cables` | OSIRIS cyber and space layers from passive keyless sources: RIPEstat, IODA, CISA KEV, CelesTrak, NOAA SWPC, NASA EONET, cable corridors, CSTI (ADR-108) |
| `quant-microstructure-gex` | Brain 2 maths: Kalman, BOCPD, Kyle's lambda, icebergs, book entropy, L2 fill, dealer gamma, DVOL, funding and basis; paper only (ADR-108) |
| `synaptic-spiderweb-viz` | The Brain 2 synaptic web canvas, its pulses, causal card and the Web Worker gym (ADR-108) |
| `safe-vault-cryptographic-ratchet` | Locked base, profit sweep, SHA-256 receipt chain, Merkle checkpoints, capsule and vault; paper only (ADR-108) |
| `neural-flow-decision-viz` | The Ops Room deep neural flow 139 → 8: threads, pulses, oscilloscope, chrono-scrubber, training worker, decision heads (ADR-109) |
| `supreme-software-ui-architect` | Engineering and visual craft for any OMEGA page: 4/8 grid, glass rules, P3, zero clipped text, workers and canvases without jank, honest data paths, the checks (ADR-109) |
| `cyber-space-osint-grid` | OSIRIS cyber, space and air sources: SANS InfoCON, Shodan InternetDB on four fixed resolvers, RIS Live BGP, adsb.lol squawks, NASA GIBS overlays, cables per strait, the 7-part CSTI (ADR-110) |
| `liquid-neural-139-flow` | The continuous-time dynamics of the 139 → 8 flow: τ table, shocks, Heun solver, settle loop, oscilloscope τ (ADR-110) |
| `autonomous-24-selftest-gate` | The 24-check browser self-test and the release gate before a PR (ADR-110) |
| `stablecoin-cyber-vuln-intel` | DefiLlama liquidity flow index, CIRCL Vulnerability-Lookup with MISP taxonomy tags, the 8-part CSTI and the Open-Meteo Marine sea state at the five straits (ADR-112) |
| `neural-139-inputs-heads` | What enters the 139 inputs, what the 8 heads mean (the $20 base, protected wallet and SHA-256 receipt heads are Director 00 proposals), the frozen oscilloscope and the causal "why" table (ADR-112) |
| `local-glm-agent-windows-mcp` | The loopback-only Ollama bridge for local GLM models, the MCP explain tool, the launchers and the locked Windows-MCP setup (ADR-112) |

These hold text rules distilled from taste-skill, web-interface-guidelines, agent-skills and awesome-design-md, and (the five ADR-108 skills) written from this repo's own code and the papers they cite; no third-party scripts were copied.
