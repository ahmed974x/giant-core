# Security review: the universal agent (ADR-159)

Date: 2026-11-12 · Reviewer: Claude Code, cloud sandbox. The outside projects are reviewed separately in `THIRD-PARTY-SKILLS-REVIEW-2026-11-12.md`.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/universal-agent.mjs` | 212 | 54964f998e46ed5e | The nine modes, the catalog and the review register |
| `.claude/skills/replica-universal-agent/universal_agent.py` | 352 | 20ac8605b54cd99f | The same engine in Python |
| `.claude/skills/replica-universal-agent/tests/test_universal_agent.py` | 85 | 44e65856cacd0754 | 10 unit tests, one against the server's golden answers |
| `.claude/skills/replica-universal-agent/tests/golden.json` | — | 563a319437d38b20 | 180 requests with the server's answers |

Also changed:
- `server.mjs`: `POST /api/w/:slug/agent/universal`;
- `app.js`, `shell.tmpl`, `i18n-ar.json`: the `#/universal` page;
- `build-app.mjs`: inlines the engine in its own scope after the prover and reversal engine;
- `bilingual-purity.mjs`: adds `universal` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **No send, no install, no fetch.** Both engines read their own constant tables and the request. They open no socket, start no process and write no file; a unit test checks the Python file for the words that would. `buildRequest` returns a body and a plan, and `sent` is always false.
- **Locks.** Every send is `{gate: "approval", locked: true, status: "pending_approval"}` with category `outbound`, and a loopback gateway adds a locked `install` before it. `provePlan` verifies the plan: no deadlock, every step reachable, no effect without a locked approval.
- **Hosted endpoints** stay locked by ADR-141. The router never turns a hosted pick into a send; it says "locked: a hosted model waits for Director 00".
- **Gateway text** is data. `isLoopback` accepts only `http(s)://127.0.0.1`, `localhost` or `[::1]` with an optional port and a path boundary, so `localhost.evil.example` and `127.0.0.2` are not loopback (both are golden probes). Nothing is fetched either way.
- **Keys.** No field takes a key. The request's sample settings held a key placeholder; it is not copied anywhere.
- **Output in the page** goes in with `textContent`. Licence links pass `safeUrl` and open with `rel="noopener noreferrer"`. The JSON field is parsed with `JSON.parse` only.
- **Event log:** `agent.universal` with the mode name only, never the request.

## 3. Cost

Every input is bounded: 40 candidates, 50 messages or list items, 2,000 edges, 400 units, 200,000 characters of text, 100,000 of CSS. Measured on the sandbox:
- route of 40: 0.15 ms;
- a request: 0.03 ms;
- 200,000 characters compressed: 2.9 ms;
- a 2,000-edge chain: 16 ms (breadth-first, at most edges × nodes steps);
- 100,000 characters of CSS: 9.8 ms.

## 4. Honesty

- **Claude figures** come from the claude-api skill's model table, with its cache date and the date read.
- **The 17 other names** carry no price, limit or benchmark, and show «تعذر التحقق منها».
- **The router's scores** are the caller's numbers, tagged [INFERENCE]. An unknown cost is null and never counts as free.
- **Compression** reports characters, not tokens.
- **The review register** says "Rules adopted" only where a rule was written into this code. "Integrated" is not used, because nothing was installed.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |
| `ruff check .claude/skills/replica-universal-agent` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-universal-agent/tests` | 10 tests OK; Python gives the server's answers to all 180 golden requests |
| `node jarvis/scripts/mutation-harness.mjs` | `universal-agent.mjs` 253/253 killed, 3 equivalent, each with its reason |
| `python3 jarvis/scripts/mutation_harness.py` | `universal_agent.py` 274/274 killed |

The mutation run found dead code, now removed:
- the `-0` guard in rounding;
- object guards that `universalAgent` already makes.

It also found that two candidates with the same id made the order undefined, so a repeated id is now refused. Sharper probes were added for missing likelihood or impact, an all-EXTRACTED path, a leading blank line and four-decimal rounding.

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. Sending to any model, hosted or through a local gateway, stays a locked approval.
