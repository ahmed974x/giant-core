# ADR-138: Jarvis memory bank, live Skill Forge, and the replica-cyber-recon and replica-hybrid-python skills

Date: 2026-11-05 · Status: Proposed. Ahmad's messages of 2026-11-05 asked for ADR-138 on `claude/replica-design-jarvis`, after ADR-137 and before PR #52 is merged. ADR-139 (live open-web search) follows as its own commit.

## Context

After ADR-137, Jarvis forgot everything between runs. A good plan or design in a workspace did not help the next one, and the local model started from nothing every time. Skills could only be checked in the browser and downloaded; using a new one meant installing it, which AGENTS.md §1 locks. Ahmad asked for:
- two standard-library skills, each with a security review:
  - defensive recon;
  - "hybrid" design engines with a 50,000-item curriculum;
- an episodic memory ranked with BM25 that feeds the local model, with self-training sessions and a JSONL export;
- a Skill Forge that hot-mounts a skill in the workspace while the permanent install stays locked.

## Decision

1. **`replica-cyber-recon`** (`.claude/skills/replica-cyber-recon`). Four tools:
   - **`secret_audit`:** known key shapes plus Shannon entropy, redacted to four characters.
   - **`static_guard`:** markup sinks, code from strings, processes, SQL from strings, a weak CSP, prompt injection, locked actions; a `static-guard: reviewed - <reason>` marker that keeps the finding; detection rule lists between SkillSpector's markers skipped but reported.
   - **`manifest_parse`:** openapi.json, llms.txt, security.txt (RFC 9116), robots.txt.
   - **`sbom_integrity`:** SHA-256 manifests.

   Twelve unit tests. Review: `docs/security/CYBER-RECON-SKILL-REVIEW-2026-11-05.md`.
2. **`replica-hybrid-python`** (`.claude/skills/replica-hybrid-python`):
   - **`topology_synth`:** Weisfeiler-Lehman fingerprint, archetype, golden-ratio scale, clean template with a pinned CSP.
   - **`dag_scheduler`:** `graphlib` batches, critical path, locked steps held.
   - **`pattern_memory`:** a Markov chain weighted by gates passed.
   - **`static_intel`:** manifest inventory, entropy audit.
   - **`curriculum_50k`:** 258,048 layouts and 54,250 Arabic/English Q&A pairs. Every answer is computed. Item *k* is the same on every machine.

   Six unit tests. Review: `docs/security/HYBRID-PYTHON-SKILL-REVIEW-2026-11-05.md`.
3. **Static guard dogfood fix.** `static_guard` found four `update … set ${sets}` helpers in `store.mjs` and `missions.mjs`. Each now builds its column list only from an allowlist (`onlyColumns`) and carries a reviewed marker.
4. **Memory bank** (`jarvis/server/lib/bm25.mjs`, `selfcheck.mjs`, `memory.mjs`):
   - **Table:** `agent_memory_episodes`. Kinds: plan, design, answer, lesson, note, search, skill.
   - **Search:** BM25 with k1 1.2 and b 0.75, after Arabic normalisation (marks, tatweel, alef, ya and ta marbuta folded) and stop words in both languages. Episodes whose gates passed rank higher.
   - **What is recorded:** finished missions, `/api/llm/run` answers, plans and designs, and notes.
   - **Model examples:** `/api/llm/run` and "Plan with the local model" pass the best three episodes to the Ollama bridge. They go under a fixed heading that marks them as data.
   - **Self-check:** questions with answers Jarvis computes. With a model, its answers are graded; every computed answer is stored as a lesson.
   - **Export:** JSONL, one chat pair per line.
   - **Refusal:** text holding a key-shaped value is refused.
5. **Skill Forge** (`jarvis/server/lib/forge.mjs`, registry in `memory.mjs`):
   - **Input:** a description writes a SKILL.md, plus a standard-library `tool.py` for the "python-tool" kind. A pasted SKILL.md is read from its front matter.
   - **Scan:** every file is scanned with SkillSpector's own `RULES`. Network and process imports in Python are refused.
   - **Mount:** a clean skill is mounted in `forged_skills`, guarded by `forged_skills_scan_clean` and `forged_skills_one_mounted_name`. It appears in the Skill Mixer and the agent editor at once.
   - **Install:** "Install into the repo…" creates a locked `install` approval. Nothing is written into `.claude/skills` and nothing runs.
6. **Page.** `#/memory`, with:
   - search and the kind filter;
   - matched words and scores;
   - outcomes;
   - delete and add-note;
   - the self-check panel and Export JSONL;
   - the curriculum commands.

   The Skill Mixer gains the Skill Forge panel at its top and a "Forged in this workspace" source. The three pure files are inlined, so sample mode (`file://`) runs the same BM25, scan and self-check in the browser. Every new string has its Arabic line. A closed dialog is now emptied, so no stale text stays in the page. Placeholders of text areas are now translated and covered by the Arabic test; code-sample placeholders are marked `translate="no"`.

## Consequences

- The local model sees the workspace's best past work, which steers drafts toward what already passed the gates. A poisoned episode can only make a worse draft: locks are still decided by `enforceApprovalGates`, and designs still pass the clean-room extractor.
- BM25 matches words, not meaning. That is enough for a workspace's own vocabulary, and it is explainable: the page shows the matched words.
- Jarvis still trains nothing. The curriculum and the JSONL export are files Ahmad may use with his own tools on his machine.
- Forged skills are usable in the workspace at once without touching the repository. The permanent install keeps Director 00's approval and a written review.

## Checks

The results are in the PR body. They cover:
- **SkillSpector:** `--strict` on the changed paths and on the whole repository.
- **Server tests:** SQLite and PostgreSQL 16.
- **Flow tests:** `test-app.mjs`, with F16 for memory and forge, and the Arabic coverage of `#/memory`; `test-live.mjs`.
- **Skill unit tests** and `ruff`.
- **Contrast** and **three sizes**, in Arabic and English.
- **Parity:** 100.0 with 59 rows.
