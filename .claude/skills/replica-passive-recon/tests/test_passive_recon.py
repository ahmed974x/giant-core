"""Tests for replica-passive-recon: RDAP, CT, header grading, security.txt, domain names and the CLI."""
import contextlib
import io
import json
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import passive_recon as pr

NOW = pr.utc_ms("2026-11-07T00:00:00Z")


class Domains(unittest.TestCase):
    def test_names_only(self):
        self.assertEqual(pr.normalize_domain("https://Sub.Example.com/x?y"), "sub.example.com")
        self.assertEqual(pr.normalize_domain("example.com."), "example.com")
        self.assertEqual(pr.normalize_domain("xn--mgbh0fb.xn--kgbechtv"), "xn--mgbh0fb.xn--kgbechtv")
        for bad in ("1.2.3.4", "localhost", "a..b.com", "-a.com", "a-.com", "example.com:8080", "[::1]", "", "x" * 64 + ".com"):
            self.assertIsNone(pr.normalize_domain(bad), bad)


class Rdap(unittest.TestCase):
    def test_findings(self):
        r = pr.parse_rdap({"status": ["client hold", "redemption period"], "secureDNS": {"delegationSigned": True},
                           "events": [{"eventAction": "expiration", "eventDate": "2026-11-01T00:00:00Z"}], "nameservers": [{"ldhName": "NS1.EXAMPLE.NET"}]}, NOW)
        self.assertEqual([f["id"] for f in r["findings"]], ["domain-expired", "status-deleting", "status-hold", "transfer-unlocked"])
        self.assertEqual((r["daysLeft"], r["dnssec"], r["nameservers"]), (-6, True, ["ns1.example.net"]))
        ok = pr.parse_rdap({"status": ["client transfer prohibited"], "secureDNS": {"delegationSigned": True}, "events": [{"eventAction": "expiration", "eventDate": "2028-01-01T00:00:00Z"}]}, NOW)
        self.assertEqual(ok["findings"], [])
        self.assertEqual(pr.parse_rdap(None, NOW)["findings"][0]["id"], "rdap-missing")
        self.assertEqual([f["id"] for f in pr.parse_rdap({}, NOW)["findings"]], ["rdap-no-expiry", "dnssec-unknown", "transfer-unlocked"])


class Ct(unittest.TestCase):
    def test_dedupe_wildcards_and_dates(self):
        rows = [{"name_value": "A.example.com\na.example.com\n*.example.com", "not_after": "2026-11-10T00:00:00", "issuer_name": "CA one"},
                {"name_value": "*.com", "not_after": "2025-01-01T00:00:00", "issuer_name": "CA two"}]
        r = pr.parse_ct(rows, NOW)
        self.assertEqual(r["names"], ["*.com", "*.example.com", "a.example.com"])
        self.assertEqual((r["expired"], r["active"], r["expiringSoon"]), (1, 1, 1))
        self.assertEqual([f["id"] for f in r["findings"]], ["ct-broad-wildcard", "ct-wildcards", "ct-expiring"])

    def test_cap_is_fast(self):
        rows = [{"name_value": f"h{i}.example.com", "not_after": "2027-01-01T00:00:00"} for i in range(20000)]
        t = time.time()
        r = pr.parse_ct(rows, NOW)
        self.assertLess(time.time() - t, 2.0)
        self.assertEqual((r["certificates"], r["nameCount"], len(r["names"])), (5000, 5000, 200))
        self.assertEqual(r["findings"][0]["id"], "ct-truncated")


class Headers(unittest.TestCase):
    def test_grading(self):
        full = {"Content-Security-Policy": "default-src 'none'", "Strict-Transport-Security": "max-age=31536000; includeSubDomains", "Permissions-Policy": "camera=()",
                "Cross-Origin-Opener-Policy": "same-origin", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}
        g = pr.grade_headers(full)
        self.assertEqual((g["score"], g["grade"]), (100, "A"))
        weak = pr.grade_headers({"content-security-policy": "script-src * 'unsafe-inline' 'unsafe-eval'", "strict-transport-security": "max-age=600", "referrer-policy": "unsafe-url"})
        self.assertEqual([c["points"] for c in weak["checks"]], [0, 8, 0, 0, 0, 0])
        self.assertEqual(weak["checks"][0]["fix"], "unsafe-inline")
        self.assertEqual(pr.grade_headers({})["grade"], "F")


class SecurityTxt(unittest.TestCase):
    def test_rfc9116(self):
        signed = "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nContact: mailto:a@example.com\nExpires: 2027-06-01T00:00:00Z\nEncryption: https://example.com/k.asc\n-----BEGIN PGP SIGNATURE-----\nContact: http://evil\n-----END PGP SIGNATURE-----\n"
        r = pr.parse_security_txt(signed, NOW)
        self.assertTrue(r["valid"])
        self.assertEqual((r["contacts"], r["findings"]), (["mailto:a@example.com"], []))
        bad = pr.parse_security_txt("# x\nContact: http://example.com\nContact: room 4\nExpires: 2026-01-01\nExpires: 2027-01-01T00:00:00Z\nCanonical: http://x\n", NOW)
        self.assertEqual([f["id"] for f in bad["findings"]], ["sectxt-contact-http", "sectxt-contact-uri", "sectxt-many-expires", "sectxt-bad-expires", "sectxt-canonical-http", "sectxt-no-encryption"])
        self.assertFalse(bad["valid"])
        self.assertEqual(pr.parse_security_txt(None, NOW)["findings"][0]["id"], "sectxt-missing")
        self.assertEqual(pr.parse_security_txt("Contact: mailto:a@b.c\nExpires: 2029-01-01T00:00:00Z\nEncryption: x", NOW)["findings"][0]["id"], "sectxt-long-expiry")


class Cli(unittest.TestCase):
    def test_report_from_files(self):
        with tempfile.TemporaryDirectory() as d:
            h = os.path.join(d, "h.txt")
            with open(h, "w", encoding="utf-8") as fh:
                fh.write("X-Content-Type-Options: nosniff\n")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                pr.main(["--now", "2026-11-07T00:00:00Z", "report", "Example.COM", "--headers", h])
            out = json.loads(buf.getvalue())
            self.assertEqual((out["domain"], out["headers"]["score"], out["rdap"]), ("example.com", 10, None))
            with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
                pr.main(["report", "10.0.0.1"])


if __name__ == "__main__":
    unittest.main()
