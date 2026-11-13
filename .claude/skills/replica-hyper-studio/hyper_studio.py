#!/usr/bin/env python3
"""Hyper studio (ADR-155): projections of shapes from 3 to 8 dimensions, camera optics and grid game physics,
each with checks that the answer is what it claims. Standard library only: no network, no process, no outside
library. The same maths as Jarvis's server (jarvis/server/lib/hyper-studio.mjs); for the same request both
return the same numbers.

    python3 hyper_studio.py run request.json            # the answer as JSON
    python3 hyper_studio.py svg request.json > e8.svg   # a projection drawn as SVG
    echo '{"mode":"projection","polytope":"e8_lattice"}' | python3 hyper_studio.py run -

Modes: projection (cube, tesseract, 16cell, octeract, e8_lattice), optics (thin-lens depth of field,
hyperfocal distance, field of view, background blur, EV100, Kelvin to colour), game_physics (A* checked
against breadth-first search, Verlet particles in a box).
"""

import argparse
import json
import math
import sys
from decimal import Decimal

LIMITS = {"angle": 360, "grid": 40, "obstacles": 400, "particles": 24, "ticks": 600}
ACCENT = {"dark": "#77bcff", "light": "#0b5ed7"}
AXES = "xyzwuvst"
INF = float("inf")


class HyperError(ValueError):
    status = 400

    def __init__(self, message, detail=None):
        super().__init__(message)
        self.detail = None if detail is None else str(detail)[:80]


def _fail(message, detail=None):
    raise HyperError(message, detail)


def _js_round(x):
    return math.floor(x + 0.5)


def r(v, d=6):
    """Math.round(v * 10^d) / 10^d as JavaScript computes it, with -0 as 0 and whole numbers as int."""
    p = 10 ** d
    x = _js_round(v * p) / p
    if x == 0:
        x = 0.0
    return int(x) if x.is_integer() and abs(x) < 2 ** 53 else x


def _num(x):
    return int(x) if isinstance(x, float) and x.is_integer() and abs(x) < 2 ** 53 else x


def _hypot(*v):
    return math.sqrt(sum(x * x for x in v))


def dot(a, b):
    s = 0.0
    for i, v in enumerate(a):
        s += v * b[i]
    return s


# ---- Rotations ---------------------------------------------------------------------------------------------
def rotate_plane(points, i, j, deg):
    t = deg * math.pi / 180
    c, s = math.cos(t), math.sin(t)
    out = []
    for p in points:
        q = list(p)
        q[i] = c * p[i] - s * p[j]
        q[j] = s * p[i] + c * p[j]
        out.append(q)
    return out


def _number(v):
    if isinstance(v, bool):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def apply_angles(points, dim, angles):
    out = points
    keys = sorted((angles or {}).keys())
    if len(keys) > 28:
        _fail("Give at most 28 rotation planes.")
    for k in keys:
        v = _number(angles[k])
        if len(k) != 2 or k[0] == k[1]:
            _fail("A rotation plane is two different axes, as in xy or zw.", k)
        i, j = AXES.find(k[0]), AXES.find(k[1])
        if i < 0 or j < 0 or i >= dim or j >= dim:
            _fail("A rotation plane uses an axis this shape does not have.", k)
        if not math.isfinite(v) or abs(v) > LIMITS["angle"]:
            _fail("Angles are degrees from -360 to 360.", k)
        out = rotate_plane(out, i, j, v)
    return out


# ---- Shapes ------------------------------------------------------------------------------------------------
def hypercube(n):
    V = [[1 if (k >> b) & 1 else -1 for b in range(n)] for k in range(1 << n)]
    E = [[k, k ^ (1 << b)] for k in range(1 << n) for b in range(n) if k ^ (1 << b) > k]
    return {"vertices": V, "edges": E}


def sixteen_cell():
    V = []
    for i in range(4):
        for s in (1, -1):
            p = [0, 0, 0, 0]
            p[i] = s
            V.append(p)
    E = [[a, b] for a in range(8) for b in range(a + 1, 8) if dot(V[a], V[b]) != -1]
    return {"vertices": V, "edges": E}


def e8_roots():
    V = []
    for i in range(8):
        for j in range(i + 1, 8):
            for a in (1, -1):
                for b in (1, -1):
                    p = [0] * 8
                    p[i], p[j] = a, b
                    V.append(p)
    for k in range(256):
        p = [-0.5 if (k >> b) & 1 else 0.5 for b in range(8)]
        if sum(1 for x in p if x < 0) % 2 == 0:
            V.append(p)
    E = [[a, b] for a in range(len(V)) for b in range(a + 1, len(V)) if dot(V[a], V[b]) == 1]
    return {"vertices": V, "edges": E}


CUBE_FACES = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]


# ---- Linear algebra for the Coxeter plane ------------------------------------------------------------------
def mat_mul(A, B):
    return [[sum((v * B[k][j] for k, v in enumerate(row)), 0.0) for j in range(len(B[0]))] for row in A]


def reflection(a):
    n, q = len(a), dot(a, a)
    return [[(1 if i == j else 0) - 2 * a[i] * a[j] / q for j in range(n)] for i in range(n)]


def sym_eigen(A_in, sweeps=60):
    n = len(A_in)
    A = [list(map(float, row)) for row in A_in]
    V = [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    for _ in range(sweeps):
        off = 0.0
        for i in range(n):
            for j in range(i + 1, n):
                off += A[i][j] * A[i][j]
        if off < 1e-26:
            break
        for p in range(n):
            for q in range(p + 1, n):
                if abs(A[p][q]) < 1e-300:
                    continue
                th = (A[q][q] - A[p][p]) / (2 * A[p][q])
                t = math.copysign(1.0, th if th else 1.0) / (abs(th) + math.sqrt(th * th + 1))
                c = 1 / math.sqrt(t * t + 1)
                s = t * c
                for k in range(n):
                    kp, kq = A[k][p], A[k][q]
                    A[k][p] = c * kp - s * kq
                    A[k][q] = s * kp + c * kq
                for k in range(n):
                    pk, qk = A[p][k], A[q][k]
                    A[p][k] = c * pk - s * qk
                    A[q][k] = s * pk + c * qk
                for k in range(n):
                    kp, kq = V[k][p], V[k][q]
                    V[k][p] = c * kp - s * kq
                    V[k][q] = s * kp + c * kq
    pairs = [{"value": A[i][i], "vector": [row[i] for row in V]} for i in range(n)]
    return sorted(pairs, key=lambda e: -e["value"])


E8_SIMPLE = [[0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5], [1, 1, 0, 0, 0, 0, 0, 0], [-1, 1, 0, 0, 0, 0, 0, 0], [0, -1, 1, 0, 0, 0, 0, 0],
             [0, 0, -1, 1, 0, 0, 0, 0], [0, 0, 0, -1, 1, 0, 0, 0], [0, 0, 0, 0, -1, 1, 0, 0], [0, 0, 0, 0, 0, -1, 1, 0]]


def coxeter_plane():
    c = None
    for R in (reflection(a) for a in E8_SIMPLE):
        c = R if c is None else mat_mul(c, R)
    sym = [[v + c[j][i] for j, v in enumerate(row)] for i, row in enumerate(c)]
    eig = sym_eigen(sym)
    u, w0 = eig[0]["vector"], eig[1]["vector"]
    k = dot(w0, u)
    w1 = [v - k * u[i] for i, v in enumerate(w0)]
    nw = math.sqrt(dot(w1, w1))
    return {"c": c, "u": u, "v": [x / nw for x in w1], "top": [eig[0]["value"], eig[1]["value"]], "next": eig[2]["value"]}


def _petrie(n):
    a = [math.cos(math.pi * k / n) for k in range(n)]
    b = [math.sin(math.pi * k / n) for k in range(n)]
    return a, b


# ---- Projection mode ---------------------------------------------------------------------------------------
POLY = {"cube": 3, "tesseract": 4, "16cell": 4, "octeract": 8, "e8_lattice": 8}


def perspective(p, dist):
    f = dist / (dist - p[-1])
    return [v * f for v in p[:-1]]


def rings(pts2, tol=1e-6):
    rs = sorted(_hypot(x, y) for x, y in pts2)
    out = []
    for v in rs:
        if out and abs(v - out[-1]["r"]) <= tol:
            out[-1]["n"] += 1
        else:
            out.append({"r": v, "n": 1})
    return [g for g in out if g["r"] > tol]


def face_shade(normal, theme):
    light = [-0.4, -0.5, 0.77]
    nl = _hypot(*light)
    lam = max(0.0, dot(normal, light) / nl)
    L0, L1 = (0.42, 0.78) if theme == "light" else (0.36, 0.82)
    return {"L": r(L0 + (L1 - L0) * lam, 4), "C": 0.17 if theme == "light" else 0.12, "H": 259.8 if theme == "light" else 248.9, "lambert": r(lam, 4)}


def _js_num_str(v):
    """String(value) as JavaScript writes it: shortest digits, no .0, exponent past 1e21 or under 1e-6."""
    if isinstance(v, str):
        return v
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


def oklch_css(s):
    return "oklch(" + _js_num_str(r(s["L"] * 100, 2)) + "% " + _js_num_str(s["C"]) + " " + _js_num_str(s["H"]) + ")"


# ---- The checks, one function each, the same as in hyper-studio.mjs ----------------------------------------
TOL = 1e-9


def lengths_kept(pts, edges, length):
    return all(abs(_hypot(*[v - pts[b][i] for i, v in enumerate(pts[a])]) - length) < TOL for a, b in edges)


def norms_kept(pts, radius):
    return all(abs(_hypot(*p) - radius) < TOL for p in pts)


def faces_viewer(n):
    """A face is drawn solid when its outward normal points towards the viewer by more than the tolerance."""
    return n[2] > TOL


def back_to_front(faces):
    return all(i == 0 or faces[i - 1]["depth"] <= f["depth"] for i, f in enumerate(faces))


def facing_ok(faces):
    n = sum(1 for f in faces if f["visible"])
    return 1 <= n <= 3


def counts_ok(shape, v, e, deg):
    """v vertices, e edges, and every vertex on deg edges."""
    if len(shape["vertices"]) != v or len(shape["edges"]) != e:
        return False
    d = [0] * v
    for a, b in shape["edges"]:
        d[a] += 1
        d[b] += 1
    return all(x == deg for x in d)


def is_identity(M):
    return all(abs(v - (1 if i == j else 0)) < TOL for i, row in enumerate(M) for j, v in enumerate(row))


def coxeter_ok(top, nxt):
    w = 2 * math.cos(2 * math.pi / 30)
    return abs(top[0] - w) < TOL and abs(top[1] - top[0]) < TOL and nxt < top[0] - 1e-3


def rings_exact(rg, count, size):
    return len(rg) == count and all(g["n"] == size for g in rg)


def rings_multiple(rg, fold):
    return len(rg) > 0 and all(g["n"] % fold == 0 for g in rg)


def dof_ok(near, far, s):
    return near < s < far


def harmonic_ok(near, far, s, H):
    """Relative form: s (1/near + 1/far) is 2."""
    return s >= H if far == INF else abs(s * (1 / near + 1 / far) - 2) < TOL


def ev100_ok(N, t, iso, ev100):
    """Relative form: the shutter time read back over t is 1."""
    return abs(N * N / 2 ** (ev100 + math.log2(iso / 100)) / t - 1) < TOL


def overlap_ok(max_overlap):
    return max_overlap <= 0.01


def inside_box(trails, parts, W, H):
    return all(parts[i]["radius"] - TOL <= x <= W - parts[i]["radius"] + TOL and parts[i]["radius"] - TOL <= y <= H - parts[i]["radius"] + TOL
               for i, tr in enumerate(trails) for x, y in tr[1:])


def path_ok(path, best, blocked, W):
    """As long as the shortest, one cell at a time, through no obstacle; no path only when none exists."""
    if path is None:
        return best is None
    return (len(path) - 1 == best and all(i == 0 or abs(c[0] - path[i - 1][0]) + abs(c[1] - path[i - 1][1]) == 1 for i, c in enumerate(path))
            and all(c[1] * W + c[0] not in blocked for c in path))


def projection(req):
    name = str(req.get("polytope") or "tesseract")
    theme = "light" if req.get("theme") == "light" else "dark"
    if name not in POLY:
        _fail("Choose a shape: cube, tesseract, 16cell, octeract or e8_lattice.", name)
    dim = POLY[name]
    if req.get("dimension") is not None and _number(req["dimension"]) != dim:
        _fail("The dimension does not match the shape.", (req["dimension"] if isinstance(req["dimension"], str) else _js_num_str(req["dimension"])) + " ≠ " + str(dim))
    shape = hypercube(3) if name == "cube" else hypercube(4) if name == "tesseract" else sixteen_cell() if name == "16cell" else hypercube(8) if name == "octeract" else e8_roots()
    rot = apply_angles([[float(x) for x in p] for p in shape["vertices"]], dim, req.get("angles"))
    checks = []
    faces = None
    if dim == 3:
        pts = [[*perspective(p, 5), p[2]] for p in rot]
        faces = []
        for f in CUBE_FACES:
            # The cube is centred on the origin, so a face's outward normal is the direction of its centre.
            center = [sum(rot[i][k] for i in f) / 4 for k in range(3)]
            ln = _hypot(*center)
            nrm = [v / ln for v in center]
            shade = face_shade(nrm, theme)
            faces.append({"vertices": f, "depth": r(center[2]), "visible": faces_viewer(nrm), "fill": oklch_css(shade), "lambert": shade["lambert"]})
        faces.sort(key=lambda x: x["depth"])
        method = "SO(3) rotation, perspective from z = 5, faces sorted back to front (painter's algorithm)"
        checks.append({"text": "The rotation keeps every edge length.", "ok": lengths_kept(rot, shape["edges"], 2)})
        checks.append({"text": "Faces are drawn from the back to the front.", "ok": back_to_front(faces)})
        checks.append({"text": "Three faces at most face the viewer.", "ok": facing_ok(faces)})
    elif dim == 4:
        pts = []
        for p in rot:
            q = perspective(p, 3)
            pts.append([*perspective(q, 5), q[2]])
        method = "SO(4) rotation in the chosen planes, perspective R4 → R3 from w = 3, then R3 → R2 from z = 5"
        checks.append({"text": "The rotation keeps every vertex's distance from the centre.", "ok": norms_kept(rot, 2 if name == "tesseract" else 1)})
        if name == "tesseract":
            checks.append({"text": "16 vertices and 32 edges, each vertex on 4 edges.", "ok": counts_ok(shape, 16, 32, 4)})
        else:
            checks.append({"text": "8 vertices and 24 edges, each vertex on 6 edges.", "ok": counts_ok(shape, 8, 24, 6)})
    else:
        if name == "e8_lattice":
            cp = coxeter_plane()
            U, Vv = cp["u"], cp["v"]
            M = [[1.0 if i == j else 0.0 for j in range(8)] for i in range(8)]
            for _ in range(30):
                M = mat_mul(M, cp["c"])
            checks.append({"text": "The Coxeter element has order 30.", "ok": is_identity(M)})
            checks.append({"text": "The plane is the eigenspace of 2 cos(2π/30), which appears twice.", "ok": coxeter_ok(cp["top"], cp["next"])})
            checks.append({"text": "240 roots and 6720 edges, each root on 56 edges.", "ok": counts_ok(shape, 240, 6720, 56)})
            method = "Coxeter plane of E8: the eigenspace of c + cᵀ for 2 cos(2π/30), c the product of the 8 simple reflections"
        else:
            a, b = _petrie(8)
            na, nb = _hypot(*a), _hypot(*b)
            U, Vv = [x / na for x in a], [x / nb for x in b]
            checks.append({"text": "256 vertices and 1024 edges, each vertex on 8 edges.", "ok": counts_ok(shape, 256, 1024, 8)})
            method = "Petrie projection of the 8-cube: axis k drawn at k × 22.5°"
        pts = [[dot(p, U), dot(p, Vv), 0] for p in rot]
        rg = rings([[dot(p, U), dot(p, Vv)] for p in shape["vertices"]], 1e-6)
        if name == "e8_lattice":
            checks.append({"text": "Before rotation the roots fall on 8 rings of 30, a 30-fold symmetry.", "ok": rings_exact(rg, 8, 30)})
        else:
            checks.append({"text": "Before rotation every ring holds a multiple of 16 vertices, a 16-fold symmetry.", "ok": rings_multiple(rg, 16)})
    span = max(max(abs(p[0]), abs(p[1])) for p in pts) or 1
    xy = [[r(p[0] / span), r(p[1] / span), r(p[2])] for p in pts]
    return {"mode": "projection", "polytope": name, "dimension": dim, "theme": theme, "accent": ACCENT[theme], "method": method,
            "verified": all(c["ok"] for c in checks), "checks": checks,
            "counts": {"vertices": len(shape["vertices"]), "edges": len(shape["edges"]), "faces": len(faces) if faces else 0},
            "points": xy, "edges": shape["edges"], "faces": faces}


def hyper_svg(g, size=640):
    c, s = size / 2, size * 0.42

    def P(p):
        return f"{c + p[0] * s:.2f} {c - p[1] * s:.2f}"

    body = []
    if g["faces"]:
        for f in g["faces"]:
            body.append('<path d="M' + " L".join(P(g["points"][i]) for i in f["vertices"]) + ' Z" fill="' + f["fill"] + '" fill-opacity="' + ("1" if f["visible"] else "0.25") + '" stroke="' + g["accent"] + '" stroke-width="1.5"/>')
    else:
        many = len(g["edges"]) > 2000
        body.append('<path d="' + " ".join("M" + P(g["points"][a]) + " L" + P(g["points"][b]) for a, b in g["edges"]) + '" fill="none" stroke="' + g["accent"] + '" stroke-width="' + ("0.4" if many else "1.2") + '" stroke-opacity="' + ("0.45" if many else "0.85") + '"/>')
        if len(g["points"]) <= 256:
            rad = "1.6" if len(g["points"]) > 64 else "3"
            for p in g["points"]:
                body.append(f'<circle cx="{c + p[0] * s:.2f}" cy="{c - p[1] * s:.2f}" r="{rad}" fill="{g["accent"]}"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="{g["polytope"]} projection">' + "".join(body) + "</svg>"


# ---- Optics ------------------------------------------------------------------------------------------------
def kelvin_to_xy(K):
    if not (1667 <= K <= 25000):
        _fail("Colour temperatures are from 1667 K to 25000 K.", _js_num_str(K))
    if K <= 4000:
        x = -0.2661239e9 / K ** 3 - 0.2343589e6 / K ** 2 + 0.8776956e3 / K + 0.179910
    else:
        x = -3.0258469e9 / K ** 3 + 2.1070379e6 / K ** 2 + 0.2226347e3 / K + 0.240390
    if K <= 2222:
        y = -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    elif K <= 4000:
        y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
    else:
        y = 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483
    return x, y


def kelvin_to_colour(K):
    x, y = kelvin_to_xy(K)
    X, Z = x / y, (1 - x - y) / y
    lin = [3.2404542 * X - 1.5371385 - 0.4985314 * Z, -0.9692660 * X + 1.8760108 + 0.0415560 * Z, 0.0556434 * X - 0.2040259 + 1.0572252 * Z]
    mx = max(lin)
    c = [max(0.0, v / mx) for v in lin]
    gam = [12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055 for v in c]
    l_ = math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2])
    m_ = math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2])
    s_ = math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2])
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    C = _hypot(A, B)
    H = (math.atan2(B, A) * 180 / math.pi + 360) % 360
    hexs = "#" + "".join(f"{_js_round(min(1, max(0, v)) * 255):02x}" for v in gam)
    return {"kelvin": _num(K), "xy": [r(x), r(y)], "hex": hexs, "oklch": "oklch(" + _js_num_str(r(L * 100, 2)) + "% " + _js_num_str(r(C, 3)) + " " + _js_num_str(r(H, 1)) + ")", "mired": r(1e6 / K, 2)}


def _pos(v, name, lo, hi):
    x = _number(v)
    if not math.isfinite(x) or x < lo or x > hi:
        _fail("A value is out of range.", f"{name}: {_js_num_str(lo)}–{_js_num_str(hi)}")
    return x


def _get(req, k, default):
    v = req.get(k)
    return default if v is None else v


def optics(req):
    f = _pos(_get(req, "focal_mm", 50), "focal_mm", 4, 1200)
    N = _pos(_get(req, "f_stop", 2.8), "f_stop", 0.7, 64)
    sM = _pos(_get(req, "subject_distance_m", 3), "subject_distance_m", 0.05, 10000)
    w = _pos(_get(req, "sensor_width_mm", 36), "sensor_width_mm", 4, 70)
    iso = _pos(_get(req, "iso", 100), "iso", 25, 204800)
    t = _pos(_get(req, "shutter_s", 1 / 125), "shutter_s", 1 / 64000, 3600)
    s = sM * 1000
    h = w * 2 / 3
    coc = _hypot(w, h) / 1500
    if s <= f:
        _fail("The subject must be farther than the focal length.")
    H = f * f / (N * coc) + f
    near = s * (H - f) / (H + s - 2 * f)
    far = s * (H - f) / (H - s) if s < H else INF
    blur = f * f / (N * (s - f))
    fov = 2 * math.atan(w / (2 * f)) * 180 / math.pi
    fov_v = 2 * math.atan(h / (2 * f)) * 180 / math.pi
    ev100 = math.log2(N * N / t) - math.log2(iso / 100)
    lights = {}
    for k, d in (("key", 5600), ("fill", 4200), ("rim", 3200)):
        lights[k] = kelvin_to_colour(_pos(_get(req, k + "_kelvin", d), k + "_kelvin", 1667, 25000))
    shift = r(lights["fill"]["mired"] - lights["key"]["mired"], 2)
    checks = [
        {"text": "The near limit is before the subject and the far limit after it.", "ok": dof_ok(near, far, s)},
        {"text": "The focus distance is the harmonic mean of the near and far limits.", "ok": harmonic_ok(near, far, s, H)},
        {"text": "EV100 read back gives the shutter time.", "ok": ev100_ok(N, t, iso, ev100)},
    ]
    return {"mode": "optics", "verified": all(c["ok"] for c in checks), "checks": checks,
            "lens": {"focal_mm": _num(f), "f_stop": _num(N), "subject_m": _num(sM), "sensor_mm": [_num(w), r(h, 3)], "coc_mm": r(coc, 4)},
            "depth_of_field": {"hyperfocal_m": r(H / 1000, 3), "near_m": r(near / 1000, 3), "far_m": None if far == INF else r(far / 1000, 3),
                               "total_m": None if far == INF else r((far - near) / 1000, 3), "infinite": far == INF},
            "field_of_view_deg": {"horizontal": r(fov, 2), "vertical": r(fov_v, 2)},
            "background_blur": {"disc_mm": r(blur, 4), "percent_of_width": r(100 * blur / w, 3), "in_coc": r(blur / coc, 1)},
            "exposure": {"ev100": r(ev100, 2), "iso": _num(iso), "shutter_s": _num(t)},
            "lights": lights, "fill_shift_mired": shift}


# ---- Game physics ------------------------------------------------------------------------------------------
def _is_int(v):
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def _cell(v, W, H, what):
    if not isinstance(v, list) or len(v) != 2 or not all(_is_int(x) for x in v) or v[0] < 0 or v[1] < 0 or v[0] >= W or v[1] >= H:
        _fail("A cell is outside the grid.", what)
    return [int(v[0]), int(v[1])]


def astar(W, H, blocked, start, goal):
    def key(x, y):
        return y * W + x

    g = {key(*start): 0}
    frm = {}
    # The open list stays in insertion order, so taking the first entry with the lowest f breaks ties by age.
    open_ = [[0, start]]
    expanded = 0
    closed = set()
    while open_:
        bi = 0
        for i in range(1, len(open_)):
            if open_[i][0] < open_[bi][0]:
                bi = i
        cur = open_.pop(bi)[1]
        ck = key(*cur)
        if ck in closed:
            continue
        closed.add(ck)
        expanded += 1
        if cur[0] == goal[0] and cur[1] == goal[1]:
            path = [cur]
            k = ck
            while k in frm:
                k = frm[k]
                path.append([k % W, k // W])
            return {"path": path[::-1], "expanded": expanded}
        for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
            nx, ny = cur[0] + dx, cur[1] + dy
            nk = key(nx, ny)
            if nx < 0 or ny < 0 or nx >= W or ny >= H or nk in blocked or nk in closed:
                continue
            ng = g[ck] + 1
            if nk not in g or ng < g[nk]:
                g[nk] = ng
                frm[nk] = ck
                open_.append([ng + abs(nx - goal[0]) + abs(ny - goal[1]), [nx, ny]])
    return {"path": None, "expanded": expanded}


def bfs_length(W, H, blocked, start, goal):
    def key(x, y):
        return y * W + x

    dist = {key(*start): 0}
    q = [start]
    h = 0
    while h < len(q):
        x, y = q[h]
        h += 1
        d = dist[key(x, y)]
        if x == goal[0] and y == goal[1]:
            return d
        for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
            nx, ny = x + dx, y + dy
            nk = key(nx, ny)
            if nx < 0 or ny < 0 or nx >= W or ny >= H or nk in blocked or nk in dist:
                continue
            dist[nk] = d + 1
            q.append([nx, ny])
    return None


def verlet(particles, W, H, ticks, gravity=0.0):
    P = [{"x": float(p["x"]), "y": float(p["y"]), "px": p["x"] - p["vx"], "py": p["y"] - p["vy"], "r": float(p["radius"])} for p in particles]
    trails = [[[r(p["x"], 4), r(p["y"], 4)]] for p in P]
    max_overlap = 0.0
    for _ in range(ticks):
        for p in P:
            nx, ny = 2 * p["x"] - p["px"], 2 * p["y"] - p["py"] + gravity
            p["px"], p["py"], p["x"], p["y"] = p["x"], p["y"], nx, ny
        # Collisions and walls are relaxed together four times, so a wall cannot push a particle back into another.
        for _it in range(4):
            for i in range(len(P)):
                for j in range(i + 1, len(P)):
                    a, b = P[i], P[j]
                    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
                    d = _hypot(dx, dy)
                    mn = a["r"] + b["r"]
                    if d >= mn:
                        continue
                    # Two centres on the same point are parted along x, so the answer stays fixed.
                    nx, ny = (dx / d, dy / d) if d else (1.0, 0.0)
                    push = (mn - d) / 2
                    va = (a["x"] - a["px"]) * nx + (a["y"] - a["py"]) * ny
                    vb = (b["x"] - b["px"]) * nx + (b["y"] - b["py"]) * ny
                    a["x"] -= nx * push
                    a["y"] -= ny * push
                    a["px"] -= nx * push
                    a["py"] -= ny * push
                    b["x"] += nx * push
                    b["y"] += ny * push
                    b["px"] += nx * push
                    b["py"] += ny * push
                    dv = vb - va
                    if dv < 0:
                        a["px"] -= dv * nx
                        a["py"] -= dv * ny
                        b["px"] += dv * nx
                        b["py"] += dv * ny
            for p in P:
                if p["x"] < p["r"]:
                    v = p["x"] - p["px"]
                    p["x"] = p["r"]
                    p["px"] = p["x"] + v
                if p["x"] > W - p["r"]:
                    v = p["x"] - p["px"]
                    p["x"] = W - p["r"]
                    p["px"] = p["x"] + v
                if p["y"] < p["r"]:
                    v = p["y"] - p["py"]
                    p["y"] = p["r"]
                    p["py"] = p["y"] + v
                if p["y"] > H - p["r"]:
                    v = p["y"] - p["py"]
                    p["y"] = H - p["r"]
                    p["py"] = p["y"] + v
        for i in range(len(P)):
            for j in range(i + 1, len(P)):
                max_overlap = max(max_overlap, P[i]["r"] + P[j]["r"] - _hypot(P[j]["x"] - P[i]["x"], P[j]["y"] - P[i]["y"]))
        for i, p in enumerate(P):
            trails[i].append([r(p["x"], 4), r(p["y"], 4)])
    final = [{"x": r(p["x"], 4), "y": r(p["y"], 4), "vx": r(p["x"] - p["px"], 4), "vy": r(p["y"] - p["py"], 4), "radius": _num(p["r"])} for p in P]
    return {"trails": trails, "final": final, "max_overlap": max_overlap}


def game_physics(req):
    gs = _get(req, "grid_size", [12, 12])
    if not isinstance(gs, list) or len(gs) != 2 or not all(_is_int(v) and 2 <= v <= LIMITS["grid"] for v in gs):
        _fail("The grid is two whole numbers from 2 to 40.")
    W, H = int(gs[0]), int(gs[1])
    start = _cell(_get(req, "start", [0, 0]), W, H, "start")
    goal = _cell(_get(req, "goal", [W - 1, H - 1]), W, H, "goal")
    obs = _get(req, "obstacles", [])
    if not isinstance(obs, list) or len(obs) > LIMITS["obstacles"]:
        _fail("Give at most 400 obstacles.")
    blocked = set()
    for i, o in enumerate(obs):
        c = _cell(o, W, H, f"obstacle {i}")
        blocked.add(c[1] * W + c[0])
    if start[1] * W + start[0] in blocked or goal[1] * W + goal[0] in blocked:
        _fail("The start and the goal must be free cells.")
    ticks = _get(req, "ticks", 30)
    if not _is_int(ticks) or ticks < 0 or ticks > LIMITS["ticks"]:
        _fail("Ticks are whole numbers from 0 to 600.")
    ticks = int(ticks)
    parts = _get(req, "particles", [])
    if not isinstance(parts, list) or len(parts) > LIMITS["particles"]:
        _fail("Give at most 24 particles.")
    for p in parts:
        ok = isinstance(p, dict) and all(isinstance(p.get(k), (int, float)) and not isinstance(p.get(k), bool) and math.isfinite(p[k]) for k in ("x", "y", "vx", "vy", "radius"))
        if not ok or p["radius"] <= 0 or p["radius"] > min(W, H) / 2 or abs(p["vx"]) > W or abs(p["vy"]) > H:
            _fail("Each particle needs x, y, vx, vy and a radius that fits the grid.")
    gravity = _number(_get(req, "gravity", 0))
    if not math.isfinite(gravity) or abs(gravity) > 1:
        _fail("Gravity is from -1 to 1 cells per tick squared.")
    a = astar(W, H, blocked, start, goal)
    best = bfs_length(W, H, blocked, start, goal)
    sim = verlet(parts, W, H, ticks, gravity)
    path = a["path"]
    checks = [
        {"text": "A*'s path is as short as breadth-first search's, one step at a time, never through an obstacle." if path else "No path exists, and breadth-first search agrees.", "ok": path_ok(path, best, blocked, W)},
        {"text": "Every particle stays inside the box.", "ok": inside_box(sim["trails"], parts, W, H)},
        {"text": "Particles never overlap by more than a hundredth of a cell after a tick.", "ok": overlap_ok(sim["max_overlap"])},
    ]
    return {"mode": "game_physics", "verified": all(c["ok"] for c in checks), "checks": checks, "grid": [W, H], "start": start, "goal": goal, "obstacles": obs,
            "path": path, "path_length": len(path) - 1 if path else None, "expanded": a["expanded"], "shortest": best, "ticks": ticks, "gravity": _num(gravity),
            "trails": sim["trails"], "particles": sim["final"]}


def hyper(req):
    req = req if isinstance(req, dict) else {}
    mode = str(req.get("mode") or "")
    if mode == "projection":
        return projection(req)
    if mode == "optics":
        return optics(req)
    if mode == "game_physics":
        return game_physics(req)
    return _fail("Choose a mode: projection, optics or game_physics.")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Projections from 3 to 8 dimensions, camera optics and grid physics (ADR-155).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "svg"):
        p = sub.add_parser(name)
        p.add_argument("file", help="a JSON request, or - for standard input")
    a = ap.parse_args(argv)
    try:
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
        out = hyper(req)
        if a.cmd == "svg":
            if out["mode"] != "projection":
                _fail("Only a projection is drawn as SVG.")
            print(hyper_svg(out))
        else:
            print(json.dumps(out, ensure_ascii=False))
        return 0
    except HyperError as e:
        print(json.dumps({"error": str(e), "detail": e.detail}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
