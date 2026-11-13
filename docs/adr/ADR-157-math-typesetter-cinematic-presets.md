# ADR-157: The SVG maths typesetter and cinematic presets

Date: 2026-11-07 (finished 2026-11-12) · Status: Proposed. Ahmad's messages of 2026-11-07 and 2026-11-12 asked for:
- a typesetter that turns the Pratt tree of `universal-math.mjs` into SVG with Knuth's box and glue (fractions, radicals, powers, integrals, matrices), shown in `#/math` above the plot;
- four fixes seen on the first render: brackets round a sum before `dx`, a minus after a minus, `log₁₀` as a real subscript, and the integral's box bounds;
- cinematic presets in `jarvis/server/lib/cinematic-presets.mjs` and the `replica-hyper-studio` skill:
  - angles: `cinematic_anamorphic`, `drone_aerial`, `low_angle_hero`, `macro_closeup`, `isometric_grid`, `tilt_shift_miniature`;
  - lighting: `dramatic_chiaroscuro`, `rim_backlight`, `volumetric_rays`, `golden_hour_5200k`, `blue_hour_7500k`, `studio_three_point`;
  - atmosphere: `dense_fog`, `rainy_night_reflections`, `snow_minimal`, `desert_dusk`;
  - art: `blueprint_sketch`, `liquid_glass_art`, `monochrome_noir`, `paper_cutout_layers`, `wireframe_cad`;
- for each: focal length, f-stop, Kelvin to OKLCH checked for contrast through ADR-153, hyperfocal distance and depth of field, and a golden-ratio SVG in `#/hyper` in the accent (`#77bcff` / `#0b5ed7`), with no gradient and reduced motion respected.

## Decision

1. **`jarvis/server/lib/math-typeset.mjs`** (pure; inlined into the page in the Math lab's scope).
   - **Boxes:** every piece is `{w, h, d, items}`: a width, a height above the baseline and a depth below it, in em. Items are text, filled bars and strokes.
   - **Glue:** fixed spaces: thin (0.12 em) around a centred dot, medium (0.22 em) around `+`, `−` and `=`.
   - **Fractions:** the bar sits on the maths axis, 0.25 em above the baseline; the numerator and denominator are centred on the wider of the two.
   - **Powers:** set at 0.7 of the base's size, never under half, raised to clear the base.
   - **Radicals:** a tick, a long stroke and the bar over the content.
   - **Brackets:** round, square and bars are strokes that stretch to the content, so a tall fraction gets tall brackets.
   - **Integrals:** a stretched sign with its limits small at the top and bottom right, then the integrand, a thin space and `d` with the variable. **Matrices:** columns as wide as their widest cell, cells centred, square brackets.
   - **Glyph widths:** one fixed table (`MT_WIDTH`), not a font file, so the layout is the same on every machine and in every test. The page draws with the system's maths font.
   - **The four fixes:**
     - an integrand that is a sum or difference is bracketed before `dx`;
     - a right operand that starts with a minus is bracketed (`x − (−x)`, `− (−π e)`);
     - `log10` is `log` with `10` lowered 0.2 em at script size;
     - the integral's height and depth come from its limits, which reach past the sign's curls.
   - **`boxesHold`:** checks that every item of a box lies inside it. Every line is checked in the tests.
   - **`solutionLines(request, answer)`:**
     - calculus: f(x), d/dx f and the integral with its limits and value;
     - ODE: dy/dx;
     - linear algebra: A, b and x.
   - **Text only from the tree:** the drawing's only text is digits, variable names, the eight function names and fixed signs.
2. **`jarvis/server/lib/cinematic-presets.mjs`** (pure; inlined with the hyper studio).
   - **The 21 presets:** each is a set of starting values: focal length, f-stop, subject distance, aspect ratio, key, fill and rim Kelvin, and the corner the spiral turns into. They are conventions, not measurements, and are marked `[INFERENCE]`.
   - **Optics:** from `hyper-studio.mjs`: thin lens, depth of field, hyperfocal distance, field of view, background blur, and the lights in OKLCH from the Planckian locus.
   - **Light colours as text:** each light's colour, used as text on the theme's surface (`#10141b` dark, `#ffffff` light), is checked against WCAG 4.5 and APCA Lc 60. Where it fails, the ADR-153 bisection heals it with the hue kept. In the light theme every light is healed: pale warm colours fail on white.
   - **Composition:** the golden section of the frame (lines at 1/φ² and 1/φ), and a golden spiral of ten quarter circles in the largest golden rectangle that fits, mirrored into the preset's corner.
   - **The subject point:** the spiral's eye, where the golden rectangle's top-left to bottom-right diagonal crosses the next rectangle's other diagonal.
   - **Composition checks:**
     - each arc starts exactly where the last ended;
     - each arc's ends are its radius from its centre within 2⁻³⁰ of the radius;
     - everything is inside the frame;
     - the spiral closes on the eye.
   - **Drawing:** SVG in the accent, built from numbers only: frame, golden lines, spiral, subject point and a depth-of-field bar. No gradient, no text, nothing animates.
3. **Server.**
   - `POST /api/w/:slug/math/solve` adds `formula_svg` when the task has a formula (calculus, ODE, linear algebra), in the theme's ink. The solver's own answer is unchanged.
   - `GET /api/w/:slug/studio/cinematic/presets` lists the 21 presets.
   - `POST /api/w/:slug/studio/cinematic` with `{preset, theme, subject_distance_m}` compiles one. An unknown preset or a subject inside the focal length is a 400.
   - Each compile is a `cinematic.compile` event.
4. **Page.**
   - **`#/math`:** a «Formula» panel above the steps and the plot, drawn with `createElementNS` and labelled as one image.
   - **`#/hyper`:** a «Cinematic presets» panel: the preset picker in four groups, the composition, the lens, aspect ratio, focus range, hyperfocal distance, field of view, and the three lights. Each light shows its colour, its Kelvin and its text colour on the real surface.
5. **`.claude/skills/replica-hyper-studio/cinematic_presets.py`.** The same presets engine in Python, using `hyper_studio.py` for the optics and the reviewed `reversal_engine.py` for the healing. `tests/golden-cinematic.json` holds the server's answers to 48 requests and the preset list.
6. **Mutation run.**
   - `math-typeset.mjs`: 277 / 277.
   - `cinematic-presets.mjs`: 184 / 184.
   - `cinematic_presets.py`: 265 / 265.
   - **What the run changed:**
     - two terms of the integral box that could never be the largest were removed;
     - the arc check became exact equality, which first required writing the cut points in the order the next cut reads them, so they meet to the last bit;
     - ISO and shutter speed, which change nothing a preset returns, were dropped.
   - **No answer changed:** the golden file is the same.

Review: `docs/security/MATH-TYPESET-CINEMATIC-REVIEW-2026-11-12.md`.

## Consequences

- Glyph widths are a fixed table, so spacing is close to TeX's, not equal to it. Not covered: summation, limits, piecewise functions.
- The typesetter is in JavaScript only; the Python skills return numbers, not drawings of formulas.
- The presets are starting points for a shot. The thin-lens model leaves out focus breathing and diffraction, as ADR-155 says.

## Checks

The results are in the PR body:
- server tests on SQLite and PostgreSQL 16;
- `test-app.mjs` F39 and the live block;
- skill unit tests and ruff;
- the mutation run;
- the bilingual purity gate with the typeset matrix and a preset;
- SkillSpector, contrast, three sizes, retina screenshots and parity.
