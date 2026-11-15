# Security review: hybrid context memory and the bundle export (ADR-172)

Date: 2026-11-15 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) |
|---|---|---|
| `jarvis/server/lib/model-catalog.mjs` | 71 | 45a134b1117d9bc8 |
| `jarvis/server/lib/impact-analysis.mjs` | 191 | 343af7bae26b92e0 |
| `jarvis/server/lib/release-gate.mjs` | 148 | b37174f4314ee3ae |
| `jarvis/server/lib/architect-studio.mjs` | 129 | 44fd727a99527196 |

| File | Lines | SHA-256 (first 16) |
|---|---|---|
| `.claude/skills/replica-impact-analysis/impact_analysis.py` | 355 | d2e716fd1de5878c |
| `.claude/skills/replica-release-gate/release_gate.py` | 260 | e189085024149639 |
| `.claude/skills/replica-architect-studio/architect_studio.py` | 225 | 72567d87452cc18c |

Also changed: `server.mjs` (the event text for the two exports), `app.js`, `app.css` and `i18n-ar.json`, the golden files, and the server, flow, live and mutation tests.

## 2. What it can do

- **Read nothing new.** The two estimated cards and the 14 blocking lists come from the `config.json` files read for ADR-171, with the same SHA-256. No code path calls Hugging Face.

- **Write nothing.** The export is text returned in the answer. The page puts it in a read-only box and copies it to the clipboard only when the person presses Copy. Writing a file is a locked step; nothing approves it here.

- **Send nothing.** The server answers the request it was given. The event log keeps the export's length and the number of locked steps, not its text.

- **Keep the seal private.** The architect export carries the seal's state and the first five characters of the typed code's hash, as `#/architect` already shows. The code, the full hash and the server's seal are never in it; the server test checks both texts.

- **Bound the arithmetic.** The hybrid product is at most 2 × 8 × 128 × (64 × 10⁸) ≈ 1.3 × 10¹³ values before the batch and bits, a whole number below 2⁵³. Batch at most 4096 and bits at most 32 keep the result a finite double, as in ADR-171.

## 3. Honesty

- **Only stated layers are counted.** A card is estimated only when its file names every layer and gives one window and one head layout. For the other 14, the page shows the fields that stop it, read from the file.

- **The estimate is the formula.** Runtimes may keep one token more or less than the window, or extra buffers. The page shows the formula under the number, and runtime buffers are not counted, as ADR-171 says.

- **The export repeats, never adds.** Every field comes from the engines' own answers. Keys are sorted, so the same facts give the same text and hash in Node and Python (`tests/golden.json`).

## 4. Page safety

- The text is set with `.value` and `textContent`; nothing is parsed as HTML.

- The box is `readonly`, `lang="en"`, `translate="no"` and `data-verbatim`, so the bilingual gate reads it as data.

- The CSP is unchanged: no new host, no inline handler, no style attribute.

## 5. Checks

The commands and their results are in the pull request. Biome is not installed in this sandbox, so `npx @biomejs/biome lint` was not run.

## 6. Decision

Accepted. The change is safe to run on Ahmad's machine as written.
