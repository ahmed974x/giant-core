# AGENTS.md · rules for every coding agent in giant-core

Read by Codex CLI, Claude Code (through `CLAUDE.md`) and any agent that follows the AGENTS.md convention. The design system lives in [`DESIGN.md`](DESIGN.md); this file says how to work. Where they overlap, `DESIGN.md` wins on look and feel, this file wins on process.

## 1. Who decides

- Ahmad (Director 00) approves every irreversible or outward action: merges, production changes, outbound messages, anything that moves money, opens trades or accepts subscribers.
- Locked until a separate explicit approval and a legal review: real trading, an execution agent, public copy-trading vaults, investor profit split. They appear only as cards marked **«قيد الموافقة»** or as browser-only math simulations that say "no money accepted".
- The trading desk (ADR-091, ADR-092) is paper only. Ahmad approved the paper-only auto engine on 2026-10-19 with a standing rule: no code that signs or sends an order to any exchange, Binance or Testnet. A Testnet or real-account route needs a new explicit approval, and until then it stays a disabled option in the UI.
- The `S` key and "Sweep profit now" move paper money inside the paper ledger only (ADR-093). Any sweep of real funds stays a proposal in the Director 00 approval inbox.
- No third-party skill, plugin, hook, MCP server or installer is added without Ahmad's approval and a written security review. Taking text rules from a skill is fine; running its scripts is not.

## 2. Look and feel (summary of DESIGN.md, which is binding)

- Colour: OKLCH tokens only, with a Display P3 variant under `@media (color-gamut: p3)`. One accent. Status colours mean status.
- Contrast: every text/background pair passes WCAG ≥ 4.5:1 **and** APCA Lc ≥ 60 in light, dark and both P3 variants. Gate: `node audits/verify-contrast.mjs <file>`.
- Shape: concentric radii, outer = inner + padding. Spacing on the 4/8 scale.
- Numbers: monospace with `font-variant-numeric: tabular-nums slashed-zero`, `direction: ltr`, `unicode-bidi: isolate`.
- Motion: `transform` and `opacity` only, `--ease-apple-fluid`, off under `prefers-reduced-motion`.
- Pages: `100dvh`, safe-area insets, no horizontal page scroll, Arabic RTL first with correct bidi isolation.

## 3. Honesty

- No invented data. Every market number, map point, target, quote or performance figure has a named source and a date, or it shows "تعذر التحقق منها".
- Heuristics carry `[INFERENCE]`; model outputs carry `[INFERENCE - Quant Model]`. Teaching examples and hypothetical returns are labelled on screen.
- Free and open-source sources only. No paid APIs, no CAPTCHA solving, no anti-bot bypass.

## 4. Security

- Strict CSP meta on every page: `default-src 'none'`, sha256-pinned inline code, no `'unsafe-inline'`/`'unsafe-eval'`, named `connect-src` hosts, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
- No `eval`, `new Function`, string timers, `innerHTML` with data, inline `on*=` handlers or `style=""` attributes. External scripts carry SRI.
- Secrets never live in code, in git, or as plaintext in `localStorage`. Use the Ops Room vault (AES-GCM-256, PBKDF2 600k) or the dotenvx-encrypted env files (ADR-042). Never print a secret in a log, a report or a chat.
- Local services bind to `127.0.0.1`.

## 5. Complete-output protocol (never give up, never ship half)

1. Read the code you are changing and the ADRs it cites before editing.
2. Write every file in full. No `TODO`, no placeholders, no "rest of code here", no commented-out stubs.
3. When something fails, find the cause and fix it. Retry with a different approach before reporting a blocker; when it is truly blocked, say exactly what failed, what you tried and what is needed.
4. Run the checks in §6 and read their output. A red check is fixed, not explained away. Never skip, disable or weaken a test or a rule to get green.
5. Report what was verified and how (command and result). Anything not verified is said plainly.

## 6. Checks before any commit or PR

```bash
# security: must exit 0 (critical or high blocks); CI scans the whole repo
node scripts/skillspector-audit.mjs --strict <changed paths>
node scripts/skillspector-audit.mjs --strict .
# after editing any inline <script> or <style>: re-pin CSP hashes, then re-run the line above
node scripts/skillspector-audit.mjs --fix <changed html paths>
# contrast gate for every changed stylesheet or page
node audits/verify-contrast.mjs <file.css|file.html>
# syntax
node --check <changed .js/.mjs>
# three sizes x light/dark: mobile 390x844@3x, laptop 1440x900, ultra-wide 2560x1080; fails on console errors or overflow
node scripts/ui-three-sizes.mjs <url-or-file-url> [out-dir]
```

Python services also run `ruff check`; Node services `npx @biomejs/biome lint` per `biome.json`.

To run the pages with live data locally: `./start-omega.sh` or `start-omega.bat` (proxy and static server on `127.0.0.1:8796`, ADR-093). `node scripts/omega-data-proxy.mjs --check` prints the source status table. A new upstream must be added to `ALLOWED_UPSTREAM` in the proxy and to the page's CSP `connect-src` or `img-src`.

## 6a. Skills and local tools (ADR-108)

- Project skills in `.claude/skills/`: `omega-design`, `omega-finance-chain`, `apple-liquid-glass-hig`, `osint-bgp-cables`, `quant-microstructure-gex`, `synaptic-spiderweb-viz`, `safe-vault-cryptographic-ratchet`, from ADR-109 `neural-flow-decision-viz` and `supreme-software-ui-architect`, from ADR-110 `cyber-space-osint-grid`, `liquid-neural-139-flow` and `autonomous-24-selftest-gate`, and from ADR-112 `stablecoin-cyber-vuln-intel`, `neural-139-inputs-heads` and `local-glm-agent-windows-mcp`, and from ADR-114 `omega-deep-research-agent`. Each is text rules only and passes `node scripts/skillspector-audit.mjs --strict .claude/skills`.
- Brain 2 maths: one file, `scripts/lib/brain2-math.mjs`, shared by the proxy, the snapshot, the MCP bridge and the Ops Room (inline copy from `node scripts/build-brain2-inline.mjs`; `--check` and `node scripts/test-brain2.mjs` run in CI).
- `scripts/omega-mcp-bridge.mjs` is a zero-dependency MCP server over stdio: read-only public data and paper maths, no keys, no orders, no file writes.
- Windows-MCP is used only at 0.8.8, stdio, telemetry off, with the screen, mouse and keyboard tools (no App, PowerShell, Registry, FileSystem, Process, Clipboard), as `scripts/setup-windows-mcp.ps1` writes it. Any other setting needs a new security review. Other OSINT MCP servers are not added without one.
- The local model bridge (ADR-112) is `/llm/ollama/*` on the proxy: loopback sockets only, Ollama on a loopback address only, no `:cloud` model, a fixed paper-only system prompt, and its answer is labelled `[INFERENCE - local LLM]` and changes nothing.
- The ORACLE research agent (ADR-114, ADR-115) reads only the twelve keyless APIs in `OMEGA_RESEARCH.ENDPOINTS`, each through its one API path (`allowed()`); its intel mode is passive OSINT on a topic (Wikipedia, Wikidata, GDELT, NVD), never on an address, person or account; Isnad, Google Scholar and other sites without an open API stay link-outs. After editing `scripts/lib/deep-research.mjs` run `node scripts/build-research-inline.mjs` and `node scripts/test-research.mjs`, then re-pin the CSP.
- TRADE LAB (ADR-116): after editing `scripts/lib/trade-lab.mjs` run `node scripts/build-tradelab-inline.mjs` and `node scripts/test-tradelab.mjs`, then re-pin the CSP. The desk manager agent is fixed rules over the paper ledger; its proposals change only the paper plan, and only after the person confirms. A new proxy route must be added to `docs/api/omega-data-proxy.openapi.json`; `node scripts/build-api-docs.mjs` rewrites the Markdown and `--check` fails on an undocumented route.
- PRIME (ADR-118): the lead agent and its nine helpers in the Ops Room steer the paper desk only through `window.OMEGA_DESK_CTL` (`setAuto`, `focus`), which carry the same guards as the buttons. No helper may sign, send or size an order; the auto engine still opens a paper trade only on the risk judge's OPEN. The risk gate may only stop. New helper tools are pure functions tested in the self-test.
- ADR-119: real trading is still locked; `docs/LIVE-TRADING-READINESS.md` is a plan and TRADE LAB's live gate only measures the paper record (`liveGate()` always returns `locked: true`). After editing `scripts/lib/i18n.mjs` or `scripts/lib/i18n/*.mjs` run `node scripts/build-i18n-inline.mjs`; after editing `scripts/lib/second-brain.mjs` run `node scripts/build-brain-inline.mjs`; then `node scripts/test-brain.mjs` and re-pin the CSP. The second brain page has no network and reads no vault entry or key.
- ADR-121: the agent core is one file, `scripts/lib/agent-core.mjs` (plan checker, backoff, breakers, memory, lessons, missions, model register, 3D maths). After editing it run `node scripts/build-core-inline.mjs` and `node scripts/test-core.mjs`, then re-pin the CSP. The plan checker refuses any tool outside its fixed list and any order, signing, withdrawal or key word; a plan from the local model (`POST /llm/ollama/plan`) passes the same checker. Every model figure keeps its source and date.
- ADR-122: ORACLE has field lenses (medicine: ClinicalTrials.gov and PubMed; science and industry: Zenodo and OSTI.GOV; algorithms: Zenodo software) and FIRST EPSS in intel mode, seventeen keyless APIs in all; patents stay link-outs; no dark-web, Tor or leak-site access. `node scripts/self-shield.mjs` attacks a sandboxed, offline copy of the proxy on 127.0.0.1 (31 probes) and lints pages and files; it never targets any other host. Run it (or `node scripts/test-self-shield.mjs`) after any proxy or page change; a new hole is fixed in code, never suppressed.
- ADR-125: the cyber sources retry the snapshot instead of caching a failure, and the self-test asks once more before judging. Camera lists (`/osiris/cams`) and the oil and gold set (`/market/oilgold`) go through `OMEGA_MATH.shape.cams*` / `oilGoldSet`; a camera image URL must match `CAM_HOSTS`. The oil and gold card and the open-source library (`OMEGA_BRAIN.LIBRARY`) are read-only and paper only; listing a tool installs nothing. Newton's CORS is for `GET /api/health` from the Ops Room origins only.
- ADR-126: the knowledge domain is one file, `scripts/lib/knowledge-domain.mjs` (graph, PageRank, betweenness, Adamic-Adar, gaps, ask, plan review, enrichment shapes). After editing it, or after adding any ADR, run `node scripts/build-knowledge-inline.mjs` and `node scripts/test-knowledge.mjs`, then re-pin the CSP. A plan it writes names only PRIME's tools, passes `checkPlan` on the page and again in the Ops Room, and starts only when the person presses Start mission. Enrichment sends only the domain names, after a confirm, to Wikidata and OpenAlex.
- OSINT is passive: public keyless APIs only. No port scanning, dorking, spoofed user agents or anti-bot bypass. Shodan InternetDB is read only for the four public resolvers fixed in `INTERNETDB_HOSTS` (ADR-110), never for an address taken from input.

## 7. Records

- One task = one commit = one ADR in `docs/adr/ADR-NNN-*.md` (next free number: check the folder and the open branches).
- Commit messages and PR text in English; replies to Ahmad in Gulf Arabic.
- PR description: Before / After paragraphs, then how it works, then the check results from §6.
