# Security review: the hyper studio (ADR-155)

Date: 2026-11-07 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/hyper-studio.mjs` | 381 | b2ba20a22f6904e9 | Rotations, the five shapes, the E8 Coxeter plane, SVG text, optics, A*, BFS and Verlet |
| `.claude/skills/replica-hyper-studio/hyper_studio.py` | 756 | f975e04169d69144 | The same engine in Python |
| `.claude/skills/replica-hyper-studio/tests/test_hyper_studio.py` | 99 | 1f418fc0f86f9d9e | 12 unit tests, one against the server's golden answers |
| `.claude/skills/replica-hyper-studio/tests/golden.json` | — | fe06950aa4fdb28a | 25 requests and the server's answers |

Also changed:
- `server.mjs`: the route `POST /api/w/:slug/studio/hyper`;
- `app.js`, `shell.tmpl`, `app.css`: the Hyper studio page, `i18n-ar.json`;
- `build-app.mjs`: inlines the engine in its own scope;
- `bilingual-purity.mjs`: adds `hyper` to the routes;
- the server, flow and mutation tests.

## 2. What it can do

- **Pure arithmetic** on numbers in the request. It reads no file, opens no socket, starts no process and stores nothing, in either language. No library is loaded: no Three.js, no WebGL, no canvas.
- **SVG text** (`hyperSvg`, the `svg` field of the API) is built from numbers formatted with `toFixed`, fixed attribute names, the accent colour from a two-entry table, OKLCH strings built from numbers, and the shape name, which must be one of five fixed names. No request text reaches the SVG, so no markup can be injected.
- **The page** draws with `createElementNS` and `setAttribute`, never `innerHTML`. Face fills are the OKLCH strings above.
- **Input:** every number is checked to be finite and within range; cells must be whole numbers inside the grid, and particles must fit. Anything else is a 400 with the reason.

## 3. Cost

- **E8:** 240 roots, and their 28,680 pairs are checked once for the 6720 edges. The Coxeter element is 8 products of 8 × 8 matrices, its order check is 30 more, and Jacobi runs 60 sweeps at most. Measured: about 17 ms.
- **Octeract:** 256 vertices and 1024 edges.
- **Physics:** at most 600 ticks × 4 relaxations × 276 particle pairs.
- **Paths:** A* and BFS on at most 1600 cells. A*'s open list is scanned linearly, at most 1600 × 1600 steps.
- **Size:** the largest answer, E8 with its SVG, is about 0.5 MB of JSON.

## 4. What the mutation run changed

- **Self-checks:** they could not be tested from outside, so each became its own exported function, now tested with failing inputs as well as passing ones.
- **A\*:** a tie counter that could never decide anything was removed. The open list is already in insertion order.
- **Optics:** the two checks became relative comparisons.
- **Cube normals:** they now come from the face centres, which needs no orientation flip.
- **Answers:** none changed: the golden file is the same before and after.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high (whole repository: 875 files) |
| `ruff check .claude/skills/replica-hyper-studio` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-hyper-studio/tests` | 12 tests OK; Python gives the server's answers to all 25 golden requests |
| `node jarvis/scripts/mutation-harness.mjs` | `hyper-studio.mjs` 808/808 killed, 39 equivalent, each with its reason |
| `python3 jarvis/scripts/mutation_harness.py` | `hyper_studio.py` 1052/1052 killed, 26 equivalent, each with its reason |

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
