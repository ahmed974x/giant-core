"""Tests for replica-quantum-math: exact GF(256) maths, Shamir's threshold, VPIN, layout and Monte Carlo locks."""
import contextlib
import hashlib
import io
import json
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import quantum_math as qm


class Field(unittest.TestCase):
    def test_gf256_known_products_and_inverses(self):
        self.assertEqual(qm.gf_mul(0x57, 0x83), 0xC1)  # FIPS-197 section 4.2
        self.assertEqual(qm.gf_mul(0x57, 0x13), 0xFE)
        for a in range(1, 256):
            self.assertEqual(qm.gf_mul(a, qm.gf_inv(a)), 1)
        with self.assertRaises(ValueError):
            qm.gf_inv(0)


class Shamir(unittest.TestCase):
    def setUp(self):
        self.secret = hashlib.sha256(b"jarvis-capsule-root").digest()

    def test_any_k_shares_rebuild_the_secret(self):
        shares = qm.split_secret_gf256(self.secret, 3, 5)
        for pick in ([0, 1, 2], [0, 2, 4], [1, 3, 4], [4, 3, 2], [0, 1, 2, 3, 4]):
            self.assertEqual(qm.reconstruct_secret_gf256([shares[i] for i in pick]), self.secret)

    def test_k_minus_1_shares_fit_every_secret(self):
        # For two shares of a k=3 split, every candidate first byte s has exactly one polynomial
        # f(x) = s + a1 x + a2 x^2 through (x1, y1) and (x2, y2): the shares say nothing about s.
        shares = qm.split_secret_gf256(self.secret, 3, 5)
        (x1, y1), (x2, y2) = [(s["x"], bytes.fromhex(s["y"])[0]) for s in shares[:2]]
        fits = 0
        for s in range(256):
            # a1 x + a2 x^2 = y - s at both points: solve the 2x2 system over GF(256).
            r1, r2 = y1 ^ s, y2 ^ s
            det = qm.gf_mul(x1, qm.gf_mul(x2, x2)) ^ qm.gf_mul(x2, qm.gf_mul(x1, x1))
            if det:
                fits += 1
                a2 = qm.gf_mul(qm.gf_mul(x1, r2) ^ qm.gf_mul(x2, r1), qm.gf_inv(det))
                a1 = qm.gf_mul(r1 ^ qm.gf_mul(a2, qm.gf_mul(x1, x1)), qm.gf_inv(x1))
                self.assertEqual(s ^ qm.gf_mul(a1, x1) ^ qm.gf_mul(a2, qm.gf_mul(x1, x1)), y1)
        self.assertEqual(fits, 256)
        self.assertNotEqual(qm.reconstruct_secret_gf256(shares[:2]), self.secret)

    def test_checks_and_secure_default(self):
        shares = qm.split_secret_gf256(self.secret, 2, 3)
        bad = dict(shares[0], y="00" + shares[0]["y"][2:])
        for broken in ([shares[0], shares[0]], [bad, shares[1]], []):
            with self.assertRaises(ValueError):
                qm.reconstruct_secret_gf256(broken)
        with self.assertRaises(ValueError):
            qm.split_secret_gf256(b"x", 1, 3)
        # Without a test generator two splits differ (fresh randomness from the secrets module).
        self.assertNotEqual(qm.split_secret_gf256(self.secret, 3, 5)[0]["y"], qm.split_secret_gf256(self.secret, 3, 5)[0]["y"])
        rng = random.Random(1)
        fixed = qm.split_secret_gf256(b"ab", 2, 2, rand_byte=lambda: rng.randrange(256))
        self.assertEqual(qm.reconstruct_secret_gf256(fixed), b"ab")


class Vpin(unittest.TestCase):
    def test_healthy_toxic_and_mixed(self):
        good = qm.compute_vpin_toxicity([{"tokens": 100, "productive": True}] * 10)
        self.assertEqual((good["vpin"], good["ofi"], good["status"], good["recommend_capsule_rollback"]), (0.0, 1.0, "healthy", False))
        loop = qm.compute_vpin_toxicity([{"tokens": 200, "productive": False, "repeated_ngrams": 6}] * 4)
        self.assertEqual((loop["vpin"], loop["status"], loop["recommend_capsule_rollback"]), (1.0, "toxic", True))
        half = qm.compute_vpin_toxicity([{"tokens": 100, "productive": True}, {"tokens": 100, "productive": False, "repeated_ngrams": 4}])
        self.assertEqual(half["vpin"], 0.5)  # 0.75 + 4 x 0.08 caps at 1.0: half the bucket is toxic
        self.assertEqual(half["buckets"], 1)
        self.assertEqual(qm.compute_vpin_toxicity([])["vpin"], 0.0)


class Layout(unittest.TestCase):
    def test_three_sizes_two_directions(self):
        cards = [{"id": "a", "weight": 6}, {"id": "b", "weight": 1}, {"id": "c", "weight": 1}, {"id": "d", "weight": 1}]
        for vw, cols in ((375, 1), (768, 2), (1440, 3)):
            ltr, rtl = qm.solve_fluid_layout(cards, vw, "ltr"), qm.solve_fluid_layout(cards, vw, "rtl")
            self.assertEqual(ltr["columns"], cols)
            self.assertTrue(ltr["overflow_x_safe"] and rtl["overflow_x_safe"])
            self.assertTrue(all(p["touch_ok"] for p in ltr["placements"]))
            self.assertLess(ltr["pressure_variance"], ltr["raw_variance"])
            for a, b in zip(ltr["placements"], rtl["placements"], strict=True):
                self.assertEqual(a["col"], cols - 1 - b["col"])


PLAN = ({"id": "read", "estimate_ms": 50}, {"id": "build", "estimate_ms": 200, "depends": [0]}, {"id": "lint", "estimate_ms": 20, "depends": [0]},
            {"id": "deploy", "title": "Deploy to production", "depends": [1]}, {"id": "notes", "title": "Write notes", "depends": [3]})


class Monte(unittest.TestCase):

    def test_seeded_critical_path_and_locks(self):
        a, b = qm.simulate_mission_monte_carlo(list(PLAN), 500, 7), qm.simulate_mission_monte_carlo(list(PLAN), 500, 7)
        self.assertEqual(a, b)
        self.assertEqual(a["locked"], ["deploy"])
        self.assertEqual(a["waiting_on_lock"], ["notes"])
        self.assertTrue(a["locked_never_ran"])
        self.assertEqual(a["ready_now"], ["read"])
        self.assertGreater(a["critical_share"]["build"], 0.95)
        self.assertLess(a["critical_share"]["lint"], 0.05)
        self.assertTrue(200 < a["p50_ms"] < a["p95_ms"] < 600)
        self.assertNotIn("deploy", a["critical_share"])

    def test_cli(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "plan.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"steps": list(PLAN)}, fh)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(qm.main(["monte", p, "--trials", "50"]), 0)
        self.assertEqual(json.loads(out.getvalue())["locked"], ["deploy"])
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(qm.main(["shamir-split", "--hex", "zz"]), 2)


if __name__ == "__main__":
    unittest.main()
