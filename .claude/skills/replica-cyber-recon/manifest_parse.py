#!/usr/bin/env python3
"""Turn developer manifests into build tables (replica-cyber-recon). Standard library only, no network.

    python3 manifest_parse.py FILE [--kind openapi|llms|security|robots] [--root REPO] [--json] [--out jarvis/replica/manifest.md]

The file is read from disk (fetch it yourself, or through the Jarvis server); nothing here reaches
the network or follows a link. openapi.json (OpenAPI 3.x or Swagger 2) becomes an endpoint table with
methods, paths, summaries, parameters and auth; llms.txt becomes its sections and links;
security.txt (RFC 9116) becomes its fields, with Expires and Contact checked; robots.txt becomes its
groups. --out writes a Markdown table under the repository root and nowhere else.
"""

import argparse
import datetime
import json
import os
import re
import sys

from rcommon import ReconError, inside, read_text

METHODS = ("get", "post", "put", "patch", "delete", "head", "options")


def guess_kind(name, text):
    low = name.lower()
    if low.endswith("security.txt"):
        return "security"
    if low.endswith("robots.txt"):
        return "robots"
    if low.endswith("llms.txt") or low.endswith("llms-full.txt"):
        return "llms"
    if text.lstrip().startswith("{"):
        return "openapi"
    raise ReconError("Say which kind this is with --kind.")


def parse_openapi(text):
    try:
        doc = json.loads(text)
    except ValueError as e:
        raise ReconError(f"Not JSON: {e}") from e
    if not isinstance(doc, dict) or not isinstance(doc.get("paths"), dict):
        raise ReconError("No paths object: not an OpenAPI or Swagger document.")
    version = doc.get("openapi") or doc.get("swagger") or "?"
    schemes = sorted((doc.get("components", {}).get("securitySchemes") or doc.get("securityDefinitions") or {}).keys())
    global_sec = bool(doc.get("security"))
    rows = []
    for path, item in sorted(doc["paths"].items()):
        if not isinstance(item, dict):
            continue
        shared = item.get("parameters", []) or []
        for m in METHODS:
            op = item.get(m)
            if not isinstance(op, dict):
                continue
            params = [p.get("name", "?") + ("*" if p.get("required") else "") for p in (shared + (op.get("parameters") or [])) if isinstance(p, dict)]
            has_body = "requestBody" in op or any(isinstance(p, dict) and p.get("in") == "body" for p in op.get("parameters") or [])
            auth = op.get("security", None)
            rows.append({"method": m.upper(), "path": path, "summary": str(op.get("summary") or op.get("operationId") or "")[:120],
                         "params": params, "body": has_body, "auth": bool(auth) if auth is not None else global_sec,
                         "tags": op.get("tags") or []})
    tags = sorted({t for r in rows for t in r["tags"]})
    screens = [{"screen": t, "endpoints": sum(t in r["tags"] for r in rows)} for t in tags] or [{"screen": "API", "endpoints": len(rows)}]
    info = doc.get("info") or {}
    return {"kind": "openapi", "version": str(version), "title": str(info.get("title", ""))[:120], "auth_schemes": schemes, "endpoints": rows, "screens": screens}


def parse_llms(text):
    title, summary, sections, cur = None, None, [], None
    for line in text.splitlines():
        if line.startswith("# ") and title is None:
            title = line[2:].strip()
        elif line.startswith("> ") and summary is None:
            summary = line[2:].strip()
        elif line.startswith("## "):
            cur = {"section": line[3:].strip(), "links": []}
            sections.append(cur)
        else:
            m = re.match(r"\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)\)\s*:?\s*(.*)", line)
            if m:
                if cur is None:
                    cur = {"section": "(top)", "links": []}
                    sections.append(cur)
                cur["links"].append({"title": m.group(1), "url": m.group(2), "note": m.group(3)[:160]})
    if not title:
        raise ReconError("llms.txt should start with '# Title'.")
    return {"kind": "llms", "title": title, "summary": summary, "sections": sections, "links": sum(len(s["links"]) for s in sections)}


def parse_security(text, today=None):
    fields = {}
    for line in text.splitlines():
        if line.startswith("#") or ":" not in line:
            continue
        k, v = line.split(":", 1)
        fields.setdefault(k.strip().lower(), []).append(v.strip())
    problems = []
    if "contact" not in fields:
        problems.append("Contact is required (RFC 9116 §2.5.3).")
    if "expires" not in fields:
        problems.append("Expires is required (RFC 9116 §2.5.5).")
    else:
        try:
            exp = datetime.datetime.fromisoformat(fields["expires"][0].replace("Z", "+00:00"))
            now = today or datetime.datetime.now(datetime.UTC)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=datetime.UTC)
            if exp < now:
                problems.append("Expires is in the past.")
            elif exp - now > datetime.timedelta(days=366):
                problems.append("Expires is more than a year away (RFC 9116 recommends less).")
        except ValueError:
            problems.append("Expires is not an ISO 8601 date.")
    for c in fields.get("contact", []):
        if not re.match(r"^(mailto:|https://|tel:)", c):
            problems.append(f"Contact {c!r} should be a mailto:, https:// or tel: URI.")
    return {"kind": "security", "fields": fields, "problems": problems, "valid": not problems}


def parse_robots(text):
    groups, cur, sitemaps = [], None, []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = (x.strip() for x in line.split(":", 1))
        k = k.lower()
        if k == "user-agent":
            if cur is None or cur["rules"]:
                cur = {"agents": [], "rules": []}
                groups.append(cur)
            cur["agents"].append(v)
        elif k in ("allow", "disallow") and cur is not None:
            cur["rules"].append({k: v})
        elif k == "sitemap":
            sitemaps.append(v)
    return {"kind": "robots", "groups": groups, "sitemaps": sitemaps}


def to_markdown(r):
    if r["kind"] == "openapi":
        lines = [f"# {r['title'] or 'API'} (OpenAPI {r['version']})", "", f"Auth: {', '.join(r['auth_schemes']) or 'none declared'}", "", "| Method | Path | Summary | Params | Body | Auth |", "| --- | --- | --- | --- | --- | --- |"]
        lines += [f"| {e['method']} | `{e['path']}` | {e['summary'].replace('|', '/')} | {', '.join(e['params'])} | {'yes' if e['body'] else ''} | {'yes' if e['auth'] else ''} |" for e in r["endpoints"]]
        lines += ["", "## Screens (one per tag)", ""] + [f"- {s['screen']}: {s['endpoints']} endpoints" for s in r["screens"]]
    elif r["kind"] == "llms":
        lines = [f"# {r['title']}", "", r["summary"] or ""] + [f"\n## {s['section']}\n" + "\n".join(f"- [{x['title']}]({x['url']}) {x['note']}" for x in s["links"]) for s in r["sections"]]
    elif r["kind"] == "security":
        lines = ["# security.txt", "", "| Field | Value |", "| --- | --- |"] + [f"| {k} | {v} |" for k, vs in sorted(r["fields"].items()) for v in vs] + ["", "Problems: " + ("; ".join(r["problems"]) or "none")]
    else:
        lines = ["# robots.txt", ""] + [f"- {', '.join(g['agents'])}: " + ", ".join(f"{k} {v}" for rule in g["rules"] for k, v in rule.items()) for g in r["groups"]] + [f"- Sitemap: {s}" for s in r["sitemaps"]]
    return "\n".join(lines).rstrip() + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Developer manifests to build tables")
    ap.add_argument("file")
    ap.add_argument("--kind", choices=["openapi", "llms", "security", "robots"])
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    try:
        p = inside(a.root, a.file)
        if not p or not os.path.isfile(p):
            raise ReconError(f"{a.file} is not a file inside {a.root}.")
        text = read_text(p)
        if text is None:
            raise ReconError("The file is binary or larger than 2 MB.")
        kind = a.kind or guess_kind(p, text)
        r = {"openapi": parse_openapi, "llms": parse_llms, "security": parse_security, "robots": parse_robots}[kind](text)
        if a.out:
            o = inside(a.root, a.out)
            if not o:
                raise ReconError("--out must stay inside the repository root.")
            os.makedirs(os.path.dirname(o), exist_ok=True)
            with open(o, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(to_markdown(r))
    except ReconError as e:
        print(f"manifest_parse: {e}", file=sys.stderr)
        return 2
    print(json.dumps(r, indent=2, ensure_ascii=False) if a.json else to_markdown(r), end="" if not a.json else "\n")
    return 0 if r.get("valid", True) else 1


if __name__ == "__main__":
    sys.exit(main())
