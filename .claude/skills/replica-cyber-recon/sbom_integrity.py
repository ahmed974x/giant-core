#!/usr/bin/env python3
"""SHA-256 manifest of a skill or tool folder, and a check against it (replica-cyber-recon).

    python3 sbom_integrity.py write FOLDER [--root REPO]     # FOLDER/SBOM.sha256.json
    python3 sbom_integrity.py verify FOLDER [--root REPO]    # exit 1 if any file changed, appeared or vanished

The manifest lists every file with its size and SHA-256, and a SHA-256 over the canonical list, so a
reviewed skill can be shown to be byte-for-byte the one that was reviewed.
"""

import argparse
import hashlib
import json
import os
import sys

from rcommon import ReconError, inside, rel, sha256_file

NAME = "SBOM.sha256.json"


def listing(folder):
    out = []
    for d, dirs, files in os.walk(folder):
        dirs[:] = sorted(x for x in dirs if x not in {"__pycache__", ".git", "node_modules"})
        for f in sorted(files):
            if f == NAME:
                continue
            p = os.path.join(d, f)
            out.append({"path": os.path.relpath(p, folder).replace(os.sep, "/"), "bytes": os.path.getsize(p), "sha256": sha256_file(p)})
    return out


def digest(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main(argv=None):
    ap = argparse.ArgumentParser(description="SHA-256 manifest of a folder")
    ap.add_argument("cmd", choices=["write", "verify"])
    ap.add_argument("folder")
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    try:
        f = inside(a.root, a.folder)
        if not f or not os.path.isdir(f):
            raise ReconError(f"{a.folder} is not a folder inside {a.root}.")
        files = listing(f)
        path = os.path.join(f, NAME)
        if a.cmd == "write":
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                json.dump({"format": "sbom-sha256-v1", "folder": rel(a.root, f), "files": files, "digest": digest(files)}, fh, indent=2)
                fh.write("\n")
            print(f"wrote {rel(a.root, path)}: {len(files)} files, digest {digest(files)[:16]}…")
            return 0
        if not os.path.isfile(path):
            raise ReconError(f"No {NAME} in {a.folder}; run write first.")
        with open(path, encoding="utf-8") as fh:
            saved = json.load(fh)
        old = {x["path"]: x for x in saved.get("files", [])}
        new = {x["path"]: x for x in files}
        problems = [f"changed {p}" for p in sorted(old.keys() & new.keys()) if old[p]["sha256"] != new[p]["sha256"]]
        problems += [f"missing {p}" for p in sorted(old.keys() - new.keys())] + [f"new {p}" for p in sorted(new.keys() - old.keys())]
        if digest(saved.get("files", [])) != saved.get("digest"):
            problems.append("the manifest itself was edited (digest does not match)")
        for p in problems:
            print(p)
        print("intact" if not problems else f"{len(problems)} problems")
        return 1 if problems else 0
    except ReconError as e:
        print(f"sbom_integrity: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
