#!/usr/bin/env python3
"""quantum_math: four exact engines in the standard library (statistics, random, secrets, hashlib, json,
argparse, re, sys). No network, no processes, nothing imported from outside.

  vpin   - context toxicity of an agent's event stream: volume-synchronised buckets, VPIN = mean toxic share
           per bucket, OFI = (productive - toxic) / total; rollback advised at VPIN >= 0.65 [INFERENCE].
  layout - fluid layout: card weights relaxed by Jacobi steps of the discrete Poisson equation, then placed
           in a 1, 2 or 3 column grid for 375, 768 or 1440 px, mirrored for RTL; checks 44 px touch and overflow.
  monte  - seeded Monte Carlo over a mission DAG: p50 and p95 durations, how often each step is on the
           critical path, and the steps that can start at once. Locked steps (AGENTS.md section 1) never run.
  shamir - Shamir secret sharing over GF(256) (AES polynomial 0x11b): any k shares rebuild the secret;
           k - 1 shares are consistent with every possible secret, so they reveal nothing.

    python3 quantum_math.py vpin events.json
    python3 quantum_math.py layout cards.json --viewport 375 --dir rtl
    python3 quantum_math.py monte plan.json --trials 1000 --seed 149
    python3 quantum_math.py shamir-split --hex <64 hex chars> -k 3 -n 5
    python3 quantum_math.py shamir-join shares.json
"""

import argparse
import hashlib
import json
import random
import re
import secrets
import statistics
import sys

# The lock words of jarvis/server/lib/llm-plan.mjs (AGENTS.md section 1), English and Arabic.
LOCK_RE = re.compile(
    r"\b(pay|payment|billing|bill|invoice|price|pricing|subscription|refund|transfer|wallet|money|charge|stripe|"
    r"publish|deploy|go live|production|release to|public site|launch|permission|permissions|access|role|grant|admin|"
    r"sudo|collaborator|install|plugin|dependency|dependencies|e-?mail|send|message|webhook|tweet|slack|notify|"
    r"outbound|external|post to)\b|دفع|فاتور|مال|سعر|أسعار|اشتراك|تحويل|محفظ|نشر|إطلاق|اطلاق|صلاحي|تثبيت|ثبت|ثبّت|"
    r"أرسل|ارسل|إرسال|ارسال|بريد|رسالة|خارجي",
    re.IGNORECASE,
)


# ---- 1. VPIN-style context toxicity ---------------------------------------------------------------------
def compute_vpin_toxicity(events, bucket_volume=200, window=10, limit=0.65):
    """events: [{"tokens": int, "productive": bool, "repeated_ngrams": int}]. A token is toxic in proportion
    to how unproductive and repetitive its event was; buckets hold `bucket_volume` tokens each."""
    if bucket_volume <= 0:
        raise ValueError("bucket_volume must be positive")
    buckets, prod, tox, vol = [], 0.0, 0.0, 0
    for ev in events:
        tokens = max(1, int(ev.get("tokens", 1)))
        share = min(1.0, (0.0 if ev.get("productive", True) else 0.75) + 0.08 * max(0, int(ev.get("repeated_ngrams", 0))))
        while tokens > 0:
            take = min(tokens, bucket_volume - vol)
            prod += take * (1 - share)
            tox += take * share
            vol += take
            tokens -= take
            if vol == bucket_volume:
                buckets.append((prod, tox))
                prod, tox, vol = 0.0, 0.0, 0
    if vol:
        buckets.append((prod, tox))
    tail = buckets[-window:]
    vpin = round(statistics.fmean(t / (p + t) for p, t in tail), 4) if tail else 0.0
    total_p, total_t = sum(p for p, _ in buckets), sum(t for _, t in buckets)
    ofi = round((total_p - total_t) / (total_p + total_t), 4) if buckets else 0.0
    status = "toxic" if vpin >= limit else "elevated" if vpin >= 0.4 else "healthy"
    return {"vpin": vpin, "ofi": ofi, "buckets": len(buckets), "status": status, "recommend_capsule_rollback": vpin >= limit, "label": "[INFERENCE]"}


# ---- 2. Fluid layout: Poisson relaxation of visual weight ---------------------------------------------
def solve_fluid_layout(cards, viewport=1440, direction="ltr", iterations=40):
    """Jacobi steps of u_i = (u_{i-1} + u_{i+1}) / 2 with the card weights as sources spread the visual
    pressure; the returned variance falls as the layout balances. Columns, gaps and padding follow DESIGN.md."""
    if not cards:
        return {"viewport": viewport, "direction": direction, "columns": 0, "placements": [], "pressure_variance": 0.0, "overflow_x_safe": True}
    cols = 1 if viewport <= 480 else 2 if viewport <= 900 else 3
    gap = 12 if cols == 1 else 16 if cols == 2 else 24
    pad = 16 if cols == 1 else 24 if cols == 2 else 32
    col_w = (viewport - 2 * pad - (cols - 1) * gap) // cols
    w = [max(0.1, float(c.get("weight", 1.0))) for c in cards]
    u = list(w)
    for _ in range(max(1, iterations)):
        u = [0.5 * w[i] + 0.25 * ((u[i - 1] if i else u[i]) + (u[i + 1] if i + 1 < len(u) else u[i])) for i in range(len(u))]
    rtl = str(direction).lower() == "rtl"
    out = []
    for i, c in enumerate(cards):
        col = i % cols
        if rtl:
            col = cols - 1 - col
        h = max(44, int(c.get("min_height", 120)))
        out.append({"id": str(c.get("id", f"card{i + 1}")), "row": i // cols, "col": col, "inline_start_px": pad + col * (col_w + gap),
                    "width_px": col_w, "min_height_px": h, "pressure": round(u[i], 4), "touch_ok": col_w >= 44 and h >= 44})
    return {"viewport": viewport, "direction": "rtl" if rtl else "ltr", "columns": cols, "gap_px": gap, "placements": out,
            "pressure_variance": round(statistics.pvariance(u), 6) if len(u) > 1 else 0.0, "raw_variance": round(statistics.pvariance(w), 6) if len(w) > 1 else 0.0,
            "overflow_x_safe": all(p["inline_start_px"] + p["width_px"] <= viewport - pad for p in out)}


# ---- 3. Seeded Monte Carlo over a mission DAG ---------------------------------------------------------
def step_locked(s):
    return s.get("locked") is True or (s.get("kind") == "approval" and s.get("category") in ("money", "publish", "permissions", "install", "outbound")) or str(s.get("gate", "")).lower() == "approval" or bool(LOCK_RE.search(str(s.get("title", ""))))


def simulate_mission_monte_carlo(steps, trials=1000, seed=149):
    """Each unlocked step lasts estimate_ms x lognormal(0, 0.25); a step starts when all it depends on has
    finished. A locked step and everything that depends on it never run here: they wait for Director 00."""
    rng = random.Random(seed)  # noqa: S311 - a repeatable simulation, not a secret
    trials = max(10, min(20000, int(trials)))
    n = len(steps)
    deps = [[d for d in (s.get("depends") or []) if isinstance(d, int) and 0 <= d < i] for i, s in enumerate(steps)]
    locked = [step_locked(s) for s in steps]
    blocked = list(locked)
    for i in range(n):
        if any(blocked[d] for d in deps[i]):
            blocked[i] = True
    runnable = [i for i in range(n) if not blocked[i]]
    totals, critical = [], [0] * n
    for _ in range(trials):
        finish, via = {}, {}
        for i in runnable:
            start = max((finish[d] for d in deps[i]), default=0.0)
            via[i] = max(deps[i], key=lambda d: finish[d]) if deps[i] else None
            finish[i] = start + max(1.0, float(steps[i].get("estimate_ms", 100))) * rng.lognormvariate(0.0, 0.25)
        if finish:
            end = max(finish, key=finish.get)
            totals.append(finish[end])
            while end is not None:
                critical[end] += 1
                end = via[end]
    totals.sort()

    def pick(q):
        return round(totals[min(len(totals) - 1, int(q * len(totals)))], 1) if totals else 0.0

    return {"trials": trials, "seed": seed, "p50_ms": pick(0.5), "p95_ms": pick(0.95),
            "critical_share": {str(steps[i].get("id", i)): round(critical[i] / trials, 3) for i in runnable},
            "ready_now": [str(steps[i].get("id", i)) for i in runnable if not deps[i]],
            "locked": [str(steps[i].get("id", i)) for i in range(n) if locked[i]],
            "waiting_on_lock": [str(steps[i].get("id", i)) for i in range(n) if blocked[i] and not locked[i]],
            "locked_never_ran": all(i not in runnable for i in range(n) if blocked[i])}


# ---- 4. Shamir secret sharing over GF(256) -------------------------------------------------------------
def gf_mul(a, b):
    p = 0
    for _ in range(8):
        if b & 1:
            p ^= a
        hi = a & 0x80
        a = (a << 1) & 0xFF
        if hi:
            a ^= 0x1B
        b >>= 1
    return p


def gf_inv(a):
    if a == 0:
        raise ValueError("0 has no inverse in GF(256)")
    r, e = 1, 254
    while e:
        if e & 1:
            r = gf_mul(r, a)
        a = gf_mul(a, a)
        e >>= 1
    return r


def _eval(coeffs, x):
    y = 0
    for c in reversed(coeffs):
        y = gf_mul(y, x) ^ c
    return y


def split_secret_gf256(secret, k=3, n=5, rand_byte=None):
    """Shares of `secret` (bytes). Coefficients come from the secrets module; `rand_byte` is for tests only."""
    if not 2 <= k <= n <= 255:
        raise ValueError("need 2 <= k <= n <= 255")
    draw = rand_byte or (lambda: secrets.randbelow(256))
    ys = [bytearray() for _ in range(n)]
    for b in bytes(secret):
        coeffs = [b] + [draw() for _ in range(k - 2)] + [1 + (draw() % 255)]
        for i in range(n):
            ys[i].append(_eval(coeffs, i + 1))
    return [{"x": i + 1, "k": k, "n": n, "y": bytes(y).hex(), "sha256": hashlib.sha256(bytes(y)).hexdigest()} for i, y in enumerate(ys)]


def reconstruct_secret_gf256(shares):
    """Lagrange interpolation at x = 0. With fewer than k shares the answer is some value, not the secret."""
    if not shares:
        raise ValueError("no shares")
    xs = [int(s["x"]) for s in shares]
    if len(set(xs)) != len(xs) or any(not 1 <= x <= 255 for x in xs):
        raise ValueError("share x values must be distinct, 1 to 255")
    ys = [bytes.fromhex(s["y"]) for s in shares]
    if len({len(y) for y in ys}) != 1:
        raise ValueError("shares have different lengths")
    for s, y in zip(shares, ys, strict=True):
        if s.get("sha256") and hashlib.sha256(y).hexdigest() != s["sha256"]:
            raise ValueError(f"share {s['x']} does not match its SHA-256")
    basis = []
    for i, xi in enumerate(xs):
        num, den = 1, 1
        for j, xj in enumerate(xs):
            if i != j:
                num = gf_mul(num, xj)
                den = gf_mul(den, xi ^ xj)
        basis.append(gf_mul(num, gf_inv(den)))
    out = bytearray(len(ys[0]))
    for pos in range(len(out)):
        acc = 0
        for i in range(len(xs)):
            acc ^= gf_mul(ys[i][pos], basis[i])
        out[pos] = acc
    return bytes(out)


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("vpin")
    a.add_argument("events")
    a.add_argument("--bucket", type=int, default=200)
    b = sub.add_parser("layout")
    b.add_argument("cards")
    b.add_argument("--viewport", type=int, default=1440)
    b.add_argument("--dir", default="ltr")
    c = sub.add_parser("monte")
    c.add_argument("plan")
    c.add_argument("--trials", type=int, default=1000)
    c.add_argument("--seed", type=int, default=149)
    d = sub.add_parser("shamir-split")
    d.add_argument("--hex", required=True)
    d.add_argument("-k", type=int, default=3)
    d.add_argument("-n", type=int, default=5)
    e = sub.add_parser("shamir-join")
    e.add_argument("shares")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "vpin":
            out = compute_vpin_toxicity(_load(args.events), args.bucket)
        elif args.cmd == "layout":
            out = solve_fluid_layout(_load(args.cards), args.viewport, args.dir)
        elif args.cmd == "monte":
            p = _load(args.plan)
            out = simulate_mission_monte_carlo(p.get("steps", []) if isinstance(p, dict) else p, args.trials, args.seed)
        elif args.cmd == "shamir-split":
            out = split_secret_gf256(bytes.fromhex(args.hex), args.k, args.n)
        else:
            out = {"secret": reconstruct_secret_gf256(_load(args.shares)).hex()}
    except (OSError, ValueError, KeyError, TypeError) as err:
        print("quantum_math: " + str(err), file=sys.stderr)
        return 2
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
