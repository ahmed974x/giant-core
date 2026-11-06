# Security review: replica-quantum-math, cross-window sync and gzip templates (ADR-149)

Date: 2026-11-06 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `.claude/skills/replica-quantum-math/SKILL.md` | 28 | 49ee3100738eb16d | Engines, limits |
| `.claude/skills/replica-quantum-math/quantum_math.py` | 264 | 448589c4333b331f | VPIN, layout, Monte Carlo, Shamir GF(256) |
| `.claude/skills/replica-quantum-math/tests/test_quantum_math.py` | 125 | e50f658298ea56cc | 8 unit tests |

The page changes are in `jarvis/app/src/app.js`: the sync block next to the language code, and the gzip export and import in the Studio.

## 2. The skill

- **Imports:** `argparse`, `hashlib`, `json`, `random`, `re`, `secrets`, `statistics`, `sys`. There is no network, `subprocess`, `exec` or `importlib`.
- **Randomness:**
  - Shamir's coefficients come from `secrets.randbelow`. A caller may pass a generator only for tests, and the docstring says so.
  - Monte Carlo uses a seeded `random.Random`, on purpose, so that runs repeat. It is not a secret.
- **Shares:** each carries the SHA-256 of its bytes. `reconstruct` refuses duplicate x values, x outside 1 to 255, mismatched lengths and a share whose hash does not match.
- **Monte Carlo:** never runs a step with a lock word, `locked: true`, `gate: approval` or a sensitive approval category, nor anything that depends on one.

## 3. Cross-window sync

- `BroadcastChannel` reaches only windows of the same origin in this browser.
- Messages are checked by type:
  - the language must be `ar` or `en`;
  - the theme must be `light` or `dark`;
  - the site must be a string under 600 KB.

  Anything else is ignored. A received message is never re-broadcast.
- The site arrives as text and is stored where the Studio already keeps it. The Studio draws it as before: through the sandboxed preview, with `textContent` only.

## 4. Gzip templates

- **Compression:** `CompressionStream` and `DecompressionStream` are built into the browser; no library, no network, and the CSP is unchanged.
- **Import limits:** at most 1 MB compressed, and reading stops at 2 MB unpacked; a test feeds a 3 MB zip bomb.
- **What is kept:** only the template format, known block types, short keys, strings cut to 400 characters and `#rrggbb` colours. Everything else is dropped.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict .claude/skills/replica-quantum-math` | 0 critical, 0 high |
| `ruff check .claude/skills/replica-quantum-math` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-quantum-math/tests` | 8 tests OK |
| `python3 jarvis/scripts/mutation_harness.py` (with `quantum_math.py`) | 99/99, 2 equivalent |

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
