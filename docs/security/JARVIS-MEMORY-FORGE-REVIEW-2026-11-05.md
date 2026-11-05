# Security review: Jarvis memory bank and Skill Forge (ADR-138)

Date: 2026-11-05 · Reviewer: Claude Code, cloud sandbox.

Ahmad asked for two things:
- An episodic memory with BM25 ranking that feeds the local model with the workspace's own good work, including self-training sessions and a JSONL export.
- A live Skill Forge that hot-mounts a skill into the workspace, while a permanent install into `.claude/skills` stays a locked approval.

Both are new code in `jarvis/server` and the page. Nothing was installed.

## Scope

| File | Role |
|---|---|
| `jarvis/server/lib/bm25.mjs` | Pure ranking: Arabic and English normalisation, stop words, Okapi BM25 (k1 1.2, b 0.75), a boost for episodes that passed their gates |
| `jarvis/server/lib/selfcheck.mjs` | Pure: questions about contrast, locks and spacing, with answers Jarvis computes |
| `jarvis/server/lib/forge.mjs` | Pure: writes a SKILL.md (and, for "python-tool", a standard-library `tool.py`) from a description, reads a pasted SKILL.md, scans files with SkillSpector's own `RULES` plus a Python import check |
| `jarvis/server/lib/memory.mjs` | Database side: episodes, search, examples for the model, self-check, export, forge registry, install request |
| `jarvis/server/server.mjs` | Routes under `/api/workspaces/:slug/memory…` and `…/forge…`; passes examples to the Ollama bridge |
| Schema (`schema-sqlite.sql`, `jarvis/replica/schema.sql`) | `agent_memory_episodes`, `forged_skills` with `forged_skills_scan_clean` and the unique index `forged_skills_one_mounted_name` |
| `jarvis/app/src/app.js` | Memory page, Skill Forge panel; the same three pure files are inlined for sample mode |

## Threats and what stops them

1. **A key gets into memory and then into a model prompt or an export.**
   - `memory.add` tests title and body with SkillSpector's `SEC-KEY-LITERAL` rule and refuses with "Keys belong in the vault, never in memory."
   - The page does the same in sample mode.
   - Tested on the server (`test-server.mjs`) and in the browser (F16).
2. **Memory text steers the model ("prompt injection through retrieval").**
   - Examples go to the model under a fixed heading that says they are data, not instructions.
   - At most three examples, each 1,500 characters at most.
   - The model's answer is still untrusted (ADR-136): plans are rebuilt and locked by `enforceApprovalGates`, and designs pass the clean-room extractor. So a poisoned memory can at worst produce a worse draft. It can never unlock a step.
3. **A forged skill carries a hostile instruction or code.**
   - Every file is scanned with the same `RULES` list that CI uses (`scripts/skillspector-audit.mjs`, imported, not copied).
   - The Python check also refuses `socket`, `urllib`, `http.client`, `requests`, `httpx`, `aiohttp`, `subprocess`, `ctypes`, `smtplib` and `ftplib` imports.
   - Any critical or high finding means the skill is not mounted.
   - The database repeats the rule: `forged_skills_scan_clean` refuses a row whose scan has critical or high findings, even from a direct SQL insert. Tested on SQLite and PostgreSQL 16.
4. **A forged skill reaches the repository or runs.**
   - "Mounted" means a row in `forged_skills`: a name the Skill Mixer and the agent editor can show and link.
   - Nothing writes to `.claude/skills`, and nothing runs the files.
   - "Install into the repo…" creates an `install` approval, which is locked by category (AGENTS.md §1). It shows as «قيد الموافقة» and has no approve button.
   - The live test checks that the folder does not appear.
5. **Cross-workspace reads.** Every query filters on the workspace id taken from the route's slug. Delete and unmount also check the workspace. A wrong id answers 404.
6. **Request abuse.**
   - Titles are capped at 160 characters, bodies at 8,000, tags at 8 × 24, and SKILL.md at 64 KB.
   - Search reads at most 5,000 episodes per workspace and returns at most 50.
   - Self-check asks between 3 and 30 questions.
   - Writes need the server's existing guards: Host check, `X-Jarvis: 1`, same origin, JSON size cap.
7. **Export leaks.** The export is per workspace, served as an `attachment` with `nosniff` and `no-store`. It holds what the person saw on the page, and no key can be in it (point 1).

## Checks

| Check | Result |
|---|---|
| `node jarvis/server/test/test-server.mjs` (SQLite + PostgreSQL 16) | see `jarvis/replica/evidence/tests-server.log` |
| `node jarvis/scripts/test-app.mjs` (F16: 21 memory and forge flows) | see `tests-app.log` |
| `node jarvis/scripts/test-live.mjs` (memory, self-check graded against a fake model, export, forge, locked install) | see `tests-live.log` |
| `node scripts/skillspector-audit.mjs --strict jarvis .claude/skills` | 0 critical, 0 high |

## Limits, said plainly

- BM25 matches words, not meaning. An episode about "radius" is not found by "corner". This is retrieval, not understanding, and the page says so.
- The self-check grades only the first yes, no or number in the model's reply. A model that hedges is marked wrong. That is the intended strictness.
- The forge's scan is pattern-based. It is a gate before review, not a review. That is why installing into the repository stays a person's decision with a written review.
