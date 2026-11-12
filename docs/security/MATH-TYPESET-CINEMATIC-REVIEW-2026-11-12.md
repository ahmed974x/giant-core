# Security review: the SVG maths typesetter and cinematic presets (ADR-157)

Date: 2026-11-12 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/math-typeset.mjs` | 197 | ed0cb6cc6881296d | Boxes and glue, the layout of the solver's tree, integrals, matrices, the box check, the SVG text |
| `jarvis/server/lib/cinematic-presets.mjs` | 160 | ef7be37994e70045 | The 21 presets, the composition and its checks, the healed light colours, the SVG text |
| `.claude/skills/replica-hyper-studio/cinematic_presets.py` | 239 | 63951597cd55113b | The same presets engine in Python |
| `.claude/skills/replica-hyper-studio/tests/test_cinematic_presets.py` | 66 | eb87171081ad1742 | 7 unit tests, one against the server's golden answers |
| `.claude/skills/replica-hyper-studio/tests/golden-cinematic.json` | — | c71a77d87b288925 | 48 requests, the server's answers and the preset list |

Also changed:
- `server.mjs`: `formula_svg` on `POST /api/w/:slug/math/solve`, `GET …/studio/cinematic/presets` and `POST …/studio/cinematic`;
- `app.js`, `app.css`, `i18n-ar.json`: the «Formula» panel in the Math lab and the «Cinematic presets» panel in the hyper studio;
- `build-app.mjs`: inlines the typesetter with universal maths and the presets with the hyper studio;
- the server, flow and mutation tests.

## 2. What it can do

- **No code is run.** Both engines are arithmetic over numbers and the parser's tree. They read no file, open no socket, start no process and store nothing, in either language. The Python file is checked by a unit test for the words that would.
- **The typesetter's text** is only what the Pratt parser accepts: digits, variable names of letters, the eight function names, `π`, `e` and fixed signs. A request the solver refused is never typeset. The server's SVG string escapes `&`, `<` and `>` all the same. The page builds the drawing with `createElementNS` and `textContent`, never from a string.
- **The presets' SVG** has no text at all: numbers formatted from the engine's arithmetic, fixed attribute names, and the accent from a two-entry table. The preset is chosen by its id from a fixed list; anything else is a 400 with the id echoed as `detail`, cut to 80 characters.
- **Colours set in the page** (`el.style.background`, `el.style.color`) are hex values the engine returned from Kelvin arithmetic and the contrast healer. They go through the CSSOM, not a `style` attribute, so the CSP is unchanged.
- **The Python import:** `cinematic_presets.py` adds its own folder and the sibling `replica-reversal-engine` folder to `sys.path`, and imports only from `hyper_studio.py` and `reversal_engine.py`, both reviewed.

## 3. Cost

- A request's tree has at most 200 nodes (ADR-154), so a layout is at most a few hundred boxes. Measured: typesetting the largest example takes 0.5 ms.
- A preset is one optics call, three healer runs (two 16-step bisections each at most) and ten arcs. Measured: 0.44 ms.

## 4. Honesty

- The presets are starting values for a shot and say so on screen with `[INFERENCE]`. The optics, colours and composition are computed and checked.
- Every light colour shown as text passes WCAG 4.5 and APCA Lc 60 on the surface it sits on. The page draws that surface behind the sample, so the checked pair is the pair you see.
- Glyph widths come from a fixed table; the ADR says spacing is close to TeX's, not equal.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high |
| `ruff check .claude/skills/replica-hyper-studio` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-hyper-studio/tests` | 19 tests OK; Python gives the server's answers to all 48 golden requests |
| `node jarvis/scripts/mutation-harness.mjs` | `math-typeset.mjs` 277/277, `cinematic-presets.mjs` 184/184 |
| `python3 jarvis/scripts/mutation_harness.py` | `cinematic_presets.py` 265/265 |

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
