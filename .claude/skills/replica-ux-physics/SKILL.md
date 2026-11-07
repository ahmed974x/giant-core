---
name: replica-ux-physics
description: Measures a page against the physics of use - Fitts's law (index of difficulty from the thumb, 44 px touch targets), Hick's law (reaction time per group of choices, more than 7 flagged), RTL/LTR mirror symmetry and an attention heatmap - from boxes measured in a browser or from HTML and CSS alone; writes seeded chaos cases (long Arabic with tashkeel, bidi controls, unbroken words, markup that must stay text) and a symbol index with SHA-256 per file. Standard-library Python only; no network, no processes.
---

# replica-ux-physics

```bash
python3 .claude/skills/replica-ux-physics/ux_physics.py jarvis/app/index.html
python3 .claude/skills/replica-ux-physics/ux_physics.py --boxes boxes.json --rtl rtl.json --vw 390 --vh 844 --json
python3 .claude/skills/replica-ux-physics/chaos_fuzzer.py --seed 144 --count 60 --out jarvis/replica/evidence/fuzz-cases.json --root .
python3 .claude/skills/replica-ux-physics/symbol_index.py jarvis/server/lib --out jarvis/replica/evidence/symbol-index.json --root .
python3 -m unittest discover -s .claude/skills/replica-ux-physics/tests
```

## The formulas

| Law | Formula | Rule |
| --- | --- | --- |
| Fitts | ID = log2(D / W + 1); D from the thumb's rest point (bottom centre), W the smaller side | a target under 44 × 44 px fails (DESIGN.md §5) |
| Hick | RT = 0.2 + 0.15 · log2(n + 1) seconds | a group above 7 choices is flagged; the constants are textbook values, so RT carries `[INFERENCE]` |
| Symmetry | error = \|x_ltr − (W − x_rtl − w)\| / W; symmetry = 1 − mean error | the Arabic layout should mirror the English one |
| Heatmap | actions 1.0, headings 0.8 to 0.5, images 0.6, text 0.25, lifted near the thumb on a phone | a weight map, not eye tracking: `[INFERENCE]` |

The same formulas are in `jarvis/server/lib/ux-physics.mjs`, which the Jarvis Studio runs on the boxes its sandboxed preview measures. Keep the two in step; the tests check both against the same numbers.

## Without a browser

`ux_physics.py page.html [style.css]` counts the choices in each `nav`, `menu`, list and form, checks every size the CSS states for a button or link (a side the CSS leaves to the content is not failed), and lists physical sides (`margin-left`, `right:`, `text-align: left` …) that stop a layout from mirroring. `text-align: left` inside a rule that also sets `direction: ltr` (code, logs) is meant and is skipped.

## Chaos cases

`chaos_fuzzer.py` writes data only. Each case says what the page must do with it: wrap without a horizontal page scroll, show markup as text, keep numbers left to right, refuse empty input with a plain message. The same seed always gives the same cases, so a failure can be replayed.

## Limits

- Fitts and Hick are models of average people; they rank layouts, they do not predict one person.
- The HTML mode cannot see sizes the browser computes; use `--boxes` from a real render for those.
- Nothing here is run on a site that is not yours, and nothing is fetched.
