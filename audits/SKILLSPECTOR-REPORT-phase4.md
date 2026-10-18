# SkillSpector report · Phase 4 (ADR-089)

Date: 2026-10-18 · Tool: `scripts/skillspector-audit.mjs` (13 rules + CSP check) · Config: `.skillspector.json`

## 1. Phase 4 scope (CI gate)

`node scripts/skillspector-audit.mjs --strict site-landing omega-ops-room-v1 scripts .claude/skills/omega-design .claude/skills/omega-finance-chain AGENTS.md CLAUDE.md DESIGN.md`

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 6 (link-out hosts: marinetraffic.com camera links, coingecko.com source link; reviewed, intended) |
| Suppressed, with reason | 28 (theme / notes / vault-ciphertext `localStorage`, test-harness env, proxy env, licence URLs, one fake key in a redaction test) |

Exit code 0. Every page now has a strict CSP with sha256-pinned inline code, verified in Chromium with zero `securitypolicyviolation` events.

## 2. Whole-repo baseline (not in the CI gate yet)

`node scripts/skillspector-audit.mjs` over 513 files: critical 0 · high 90 · medium 363 · low 131 · suppressed 29.

| High rule | Count | Where, mostly |
|---|---|---|
| SEC-XSS-SINK (`innerHTML` etc.) | 36 | `dashboard/index.html`, `dashboard/mind`, `newton/ui` |
| SEC-EXEC (`subprocess`, `child_process`) | 27 | `services/director00`, `web/scripts`, `mcp/omega-sentinel`, vendored `webapp-testing` skill |
| SEC-CSP (no CSP meta) | 8 | `dashboard/*`, `newton/ui`, `web/public/offline.html`, vendored `algorithmic-art` template |
| SEC-EVAL (`new Function`) | 7 | vendored `dashboard/mind/vendor/3d-force-graph.min.js` (6), `n8n/test` loader (1) |
| SEC-ENV inside `mcp/` | 7 | `mcp/omega-sentinel`, `mcp/awesome-atlas` (reads config, reviewed) |
| SEC-HOST / SEC-SRI | 5 | vendored skills under `.claude/skills/` |

Recommended next passes, each its own task and ADR: add CSP + `textContent` rendering to `dashboard/` and `newton/ui`; review each `subprocess` call for fixed argument lists (no shell strings); replace or pin the vendored 3d-force-graph build with SRI. The vendored Anthropic skills under `.claude/skills/` are reference material; their scripts are not run on Ahmad's machine.

## 3. Browser shield self-test (Chromium, mocks for blocked feeds)

- Picked a test `SKILL.md`, `helper.js` and `page.html`: 11 findings (2 critical, 5 high, 1 medium, 3 low). The key literal shows as `sk-ant… (43 chars, masked)`.
- Vault: short passphrase refused; vault created; stored blob holds no plaintext; wrong passphrase refused with nothing changed; reopen decrypts; encrypted backup downloads; a plaintext key planted in `localStorage` was moved into the vault and deleted.
- Profit split: 10,000 at 20%, +12% gives fee 240.00 and net 10,960.00; a −4.2% period then +0.4% charges no fee below the high-water mark.

## 4. Other checks

- Contrast gate (`audits/verify-contrast.mjs`): all pairs pass WCAG ≥ 4.5 and APCA Lc ≥ 60 for `site-landing/style.css`, `the-chain.html`, `omega-ops-room.html`.
- Three sizes × light/dark (`scripts/ui-three-sizes.mjs`): 24/24 PASS for `index.html`, `en.html`, `omega-ops-room.html`, `the-chain.html`, zero console errors, zero overflow. External feeds are blocked in the cloud sandbox, so the Ops Room and THE CHAIN ran with `ALLOW_NET_ERRORS=1`.
- THE CHAIN functional test with recorded-shape mocks: SEC pull fills 5 fiscal years from 10-K only (quarterly row ignored), leaves a missing value blank, shows accession numbers, fills shares from `dei`; volatility from Binance klines; seeded quant range reproducible; crypto card reads three sources.
- `scripts/omega-data-proxy.mjs`: health 200, SEC 503 until `OMEGA_SEC_UA` is set, unknown routes 404, non-local origin 403, POST 405.
