---
name: replica-architect-studio
description: The architect studio's four deterministic tools - a domain-separated SHA-256 seal of the architect's code (NFC, "aether-prime:architect-seal:v1:"), compared with the seal the server or this browser holds and never one in the request, showing only five characters; a preview scale for the studio (90 to 120 percent with a 12 px floor, spacing on the 4/8 scale with concentric radii, tabular or proportional numerals) with a SHA-256 of its CSS variables; a composite skill draft (Kahn's order from plan order and the release bundle from release readiness, written as SKILL.md, writing it to disk a locked approval); and an upgrade radar of the skills still in text rules or tested, most depended on first, with the catalog families whose documented licence allows serving them. Standard-library Python only, over the reviewed skills.
---

# replica-architect-studio

```bash
python3 .claude/skills/replica-architect-studio/architect_studio.py '{"mode": "radar"}' --data jarvis/app/data
python3 .claude/skills/replica-architect-studio/architect_studio.py '{"mode": "seal", "passcode": "your code"}' --data jarvis/app/data
python3 -m unittest discover -s .claude/skills/replica-architect-studio/tests
```

## Rules

- The seal is `SHA-256("aether-prime:architect-seal:v1:" + NFC(code))`.
  - It is compared with the seal the caller holds (`--seal`, the server's `JARVIS_ARCHITECT_SEAL`, or the file page's saved hash). A seal sent in the request is never used.
  - Only the first five characters are shown. With no seal set up, the full hash is returned once so it can be saved. The code is never stored.
- The seal locks this studio's own tools (the preview scale and the composite draft). It is not an access control for the server, which is the founder gate (ADR-141).
- Installing, outbound calls, running a model and publishing stay locked approvals in every state.
- The preview scale changes text sizes and spacing in the studio's preview only. Nothing goes below 12 px, the radii stay concentric (outer = inner + padding) and colours do not change.
- The composite draft hands the skills, the model and the notes to plan order and release readiness, which check them. Writing the draft into `.claude/skills` is a locked install approval.
- The radar reads the skill tree's states and the dependency snapshot (EXTRACTED). A tested skill needs a golden file and a full mutation run to be proved; a skill of text rules needs tests first.
- Same answers and chain hash as `jarvis/server/lib/architect-studio.mjs`: `tests/golden.json`.
