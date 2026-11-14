# Security review: plan order (ADR-163)

Date: 2026-11-14 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/plan-order.mjs` | 161 | 1b019d53169135a7 | Kahn's order, the behaviour tree, the workbench tree and UCB1, pure |
| `.claude/skills/replica-plan-order/plan_order.py` | 311 | 0916796c79b6aec6 | The dependency reader, and the same rules in Python |
| `.claude/skills/replica-plan-order/tests/test_plan_order.py` | 86 | e43dbd2be36e0593 | 10 unit tests, one against the server's golden answers |
| `.claude/skills/replica-plan-order/tests/golden.json` | — | bef654e9cfbefec5 | 97 requests with the server's answers |
| `jarvis/app/data/skill-deps.json` | 93 | 0bdfa6326c4d8378 | The dependency snapshot the page and the server read |

Also changed:
- `server.mjs`: `POST /api/w/:slug/order`;
- `app.js`, `app.css`, `shell.tmpl`, `i18n-ar.json`: the `#/order` page;
- `build-app.mjs`: embeds the snapshot and inlines the engine;
- `bilingual-purity.mjs`: adds `order` to the routes;
- the server, flow, live and mutation tests.

## 2. What it can do

- **Read files, nothing else.**
  - **`deps`:** lists `.claude/skills`, reads each skill's top-level `.py` files as text and writes one JSON file. It keeps only names of other skill folders found in `sys.path` statements. It imports nothing it reads.
  - **The rules:** pure functions, with no network, no process and no file access. A unit test checks the Python file for the words that would start a process, open a connection or run text as code.
- **Run nothing it orders.** The skill order is a list. The page and the server never run a skill's tests or scripts.
- **Keep the locks.** The workbench mode runs the ADR-160 workbench, which sends nothing. Its locked approvals become a `running` leaf; no rule turns `running` into `success`. UCB1 picks a plan; each plan keeps its locked steps and its proof.
- **Take no dependency from the request.** The server reads `skill-deps.json` from disk and ignores a `deps` field, so a request cannot invent an edge to reorder the skills.
- **Server:** bad input is refused with 400. The event log records `order.<mode>` with counts or the tree's status only; a server test checks that a task's e-mail address never reaches it.
- **Page:** text goes in with `textContent`; skill names and stage ids are isolated as data; links are fixed routes.
- **Bounds:**
  - Kahn: 1 to 200 nodes, at most 2000 edges, names of 1 to 80 characters;
  - skills: 1 to 12 names, each in the snapshot;
  - tree: at most 8 levels, 100 nodes, 20 children a node;
  - UCB1: 2 to 12 arms, visits from 0 to 1,000,000, reward from 0 to visits, c from 0 to 4.

## 3. Honesty

- **Dependencies** are EXTRACTED from `sys.path` lines only. A skill whose files name no other skill has none; nothing is inferred from its description.
- **A cycle** is named and left out of the order. Nothing is dropped to make the graph fit.
- **UCB1** scores only the tries and wins the person types, and says why it chose (untried, tie or score). With no record, the first untried plan is chosen and the page says so. The choice carries [INFERENCE].
- **No search tree** is claimed: only UCT's rule at one node is used, because no outcome simulator exists here that would not be made up.

## 4. Cost

On this sandbox, ordering the polymath engine and the workbench with everything they load takes 0.024 ms, ticking the workbench tree (with the workbench run) 0.41 ms, and one UCB1 choice 0.005 ms.

## 5. Checks

| Check | Result |
|---|---|
| `python3 -m unittest discover -s .claude/skills/replica-plan-order/tests` | 10 tests OK; Python gives the server's answers to all 97 golden requests |
| `ruff check .claude/skills/replica-plan-order` | all checks passed |
| `node jarvis/scripts/mutation-harness.mjs` | `plan-order.mjs` 192/192 killed, 0 equivalent |
| `python3 jarvis/scripts/mutation_harness.py` | `plan_order.py` 212/212 killed |
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |

The mutation run found three checks that could never fail: a node count that always matched, a tie test on a list that always had two entries, and a second tie-breaker that the stable sort already gave. They were removed in both languages, and the order check became `orderKept`, tested on its own with backwards edges and self edges. Probes were added at every limit, for unhashable edge ends and for true and false given as numbers.

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written.
