---
name: replica-universal-math
description: Exact, step-by-step maths with every answer checked backwards - a Pratt parser (no eval) with simplification and the exact symbolic derivative, roots by Brent's method and Newton with |f(root)| <= 1e-9, adaptive Simpson, Gaussian elimination with partial pivoting, determinant, inverse and Jacobi eigenvalues, classic RK4 with a step-doubling error check, deterministic Miller-Rabin (13 bases), Pollard's rho, extended Euclid, the Chinese remainder theorem and Bayes. Steps in English or Arabic. Standard-library Python only; no network, no processes.
---

# replica-universal-math

```bash
python3 .claude/skills/replica-universal-math/universal_math.py solve request.json
python3 .claude/skills/replica-universal-math/universal_math.py solve request.json --lang ar
echo '{"task":"number_theory","n":104729,"crt_remainders":[2,3,2],"crt_moduli":[3,5,7]}' | python3 .claude/skills/replica-universal-math/universal_math.py solve -
python3 .claude/skills/replica-universal-math/universal_math.py derive "x^x"
python3 -m unittest discover -s .claude/skills/replica-universal-math/tests
```

| Task | Request | What it does | Checked by |
| --- | --- | --- | --- |
| `calculus` | `expression`, `variable`, `interval` | simplify, exact derivative (power, product, quotient, chain; sin, cos, tan, exp, ln, log10, sqrt, abs), roots by Brent then a Newton polish, adaptive Simpson | the derivative against a central difference at 4 points; each root by \|f(root)\| ≤ 1e-9. A sign change where \|f\| stays large is named as a pole or a jump, and no integral is given across it |
| `ode_rk4` | `expression` in x and y, `x0`, `y0`, `x_end`, `steps` (1 to 10,000) | classic fourth-order Runge-Kutta, the points for a plot | step doubling: the error estimate stays under 1e-6 |
| `linear_algebra` | `matrix` (square, up to 10 × 10), `rhs` | determinant and solve by elimination with partial pivoting, inverse by Gauss-Jordan, eigenvalues of a symmetric matrix by Jacobi rotations | the residual max\|Ax − b\| ≤ 1e-9; A·A⁻¹ = I to 1e-9; the eigenvalues add up to the trace and multiply to the determinant |
| `number_theory` | `n`, `a` and `b`, `crt_remainders` and `crt_moduli` | Miller-Rabin with the first 13 primes as bases (exact below 3.3·10²⁴, so larger numbers are refused), trial division and Pollard's rho below 2⁶⁴, extended Euclid and the modular inverse, CRT for moduli that need not be coprime | the factors multiply back and each is prime; a·x + b·y = gcd; x leaves every remainder |
| `bayes` | `prior`, `sensitivity`, `false_positive` | P(E) and P(H\|E) | multiplying back gives the prior |

An answer is `verified` only when every check passed; the checks are listed with the numbers they measured.

The same maths runs in Jarvis (`jarvis/server/lib/universal-math.mjs`, `POST /api/w/:slug/math/solve`, the Math lab page). For the same request both return the same steps, checks and numbers: `tests/golden.json` holds the server's answers, and both test suites compare against it.

## Limits

- Expressions: 400 characters, 200 parts, nesting 40 deep, names of at most 8 letters. Anything else is refused with the reason; nothing is run.
- Floating point: answers are rounded to 12 significant digits. Roots are found where the function changes sign on 400 samples of the interval, so a double root that only touches zero is not found.
- Eigenvalues are computed for symmetric matrices only.
- This is a calculator with checks, not a proof system: a verified answer passed its backward checks to the tolerances shown.
