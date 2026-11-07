#!/usr/bin/env python3
"""passive_recon: reads what a domain already publishes about itself, from files you saved. Standard library
only (argparse, datetime, json, re, sys, urllib.parse). No network, no processes: it never fetches anything.
The same rules as jarvis/server/lib/passive-recon.mjs, which does the four GETs on the local server.

  rdap        RFC 7480 / 9083 domain record (JSON): status, DNSSEC, dates, name servers, findings
  ct          crt.sh JSON rows: names (deduplicated in one pass), wildcards, expired and expiring certificates
  headers     response headers ("Name: value" lines): the six security headers graded 0-100 with fixes
  securitytxt /.well-known/security.txt (RFC 9116): Contact, Expires, Encryption, Canonical

    python3 passive_recon.py rdap rdap.json
    python3 passive_recon.py ct crtsh.json
    python3 passive_recon.py headers headers.txt
    python3 passive_recon.py securitytxt security.txt
    python3 passive_recon.py report example.com --rdap rdap.json --ct crtsh.json --headers headers.txt --securitytxt security.txt
"""

import argparse
import json
import re
import sys
from datetime import UTC, datetime
from urllib.parse import urlsplit

LIMITS = {"ct_rows": 5000, "names": 200, "sectxt_bytes": 32768}
DAY = 86400000
HEADER_POINTS = [("content-security-policy", 30), ("strict-transport-security", 20), ("permissions-policy", 15),
                 ("cross-origin-opener-policy", 15), ("x-content-type-options", 10), ("referrer-policy", 10)]
SAFE_REFERRER = {"no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"}
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$")
LABEL = re.compile(r"^[a-z0-9-]+$")


def finding(level, fid, text, value=None):
    f = {"level": level, "id": fid, "text": text}
    if value is not None:
        f["value"] = value
    return f


def lower(v):
    return ("" if v is None else str(v)).strip().lower()


def utc_ms(v):
    """Milliseconds since 1970 (UTC) or None. A date and time with no zone is UTC, as crt.sh writes it."""
    s = ("" if v is None else str(v)).strip()
    if not s:
        return None
    if re.search(r"T\d{2}:\d{2}", s) and not re.search(r"(?:Z|[+-]\d{2}:?\d{2})$", s, re.I):
        s += "Z"
    if s[-1:] in "zZ":
        s = s[:-1] + "+00:00"
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return int(d.timestamp() * 1000)


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def normalize_domain(raw):
    s = lower(raw)
    if "://" in s:
        try:
            s = (urlsplit(s).hostname or "").lower()
        except ValueError:
            return None
    s = s.split("/", 1)[0]
    if s.endswith("."):
        s = s[:-1]
    if len(s) < 3 or len(s) > 253 or ":" in s:
        return None
    labels = s.split(".")
    if len(labels) < 2:
        return None
    for lab in labels:
        if not lab or len(lab) > 63 or not LABEL.match(lab) or lab[0] == "-" or lab[-1] == "-":
            return None
    tld = labels[-1]
    return s if re.fullmatch(r"[a-z]{2,63}", tld) or re.fullmatch(r"xn--[a-z0-9-]+", tld) else None


def parse_rdap(j, now):
    out = {"statuses": [], "dnssec": None, "registered": None, "expires": None, "daysLeft": None, "nameservers": [], "findings": []}
    if not isinstance(j, dict):
        out["findings"].append(finding("high", "rdap-missing", "No RDAP record was returned."))
        return out
    out["statuses"] = [lower(x) for x in (j.get("status") if isinstance(j.get("status"), list) else [])[:20]]
    sec = j.get("secureDNS")
    if isinstance(sec, dict) and isinstance(sec.get("delegationSigned"), bool):
        out["dnssec"] = sec["delegationSigned"]
    for e in (j.get("events") if isinstance(j.get("events"), list) else [])[:50]:
        t = utc_ms(e.get("eventDate")) if isinstance(e, dict) else None
        if t is None:
            continue
        a = lower(e.get("eventAction"))
        if a == "registration":
            out["registered"] = iso(t)
        elif a == "expiration":
            out["expires"] = iso(t)
    ns = j.get("nameservers") if isinstance(j.get("nameservers"), list) else []
    out["nameservers"] = [x for x in (lower(n.get("ldhName")) if isinstance(n, dict) else "" for n in ns[:20]) if x]
    keys = {re.sub(r"\s+", "", s) for s in out["statuses"]}
    f = out["findings"]
    if out["expires"]:
        out["daysLeft"] = (utc_ms(out["expires"]) - now) // DAY
        if out["daysLeft"] < 0:
            f.append(finding("high", "domain-expired", f"The domain expired {-out['daysLeft']} days ago."))
        elif out["daysLeft"] <= 30:
            f.append(finding("medium", "domain-expiring", f"The domain expires in {out['daysLeft']} days."))
    else:
        f.append(finding("low", "rdap-no-expiry", "The record gives no expiry date."))
    if out["dnssec"] is False:
        f.append(finding("medium", "dnssec-off", "DNSSEC is off: the delegation is not signed."))
    elif out["dnssec"] is None:
        f.append(finding("low", "dnssec-unknown", "The record does not say whether DNSSEC is on."))
    if "redemptionperiod" in keys or "pendingdelete" in keys:
        f.append(finding("high", "status-deleting", "The domain is being deleted."))
    if "clienthold" in keys or "serverhold" in keys:
        f.append(finding("high", "status-hold", "The domain is on hold and does not resolve."))
    if "clienttransferprohibited" not in keys and "servertransferprohibited" not in keys:
        f.append(finding("low", "transfer-unlocked", "No transfer lock on the domain."))
    return out


def parse_ct(rows, now):
    every = rows if isinstance(rows, list) else []
    rows = every[:LIMITS["ct_rows"]]
    names, wild, issuers = set(), set(), {}
    expired = active = soon = 0
    for r in rows:
        if not isinstance(r, dict):
            continue
        na = utc_ms(r.get("not_after"))
        if na is not None:
            if na < now:
                expired += 1
            else:
                active += 1
                if na - now < 14 * DAY:
                    soon += 1
        for part in ("" if r.get("name_value") is None else str(r.get("name_value"))).split("\n"):
            n = lower(part)
            if not n or len(n) > 253:
                continue
            names.add(n)
            if n.startswith("*."):
                wild.add(n)
        iss = ("" if r.get("issuer_name") is None else str(r.get("issuer_name")))[:120]
        if iss:
            issuers[iss] = issuers.get(iss, 0) + 1
    f = []
    if len(every) > len(rows):
        f.append(finding("low", "ct-truncated", f"Only the first {len(rows)} certificates were read."))
    broad = [w for w in wild if "." not in w[2:]]
    if broad:
        f.append(finding("high", "ct-broad-wildcard", "A wildcard covers a whole top-level domain: " + sorted(broad)[0]))
    if len(wild) >= 5:
        f.append(finding("medium", "ct-many-wildcards", f"Wildcard names on certificates: {len(wild)}."))
    elif wild:
        f.append(finding("low", "ct-wildcards", f"Wildcard names on certificates: {len(wild)}."))
    if soon:
        f.append(finding("medium", "ct-expiring", f"Certificates in use that expire within 14 days: {soon}."))
    if rows and not active:
        f.append(finding("medium", "ct-no-active", "No logged certificate is still valid."))
    top = sorted(issuers.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    return {"certificates": len(rows), "nameCount": len(names), "names": sorted(names)[:LIMITS["names"]], "wildcards": sorted(wild),
            "expired": expired, "active": active, "expiringSoon": soon, "issuers": [{"name": k, "count": v} for k, v in top], "findings": f}


def grade_headers(headers):
    h = {str(k).lower(): v for k, v in headers.items()} if isinstance(headers, dict) else {}

    def get(k):
        v = h.get(k)
        if v is None:
            return ""
        return (", ".join(map(str, v)) if isinstance(v, list) else str(v)).strip()[:2000]

    checks = []
    for name, mx in HEADER_POINTS:
        v = get(name)
        lv = v.lower()
        points, fix = 0, None
        if not v:
            fix = "missing"
        elif name == "content-security-policy":
            points = mx
            tokens = set(re.split(r"[\s;]+", lv))
            if "'unsafe-inline'" in tokens:
                points -= 8
                fix = "unsafe-inline"
            if "'unsafe-eval'" in tokens:
                points -= 8
                fix = fix or "unsafe-eval"
            if "*" in tokens:
                points -= 8
                fix = fix or "wildcard-source"
            if "default-src" not in lv:
                points -= 6
                fix = fix or "no-default-src"
            points = max(0, points)
        elif name == "strict-transport-security":
            m = re.search(r"max-age\s*=\s*\"?(\d{1,12})", lv)
            age = int(m.group(1)) if m else 0
            points = mx if age >= 31536000 else 15 if age >= 15552000 else 8 if age > 0 else 0
            fix = "short-max-age" if age < 31536000 else ("no-subdomains" if "includesubdomains" not in lv else None)
        elif name == "x-content-type-options":
            points, fix = (mx, None) if lv == "nosniff" else (3, "not-nosniff")
        elif name == "referrer-policy":
            parts = [x.strip() for x in lv.split(",") if x.strip()]
            last = parts[-1] if parts else ""
            points = mx if last in SAFE_REFERRER else 0 if last == "unsafe-url" else 5
            fix = None if last in SAFE_REFERRER else "weak-referrer"
        elif name == "cross-origin-opener-policy":
            points = mx if lv == "same-origin" else 10 if lv == "same-origin-allow-popups" else 3
            fix = None if lv == "same-origin" else "weak-coop"
        else:
            points = mx
        checks.append({"header": name, "present": bool(v), "value": v[:300], "points": points, "max": mx, "fix": fix})
    score = sum(c["points"] for c in checks)
    grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"
    return {"score": score, "grade": grade, "checks": checks}


def parse_security_txt(text, now):
    out = {"present": text is not None, "fields": {}, "contacts": [], "expires": None, "valid": False, "findings": []}
    f = out["findings"]
    if text is None:
        f.append(finding("high", "sectxt-missing", "No security.txt at /.well-known/security.txt."))
        return out
    in_sig = False
    for line in str(text)[:LIMITS["sectxt_bytes"]].split("\n"):
        t = line.strip()
        if t.startswith("-----BEGIN PGP SIGNATURE"):
            in_sig = True
            continue
        if in_sig:
            if t.startswith("-----END PGP SIGNATURE"):
                in_sig = False
            continue
        if not t or t[0] == "#" or t.startswith("-----BEGIN PGP SIGNED MESSAGE") or t.lower().startswith("hash:"):
            continue
        i = t.find(":")
        if i < 1:
            continue
        key, val = t[:i].strip().lower(), t[i + 1:].strip()
        lst = out["fields"].setdefault(key, [])
        if len(lst) < 20:
            lst.append(val[:300])
    out["contacts"] = out["fields"].get("contact", [])
    if not out["contacts"]:
        f.append(finding("high", "sectxt-no-contact", "No Contact line; RFC 9116 requires one."))
    for c in out["contacts"]:
        lc = c.lower()
        if lc.startswith("http://"):
            f.append(finding("medium", "sectxt-contact-http", "A Contact link uses plain http.", c))
        elif not (lc.startswith("mailto:") or lc.startswith("https://") or lc.startswith("tel:")):
            f.append(finding("medium", "sectxt-contact-uri", "A Contact is not a mailto:, https: or tel: link.", c))
    exp = out["fields"].get("expires", [])
    if not exp:
        f.append(finding("high", "sectxt-no-expires", "No Expires line; RFC 9116 requires one."))
    else:
        if len(exp) > 1:
            f.append(finding("medium", "sectxt-many-expires", f"Expires appears {len(exp)} times; it must appear once."))
        t = utc_ms(exp[0]) if ISO.match(exp[0]) else None
        if t is None:
            f.append(finding("high", "sectxt-bad-expires", "Expires is not an ISO 8601 date and time: " + exp[0]))
        else:
            out["expires"] = iso(t)
            if t < now:
                f.append(finding("high", "sectxt-expired", "Expires is in the past: " + out["expires"][:10]))
            elif t - now > 366 * DAY:
                f.append(finding("low", "sectxt-long-expiry", "Expires is more than a year ahead; RFC 9116 advises less."))
    can = out["fields"].get("canonical", [])
    if can and not any(c.lower().startswith("https://") for c in can):
        f.append(finding("low", "sectxt-canonical-http", "No Canonical link uses https."))
    if not out["fields"].get("encryption"):
        f.append(finding("low", "sectxt-no-encryption", "No Encryption key is named."))
    out["valid"] = not any(x["level"] == "high" for x in f)
    return out


MISSING = object()


def recon_report(domain, now, rdap=MISSING, ct=MISSING, headers=MISSING, security_txt=MISSING):
    r = {"domain": domain, "at": iso(now),
         "rdap": None if rdap is MISSING else parse_rdap(rdap, now),
         "ct": None if ct is MISSING else parse_ct(ct, now),
         "headers": None if headers is MISSING else grade_headers(headers),
         "securityTxt": None if security_txt is MISSING else parse_security_txt(security_txt, now)}
    every = [x for k in ("rdap", "ct", "securityTxt") if r[k] for x in r[k]["findings"]]
    r["counts"] = {lv: sum(1 for x in every if x["level"] == lv) for lv in ("high", "medium", "low")}
    return r


def read_headers(text):
    out = {}
    for line in text.split("\n"):
        i = line.find(":")
        if i > 0:
            out[line[:i].strip().lower()] = line[i + 1:].strip()
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Read saved RDAP, crt.sh, header and security.txt files; prints JSON. Fetches nothing.")
    ap.add_argument("--now", help="the time to judge against (ISO 8601); default: now")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("rdap", "ct", "headers", "securitytxt"):
        sub.add_parser(name).add_argument("file")
    rep = sub.add_parser("report")
    rep.add_argument("domain")
    for opt in ("--rdap", "--ct", "--headers", "--securitytxt"):
        rep.add_argument(opt)
    a = ap.parse_args(argv)
    now = utc_ms(a.now) if a.now else int(datetime.now(UTC).timestamp() * 1000)
    if now is None:
        ap.error("--now is not an ISO 8601 date")

    def load(path, kind):
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        return json.loads(raw) if kind == "json" else read_headers(raw) if kind == "headers" else raw

    if a.cmd == "report":
        d = normalize_domain(a.domain)
        if not d:
            ap.error("give a domain name such as example.com")
        kw = {k: load(p, kind) for k, p, kind in (("rdap", a.rdap, "json"), ("ct", a.ct, "json"), ("headers", a.headers, "headers"), ("security_txt", a.securitytxt, "text")) if p}
        out = recon_report(d, now, **kw)
    elif a.cmd == "rdap":
        out = parse_rdap(load(a.file, "json"), now)
    elif a.cmd == "ct":
        out = parse_ct(load(a.file, "json"), now)
    elif a.cmd == "headers":
        out = grade_headers(load(a.file, "headers"))
    else:
        out = parse_security_txt(load(a.file, "text"), now)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
