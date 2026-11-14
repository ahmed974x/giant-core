---
name: replica-skill-tree
description: The repository's skills as one tree - roots (AGENTS.md, DESIGN.md, the approval locks, the state prover, the Merkle log, the privacy shield, the contrast healer), a trunk of the engines that join the others (workbench, polymath, universal agent), three branches (Jarvis skills, OMEGA skills, vendored references) and leaves (each skill's tools). Each skill's state comes from facts only - its SkillSpector scan, its tests, its golden file and its mutation run. Compose chosen skills into their path to the roots, the commands that test them and the trunk engine that already runs them together. Standard-library Python only; it reads the repository's files and fetches nothing.
---

# replica-skill-tree

```bash
python3 .claude/skills/replica-skill-tree/skill_tree.py snapshot --root . --out jarvis/app/data/skill-tree-input.json
python3 .claude/skills/replica-skill-tree/skill_tree.py tree jarvis/app/data/skill-tree-input.json
python3 .claude/skills/replica-skill-tree/skill_tree.py compose jarvis/app/data/skill-tree-input.json replica-universal-math replica-foss-atlas
python3 -m unittest discover -s .claude/skills/replica-skill-tree/tests
```

| State | When |
| --- | --- |
| attention | the scan has a critical or high finding in the skill's folder |
| proved | its mutation run killed every mutant and it has a golden file shared with the server |
| tested | it has a tests folder |
| rules | a project skill of text rules only |
| reference | a vendored skill, not run on Ahmad's machine without a review |

`snapshot` reads `jarvis/app/data/knowledge-graph.json` (refresh it with `graphify.py` first), `jarvis/app/data/skills-scan.json`, `jarvis/replica/evidence/mutation-audit.log`, each skill's `tests/` folder and `docs/security/*.md`. Run it after those, then build the Jarvis page. The same tree runs in Jarvis (`jarvis/server/lib/skill-tree.mjs`, `GET /api/w/:slug/tree`, `POST /api/w/:slug/tree/compose`, the `#/tree` page); `tests/golden.json` holds the server's answers.

## Limits

- A review is the first file in `docs/security` that names the skill. It shows where the skill is named, not that the file reviews only that skill.
- The tree shows what is installed in `.claude/skills`. Adding an outside skill or tool is still a written review and Ahmad's approval (AGENTS.md section 1).
