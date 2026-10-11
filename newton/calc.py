"""Exact symbolic/numeric maths with SymPy, sandboxed: no attribute access, no builtins."""

from __future__ import annotations

import re

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

MAX_LEN = 500
_FUNCS = {
    n: getattr(sp, n)
    for n in (
        "sin cos tan asin acos atan atan2 sinh cosh tanh exp log ln sqrt cbrt root Abs floor ceiling "
        "factorial binomial gamma pi E I oo diff integrate limit summation Sum Integral Derivative "
        "simplify expand factor solve Eq Matrix Rational Integer Float Symbol Max Min mod gcd lcm "
        "isprime nsolve series degree rad deg"
    ).split()
    if hasattr(sp, n)
}
_FUNCS["ln"] = sp.log
_IDENT = re.compile(r"[A-Za-z_]\w*")
_TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)


def _parse(text: str):
    if not text or len(text) > MAX_LEN:
        raise ValueError(f"expression must be 1..{MAX_LEN} chars")
    if "__" in text or re.search(r"\.\s*[A-Za-z_]", text) or re.search(r"[;\\`'\"\[\]{}@!$&|<>]", text):
        raise ValueError("unsupported characters in expression")
    local = {}
    for name in _IDENT.findall(text):
        if name not in _FUNCS:
            if len(name) > 12:
                raise ValueError(f"unknown name '{name}'")
            local[name] = sp.Symbol(name)
    glb = dict(_FUNCS, __builtins__={}, Symbol=sp.Symbol, Integer=sp.Integer,
               Float=sp.Float, Rational=sp.Rational)
    return parse_expr(text, local_dict=local, global_dict=glb, transformations=_TRANSFORMS)


def evaluate(expression: str, digits: int = 30, subs: dict | None = None) -> dict:
    """Exact result plus a decimal with `digits` significant figures."""
    expr = _parse(expression)
    if subs:
        expr = expr.subs({sp.Symbol(k): sp.nsimplify(v) for k, v in subs.items()})
    exact = sp.simplify(expr)
    out = {"input": expression, "exact": str(exact), "latex": sp.latex(exact), "engine": "SymPy " + sp.__version__}
    if exact.is_number:
        out["decimal"] = str(sp.N(exact, max(5, min(digits, 100))))
    return out


def solve(equation: str, variable: str | None = None) -> dict:
    """Solve 'lhs = rhs' (or 'expr', meaning expr = 0) for a variable."""
    if equation.count("=") > 1:
        raise ValueError("use a single '='")
    lhs, _, rhs = equation.partition("=")
    eq = sp.Eq(_parse(lhs), _parse(rhs) if rhs else 0)
    syms = sorted(eq.free_symbols, key=str)
    var = sp.Symbol(variable) if variable else (syms[0] if syms else None)
    if var is None:
        raise ValueError("no unknown to solve for")
    sols = sp.solve(eq, var)
    return {
        "equation": equation, "variable": str(var),
        "solutions": [str(s) for s in sols],
        "decimal": [str(sp.N(s, 15)) for s in sols if s.is_number],
        "engine": "SymPy " + sp.__version__,
    }


_KIN = {
    "s = u*t + a*t**2/2", "v = u + a*t", "v**2 = u**2 + 2*a*s", "s = (u + v)*t/2", "s = v*t - a*t**2/2",
}


def kinematics(**known: float) -> dict:
    """Constant-acceleration motion (Newton): give any 3 of s,u,v,a,t (SI units); solves the rest."""
    names = ("s", "u", "v", "a", "t")
    given = {k: float(v) for k, v in known.items() if k in names and v is not None}
    if len(given) < 3:
        raise ValueError("give at least 3 of s (m), u (m/s), v (m/s), a (m/s^2), t (s)")
    S = {n: sp.Symbol(n) for n in names}
    eqs = []
    for e in _KIN:
        l, r = e.split("=")
        eqs.append(sp.Eq(sp.sympify(l, locals=S), sp.sympify(r, locals=S)).subs({S[k]: v for k, v in given.items()}))
    unknown = [S[n] for n in names if n not in given]
    sols = sp.solve(eqs, unknown, dict=True)
    phys = [s for s in sols if all(not (x.is_real is False) for x in s.values())
            and (sp.Symbol("t") not in s or s[sp.Symbol("t")] >= 0)]
    return {
        "given": given, "equations": sorted(_KIN),
        "solutions": [{str(k): float(v) for k, v in s.items()} for s in phys],
        "note": "SI units. Assumes constant acceleration (F = m*a with constant net force).",
    }
