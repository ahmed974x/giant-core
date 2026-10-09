"""OMEGA plugin registry: validate every plugins/*/plugin.json and publish the catalog.

    python scripts/plugins.py            validate + write dashboard/plugins.json
    python scripts/plugins.py --check    validate only (non-zero exit on any error)

The dashboard reads dashboard/plugins.json (served by the relay at /plugins.json) and shows
every plugin in its Modules panel. Standard library only.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS = ROOT / "plugins"
OUT = ROOT / "dashboard" / "plugins.json"

KINDS = {"workflow", "tool", "skill", "mcp", "provider", "panel"}
REQUIRED = {"id": str, "name": str, "kind": str, "version": str, "description": str, "entry": str}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")


def validate(folder: Path) -> tuple[dict | None, list[str]]:
    errors: list[str] = []
    try:
        meta = json.loads((folder / "plugin.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, [f"{folder.name}: unreadable plugin.json ({exc})"]
    for key, typ in REQUIRED.items():
        if not isinstance(meta.get(key), typ) or not meta.get(key):
            errors.append(f"{folder.name}: '{key}' must be a non-empty {typ.__name__}")
    if meta.get("id") != folder.name:
        errors.append(f"{folder.name}: id must equal the folder name")
    if not ID_RE.match(str(meta.get("id", ""))):
        errors.append(f"{folder.name}: id must be lowercase letters, digits and dashes")
    if meta.get("kind") not in KINDS:
        errors.append(f"{folder.name}: kind must be one of {sorted(KINDS)}")
    entry = str(meta.get("entry", ""))
    if entry.startswith(("/", "..")) or ".." in Path(entry).parts:
        errors.append(f"{folder.name}: entry must be a path inside the repo")
    elif meta.get("enabled", True) and not (ROOT / entry).exists():
        errors.append(f"{folder.name}: entry '{entry}' does not exist")
    if not isinstance(meta.get("requires", []), list):
        errors.append(f"{folder.name}: requires must be a list")
    return meta, errors


def main() -> int:
    check_only = "--check" in sys.argv
    catalog, errors = [], []
    for folder in sorted(p for p in PLUGINS.iterdir() if p.is_dir() and not p.name.startswith("_")):
        meta, errs = validate(folder)
        errors += errs
        if meta and not errs:
            catalog.append({k: meta.get(k) for k in ("id", "name", "kind", "version", "description", "entry", "requires", "enabled")})
    for e in errors:
        print("ERROR", e)
    print(f"{len(catalog)} plugin(s) valid, {len(errors)} error(s)")
    if not check_only and not errors:
        OUT.write_text(json.dumps({"plugins": catalog}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
