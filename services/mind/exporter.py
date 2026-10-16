"""Nightly export: the whole brain as Markdown with [[wikilinks]] (ADR-081, section 12.4).

Readable in Obsidian, Logseq or Foam without OMEGA. One file per atom, grouped by theme, with front matter.
Only files this exporter wrote (n<id>.md) are replaced; the folder stays the owner's to browse.
"""

from __future__ import annotations

import os
from pathlib import Path


def _folder(name: str) -> str:
    keep = "".join(c if c.isalnum() or c in " ·-_" else "-" for c in name)
    return keep.strip()[:60] or "متفرقات"


def render(snapshot: dict) -> dict[str, str]:
    """-> {relative path: markdown}. Pure: no file access."""
    names = {c["key"]: c["name"] for c in snapshot.get("clusters", [])}
    files: dict[str, str] = {}
    links: dict[int, list[str]] = {}
    for e in snapshot.get("edges", []):
        mark = " (suggested)" if e["state"] == "suggested" else ""
        links.setdefault(e["src"], []).append(f"- {e['type']}: [[n{e['dst']}]]{mark}" + (f" — {e['why']}" if e.get("why") else ""))
        links.setdefault(e["dst"], []).append(f"- {e['type']}: [[n{e['src']}]]{mark}" + (f" — {e['why']}" if e.get("why") else ""))
    for n in snapshot.get("nodes", []):
        folder = _folder(names.get(n.get("cluster"), "متفرقات"))
        front = ["---", f"id: n{n['id']}", f"type: {n['type']}", f"captured: {n['captured_at']}",
                 f"source: {n.get('source', 'text')}"]
        if n.get("source_url"):
            front.append(f"source_url: {n['source_url']}")
        front.append("---")
        body = [n["text"], "", "## Links"] + (links.get(n["id"]) or ["- none yet"])
        files[f"{folder}/n{n['id']}.md"] = "\n".join(front + [""] + body) + "\n"
    return files


def write(root: str, files: dict[str, str]) -> int:
    base = Path(root)
    base.mkdir(parents=True, exist_ok=True)
    for old in base.rglob("n*.md"):                    # only the files this exporter owns
        if old.stem[1:].isdigit():
            old.unlink()
    for rel, text in files.items():
        target = (base / rel).resolve()
        if base.resolve() not in target.parents:       # never write outside the export folder
            raise ValueError("bad export path")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return len(files)


def export_dir() -> str:
    return os.environ.get("MIND_EXPORT_DIR", "/export")
