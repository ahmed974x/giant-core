#!/usr/bin/env python3
"""Universal maths with every answer checked backwards (ADR-154). Standard library only: no network, no process,
no eval. The same maths as Jarvis's server (jarvis/server/lib/universal-math.mjs); for the same request both
return the same steps, checks and numbers.

    python3 universal_math.py solve request.json [--lang ar]
    echo '{"task":"calculus","expression":"x^3 - 6*x^2 + 11*x - 6","interval":[0.5,3.5]}' | python3 universal_math.py solve -
    python3 universal_math.py derive "sin(x)^2" [--var x]

Tasks: calculus (simplify, exact derivative, roots by Brent then Newton with |f(root)| <= 1e-9, adaptive
Simpson), ode_rk4 (classic Runge-Kutta with a step-doubling error check), linear_algebra (Gaussian elimination
with partial pivoting, determinant, Gauss-Jordan inverse, Jacobi eigenvalues of a symmetric matrix),
number_theory (deterministic Miller-Rabin, trial division and Pollard's rho, extended Euclid, CRT) and bayes.
"""

import argparse
import json
import math
import sys
from decimal import ROUND_HALF_UP, Decimal

LIMITS = {"chars": 400, "tokens": 200, "depth": 40, "size": 10, "ode_steps": 10000, "crt": 10}
# Every tolerance in one place, the same as UM_TOL in universal-math.mjs.
TOL = {"root": 1e-9, "pole": 1e-6, "same_root": 1e-9, "pivot": 1e-12, "probe_step": 1e-5, "deriv": 1e-4, "ode": 1e-6, "sym": 1e-12, "residual": 1e-9,
       "singular": 1e-9, "identity": 1e-9, "trace": 1e-9, "det": 1e-8, "bayes": 1e-12}


def within(err, tol, scale=1):
    """A relative check: err is at most tol times |scale|, or times 1 when |scale| is below 1."""
    return err <= tol * max(1, abs(scale))
FUNCS = ["sin", "cos", "tan", "exp", "ln", "log10", "sqrt", "abs"]
CONSTS = {"pi": math.pi, "e": math.e}
INF = float("inf")
NAN = float("nan")


class MathError(ValueError):
    status = 400

    def __init__(self, message, detail=None):
        super().__init__(message)
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise MathError(message, detail)


# ---- Numbers written as JavaScript writes them -------------------------------------------------------------
def js_round(x):
    return math.floor(x + 0.5)


def js_str(v):
    """String(number) in JavaScript: shortest round-trip digits, no .0, exponent past 1e21 or under 1e-6."""
    v = float(v)
    if v != v:
        return "NaN"
    if v in (INF, -INF):
        return "Infinity" if v > 0 else "-Infinity"
    if v == 0:
        return "0"
    _, dig, exp = Decimal(repr(abs(v))).normalize().as_tuple()
    digits = "".join(str(x) for x in dig)
    e10 = len(digits) + exp - 1
    sign = "-" if v < 0 else ""
    if -7 < e10 < 21:
        if e10 < 0:
            return sign + "0." + "0" * (-e10 - 1) + digits
        whole = digits[:e10 + 1].ljust(e10 + 1, "0")
        return sign + whole + ("." + digits[e10 + 1:] if len(digits) > e10 + 1 else "")
    return sign + digits[0] + ("." + digits[1:] if len(digits) > 1 else "") + "e" + ("+" if e10 > 0 else "-") + str(abs(e10))


def _digits(v, d):
    """The sign, the mantissa with d decimals and the exponent of |v|, rounded as JavaScript's toExponential and
    toPrecision round: from the exact binary value, a tie going to the larger magnitude (Python's format would
    round a tie to even)."""
    x = Decimal(abs(v))
    if x == 0:
        return "", Decimal(0).quantize(Decimal(1).scaleb(-d)), 0
    e = x.adjusted()
    q = x.scaleb(-e).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
    if q >= 10:
        e += 1
        q = x.scaleb(-e).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
    return ("-" if v < 0 else ""), q, e


def to_precision(v, p):
    if not math.isfinite(v):
        return v
    sign, q, e = _digits(v, p - 1)
    return float(f"{sign}{q:f}e{e}")


def to_exponential(v, d):
    if not math.isfinite(v):
        return js_str(v)
    sign, q, e = _digits(v, d)
    return f"{sign}{q:f}e{'+' if e >= 0 else '-'}{abs(e)}"


def fmt(v):
    return js_str(v) if float(v).is_integer() else js_str(to_precision(v, 10))


def r12(v):
    return _num(to_precision(v, 12))


def _num(x):
    return int(x) if isinstance(x, float) and x.is_integer() and abs(x) < 2 ** 53 else x


# ---- Arithmetic that answers like JavaScript (NaN and Infinity instead of exceptions) -----------------------
def _div(a, b):
    if b == 0:
        if a == 0 or a != a:
            return NAN
        return math.copysign(INF, a) * math.copysign(1, b)
    return a / b


def _pow(a, b):
    try:
        r = math.pow(a, b)
    except OverflowError:
        return -INF if a < 0 and float(b).is_integer() and b % 2 == 1 else INF
    except (ValueError, ZeroDivisionError):
        if a == 0 and b < 0:
            return INF
        return NAN
    return r


def _call(f, x):
    try:
        if f == "sin":
            return math.sin(x)
        if f == "cos":
            return math.cos(x)
        if f == "tan":
            return math.tan(x)
        if f == "exp":
            try:
                return math.exp(x)
            except OverflowError:
                return INF
        if f == "ln":
            return -INF if x == 0 else math.log(x)
        if f == "log10":
            return -INF if x == 0 else math.log10(x)
        if f == "sqrt":
            return math.sqrt(x)
        return abs(x)
    except ValueError:
        return NAN


# ---- Expressions ------------------------------------------------------------------------------------------
def _isdigit(c):
    return "0" <= c <= "9"


def _isalpha(c):
    return ("a" <= c <= "z") or ("A" <= c <= "Z") or c == "_"


def tokenize(src):
    s = "" if src is None else str(src)
    if not s.strip():
        _fail("Write an expression first.")
    if len(s) > LIMITS["chars"]:
        _fail("Keep the expression under 400 characters.")
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c in " \t":
            i += 1
            continue
        if _isdigit(c) or c == ".":
            j = i
            while j < len(s) and (_isdigit(s[j]) or s[j] == "."):
                j += 1
            if j < len(s) and s[j] in "eE" and (
                (j + 1 < len(s) and _isdigit(s[j + 1])) or (j + 2 < len(s) and s[j + 1] in "+-" and _isdigit(s[j + 2]))
            ):
                j += 2 if s[j + 1] in "+-" else 1
                while j < len(s) and _isdigit(s[j]):
                    j += 1
            text = s[i:j]
            try:
                v = float(text)
            except ValueError:
                v = NAN
            if not math.isfinite(v):
                _fail("A number could not be read.", text)
            out.append({"t": "n", "v": v})
            i = j
        elif _isalpha(c):
            j = i
            while j < len(s) and (_isalpha(s[j]) or _isdigit(s[j])):
                j += 1
            out.append({"t": "id", "v": s[i:j].lower()})
            i = j
        elif c in "+-*/^(),":
            out.append({"t": c})
            i += 1
        else:
            _fail("This sign is not maths Jarvis reads.", c)
        if len(out) > LIMITS["tokens"]:
            _fail("The expression has more than 200 parts.")
    res = []
    for tk in out:
        p = res[-1] if res else None
        if p and (p["t"] in ("n", ")") or (p["t"] == "id" and p["v"] not in FUNCS)) and tk["t"] in ("n", "id", "(") and not (p["t"] == "n" and tk["t"] == "n"):
            res.append({"t": "*"})
        res.append(tk)
    return res


BP = {"+": 10, "-": 10, "*": 20, "/": 20, "^": 30}


def parse(src):
    tk = tokenize(src)
    pos = [0]

    def peek():
        return tk[pos[0]] if pos[0] < len(tk) else None

    def nxt():
        t = peek()
        pos[0] += 1
        return t

    def expr(rbp, depth):
        if depth > LIMITS["depth"]:
            _fail("The expression is nested too deeply.")
        t = nxt()
        if t is None:
            _fail("The expression ends too early.")
        if t["t"] == "n":
            left = {"k": "n", "v": t["v"]}
        elif t["t"] == "id":
            if t["v"] in FUNCS:
                if not peek() or peek()["t"] != "(":
                    _fail("A function needs brackets, as in sin(x).", t["v"])
                nxt()
                a = expr(0, depth + 1)
                if not peek() or peek()["t"] != ")":
                    _fail("A bracket is not closed.")
                nxt()
                left = {"k": "f", "f": t["v"], "a": a}
            elif t["v"] in CONSTS:
                left = {"k": "c", "n": t["v"]}
            elif len(t["v"]) <= 8:
                left = {"k": "v", "n": t["v"]}
            else:
                _fail("A name is too long.", t["v"])
        elif t["t"] == "(":
            left = expr(0, depth + 1)
            if not peek() or peek()["t"] != ")":
                _fail("A bracket is not closed.")
            nxt()
        elif t["t"] == "-":
            left = {"k": "neg", "a": expr(25, depth + 1)}
        elif t["t"] == "+":
            left = expr(25, depth + 1)
        else:
            _fail("Something unexpected is in the expression.", t["t"])
        while peek() and peek()["t"] in BP and BP[peek()["t"]] > rbp:
            op = nxt()["t"]
            left = {"k": op, "a": left, "b": expr(BP[op] - 1 if op == "^" else BP[op], depth + 1)}
        return left

    ast = expr(0, 0)
    if pos[0] < len(tk):
        _fail("Something unexpected follows the expression.", tk[pos[0]]["t"])
    return ast


def evaluate(n, env=None):
    env = env or {}
    k = n["k"]
    if k == "n":
        return n["v"]
    if k == "c":
        return CONSTS[n["n"]]
    if k == "v":
        if n["n"] not in env:
            _fail("A name has no value.", n["n"])
        return env[n["n"]]
    if k == "neg":
        return -evaluate(n["a"], env)
    if k == "f":
        return _call(n["f"], evaluate(n["a"], env))
    a, b = evaluate(n["a"], env), evaluate(n["b"], env)
    if k == "+":
        return a + b
    if k == "-":
        return a - b
    if k == "*":
        return a * b
    if k == "/":
        return _div(a, b)
    return _pow(a, b)


def num(v):
    return {"k": "n", "v": float(js_round(v)) if abs(v - js_round(v)) < 1e-12 else v}


def is_n(n, v=None):
    return n["k"] == "n" and (v is None or n["v"] == v)


def same(a, b):
    return a == b


def has_var(n, x):
    k = n["k"]
    if k == "v":
        return n["n"] == x
    if k in ("n", "c"):
        return False
    if k in ("neg", "f"):
        return has_var(n["a"], x)
    return has_var(n["a"], x) or has_var(n["b"], x)


def simplify(n):
    k = n["k"]
    if k in ("n", "v", "c"):
        return n
    if k == "f":
        a = simplify(n["a"])
        if n["f"] == "ln" and a["k"] == "c" and a["n"] == "e":
            return num(1)
        if is_n(a) and math.isfinite(evaluate({"k": "f", "f": n["f"], "a": a})) and n["f"] == "abs":
            return num(abs(a["v"]))
        return {"k": "f", "f": n["f"], "a": a}
    if k == "neg":
        a = simplify(n["a"])
        if is_n(a):
            return num(-a["v"])
        if a["k"] == "neg":
            return a["a"]
        return {"k": "neg", "a": a}
    a, b = simplify(n["a"]), simplify(n["b"])
    if is_n(a) and is_n(b):
        v = evaluate({"k": k, "a": a, "b": b})
        if math.isfinite(v):
            return num(v)
    if k == "+":
        if is_n(a, 0):
            return b
        if is_n(b, 0):
            return a
        if b["k"] == "neg":
            return simplify({"k": "-", "a": a, "b": b["a"]})
        if is_n(b) and b["v"] < 0:
            return {"k": "-", "a": a, "b": num(-b["v"])}
        if same(a, b):
            return simplify({"k": "*", "a": num(2), "b": a})
    elif k == "-":
        if is_n(b, 0):
            return a
        if is_n(a, 0):
            return simplify({"k": "neg", "a": b})
        if b["k"] == "neg":
            return simplify({"k": "+", "a": a, "b": b["a"]})
        if is_n(b) and b["v"] < 0:
            return {"k": "+", "a": a, "b": num(-b["v"])}
        if same(a, b):
            return num(0)
    elif k == "*":
        if is_n(a, 0) or is_n(b, 0):
            return num(0)
        if is_n(a, 1):
            return b
        if is_n(b, 1):
            return a
        if is_n(a, -1):
            return simplify({"k": "neg", "a": b})
        if is_n(b) and not is_n(a):
            return simplify({"k": "*", "a": b, "b": a})
        if is_n(a) and b["k"] == "*" and is_n(b["a"]):
            return simplify({"k": "*", "a": num(a["v"] * b["a"]["v"]), "b": b["b"]})
        if same(a, b):
            return {"k": "^", "a": a, "b": num(2)}
        if b["k"] == "^" and same(a, b["a"]) and is_n(b["b"]):
            return {"k": "^", "a": a, "b": num(b["b"]["v"] + 1)}
        if a["k"] == "^" and same(a["a"], b) and is_n(a["b"]):
            return {"k": "^", "a": b, "b": num(a["b"]["v"] + 1)}
        if a["k"] == "neg":
            return simplify({"k": "neg", "a": {"k": "*", "a": a["a"], "b": b}})
        if b["k"] == "neg":
            return simplify({"k": "neg", "a": {"k": "*", "a": a, "b": b["a"]}})
    elif k == "/":
        if is_n(a, 0) and not is_n(b, 0):
            return num(0)
        if is_n(b, 1):
            return a
        if same(a, b) and not is_n(a, 0):
            return num(1)
    elif k == "^":
        if is_n(b, 0):
            return num(1)
        if is_n(b, 1):
            return a
        if is_n(a, 1):
            return num(1)
        if a["k"] == "^" and is_n(a["b"]) and is_n(b):
            return {"k": "^", "a": a["a"], "b": num(a["b"]["v"] * b["v"])}
    return {"k": k, "a": a, "b": b}


def _d(n, x):
    k = n["k"]
    if k in ("n", "c"):
        return num(0)
    if k == "v":
        return num(1 if n["n"] == x else 0)
    if k == "neg":
        return {"k": "neg", "a": _d(n["a"], x)}
    if k in ("+", "-"):
        return {"k": k, "a": _d(n["a"], x), "b": _d(n["b"], x)}
    if k == "*":
        return {"k": "+", "a": {"k": "*", "a": _d(n["a"], x), "b": n["b"]}, "b": {"k": "*", "a": n["a"], "b": _d(n["b"], x)}}
    if k == "/":
        return {"k": "/", "a": {"k": "-", "a": {"k": "*", "a": _d(n["a"], x), "b": n["b"]}, "b": {"k": "*", "a": n["a"], "b": _d(n["b"], x)}},
                "b": {"k": "^", "a": n["b"], "b": num(2)}}
    if k == "^":
        ua, ub = has_var(n["a"], x), has_var(n["b"], x)
        if not ub:
            return {"k": "*", "a": {"k": "*", "a": n["b"], "b": {"k": "^", "a": n["a"], "b": {"k": "-", "a": n["b"], "b": num(1)}}}, "b": _d(n["a"], x)}
        if not ua:
            return {"k": "*", "a": {"k": "*", "a": n, "b": {"k": "f", "f": "ln", "a": n["a"]}}, "b": _d(n["b"], x)}
        return {"k": "*", "a": n, "b": {"k": "+", "a": {"k": "*", "a": _d(n["b"], x), "b": {"k": "f", "f": "ln", "a": n["a"]}},
                                        "b": {"k": "/", "a": {"k": "*", "a": n["b"], "b": _d(n["a"], x)}, "b": n["a"]}}}
    u = n["a"]
    du = _d(u, x)
    outer = {
        "sin": lambda: {"k": "f", "f": "cos", "a": u},
        "cos": lambda: {"k": "neg", "a": {"k": "f", "f": "sin", "a": u}},
        "tan": lambda: {"k": "/", "a": num(1), "b": {"k": "^", "a": {"k": "f", "f": "cos", "a": u}, "b": num(2)}},
        "exp": lambda: {"k": "f", "f": "exp", "a": u},
        "ln": lambda: {"k": "/", "a": num(1), "b": u},
        "log10": lambda: {"k": "/", "a": num(1), "b": {"k": "*", "a": u, "b": {"k": "f", "f": "ln", "a": num(10)}}},
        "sqrt": lambda: {"k": "/", "a": num(1), "b": {"k": "*", "a": num(2), "b": {"k": "f", "f": "sqrt", "a": u}}},
        "abs": lambda: {"k": "/", "a": u, "b": {"k": "f", "f": "abs", "a": u}},
    }[n["f"]]()
    return {"k": "*", "a": outer, "b": du}


def derivative(n, x="x"):
    return simplify(_d(n, x))


PREC = {"+": 1, "-": 1, "*": 2, "/": 2, "neg": 3, "^": 4}


def show(n):
    def wrap(c, p, right):
        s = show(c)
        cp = 3 if c["k"] == "n" and c["v"] < 0 else PREC.get(c["k"], 5)
        if cp < p or (right and cp == p and p != 4) or (c["k"] == "^" and p == 4 and not right) or (cp == 3 and (right or p == 4)):
            return "(" + s + ")"
        return s

    k = n["k"]
    if k == "n":
        return fmt(n["v"])
    if k in ("v", "c"):
        return n["n"]
    if k == "f":
        return n["f"] + "(" + show(n["a"]) + ")"
    if k == "neg":
        return "-" + wrap(n["a"], 3, True)
    return wrap(n["a"], PREC[k], False) + ("^" if k == "^" else " " + k + " ") + wrap(n["b"], PREC[k], True)


# ---- Calculus ------------------------------------------------------------------------------------------------
def adaptive_simpson(f, a, b, eps=1e-10, max_depth=50):
    evals = [0]

    def F(x):
        evals[0] += 1
        y = f(x)
        if not math.isfinite(y):
            _fail("The function is not finite on the interval.")
        return y

    fa, fb = F(a), F(b)
    m = (a + b) / 2
    fm = F(m)
    whole = (b - a) / 6 * (fa + 4 * fm + fb)
    stack = [(a, b, fa, fm, fb, whole, eps, 0)]
    total = 0.0
    while stack:
        lo, r, fl, fmid, fr, s, e, d = stack.pop()
        mid = (lo + r) / 2
        lm, rm = (lo + mid) / 2, (mid + r) / 2
        flm, frm = F(lm), F(rm)
        left = (mid - lo) / 6 * (fl + 4 * flm + fmid)
        right = (r - mid) / 6 * (fmid + 4 * frm + fr)
        if d >= max_depth or abs(left + right - s) <= 15 * e or evals[0] > 200000:
            total += left + right + (left + right - s) / 15
        else:
            stack.append((lo, mid, fl, flm, fmid, left, e / 2, d + 1))
            stack.append((mid, r, fmid, frm, fr, right, e / 2, d + 1))
    return {"value": total, "evals": evals[0]}


def brent(f, a, b, tol=1e-14, max_iter=100):
    fa, fb = f(a), f(b)
    if fa == 0:
        return a
    if fb == 0:
        return b
    if fa * fb > 0:
        return None
    if abs(fa) < abs(fb):
        a, b, fa, fb = b, a, fb, fa
    c, fc, d, mflag = a, fa, b - a, True
    for _ in range(max_iter):
        if fb == 0 or abs(b - a) < tol:
            return b
        if fa != fc and fb != fc:
            s = a * fb * fc / ((fa - fb) * (fa - fc)) + b * fa * fc / ((fb - fa) * (fb - fc)) + c * fa * fb / ((fc - fa) * (fc - fb))
        else:
            s = b - fb * (b - a) / (fb - fa)
        lo = (3 * a + b) / 4
        if not (min(lo, b) < s < max(lo, b)) or (mflag and abs(s - b) >= abs(b - c) / 2) or (not mflag and abs(s - b) >= abs(c - d) / 2):
            s = (a + b) / 2
            mflag = True
        else:
            mflag = False
        fs = f(s)
        d, c, fc = c, b, fb
        if fa * fs < 0:
            b, fb = s, fs
        else:
            a, fa = s, fs
        if abs(fa) < abs(fb):
            a, b, fa, fb = b, a, fb, fa
    return b


def find_roots(f, df, a, b, samples=400):
    roots = []
    x0, y0 = a, f(a)
    for i in range(1, samples + 1):
        x1 = a + (b - a) * i / samples
        y1 = f(x1)
        # A zero at a sample is a root even when the next sample is not finite (found by the mutation run).
        if y0 == 0 or (math.isfinite(y0) and math.isfinite(y1)):
            r = None
            if y0 == 0:
                r = x0
            elif y0 * y1 < 0:
                r = brent(f, x0, x1)
            if r is not None:
                for _ in range(5 if df else 0):
                    dv = df(r)
                    if not dv or not math.isfinite(dv):
                        break
                    nr = r - _div(f(r), dv)
                    if nr < x0 or nr > x1 or not math.isfinite(f(nr)):
                        break
                    if abs(f(nr)) > abs(f(r)):
                        break
                    r = nr
                if not any(abs(q - r) < TOL["same_root"] for q in roots):
                    roots.append(r)
        x0, y0 = x1, y1
    if y0 == 0 and not any(abs(q - b) < TOL["same_root"] for q in roots):
        roots.append(b)
    return roots


# ---- Linear algebra --------------------------------------------------------------------------------------
def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def check_matrix(A):
    if not isinstance(A, list) or not A or len(A) > LIMITS["size"]:
        _fail("Give a square matrix of at most 10 rows.")
    n = len(A)
    for r in A:
        if not isinstance(r, list) or len(r) != n or any(not _is_num(v) for v in r):
            _fail("Give a square matrix of numbers.")
    return n


def _scale(A):
    return max([1.0] + [abs(float(v)) for r in A for v in r])


def gauss_solve(A, b):
    n = check_matrix(A)
    if not isinstance(b, list) or len(b) != n or any(not _is_num(v) for v in b):
        _fail("The right-hand side needs one number per row.")
    M = [[float(v) for v in r] + [float(b[i])] for i, r in enumerate(A)]
    scale = _scale(A)
    for c in range(n):
        p = c
        for r in range(c + 1, n):
            if abs(M[r][c]) > abs(M[p][c]):
                p = r
        if abs(M[p][c]) < TOL["pivot"] * scale:
            return None
        if p != c:
            M[p], M[c] = M[c], M[p]
        for r in range(c + 1, n):
            f = M[r][c] / M[c][c]
            for k in range(c, n + 1):
                M[r][k] -= f * M[c][k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = M[r][n]
        for k in range(r + 1, n):
            s -= M[r][k] * x[k]
        x[r] = s / M[r][r]
    return x


def determinant(A):
    n = check_matrix(A)
    M = [[float(v) for v in r] for r in A]
    det = 1.0
    for c in range(n):
        p = c
        for r in range(c + 1, n):
            if abs(M[r][c]) > abs(M[p][c]):
                p = r
        if M[p][c] == 0:
            return 0.0
        if p != c:
            M[p], M[c] = M[c], M[p]
            det = -det
        det *= M[c][c]
        for r in range(c + 1, n):
            f = M[r][c] / M[c][c]
            for k in range(c, n):
                M[r][k] -= f * M[c][k]
    return det


def inverse(A):
    n = check_matrix(A)
    M = [[float(v) for v in r] + [1.0 if i == j else 0.0 for j in range(n)] for i, r in enumerate(A)]
    scale = _scale(A)
    for c in range(n):
        p = c
        for r in range(c + 1, n):
            if abs(M[r][c]) > abs(M[p][c]):
                p = r
        if abs(M[p][c]) < TOL["pivot"] * scale:
            return None
        if p != c:
            M[p], M[c] = M[c], M[p]
        pv = M[c][c]
        for k in range(2 * n):
            M[c][k] /= pv
        for r in range(n):
            if r != c:
                f = M[r][c]
                for k in range(2 * n):
                    M[r][k] -= f * M[c][k]
    return [r[n:] for r in M]


def jacobi_eigen(A, sweeps=100):
    n = check_matrix(A)
    M = [[float(v) for v in r] for r in A]
    for _ in range(sweeps):
        off = 0.0
        for i in range(n):
            for j in range(i + 1, n):
                off += M[i][j] * M[i][j]
        if off < 1e-22:
            break
        for p in range(n):
            for q in range(p + 1, n):
                if abs(M[p][q]) < 1e-300:
                    continue
                theta = (M[q][q] - M[p][p]) / (2 * M[p][q])
                t = math.copysign(1.0, theta if theta else 1.0) / (abs(theta) + math.sqrt(theta * theta + 1))
                c = 1 / math.sqrt(t * t + 1)
                sn = t * c
                for k in range(n):
                    kp, kq = M[k][p], M[k][q]
                    M[k][p] = c * kp - sn * kq
                    M[k][q] = sn * kp + c * kq
                for k in range(n):
                    pk, qk = M[p][k], M[q][k]
                    M[p][k] = c * pk - sn * qk
                    M[q][k] = sn * pk + c * qk
    return sorted(M[i][i] for i in range(n))


# ---- Ordinary differential equations ----------------------------------------------------------------------
def rk4(f, x0, y0, x1, steps):
    h = (x1 - x0) / steps
    pts = [[x0, y0]]
    x, y = x0, y0
    for i in range(steps):
        k1 = f(x, y)
        k2 = f(x + h / 2, y + h * k1 / 2)
        k3 = f(x + h / 2, y + h * k2 / 2)
        k4 = f(x + h, y + h * k3)
        y += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        x = x0 + h * (i + 1)
        if not math.isfinite(y):
            _fail("The solution is not finite.", "x = " + fmt(x))
        pts.append([x, y])
    return pts


# ---- Number theory (exact integers; division truncates toward zero as BigInt does) -------------------------
def _tdiv(a, b):
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q


def _tmod(a, b):
    return a - b * _tdiv(a, b)


def big(v):
    if isinstance(v, bool):
        _fail("Give a whole number.")
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    t = str(v).strip()
    if t and (t.isdigit() or (t[0] in "+-" and t[1:].isdigit())):
        return int(t)
    return _fail("Give a whole number.")


def egcd(a, b):
    r0, r1, s0, s1, t0, t1 = a, b, 1, 0, 0, 1
    while r1 != 0:
        q = _tdiv(r0, r1)
        r0, r1 = r1, r0 - q * r1
        s0, s1 = s1, s0 - q * s1
        t0, t1 = t1, t0 - q * t1
    return {"g": -r0, "x": -s0, "y": -t0} if r0 < 0 else {"g": r0, "x": s0, "y": t0}


# Exact below 3,317,044,064,679,887,385,961,981 (the first number that passes all thirteen bases).
MR_BASES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41]
MR_LIMIT = 3317044064679887385961981


def is_prime(n):
    if n < 2:
        return False
    for p in MR_BASES:
        if n == p:
            return True
        if n % p == 0:
            return False
    d, s = n - 1, 0
    while d & 1 == 0:
        d >>= 1
        s += 1
    for a in MR_BASES:
        x = pow(a, d, n)
        if x == 1 or x == n - 1:
            continue
        comp = True
        for _ in range(1, s):
            x = x * x % n
            if x == n - 1:
                comp = False
                break
        if comp:
            return False
    return True


def _rho(n):
    if n % 2 == 0:
        return 2
    for c in range(1, 20):
        x = y = 2
        d = 1
        steps = 0
        while d == 1 and steps < 200000:
            x = (x * x + c) % n
            y = (y * y + c) % n
            y = (y * y + c) % n
            d = math.gcd(x - y, n)
            steps += 1
        if d not in (n, 1):
            return d
    return n


def factorize(n_in):
    n = big(n_in)
    if n < 2:
        _fail("Factorise a whole number of 2 or more.")
    if n > (1 << 64):
        _fail("Factorise numbers below 2^64.")
    out = []
    p = 2
    while p < 1000 and p * p <= n:
        while n % p == 0:
            out.append(p)
            n //= p
        p += 1
    stack = [n] if n > 1 else []
    while stack:
        m = stack.pop()
        if is_prime(m):
            out.append(m)
            continue
        d = _rho(m)
        if d == m:
            _fail("This number could not be factorised within the limits.")
        stack.extend([d, m // d])
    return sorted(out)


def crt(remainders, moduli):
    if not isinstance(remainders, list) or not isinstance(moduli, list) or not remainders or len(remainders) != len(moduli) or len(remainders) > LIMITS["crt"]:
        _fail("Give the same number of remainders and moduli, at most 10.")
    r, m = 0, 1
    for i in range(len(moduli)):
        mi = big(moduli[i])
        if mi < 1:
            _fail("Every modulus must be 1 or more.")
        ri = big(remainders[i]) % mi
        e = egcd(m, mi)
        g, x = e["g"], e["x"]
        if _tmod(ri - r, g) != 0:
            return None
        lcm = m // g * mi
        r = (r + m * ((ri - r) // g) * x) % lcm
        m = lcm
    return {"x": r, "modulus": m}


def bayes(prior, sensitivity, false_positive):
    for v in (prior, sensitivity, false_positive):
        if not _is_num(v) or not (0 <= v <= 1):
            _fail("Probabilities are numbers from 0 to 1.")
    evidence = sensitivity * prior + false_positive * (1 - prior)
    if evidence == 0:
        _fail("The evidence has probability 0.")
    return {"posterior": sensitivity * prior / evidence, "evidence": evidence}


# ---- The solver --------------------------------------------------------------------------------------------
def _step(text, formula=None):
    return {"text": text} if formula is None else {"text": text, "formula": str(formula)}


def _check(text, ok, formula=None):
    return {"text": text, "ok": bool(ok)} if formula is None else {"text": text, "ok": bool(ok), "formula": str(formula)}


def _plot(f, a, b, n=200):
    pts = []
    for i in range(n + 1):
        x = a + (b - a) * i / n
        y = f(x)
        if math.isfinite(y) and abs(y) < 1e6:
            pts.append([r12(x), r12(y)])
    return pts


def _number(v, default):
    if v is None:
        return float(default)
    if isinstance(v, bool):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return NAN


def _interval(v):
    if isinstance(v, list) and len(v) == 2:
        a, b = _number(v[0], NAN), _number(v[1], NAN)
    else:
        a, b = -10.0, 10.0
    if not math.isfinite(a) or not math.isfinite(b) or not a < b:
        _fail("The interval is two numbers, smaller first.")
    return a, b


def solve(req):
    req = req if isinstance(req, dict) else {}
    task = str(req.get("task") or "")
    if task == "calculus":
        x = str(req.get("variable") or "x").lower()
        ast = simplify(parse(req.get("expression")))
        a, b = _interval(req.get("interval"))
        d = derivative(ast, x)

        def f(v):
            return evaluate(ast, {x: v})

        def df(v):
            return evaluate(d, {x: v})

        # A sign change where |f| stays large is a pole or a jump, not a root: it is named, and no integral is given across it.
        found = [r12(r) for r in find_roots(f, df, a, b)]
        jumps = [r for r in found if not within(abs(f(r)), TOL["pole"])]
        roots = [r for r in found if within(abs(f(r)), TOL["pole"])]
        residuals = [abs(f(r)) for r in roots]
        integral, integral_error = None, None
        if jumps:
            integral_error = "x = " + ", ".join(fmt(r) for r in jumps)
        else:
            try:
                integral = r12(adaptive_simpson(f, a, b)["value"])
            except MathError as e:
                integral_error = str(e)
        probe = [a + (b - a) * t for t in (0.13, 0.37, 0.61, 0.89)]

        def deriv_ok(p):
            h = TOL["probe_step"] * max(1, abs(p))
            nd = (f(p + h) - f(p - h)) / (2 * h)
            sd = df(p)
            return not math.isfinite(sd) or not math.isfinite(nd) or within(abs(nd - sd), TOL["deriv"], sd)

        checks = [_check("The derivative matches a central difference at 4 points.", all(deriv_ok(p) for p in probe))]
        checks += [_check("Back-check of a root: |f| is at most 1e-9.", within(residuals[i], TOL["root"]), "|f(" + fmt(r) + ")| = " + to_exponential(residuals[i], 1)) for i, r in enumerate(roots)]
        steps = [_step("The expression, simplified", show(ast)),
                 _step("Its derivative by the power, product, quotient and chain rules", "d/d" + x + " = " + show(d)),
                 _step("Roots on the interval, by Brent's method and a Newton polish" if roots else "No root on the interval", ", ".join(fmt(r) for r in roots) or "—"),
                 *([_step("A sign change without a root: a pole or a jump", ", ".join(fmt(r) for r in jumps))] if jumps else []),
                 _step("The definite integral could not be computed.", integral_error) if integral is None
                 else _step("The definite integral by adaptive Simpson", "∫[" + fmt(a) + ", " + fmt(b) + "] f(" + x + ") d" + x + " = " + fmt(integral))]
        return {"task": task, "verified": all(c["ok"] for c in checks), "checks": checks, "steps": steps,
                "result": {"expression": show(ast), "derivative": show(d), "roots": roots, "poles": jumps, "integral": integral, "interval": [_num(a), _num(b)]},
                "plot": {"kind": "function", "points": _plot(f, a, b), "roots": roots}}
    if task == "ode_rk4":
        ast = simplify(parse(req.get("expression")))
        x0, y0, x1 = _number(req.get("x0"), 0), _number(req.get("y0"), 0), _number(req.get("x_end"), 1)
        sv = _number(req.get("steps"), 20)
        steps = js_round(sv) if math.isfinite(sv) else sv
        if not all(math.isfinite(v) for v in (x0, y0, x1)) or x1 == x0:
            _fail("Give a start point, a start value and a different end point.")
        if not (isinstance(steps, int) and 1 <= steps <= LIMITS["ode_steps"]):
            _fail("Steps are from 1 to 10000.")

        def f(x, y):
            return evaluate(ast, {"x": x, "y": y})

        pts = rk4(f, x0, y0, x1, steps)
        fine = rk4(f, x0, y0, x1, min(LIMITS["ode_steps"] * 2, steps * 2))
        y_end, y_fine = pts[-1][1], fine[-1][1]
        err = abs(y_end - y_fine) / 15
        ok = within(err, TOL["ode"], y_fine)
        every = max(1, math.ceil(len(pts) / 400))
        return {"task": task, "verified": ok, "checks": [_check("Step doubling keeps the error estimate under 1e-6.", ok, "err = " + to_exponential(err, 1))],
                "steps": [_step("The equation", "dy/dx = " + show(ast)), _step("Classic Runge-Kutta, 4 slopes a step", "h = " + fmt(r12((x1 - x0) / steps)) + ", steps = " + str(steps)),
                          _step("The value at the end", "y(" + fmt(x1) + ") = " + fmt(r12(y_end)))],
                "result": {"y_end": r12(y_end), "error_estimate": _num(float(to_exponential(err, 3))), "points": len(pts)},
                "plot": {"kind": "ode", "points": [[r12(x), r12(y)] for i, (x, y) in enumerate(pts) if i % every == 0 or i == len(pts) - 1]}}
    if task == "linear_algebra":
        A = req.get("matrix")
        n = check_matrix(A)
        det, inv = determinant(A), inverse(A)
        sym = all(within(abs(v - A[j][i]), TOL["sym"], v) for i, r in enumerate(A) for j, v in enumerate(r))
        eig = jacobi_eigen(A) if sym else None
        steps = [_step("Determinant by elimination with partial pivoting", "det(A) = " + fmt(r12(det)))]
        checks = []
        result = {"determinant": r12(det), "singular": inv is None}
        if "rhs" in req:
            x = gauss_solve(A, req["rhs"])
            if x:
                res = max(abs(sum((v * x[j] for j, v in enumerate(r)), 0.0) - req["rhs"][i]) for i, r in enumerate(A))
                result["solution"] = [r12(v) for v in x]
                steps.append(_step("The system solved by Gaussian elimination with partial pivoting", "x = [" + ", ".join(fmt(v) for v in result["solution"]) + "]"))
                checks.append(_check("The residual of the solution is at most 1e-9.", within(res, TOL["residual"]), "max|Ax - b| = " + to_exponential(res, 1)))
            else:
                steps.append(_step("The matrix is singular, so the system has no single solution."))
                checks.append(_check("A pivot is zero: singular.", within(abs(det), TOL["singular"], max(abs(float(v)) for r in A for v in r) ** n)))
        if inv:
            err = max(abs(sum((v * inv[k][j] for k, v in enumerate(r)), 0.0) - (1 if i == j else 0)) for i, r in enumerate(A) for j in range(n))
            result["inverse"] = [[r12(v) for v in r] for r in inv]
            steps.append(_step("The inverse by Gauss-Jordan", str(n) + " × " + str(n)))
            checks.append(_check("The matrix times its inverse gives the identity to 1e-9.", within(err, TOL["identity"]), "max|A·A^-1 - I| = " + to_exponential(err, 1)))
        if eig:
            tr = sum((float(r[i]) for i, r in enumerate(A)), 0.0)
            te = sum(eig, 0.0)
            pe = 1.0
            for v in eig:
                pe *= v
            result["eigenvalues"] = [r12(v) for v in eig]
            steps.append(_step("Eigenvalues of the symmetric matrix by Jacobi rotations", "λ = " + ", ".join(fmt(v) for v in result["eigenvalues"])))
            checks.append(_check("The eigenvalues add up to the trace and multiply to the determinant.",
                                 within(abs(tr - te), TOL["trace"], tr) and within(abs(det - pe), TOL["det"], det)))
        return {"task": task, "verified": len(checks) > 0 and all(c["ok"] for c in checks), "checks": checks, "steps": steps, "result": result}
    if task == "number_theory":
        steps, checks, result = [], [], {}
        if req.get("n") is not None:
            n = big(req["n"])
            if n >= MR_LIMIT:
                _fail("Test whole numbers below 3.3 × 10^24, where the test is exact.")
            prime = is_prime(n)
            result["n"], result["prime"] = str(n), prime
            steps.append(_step("Miller-Rabin test with 13 fixed bases: prime" if prime else "Miller-Rabin test with 13 fixed bases: not prime", str(n)))
            if n > 1 << 64:
                steps.append(_step("Numbers above 2^64 are tested here but not factorised."))
            elif n >= 2:
                fs = factorize(n)
                prod = 1
                for q in fs:
                    prod *= q
                result["factors"] = [str(q) for q in fs]
                steps.append(_step("Prime factors by trial division and Pollard's rho", " × ".join(str(q) for q in fs)))
                checks.append(_check("The factors multiply back to n, and each is prime.", prod == n and all(is_prime(q) for q in fs) and (len(fs) == 1) == prime))
        if req.get("a") is not None and req.get("b") is not None:
            a, b = big(req["a"]), big(req["b"])
            e = egcd(a, b)
            g, x, y = e["g"], e["x"], e["y"]
            result["gcd"], result["bezout"] = str(g), [str(x), str(y)]
            steps.append(_step("Extended Euclid", "gcd = " + str(g) + " = " + str(a) + "·(" + str(x) + ") + " + str(b) + "·(" + str(y) + ")"))
            checks.append(_check("a·x + b·y equals the gcd.", a * x + b * y == g))
            if g == 1 and b > 1:
                result["inverse_mod_b"] = str(x % b)
                steps.append(_step("The inverse of a modulo b", result["inverse_mod_b"]))
        if req.get("crt_remainders") is not None:
            c = crt(req["crt_remainders"], req.get("crt_moduli"))
            if not c:
                steps.append(_step("The congruences contradict each other: no solution."))
                checks.append(_check("No x fits every congruence.", True))
            else:
                result["crt"] = {"x": str(c["x"]), "modulus": str(c["modulus"])}
                steps.append(_step("Chinese remainder theorem, merging one congruence at a time", "x ≡ " + str(c["x"]) + " (mod " + str(c["modulus"]) + ")"))
                checks.append(_check("x leaves every given remainder.", all(_tmod(c["x"] - big(req["crt_remainders"][i]), big(m)) == 0 for i, m in enumerate(req["crt_moduli"]))))
        if not steps:
            _fail("Give a number to test, a pair for the gcd, or remainders and moduli.")
        return {"task": task, "verified": len(checks) > 0 and all(c["ok"] for c in checks), "checks": checks, "steps": steps, "result": result}
    if task == "bayes":
        p, s, fp = _number(req.get("prior"), NAN), _number(req.get("sensitivity"), NAN), _number(req.get("false_positive"), NAN)
        out = bayes(p, s, fp)
        posterior, evidence = out["posterior"], out["evidence"]
        back = _div(posterior * evidence, s)
        ok = posterior == 0 if s == 0 else within(abs(back - p), TOL["bayes"])
        return {"task": task, "verified": ok, "checks": [_check("Multiplying back gives the prior.", ok, "P(H|E)·P(E) / P(E|H) = " + fmt(r12(back)))],
                "steps": [_step("The probability of the evidence", "P(E) = P(E|H)·P(H) + P(E|¬H)·P(¬H) = " + fmt(r12(evidence))),
                          _step("Bayes' theorem", "P(H|E) = P(E|H)·P(H) / P(E) = " + fmt(r12(posterior)))],
                "result": {"posterior": r12(posterior), "evidence": r12(evidence)}}
    return _fail("Choose a task: calculus, an equation, a matrix, number theory or Bayes.")


# ---- Language: the same Arabic lines as the server (UM_AR in universal-math.mjs) ---------------------------
UM_AR = {
    "A bracket is not closed.": "قوس لم يُغلق.",
    "A sign change without a root: a pole or a jump": "تغيّر في الإشارة بلا جذر: قطب أو قفزة",
    "A function needs brackets, as in sin(x).": "الدالة تحتاج قوسين، مثل sin(x).",
    "A name has no value.": "اسم بلا قيمة.",
    "A name is too long.": "الاسم طويل جداً.",
    "A number could not be read.": "تعذرت قراءة عدد.",
    "A pivot is zero: singular.": "أحد المحاور صفر: المصفوفة منفردة.",
    "Back-check of a root: |f| is at most 1e-9.": "التحقق العكسي من الجذر: |f| لا تتجاوز 1e-9.",
    "Bayes' theorem": "مبرهنة بايز",
    "Chinese remainder theorem, merging one congruence at a time": "مبرهنة الباقي الصينية، بدمج تطابق واحد في كل مرة",
    "Choose a task: calculus, an equation, a matrix, number theory or Bayes.": "اختر مهمة: التفاضل والتكامل، أو معادلة، أو مصفوفة، أو نظرية الأعداد، أو بايز.",
    "Classic Runge-Kutta, 4 slopes a step": "طريقة رونغه-كوتا الكلاسيكية، أربعة ميول في كل خطوة",
    "Determinant by elimination with partial pivoting": "المحدِّد بالحذف مع الارتكاز الجزئي",
    "Eigenvalues of the symmetric matrix by Jacobi rotations": "القيم الذاتية للمصفوفة المتماثلة بدورانات جاكوبي",
    "Every modulus must be 1 or more.": "كل مقياس يجب أن يكون 1 أو أكثر.",
    "Extended Euclid": "خوارزمية إقليدس الموسَّعة",
    "Factorise a whole number of 2 or more.": "حلّل عدداً صحيحاً من 2 فأكثر.",
    "Factorise numbers below 2^64.": "حلّل أعداداً أصغر من 2^64.",
    "Give a number to test, a pair for the gcd, or remainders and moduli.": "أعطِ عدداً لاختباره، أو زوجاً للقاسم المشترك الأكبر، أو بواقي ومقاييس.",
    "Give a square matrix of at most 10 rows.": "أعطِ مصفوفة مربعة من 10 صفوف على الأكثر.",
    "Give a square matrix of numbers.": "أعطِ مصفوفة مربعة من الأعداد.",
    "Give a start point, a start value and a different end point.": "أعطِ نقطة بداية وقيمة بداية ونقطة نهاية مختلفة.",
    "Give a whole number.": "أعطِ عدداً صحيحاً.",
    "Give the same number of remainders and moduli, at most 10.": "أعطِ عدداً متساوياً من البواقي والمقاييس، 10 على الأكثر.",
    "Its derivative by the power, product, quotient and chain rules": "مشتقته بقواعد القوة والضرب والقسمة والسلسلة",
    "Keep the expression under 400 characters.": "اجعل التعبير أقل من 400 حرف.",
    "Miller-Rabin test with 13 fixed bases: not prime": "اختبار ميلر-رابين بـ 13 أساساً ثابتاً: ليس أولياً",
    "Miller-Rabin test with 13 fixed bases: prime": "اختبار ميلر-رابين بـ 13 أساساً ثابتاً: أولي",
    "Multiplying back gives the prior.": "الضرب العكسي يعيد الاحتمال المسبق.",
    "No root on the interval": "لا جذر في المجال",
    "No x fits every congruence.": "لا يوجد x يحقق كل التطابقات.",
    "Prime factors by trial division and Pollard's rho": "العوامل الأولية بالقسمة التجريبية وطريقة رو لبولارد",
    "Probabilities are numbers from 0 to 1.": "الاحتمالات أعداد من 0 إلى 1.",
    "Roots on the interval, by Brent's method and a Newton polish": "الجذور في المجال بطريقة برنت ثم تنقيح نيوتن",
    "Something unexpected follows the expression.": "شيء غير متوقع بعد التعبير.",
    "Something unexpected is in the expression.": "شيء غير متوقع في التعبير.",
    "Step doubling keeps the error estimate under 1e-6.": "مضاعفة الخطوات تُبقي تقدير الخطأ دون 1e-6.",
    "Test whole numbers below 3.3 × 10^24, where the test is exact.": "اختبر أعداداً صحيحة أصغر من 3.3 × 10^24، حيث يكون الاختبار دقيقاً.",
    "Numbers above 2^64 are tested here but not factorised.": "الأعداد الأكبر من 2^64 تُختبر هنا ولا تُحلَّل.",
    "Steps are from 1 to 10000.": "عدد الخطوات من 1 إلى 10000.",
    "The congruences contradict each other: no solution.": "التطابقات متناقضة: لا حل.",
    "The definite integral by adaptive Simpson": "التكامل المحدد بطريقة سيمبسون التكيفية",
    "The definite integral could not be computed.": "تعذر حساب التكامل المحدد.",
    "The derivative matches a central difference at 4 points.": "المشتقة تطابق الفرق المركزي عند 4 نقاط.",
    "The eigenvalues add up to the trace and multiply to the determinant.": "مجموع القيم الذاتية يساوي الأثر وحاصل ضربها يساوي المحدِّد.",
    "The equation": "المعادلة",
    "The evidence has probability 0.": "احتمال الدليل صفر.",
    "The expression ends too early.": "التعبير ينتهي مبكراً.",
    "The expression has more than 200 parts.": "التعبير فيه أكثر من 200 جزء.",
    "The expression is nested too deeply.": "التعبير متداخل بعمق زائد.",
    "The expression, simplified": "التعبير بعد التبسيط",
    "The factors multiply back to n, and each is prime.": "حاصل ضرب العوامل يعيد n، وكل منها أولي.",
    "The function is not finite on the interval.": "الدالة غير منتهية على المجال.",
    "The interval is two numbers, smaller first.": "المجال عددان، الأصغر أولاً.",
    "The inverse by Gauss-Jordan": "المعكوس بطريقة غاوس-جوردان",
    "The inverse of a modulo b": "معكوس a بمقياس b",
    "The matrix is singular, so the system has no single solution.": "المصفوفة منفردة، فليس للنظام حل وحيد.",
    "The matrix times its inverse gives the identity to 1e-9.": "المصفوفة مضروبة في معكوسها تعطي مصفوفة الوحدة بدقة 1e-9.",
    "The probability of the evidence": "احتمال الدليل",
    "The residual of the solution is at most 1e-9.": "باقي الحل لا يتجاوز 1e-9.",
    "The right-hand side needs one number per row.": "الطرف الأيمن يحتاج عدداً لكل صف.",
    "The solution is not finite.": "الحل غير منتهٍ.",
    "The system solved by Gaussian elimination with partial pivoting": "حل النظام بحذف غاوس مع الارتكاز الجزئي",
    "The value at the end": "القيمة عند النهاية",
    "This number could not be factorised within the limits.": "تعذر تحليل هذا العدد ضمن الحدود.",
    "This sign is not maths Jarvis reads.": "هذه العلامة ليست من الرياضيات التي يقرؤها Jarvis.",
    "Write an expression first.": "اكتب تعبيراً أولاً.",
    "a·x + b·y equals the gcd.": "a·x + b·y يساوي القاسم المشترك الأكبر.",
    "x leaves every given remainder.": "x يعطي كل باقٍ مطلوب.",
}


def um_text(text, lang):
    return UM_AR.get(text, text) if lang == "ar" else text


def localize(out, lang):
    if lang != "ar":
        return out
    return {**out, "lang": "ar", "steps": [{**x, "text": um_text(x["text"], lang)} for x in out["steps"]],
            "checks": [{**x, "text": um_text(x["text"], lang)} for x in out["checks"]]}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Universal maths with every answer checked backwards (ADR-154).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("solve", help="solve a request (JSON file, or - for standard input)")
    s.add_argument("file")
    s.add_argument("--lang", choices=["en", "ar"], default="en")
    d = sub.add_parser("derive", help="simplify an expression and print its derivative")
    d.add_argument("expression")
    d.add_argument("--var", default="x")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "derive":
            ast = simplify(parse(a.expression))
            print(show(ast))
            print("d/d" + a.var.lower() + " = " + show(derivative(ast, a.var.lower())))
            return 0
        if a.file == "-":
            text = sys.stdin.read(64 * 1024 + 1)
        else:
            with open(a.file, encoding="utf-8") as fh:
                text = fh.read(64 * 1024 + 1)
        if len(text) > 64 * 1024:
            _fail("The request is larger than 64 KB.")
        try:
            req = json.loads(text)
        except json.JSONDecodeError:
            _fail("The request is not valid JSON.")
        print(json.dumps(localize(solve(req), a.lang), ensure_ascii=False, indent=1))
        return 0
    except MathError as e:
        print(json.dumps({"error": um_text(str(e), getattr(a, "lang", "en")), "detail": e.detail}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
