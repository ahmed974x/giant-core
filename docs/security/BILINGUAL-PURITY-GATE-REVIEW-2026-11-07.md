# Security review: the bilingual purity gate and the model's answer language (ADR-151)

Date: 2026-11-07 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/scripts/bilingual-purity.mjs` | 69 | a9f6a5e4c86cca3c | The gate (run in the page by the flow tests) and its evidence writer |

Also changed:
- `jarvis/app/src/app.js`: the translator, data marking and `data-i18n`;
- `app.css`: one isolation rule;
- `i18n-ar.json`;
- `shell.tmpl`: one attribute;
- `build-app.mjs`: reads the evidence;
- `readiness.mjs`: one check;
- `ollama-bridge.mjs`, `council.mjs` and `server.mjs`: the answer language;
- `open-web-search.mjs`: one label;
- the flow and server tests.

## 2. The translator writes elements, never HTML

- **How the isolation is built:** `document.createElement("span")` and `createElement("bdi")`, with `textContent` and `setAttribute` for `dir` and `translate`. No `innerHTML`, no parsing, and no new inline script or style; the CSP pins are refreshed by `skillspector-audit.mjs --fix` as before.
- **What can reach the page:** the Latin runs come from the dictionary's Arabic output or from data already on the page. Text stays text.
- **Language switch:** switching back to English replaces each wrapper with a text node holding the original string, kept in a `WeakMap`, so nothing is left behind.
- **Recursion:** the nested lookup of captured groups is capped at depth 3 and works on substrings, so it always ends.

## 3. The model's answer language

- **Input:** the page sends `lang`. The server passes `ar` or `en` and nothing else (`body.lang === "ar" ? "ar" : "en"` on the stream and mission routes; `/api/llm/run` and the council keep their existing `lang` handling, and any value other than `ar` or `en` adds no line). So no text from the request reaches the system prompt.
- **Output:** the model's output is still untrusted. Plans pass `enforceApprovalGates` and designs pass the clean-room extractor, as before. The Arabic lock words were already in the rules (ADR-136), so an Arabic plan is locked the same way.

## 4. The gate

- **What it does:** it runs in the browser through Playwright `page.evaluate`. It reads text nodes, attributes and computed styles, and changes nothing. In Node it writes one JSON file under `jarvis/replica/evidence/`. It starts no process and opens no socket.
- **Exemptions:** each is an attribute set by the page's own code:
  - `lang="ar"` (the language button, the locked marks, the teaching label);
  - `lang="en"` (proper names);
  - `data-verbatim` (workspace data and file content).

  The marks AGENTS.md §1 requires stay visible in English mode; the gate does not hide them.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict .` | 0 critical, 0 high |
| `test-app.mjs` F33 and `test-live.mjs` live gate | 0 violations in Arabic and in English (22 + 21 screens) |
| `test-server.mjs` | language line sent for chat, plan and stream; none for design |

## 6. Decision

Added. Nothing here widens what Jarvis can reach or do.
