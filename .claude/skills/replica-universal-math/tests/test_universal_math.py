import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import universal_math as um  # noqa: E402


class Examples(unittest.TestCase):
    def test_calculus(self):
        r = um.solve({"task": "calculus", "expression": "x^3 - 6*x^2 + 11*x - 6", "variable": "x", "interval": [0.5, 3.5]})
        self.assertTrue(r["verified"])
        self.assertEqual(r["result"]["roots"], [1, 2, 3])
        self.assertEqual(r["result"]["derivative"], "3 * x^2 - 12 * x + 11")
        self.assertEqual(r["result"]["integral"], 0)

    def test_ode(self):
        r = um.solve({"task": "ode_rk4", "expression": "-2 * y + x", "x0": 0, "y0": 1, "x_end": 2.0, "steps": 20})
        self.assertTrue(r["verified"])
        # Exact: y = x/2 - 1/4 + (5/4) e^(-2x); RK4 with h = 0.1 is within 1e-5.
        exact = 2 / 2 - 0.25 + 1.25 * 2.718281828459045 ** -4
        self.assertLess(abs(r["result"]["y_end"] - exact), 1e-5)

    def test_linear_algebra(self):
        r = um.solve({"task": "linear_algebra", "matrix": [[4, 2, 1], [2, 5, 2], [1, 2, 6]], "rhs": [7, 9, 9]})
        self.assertTrue(r["verified"])
        self.assertEqual(r["result"]["solution"], [1, 1, 1])
        self.assertEqual(r["result"]["determinant"], 83)

    def test_number_theory(self):
        r = um.solve({"task": "number_theory", "n": 104729, "crt_remainders": [2, 3, 2], "crt_moduli": [3, 5, 7]})
        self.assertTrue(r["result"]["prime"])
        self.assertEqual(r["result"]["crt"], {"x": "23", "modulus": "105"})
        self.assertEqual(um.factorize("18446744030759878681"), [4294967291, 4294967291])
        self.assertEqual(um.egcd(-240, 46), {"g": 2, "x": 9, "y": 47})

    def test_pole_is_not_a_root(self):
        r = um.solve({"task": "calculus", "expression": "1/(x-1)", "interval": [0, 3]})
        self.assertEqual(r["result"]["roots"], [])
        self.assertEqual(r["result"]["poles"], [1])
        self.assertIsNone(r["result"]["integral"])


class Safety(unittest.TestCase):
    def test_refusals(self):
        for bad in ["", "x $ 2", "sin x", "(" * 50 + "x" + ")" * 50, "x" * 401, "1e999", "import os"]:
            with self.assertRaises(um.MathError):
                um.solve({"task": "calculus", "expression": bad})
        with self.assertRaises(um.MathError):
            um.solve({"task": "linear_algebra", "matrix": [[1] * 11] * 11})
        with self.assertRaises(um.MathError):
            um.factorize(2 ** 65)

    def test_no_code_is_run(self):
        with open(um.__file__, encoding="utf-8") as fh:
            src = fh.read()
        # Spelled in parts so that this test file does not itself contain the words.
        for word in ("ev" + "al(", "ex" + "ec(", "sub" + "process", "os." + "system", "__imp" + "ort__", "import" + "lib", "soc" + "ket", "url" + "lib"):
            self.assertNotIn(word, src)

    def test_js_numbers(self):
        self.assertEqual([um.js_str(v) for v in (1.0, 1e21, 1.5e-7, 0.000001, -1875.0)], ["1", "1e+21", "1.5e-7", "0.000001", "-1875"])
        self.assertEqual(um.to_exponential(9.068e-8, 1), "9.1e-8")


class SameAsServer(unittest.TestCase):
    def test_golden(self):
        with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as fh:
            g = json.load(fh)
        for req, want in zip(g["requests"], g["outputs"], strict=True):
            try:
                got = um.localize(um.solve(req), "ar" if req.get("task") == "bayes" else "en")
            except um.MathError as e:
                got = {"error": str(e), "detail": e.detail}
            self.assertEqual(got, want, req)


if __name__ == "__main__":
    unittest.main()
