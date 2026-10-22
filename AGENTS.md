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

- Project skills in `.claude/skills/`: `omega-design`, `omega-finance-chain`, `apple-liquid-glass-hig`, `osint-bgp-cables`, `quant-microstructure-gex`, `synaptic-spiderweb-viz`, `safe-vault-cryptographic-ratchet`. Each is text rules only and passes `node scripts/skillspector-audit.mjs --strict .claude/skills`.
- Brain 2 maths: one file, `scripts/lib/brain2-math.mjs`, shared by the proxy, the snapshot, the MCP bridge and the Ops Room (inline copy from `node scripts/build-brain2-inline.mjs`; `--check` and `node scripts/test-brain2.mjs` run in CI).
- `scripts/omega-mcp-bridge.mjs` is a zero-dependency MCP server over stdio: read-only public data and paper maths, no keys, no orders, no file writes.
- Windows-MCP is used only at 0.8.8, stdio, telemetry off, with the screen, mouse and keyboard tools (no App, PowerShell, Registry, FileSystem, Process, Clipboard), as `scripts/setup-windows-mcp.ps1` writes it. Any other setting needs a new security review. Other OSINT MCP servers are not added without one.
- OSINT is passive: public keyless APIs only. No port scanning, dorking, spoofed user agents or anti-bot bypass.

## 7. Records

- One task = one commit = one ADR in `docs/adr/ADR-NNN-*.md` (next free number: check the folder and the open branches).
- Commit messages and PR text in English; replies to Ahmad in Gulf Arabic.
- PR description: Before / After paragraphs, then how it works, then the check results from §6.
