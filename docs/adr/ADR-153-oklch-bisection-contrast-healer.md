# ADR-153: The OKLCH bisection contrast healer

Date: 2026-11-07 · Status: Proposed. Ahmad's message of 2026-11-07 asked:
- that a text and background pair that misses DESIGN.md's floor (WCAG ≥ 4.5:1, 3:1 for large text, and APCA |Lc| ≥ 60) be healed rather than only refused;
- for a deterministic bisection of at most 16 steps on the lightness L of `oklch(L C H)`, keeping C and H, to the nearest L that passes both, on dark and light backgrounds alike;
- for it in the server and the skill, in the reversal engine (with the colour, WCAG and APCA Lc before and after in the reversal log), and as an "Auto-Heal Contrast" button and report in the Studio.

## Decision

1. **`jarvis/server/lib/contrast-heal.mjs`** (pure; inlined into the page).
   - **Colours:** `#rgb`, `#rrggbb` or `oklch(L C H)`.
   - **Conversion:** sRGB ↔ OKLab ↔ OKLCH with Björn Ottosson's matrices.
   - **Formulas:** WCAG 2's ratio, and APCA-W3 0.1.9's Lc (the constants the repository's contrast gate and the Studio badge use).
   - **`healOklchContrast(fg, bg, { large, minLc })`:**
     - It tries both ends (L = 1 and L = 0), and bisects 16 times between the current L and each end that passes.
     - It keeps the passing L nearest the original, which is lighter on a dark background and darker on a light one. Where both pass (large text, lower Lc), the nearer one wins.
     - Each candidate is judged on the 8-bit hex it would be written as, so the returned colour really passes.
   - **Gamut:** a lightness that leaves sRGB keeps its hue; chroma is lowered by bisection only as far as sRGB needs, and the result says `chromaReduced`. The first draft clipped channels, which moved a blue's hue by 12°; the server test caught it.
   - **No answer:** a pair that no lightness can fix (for example grey on the same grey, or blue on purple) comes back `ok: false` with the reason, and nothing is changed.
2. **Reversal engine.**
   - **Rule:** `reverseTemplate` gains a sixth rule, `contrast`. A CSS rule that sets both `color` and a solid `background` / `background-color` (hex or oklch), and misses the floor, gets its text colour healed.
   - **Log:** the correction records the selector, the background, the colour before and after, its OKLCH, the WCAG ratio and APCA Lc before and after, and the step count. It goes into the reversal log, the Merkle audit leaf and the memory lesson like every other correction (ADR-150).
   - **Limit:** at most 50 pairs a template, so a hostile 200 KB paste takes about 75 ms.
   - **Fixed point:** running the engine on its own output finds nothing more.
3. **Studio → Colours → "Heal contrast automatically".**
   - **What it does:** it heals the text colour of each failing pair of the six the Studio checks (text, muted text and links on the page; text and muted text on cards; button text). It repeats up to four rounds, because healing the accent can change the button pair.
   - **The report:** each change, as `#before → #after · oklch(…)`, with "WCAG a → b · APCA Lc c → d". A pair that cannot be healed by lightness says so.
   - **The theme:** it becomes "Custom".
   - **Small fix:** the hex fields now carry `dir="ltr"`, so `#eef2f8` no longer reads `eef2f8#` in Arabic.
4. **`replica-reversal-engine` skill.** `reversal_engine.py` gains the same functions:
   - `parse_colour`, `rgb_to_oklch`, `oklch_to_rgb`, `in_gamut`, `wcag_ratio`, `apca_lc` and `heal_oklch_contrast`;
   - the `contrast` rule.

   It rounds and writes numbers as JavaScript does, so for the same template it returns the same text and the same SHA-256 hashes as the server; a unit test pins them.
5. **Mutation run.**
   - `contrast-heal.mjs` joins it: 140 / 140 killed, 11 equivalent.
   - `reversal.mjs` with its new rule: 208 / 208, 29 equivalent.
   - `reversal_engine.py` with the healer: 516 / 516, 25 equivalent.

   To kill comparator mutants, the oracle uses pairs where both directions pass. To kill precision mutants, it pins the exact lightness, now returned as `lightness`. Each equivalent has its reason. All eleven files together: 1,954 / 1,954.

Review: `docs/security/CONTRAST-HEALER-REVIEW-2026-11-07.md`.

## Consequences

- A healed colour is the nearest that passes, not a designer's choice; the Studio shows it, and the preset becomes "Custom" so the person sees it changed.
- Only the text colour moves. When the background is the problem, the healer says it cannot heal, and the person changes the background or the hue.
- The healer judges two colours, not rendered text, so it cannot account for transparency, images behind text or font weight.

## Checks

The results are in the PR body:
- server tests on SQLite and PostgreSQL 16;
- `test-app.mjs` F35 and the live block;
- skill unit tests and ruff;
- the mutation run;
- the bilingual purity gate;
- SkillSpector, contrast, three sizes, retina screenshots and parity.
