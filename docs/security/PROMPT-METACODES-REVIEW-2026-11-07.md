# Security review: prompt meta-codes (ADR-156)

Date: 2026-11-07 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/prompt-metacodes.mjs` | 190 | eacf995123e83f9d | One-pass reader, lock words, the three plans, the proof, the critic, the stages, Arabic and English sentences, SHA-256 |
| `.claude/skills/replica-prompt-metacodes/prompt_metacodes.py` | 292 | 9611d6c3d710da77 | The same engine in Python; contrast from the reviewed reversal-engine skill |
| `.claude/skills/replica-prompt-metacodes/tests/test_prompt_metacodes.py` | 78 | a8deed1ab83b1bba | 8 unit tests, one against the server's golden answers |
| `.claude/skills/replica-prompt-metacodes/tests/golden.json` | — | 8f7f2653b2476339 | 19 requests and the server's answers |

Also changed:
- `server.mjs`: the route `POST /api/w/:slug/metacodes/compile`;
- `app.js`, `i18n-ar.json`: the meta-codes panel in Missions, the Studio and the Math lab;
- `build-app.mjs`: inlines the engine with the council's libraries, which already hold the contrast healer and SHA-256;
- the server, flow and mutation tests.

## 2. What it can do

- **It runs nothing.** The engine reads text and returns plans as data. It starts no process, opens no socket, reads no file and stores nothing, in either language; the Python file is checked by a unit test for the words that would. Only the route writes, and only one event to the log.
- **It never unlocks.** Every money, publishing, permissions, install or outbound word becomes a locked approval step, and `proveOption` fails a plan where such a step is unlocked or a plain step is locked. Pressing codes cannot change this: the codes only add sections.
- **Secrets:** text shaped like an `sk-`, `ghp_`, `AKIA` or Slack token is replaced by `[redacted]` before anything else reads the request, so it is not in the answer, its SHA-256 or the event log. The event stores only the codes and whether the plans were verified.
- **Addresses:** URLs are only classified, never fetched. The private ranges are the same family the SSRF shield refuses.
- **Output in the page:** every string goes in with `textContent`; Arabic sentences are split into text and `<bdi>` nodes, never parsed as HTML. The request box is a textarea.
- **The Python import:** `prompt_metacodes.py` adds the sibling `replica-reversal-engine` folder (or its own folder) to `sys.path` and imports `heal_oklch_contrast` from that reviewed file. It loads nothing else.

## 3. Cost

- One pass over at most 4,000 characters; five fixed regular expressions with bounded repeats (`{1,200}`), and at most 20 URLs and 2 colours read.
- The contrast healer runs at most once: two 16-step bisections.
- Measured: a full request with all five codes takes under 2 ms.

## 4. Honesty

- The three plans are fixed rules marked `[INFERENCE]`. No speed, saving or sovereignty number is printed, because none was measured.
- The critic says every time that the three sizes and the UI states cannot be checked from text.
- The mutation run kept both engines at 100 %; its two equivalents are explained in the harness.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |
| `ruff check .claude/skills/replica-prompt-metacodes` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-prompt-metacodes/tests` | 8 tests OK; Python gives the server's answers and SHA-256 to all 19 golden requests |
| `node jarvis/scripts/mutation-harness.mjs` | `prompt-metacodes.mjs` 150/150 killed |
| `python3 jarvis/scripts/mutation_harness.py` | `prompt_metacodes.py` 172/172 killed, 2 equivalent, each with its reason |

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
