# Security review: the purity gate's dotted captions and per-page checks (ADR-173)

Date: 2026-11-16 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Change |
|---|---|
| `jarvis/scripts/bilingual-purity.mjs` | one rule in `PURITY` (dotted captions); `checkPurity` passes `check()` to each extra step |
| `jarvis/scripts/test-app.mjs` | F33b; the "bundle export" and "campaign" hooks call `check()` |
| `jarvis/scripts/test-live.mjs` | the same two hooks call `check()` |

No page code, server code, dictionary line, CSP or lock changed. `jarvis/app/index.html` was rebuilt only to carry the refreshed evidence and corpus.

## 2. What the gate can do

- **In the page:** `PURITY` still runs through Playwright `page.evaluate`. It reads text nodes, attributes and computed styles, and changes nothing. The new rule is one regular expression over text the page already shows (`^[·•]`), plus the existing `KEEP` list and `closest()`. It has no nested quantifiers, so it cannot backtrack badly.
- **In Node:** `check()` is a closure over the same `page.evaluate` call. It runs in the test process only, writes nothing and opens nothing. The evidence file is written once per mode, as before.
- **F33b:** builds its list with `createElement`, `setAttribute` and `textContent`, with no HTML parsed, and removes it before the next check.

## 3. What it cannot weaken

- The exemptions are the ones ADR-151 named: code, `lang="en"`, `data-verbatim`, `<bdi>` and `translate="no"`. The new rule narrows the last of these: the browser's default block isolation no longer counts as isolating a dotted caption. No exemption was added.
- F33 still requires 0 violations in both languages, in sample and live mode. The gate now reads more pages, so it can only find more.

## 4. Checks

Listed with their output in the PR: `test-app.mjs`, `test-live.mjs`, `skillspector-audit.mjs --strict`, `node --check`, `build-app.mjs --check` and the contrast gate on the rebuilt page.

## 5. Decision

Accepted. The change only makes the gate stricter, and nothing here widens what Aether Prime can reach or do.
