# ADR-168: Impact analysis (catalog rules, blast radius, line diff)

Date: 2026-11-15 · Status: Proposed. Ahmad's message of 2026-11-15 asked for a deterministic engine in `#/impact`, built on main after ADR-167, with a Node engine and a Python twin that give the same answers. It has three parts: a rule check of the 30-family catalog (no ranking, no performance numbers), the blast radius of a skill, and a line-by-line comparison of two plans or texts.

## Decision

1. **One engine in two languages.**
   - `jarvis/server/lib/impact-analysis.mjs` is pure and is inlined into the page in its own scope.
   - `.claude/skills/replica-impact-analysis/impact_analysis.py` uses the standard library, over `replica-plan-order` and `replica-project-search`.
   - `tests/golden.json` holds 219 requests with the server's answers, 52 of them refusals; Python gives the same answers and hashes.
   - The catalog reaches Python as `jarvis/app/data/model-catalog.json`, which `node jarvis/scripts/build-app.mjs` writes from `model-catalog.mjs`; `--check` fails when it is stale.

2. **`catalog`: a model name against the catalog.** The input is the name, the use (`personal` or `service`, serving the model to others), and optionally the memory in GB and the bits per weight.
   - **The family** is the first of the 30 patterns (ADR-167) that matches. A name that matches none but starts one or more family names (`qwen3.8` starts the three Qwen3.8 families) is `size_unnamed`: those families are listed and no licence is guessed. Any other name is `unknown`, shown with «تعذر التحقق منها».
   - **The licence rule** reads the licence text as the catalog states it:

     | Licence text | Personal | Serving to others |
     |---|---|---|
     | `MIT`, `Apache 2.0` | `allowed` | `allowed` |
     | the same with a note in brackets | `allowed_note` (the note shown as written) | `allowed_note` |
     | a Model-as-a-Service condition (Mistral Large 4) | `allowed_note` | `commercial_licence` |
     | non-production (Codestral) | `non_production` | `not_allowed` |
     | anything else (custom or community terms: Kimi K3 and K3.1 Pro, GLM-5.3, Qwen3.8 Flash and Max, Llama, Gemma 3) | `read_licence` | `read_licence` |

   - **Memory** is parameters × bits ÷ 8 ÷ 10⁹ GB, to two decimals: the weights only, with no runtime cache or overhead added. It is given only when the name is the card the count was read from. Another size of the family (`gpt-oss:20b` against the 120b card) is `other_card`, and a family with no count (Mistral Large 4) is `no_count`. Both show no number. When the memory is typed, `fits` compares the two.
   - **Running the model** is one step, `{action: "install", gate: "approval", locked: true, status: "pending_approval"}`. Nothing here approves it.

3. **`blast`: the blast radius of a skill.** From `skill-deps.json` (EXTRACTED from `sys.path` lines, ADR-163) it gives:
   - what the skill loads, in Kahn's layers (`skillOrder`), with a cycle named and never broken;
   - what loads it: a breadth-first search over the snapshot read backwards, nearest first, ties by name;
   - the pages built on any of those skills, for the eleven page engines including `#/impact` itself;
   - each skill's own test command, from the skill tree's `tests` fact;
   - the server and flow tests when a page is touched, and the mutation run when a touched skill is in it;
   - the five best-matching documents by project search (BM25 and RRF, ADR-164), on the skill's name or the words typed.

4. **`diff`: two texts line by line.**
   - Each text has at most 20,000 characters and 500 lines, and must be well-formed Unicode. Lines split at `\n` or `\r\n`.
   - The longest common subsequence keeps equal lines. When removing and adding keep the same length, a line is removed before one is added.
   - The answer gives the operations with their line numbers, the counts, and the SHA-256 of each text, of the operations' JSON and of the chain: `h0` is 64 zeros, then `h = SHA-256(h + hash)` for each of the three.

5. **Server and page.**
   - `POST /api/w/:slug/impact` reads the catalog module and the snapshots on disk; a catalog or snapshot in the request is ignored. The event log keeps `impact.<mode>` with the verdict or the counts, never the model name, the skill or the texts.
   - `#/impact` has three panels, one per mode, and works in sample mode from the copies built into the page.
   - Tables scroll inside their own box (`contain: inline-size`), so the page stays 390 px wide on a phone; hashes and card names wrap.
   - The runbook (ADR-165) probes `#/impact` with a blast radius of the first skill in the snapshot, as its eleventh page.

## Not done

- **A ranking of models.** The catalog has no independent benchmark, so none is given.
- **Memory for the cache or the runtime.** That depends on the runtime and the context length, and no figure is invented.
- **Summaries of custom licence terms.** Those files were not read in full (ADR-167), so the page says to read them.

## Consequences

- The verdicts follow the catalog's licence text. When ADR-167's table changes, the verdicts change with it, and `--check` makes sure the Python copy follows.
- The mutation list in CLAUDE.md adds `impact-analysis.mjs` and `impact_analysis.py`.
