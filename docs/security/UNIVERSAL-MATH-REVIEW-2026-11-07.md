# Security review: universal maths (ADR-154)

Date: 2026-11-07 · Reviewer: Claude Code, cloud sandbox.

## 1. Files

| File | Lines | SHA-256 (first 16) | Role |
|---|---|---|---|
| `jarvis/server/lib/universal-math.mjs` | 641 | 31da8bd3490e3d85 | Tokenizer, Pratt parser, algebra, calculus, matrices, RK4, number theory, Bayes, the solver and its Arabic lines |
| `.claude/skills/replica-universal-math/universal_math.py` | 1184 | 071ccf47553d1f1e | The same engine in Python, numbers written as JavaScript writes them |
| `.claude/skills/replica-universal-math/tests/test_universal_math.py` | 81 | 9876a094b7a7bd5c | 9 unit tests, one against the server's golden answers |
| `.claude/skills/replica-universal-math/tests/golden.json` | — | d7e5f4a25a584b13 | 28 requests and the server's answers |

Also changed:
- `server.mjs`: the route `POST /api/w/:slug/math/solve`;
- `app.js`, `shell.tmpl`, `app.css`: the Math lab page, `i18n-ar.json`;
- `build-app.mjs`: inlines the engine in its own scope;
- `bilingual-purity.mjs`: adds `math` to the routes;
- the server, flow and mutation tests.

## 2. What it can do

- **No code is run.**
  - An expression is read character by character into tokens, then into a tree by a Pratt parser. Only `+ - * / ^`, brackets, eight named functions, `pi`, `e`, numbers and names of at most 8 letters are accepted. Anything else is refused with the reason.
  - There is no `eval`, no `Function`, no `import()`, no process and no file or network access, in either language. A unit test checks that the Python source has none of these words.
- **Names:** a name is looked up only among the values the engine itself passes (`x`, or `x` and `y`), with `hasOwnProperty`. `constructor`, `__proto__` and the like are refused: they are too long, or have no value.
- **Output:** numbers, the steps' fixed sentences and formulas built from the tree. The page writes every piece with `textContent` or SVG attributes; the plot is a path of numbers.
- **The API:** the route is behind the same rules as every other write: the `x-jarvis: 1` header, the origin check, JSON only, 64 KB. Each run is an event in the log. No database table is added.

## 3. Cost, and what a hostile request can do

Limits that bound the work:
- an expression of 400 characters, 200 parts, depth 40, so the tree has at most 200 nodes;
- a matrix of 10 × 10;
- 10,000 RK4 steps (20,000 with the doubling check);
- adaptive Simpson stops at 200,000 evaluations;
- Brent stops at 100 iterations, root search at 400 samples;
- Jacobi stops at 100 sweeps;
- factorisation below 2⁶⁴: trial division under 1,000, then Pollard's rho with 19 constants and 200,000 steps each;
- Miller-Rabin only below 3.3·10²⁴, so BigInt sizes stay small;
- at most 10 congruences.

Measured on this machine:
- the largest expression, 200 parts, takes 7 ms;
- `sin(1/x)` near 0, which hits the Simpson cap, takes about 40 ms;
- a semiprime near 2⁶⁴ is factorised in about 0.75 s.

The worst case is a number near 2⁶⁴ that Pollard's rho cannot split. The bound is about 3.8 million BigInt steps, a few seconds, and the request is then refused with "could not be factorised within the limits". In Python, rho uses `math.gcd`, the same number as the extended Euclid, only faster.

## 4. Honesty of the answers

- **[VERIFIED]:** shown only when every backward check passed. The checks and their measured numbers are on the page.
- **The pole case:** a sign change where |f| stays large, as in 1/(x−1), is named as a pole, and no integral is given across it. The first draft gave a finite integral there; it was caught while testing and fixed.
- **Miller-Rabin:** the first draft used 12 bases and claimed to be exact to 3.3·10²⁴. 318,665,857,834,031,151,167,461 passes all twelve. The engine now uses 13 bases and refuses numbers at or above the 13-base bound.
- **CRT:** a modulus of 0 threw a raw `RangeError`, which would have been a 500. It is now checked before use.
- **Roots next to a gap:** a zero at a sample was missed when the next sample was not finite. The mutation run found it, and both engines were fixed.
- **Rounding:** Python's format rounds a tie to even, while JavaScript's toExponential rounds it up (12345 → `1.234e+4` against `1.235e+4`). The Python skill now rounds from the exact binary value, as JavaScript does.

## 5. Checks

| Check | Result |
|---|---|
| `node scripts/skillspector-audit.mjs --strict` on the changed files | 0 critical, 0 high (whole repository: 868 files) |
| `ruff check .claude/skills/replica-universal-math` | all checks passed |
| `python3 -m unittest discover -s .claude/skills/replica-universal-math/tests` | 9 tests OK; Python gives the server's answers to all 28 golden requests |
| `node jarvis/scripts/mutation-harness.mjs` | `universal-math.mjs` 729/729 killed, 49 equivalent, each with its reason |
| `python3 jarvis/scripts/mutation_harness.py` | `universal_math.py` 1281/1281 killed, 45 equivalent, each with its reason |

## 6. Decision

Added. The skill is safe to run on Ahmad's machine as written. A later change needs a new entry here.
