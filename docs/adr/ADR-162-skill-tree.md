# ADR-162: The skill tree

Date: 2026-11-13 · Status: Proposed. Ahmad's message of 2026-11-13: «صمم تصميم الشجره و جذوره و ركب المهارات و ثبت الادوات و المهارات و خليهم يعملون بطريقه احترافيه» — design the tree and its roots, compose the skills, install the tools and skills, and make them work together.

## Decision

1. **What "install" means here.** The 57 skills in `.claude/skills` are already installed: Claude Code loads them from that folder, and every Jarvis engine they back is wired into the server and the page.
   - The tree shows each one's real state. It installs nothing new.
   - Outside skills and tools still need a written review and Ahmad's approval (AGENTS.md §1), so none were added.
   - The new skill is `replica-skill-tree`, written here.
2. **The snapshot.** `.claude/skills/replica-skill-tree/skill_tree.py snapshot` reads only the repository's files and writes `jarvis/app/data/skill-tree-input.json`. Per skill, it records:
   - its tools and function counts, from `knowledge-graph.json`;
   - its SkillSpector findings by severity, from `skills-scan.json`;
   - whether it has `tests/` and a golden file;
   - its mutation result (killed out of non-equivalent mutants), from `mutation-audit.log`;
   - the first security review that names it.
3. **The engine.** `jarvis/server/lib/skill-tree.mjs` is pure and has no dependencies. It is inlined into the page in its own scope, and `skill_tree.py` gives the same answers (`tests/golden.json`, 43 requests).
   - **Roots**, drawn below a ground line:
     - AGENTS.md and DESIGN.md;
     - the approval locks;
     - the state prover (ADR-145);
     - the Merkle log (ADR-147);
     - the privacy shield (ADR-158);
     - the contrast healer (ADR-153).
   - **Trunk:** the workbench (ADR-160), the polymath engine (ADR-161) and the universal agent (ADR-159). Each lists the skills it already runs together.
   - **Branches:** Jarvis skills (`replica-*`), OMEGA skills (the project skills CLAUDE.md lists), and vendored references.
   - **Leaves:** each skill's tools.
   - **State, from facts only:**
     - `attention`: a critical or high finding;
     - `proved`: every mutant killed and a golden file shared with the server;
     - `tested`: a tests folder;
     - `rules`: text rules only;
     - `reference`: a vendored skill, not run on Ahmad's machine without a review.
4. **Composing skills.** `composeSkills` takes 1 to 12 chosen skills and returns:
   - each one's path down to the roots;
   - the command that tests it (`python3 -m unittest discover -s .claude/skills/<name>/tests`), or why there is none;
   - the trunk engines that already run all of them together;
   - whether every chosen skill is tested.
5. **Server:** `GET /api/w/:slug/tree` and `POST /api/w/:slug/tree/compose`. The event log records `tree.compose` with the count only.
6. **Page:** `#/tree` shows:
   - the counts per state and the mutation total;
   - the SVG tree, with roots, trunk and family names drawn as text, and skills and tools as marks;
   - a facts panel (state, tools, scan, tests, golden file, mutation, the review naming it, its page);
   - the composer;
   - a full table of the skills for screen readers and phones.

## Consequences

- The tree is only as fresh as its snapshot. After a skill, a scan, the structural map or the mutation run changes, run `skill_tree.py snapshot` and rebuild the page.
- The mutation list in CLAUDE.md adds `skill-tree.mjs` and `skill_tree.py`.
