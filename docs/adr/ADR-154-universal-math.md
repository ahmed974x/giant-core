# ADR-154: Universal maths, checked backwards

Date: 2026-11-07 · Status: Proposed. Ahmad's message of 2026-11-07 asked for:
- a maths engine in the server and a standard-library skill, with no eval, no `Function`, no process, and a deterministic linear parser of bounded depth;
- a Pratt parser to a tree, simplification and the exact derivative (power, product, quotient, chain, trig, exp, log);
- adaptive Simpson, and roots by Brent or Newton with the back-check |f(root)| ≤ 1e-9;
- Gaussian elimination with partial pivoting, the determinant, the inverse, the eigenvalues of a symmetric matrix, and RK4 with points for a plot;
- deterministic Miller-Rabin, factorisation, the extended GCD and the modular inverse, the Chinese remainder theorem, and Bayes;
- `POST /api/w/:slug/math/solve`, and a page that shows the steps in pure Arabic or pure English, a [VERIFIED] badge when the back-check passes, and an SVG plot in OKLCH colours.

## Decision

1. **`jarvis/server/lib/universal-math.mjs`** (pure; inlined into the page in its own scope).
   - **Reading:** a tokenizer with implicit products (`2x(x+1)`), then a Pratt parser: `+ -` 10, `* /` 20, `^` 30 and right-associative, unary minus 25. The functions are `sin cos tan exp ln log10 sqrt abs`, the constants `pi` and `e`.
   - **Limits:** 400 characters, 200 parts, nesting 40 deep, names of 8 letters. A name is read only from the values given, never from an object's prototype.
   - **Algebra:** `simplify` folds constants and removes the identities (0 and 1 in sums, products and powers; `x·x = x²`; `--x = x`); `derivative` applies the rules and simplifies; `show` writes the tree back with the fewest brackets, and what it writes parses back to the same function.
   - **Calculus:** roots where the function changes sign on 400 samples, by Brent's method, then up to 5 Newton steps that are kept only while |f| falls. A sign change where |f| stays above 1e-6 is a pole or a jump: it is named, and no integral is given across it. The integral is adaptive Simpson with an explicit stack, at most 200,000 evaluations.
   - **Matrices:** up to 10 × 10. Elimination with partial pivoting gives the solve and the determinant; Gauss-Jordan gives the inverse; cyclic Jacobi rotations give the eigenvalues when the matrix is symmetric.
   - **Equations:** classic RK4 on `dy/dx = f(x, y)`, 1 to 10,000 steps.
   - **Numbers:** BigInt throughout. Miller-Rabin with the first 13 primes as bases is exact below 3,317,044,064,679,887,385,961,981, so larger numbers are refused. The first draft used 12 bases and called itself exact to 3.3·10²⁴; the mutation oracle's list of strong pseudoprimes caught 318,665,857,834,031,151,167,461, which passes all twelve. Factorisation is trial division below 1,000 and Pollard's rho, below 2⁶⁴. CRT merges one congruence at a time and accepts moduli that share factors. A modulus of 0 is refused before it is used (the first draft divided by it).
2. **Checks before [VERIFIED].** An answer is verified only when every check passed, and the checks are shown with what they measured:
   - a derivative against a central difference at 4 points; each root by |f(root)| ≤ 1e-9;
   - a system by its residual (≤ 1e-9), an inverse by A·A⁻¹ = I (≤ 1e-9), eigenvalues by the trace and the determinant;
   - an ODE by step doubling (the error estimate under 1e-6);
   - factors by multiplying back and testing each; a·x + b·y = gcd; x against every congruence;
   - Bayes by multiplying back to the prior.
3. **`POST /api/w/:slug/math/solve`.**
   - The language comes from `?lang=ar` or `body.lang`. In Arabic the step and check sentences are translated, while formulas, numbers and names stay as written. The engine's dictionary (`UM_AR`) equals the page's lines in `i18n-ar.json`, and a server test keeps them equal.
   - A bad request is a 400 with the reason and the part that broke it (`detail`), in the language asked for.
   - Each run is a `math.solve` event.
4. **The page `#/math` ("Math lab").** An example picker, the request as JSON, then:
   - the steps with their formulas in `<code dir="ltr">`;
   - the checks with passed or failed;
   - `[VERIFIED]` or "Not verified";
   - a plot for functions and ODEs: one SVG path in the accent colour, axes in the input border colour, roots as dots in the success colour, with the ranges as HTML beside it.

   In sample mode the inlined engine answers; in live mode the server does.
5. **`.claude/skills/replica-universal-math/universal_math.py`.** The same engine in Python, written so that the numbers come out as JavaScript writes them:
   - shortest digits, exponent form past 10²¹ or under 10⁻⁶;
   - BigInt's truncating division;
   - toExponential's and toPrecision's ties rounded up. Python's format rounds them to even; the oracle caught 12345 → `1.234e+4` against JavaScript's `1.235e+4`.

   `tests/golden.json` holds the server's answers to 28 requests, including the plots. The skill's tests and the server's tests both compare against it.
6. **Mutation run.**
   - `universal-math.mjs`: 729 / 729 killed, 49 equivalent.
   - `universal_math.py`: 1281 / 1281 killed, 45 equivalent.
   - All thirteen files together: 3,964 / 3,964.

   Each oracle has the golden file plus direct checks of every function. It pins Brent's iterates at a fixed iteration count, the parser's depth limits on every path, pivot ties, and the exact boundaries of every tolerance. The tolerances are one table, `UM_TOL`, checked through one `within(err, tol, scale)`.

   The run found four faults that were fixed:
   - a root missed next to a non-finite sample;
   - the 12-base Miller-Rabin;
   - the CRT modulus of 0;
   - Python's ties rounding to even.

   Each equivalent has its reason. For example, "the extra squaring tests a^(n−1) ≡ −1 (mod n), which has no solution for n > 2".
   - **Python harness:** an equivalence can now name its source line, so it cannot hide another mutant of the same kind.

Review: `docs/security/UNIVERSAL-MATH-REVIEW-2026-11-07.md`.

## Consequences

- This is a calculator with backward checks, not a proof system. A verified answer passed its checks to the tolerances shown.
- Roots are found where the sign changes, so a double root that only touches zero is not found; the page says "No root on the interval" and the plot shows it.
- Floating point is IEEE double, rounded to 12 significant digits on screen.

## Checks

The results are in the PR body:
- server tests on SQLite and PostgreSQL 16;
- `test-app.mjs` F36 and the live block;
- skill unit tests and ruff;
- the mutation run;
- the bilingual purity gate with the math result and refusal screens;
- SkillSpector, contrast, three sizes, retina screenshots and parity.
