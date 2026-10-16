"""What the second brain does, step by step (ADR-081). Used by the HTTP API (server.py) and the nightly run (worker.py)."""

from __future__ import annotations

import os
from datetime import UTC, datetime

import analysis
import atomise
import clusters
import exporter
import linker
import store
from embed import get_embedder

SIMILAR_DEFAULT = 0.55


def _embedder():
    return get_embedder()


def capture(db, text: str, source: str = "text", source_url: str | None = None) -> dict:
    """Keep the note verbatim, split it into atoms, embed each, and suggest links to what is already there."""
    raw = store.capture(db, text, source, source_url)
    if raw is None:
        return {"refused": True}
    embedder = _embedder()
    new = []
    for item in atomise.atomise(text):
        vec = embedder.embed(item["text"])
        nid = store.add_node(db, raw, item, vec, embedder.name)
        if nid is not None:
            new.append({"id": nid, "text": item["text"], "type": item["type"], "entities": item["entities"],
                        "embedding": vec, "captured_at": datetime.now(UTC)})
    snap = store.snapshot(db)
    old = [n for n in snap["nodes"] if n["id"] not in {x["id"] for x in new} and n.get("embedding")]
    threshold = float(snap.get("settings", {}).get("similar_min", SIMILAR_DEFAULT))
    suggested = 0
    for link in linker.candidates(new, old, threshold):
        if store.suggest_edge(db, link) is not None:
            suggested += 1
    return {"raw_id": raw, "atoms": [{"id": n["id"], "text": n["text"], "type": n["type"]} for n in new],
            "suggested_links": suggested}


def dump(db, text: str) -> dict:
    """A brain dump: captured like any note, then sorted into themes, questions, next actions and the parked rest."""
    result = capture(db, text)
    if result.get("refused"):
        return result
    ids = {x["id"] for x in result["atoms"]}
    atoms = [a for a in store.snapshot(db)["nodes"] if a["id"] in ids]
    return {"raw_id": result["raw_id"], **analysis.brain_dump(atoms)}


def refresh_clusters(db) -> dict:
    """Recompute the themes from the live links (nightly, or on demand). Names come from the owner's words."""
    snap = store.snapshot(db)
    assign, named = clusters.assign(snap["nodes"], snap["edges"])
    changed = store.apply_clusters(db, named, assign)
    return {"clusters": len(named), "nodes": changed}


def think(db, question: str) -> dict:
    """Answer from the owner's own atoms only, with citations, and ask the next question."""
    vec = _embedder().embed(question)
    hits = store.search(db, question, vec, k=3)
    return analysis.think(question, hits)


def digest(db, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    snap = store.snapshot(db)
    nodes = snap["nodes"]
    cluster_of = {n["id"]: n["cluster"] for n in nodes if n.get("cluster") is not None}
    return {
        "loops": analysis.find_loops(nodes, snap["edges"], now),
        "collision": analysis.collision(nodes, cluster_of, now.date().isoformat()),
        "by_day": analysis.by_day(nodes),
        "open_suggestions": sum(1 for e in snap["edges"] if e["state"] == "suggested"),
    }


def export(db, root: str | None = None) -> int:
    return exporter.write(root or exporter.export_dir(), exporter.render(store.snapshot(db)))


def graph_view(db) -> dict:
    """The map's data: atoms and live links. Embeddings stay on the server."""
    snap = store.snapshot(db)
    nodes = [{k: v for k, v in n.items() if k != "embedding"} for n in snap["nodes"]]
    return {"nodes": nodes, "edges": snap["edges"], "clusters": snap["clusters"], "settings": snap["settings"],
            "generated_at": datetime.now(UTC).isoformat(), "embedder": os.environ.get("AMEEN_EMBED_MODEL", "hashing-384")}
