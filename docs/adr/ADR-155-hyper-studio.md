# ADR-155: The hyper studio: 3D to 8D projections, optics and grid physics

Date: 2026-11-07 · Status: Proposed. Ahmad's message of 2026-11-07 asked for:
- a skill and a server engine with no Three.js or other library, drawing in pure SVG;
- the accent `#77bcff` on dark and `#0b5ed7` on light, no blue to purple gradient, and `prefers-reduced-motion` respected;
- 3D: SO(3) rotation, a painter's Z-sort and OKLCH face shading;
- 4D: SO(4) rotations in the six planes and perspective R4 → R3 → R2, for the tesseract (16 vertices, 32 edges) and the 16-cell;
- 8D: the octeract and the E8 root lattice in a Coxeter projection.

His message was cut off in the middle of the 8D part. The rest was taken from his example requests to `POST /api/w/:slug/studio/hyper`:
- `projection` with `{dimension: 8, polytope: "e8_lattice", angles: {xy, zw, xw}, theme}`;
- `optics` with focal length, f-stop, subject distance, sensor width, ISO, shutter and three Kelvin values;
- `game_physics` with a grid, start, goal, obstacles, particles and ticks.

## Decision

1. **`jarvis/server/lib/hyper-studio.mjs`** (pure; inlined into the page in its own scope).
   - **Rotations:**
     - a Givens rotation in any plane of two axes, named with the letters x y z w u v s t, so `xy`, `zw` and `xw` work in every dimension that has them;
     - angles in degrees, at most 28 planes, applied in key order.
   - **Cube:**
     - perspective from z = 5;
     - each face's outward normal is the direction of its centre, since the cube is centred on the origin;
     - the six faces sorted back to front;
     - each face shaded as an OKLCH colour with the accent's chroma and hue, and its lightness from the angle to one light (Lambert);
     - faces turned away drawn at 25 % opacity.
   - **Tesseract and 16-cell:** perspective from w = 3 to R3, then from z = 5 to R2.
   - **8-cube:** the Petrie projection, axis k at k × 22.5°, which shows 16-fold symmetry.
   - **E8:**
     - the 240 roots (112 of the form (±1, ±1, 0⁶), 128 of the form (±½)⁸ with an even number of minus signs);
     - 6720 edges between roots with inner product 1.
     - The projection is the Coxeter plane:
       - c is the product of the reflections in the 8 simple roots (Bourbaki);
       - c + cᵀ is symmetric, so its eigenvectors come from Jacobi rotations;
       - the plane is the eigenspace of its largest eigenvalue, 2 cos(2π/30), which appears twice.
   - **Checks:** each check is its own small exported function, so it can be tested on its own, with failing inputs too:
     - shapes: `lengthsKept`, `normsKept`, `backToFront`, `facingOk`, `facesViewer`, `countsOk`, `isIdentity`, `coxeterOk`, `ringsExact`, `ringsMultiple`;
     - optics: `dofOk`, and `harmonicOk` and `ev100Ok` in relative form;
     - physics: `insideBox`, `pathOk`, `overlapOk`.
   - **Checks per shape:**
     - rotation keeps edge lengths or distances;
     - vertex, edge and degree counts (16/32/4, 8/24/6, 256/1024/8, 240/6720/56);
     - faces in depth order;
     - for E8, that c has order 30 and that the roots fall on 8 rings of 30.
   - **Optics** (thin lens):
     - circle of confusion = sensor diagonal / 1500, for a 3:2 sensor;
     - hyperfocal distance, near and far limits, depth of field and horizontal and vertical field of view;
     - the blur disc of a point at infinity, also as a share of the frame;
     - EV100;
     - each light's colour from the Planckian locus (Kim et al., 2002, 1667 to 25000 K), as hex, OKLCH and mireds, with the fill-to-key shift in mireds.
     - Checks: the subject lies between the limits; the subject is the harmonic mean of the limits; EV100 read back gives the shutter time.
   - **Game physics:**
     - A* with four moves and the Manhattan distance. The open list stays in insertion order, so the first entry with the lowest f is also the oldest; a separate counter for ties was removed when the mutation run showed it could never decide anything;
     - breadth-first search for the true shortest length;
     - Verlet integration with one-tick steps, wall bounces, and equal-mass collisions that swap the normal velocities of approaching particles. Collisions and walls are relaxed together four times. Two centres on the same point are parted along x.
     - Checks: A*'s length equals breadth-first search's, one step at a time and never through an obstacle; every particle stays inside; no overlap above 0.01 of a cell.
   - **Limits:** 40 × 40 grid, 400 obstacles, 24 particles, 600 ticks, gravity within ±1.
   - **`hyperSvg`** writes a projection as SVG text built from numbers only, and the route returns it as `svg`.
2. **`POST /api/w/:slug/studio/hyper`.** A bad request is a 400 with the reason and the part that broke it. Each run is a `hyper.solve` event. It is deliberately not an audited `studio.*` leaf, because these are calculations, not changes.
3. **The page `#/hyper` ("Hyper studio").**
   - **Projection:** a shape picker and three angle sliders. The drawing changes only when a slider moves; nothing animates, so reduced motion has nothing to stop. The shape is drawn in the page by the inlined engine, because a slider would otherwise send a request for every step. Under the drawing are the method, the counts and the checks with [VERIFIED].
   - **Optics and game physics:** a JSON request answered by the store: in the page in sample mode, by the server in live mode.
     - Optics shows a depth-of-field bar, the limits with units translated, the three light swatches with their numbers in code, and the mired shift.
     - Game physics shows the grid with obstacles, the A* path, the start dot and goal ring, and the particles' dashed tracks.
   - **Colours:** edges, outlines, path and start use `--color-accent`, which is `#77bcff` on dark and `#0b5ed7` on light. There is no gradient.
4. **`.claude/skills/replica-hyper-studio/hyper_studio.py`.** The same engine in Python (`run` and `svg`), with `math.cbrt` and JavaScript's rounding so the numbers agree. `tests/golden.json` holds the server's answers to 25 requests, including E8, and both test suites compare against it.
5. **Mutation run.** `hyper-studio.mjs` and `hyper_studio.py` join it, each with an oracle of the golden file and probes pinned from the reviewed code: boundaries at exactly 1e-9, A* on grids where tie-breaking shows, and a breadth-first search that would wrap around the grid's edge. Results:
   - `hyper-studio.mjs`: 808 / 808 killed, 39 equivalent.
   - `hyper_studio.py`: 1052 / 1052 killed, 26 equivalent.
   - All fifteen files together: 5,824 / 5,824.

   Each equivalent has its reason, for example "there are 8 signs, so the count of non-negative ones has the same parity as the count of negative ones".

Review: `docs/security/HYPER-STUDIO-REVIEW-2026-11-07.md`.

## Consequences

- The 8D pictures are one plane among many. The Coxeter plane is the one that shows E8's 30-fold symmetry, but depth is lost.
- The optics are the thin-lens model; real lenses breathe, vignette and diffract.
- The physics is a teaching model with unit time steps, not a game engine.

## Checks

The results are in the PR body:
- server tests on SQLite and PostgreSQL 16;
- `test-app.mjs` F37 and the live block;
- skill unit tests and ruff;
- the mutation run;
- the bilingual purity gate with the hyper studio's results;
- SkillSpector, contrast, three sizes, retina screenshots and parity.
