# ADR-170: The architect studio (#/architect)

Date: 2026-11-15 · Status: Proposed. Ahmad's message of 2026-11-15 asked for an architect studio, built on main after ADR-169. It has four parts:
- a domain-separated SHA-256 seal that opens the studio's tools;
- a live scale for text, spacing and numerals;
- a composite skill composer that hands its checks to the engines it calls;
- an upgrade radar.

## Decision

1. **The route is `#/architect`, not `#/studio`.** `#/studio` is already the Studio of ADR-133 (the preview, the time machine and the exporter). The page is «استوديو المصمم» / Architect studio.

2. **One engine in two languages.**
   - `jarvis/server/lib/architect-studio.mjs` is pure and is inlined into the page in its own scope.
   - `.claude/skills/replica-architect-studio/architect_studio.py` uses the standard library, over `replica-plan-order`, `replica-skill-tree`, `replica-impact-analysis` and `replica-release-gate`.
   - `tests/golden.json` holds 96 requests with the server's answers, 48 of them refusals with their status; Python gives the same answers and chain hashes.

3. **The seal.** `SHA-256("aether-prime:architect-seal:v1:" + NFC(code))`.

   - **Where the expected seal lives.** On the server it is `JARVIS_ARCHITECT_SEAL` (or the `architectSeal` start option); in the file page it is the hash this browser saved.

   - **A seal sent in the request is never used.** Otherwise anyone could send the hash of their own code and unlock the studio.

   - **What is shown.** Only the first five characters, as an audit prefix. With no seal set up, the full hash is returned once so it can be saved. The file page saves it in this browser; the server page shows it with the variable to set. The code is never stored or logged.

   - **States.** `unlocked` («وضع المصمم الرئيسي: مفعّل»), `locked` («للقراءة فقط: يتطلب ختم المصمم») or `not_configured`. The preview scale and the composite draft need `unlocked`; otherwise they are refused with 403.

   - **The locks stay.** Installing or writing a skill, outbound connections, running a model and publishing stay locked approvals in every state (ADR-141).

   - **What the seal is not.** It locks this studio's own tools. It is not the server's sign-in, which is the founder gate (ADR-141), and in the file page it is a convenience lock in one browser.

4. **The preview scale.**
   - **Text size:** 90 to 120 percent of DESIGN.md's sizes (body 15, headline 17, footnote 13, caption 12 px), to two decimals, never below 12 px.
   - **Spacing:** compact, balanced or spacious, a unit of 4, 8 or 12 px. The padding is twice the unit, and the outer radius is the inner radius (12 px) plus the padding.
   - **Numerals:** tabular or proportional.
   - **What it touches.** The tokens apply to the studio's preview card only. Every other number on the pages stays tabular (DESIGN.md §2), and colours do not change, so the contrast gate's result stands.
   - **What is kept.** The answer carries the SHA-256 of its CSS variables, and this browser keeps the last scale.

5. **The composite skill.** A name (2 to 48 lower-case letters, digits and hyphens), a one-line description and two or more skills, with an optional model, use and notes.
   - The skills, the model and the notes go to release readiness's bundle (ADR-169, through impact analysis), and the skills to plan order's Kahn order (ADR-163). Those engines keep their own checks.
   - The answer is a `SKILL.md` draft built from those facts: the layers, a cycle if there is one, the real test commands, the pages and the model's verdict.
   - Writing it to `.claude/skills/<name>/SKILL.md` is a locked install step, followed by the bundle's own locked steps.

6. **The upgrade radar.**
   - It lists the skill tree's skills in «قواعد نصية» or «مُختبَرة», the most depended on first (a reverse breadth-first search over `skill-deps.json`), then by name.
   - Next to each it names the next step to «مُبرهَن»: tests first, or a golden file and the full mutation run.
   - It also lists the catalog families whose documented licence allows serving them to others, alphabetically, with no ranking.
   - Reading it needs no seal.

7. **Server and records.**
   - `POST /api/w/:slug/architect`. The event log keeps `architect.<mode>` with the seal's state and counts, never the code or its hash.
   - The runbook probes `#/architect` with the radar, as its thirteenth page.
   - Impact analysis's page list gains `#/release` (missing since ADR-169) and `#/architect`.

## Not done

- **Saving the scale on the server.** It is kept in this browser only; nothing else reads it.
- **Changing the whole interface's scale or colours.** DESIGN.md fixes them, and the contrast gate checks them.
- **Writing a composite skill to disk.** That stays a locked install approval.

## Consequences

- To use the studio on the server, set `JARVIS_ARCHITECT_SEAL` to the hash the seal step shows, then restart the server.
- The mutation list in CLAUDE.md adds `architect-studio.mjs` and `architect_studio.py`.
