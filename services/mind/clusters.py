"""Themes: Louvain communities over the live links, named from the owner's own words (ADR-081, section 12.1 step 6).

networkx (BSD-3-Clause, pinned) runs the community detection with a fixed seed, so the same brain gives the same themes.
Names come from the most frequent meaningful words in each theme; no model is needed.
"""

from __future__ import annotations

import re
from collections import Counter

import networkx as nx

STOP = {"the", "and", "that", "with", "this", "from", "have", "will", "about", "into", "not", "for", "are", "was",
        "في", "من", "على", "إلى", "الى", "عن", "مع", "هذا", "هذه", "ان", "أن", "انا", "أنا", "ما", "لا", "لو", "كل",
        "يعني", "اللي", "الي", "شي", "شيء", "هو", "هي", "the", "it", "is", "to", "of", "a", "i"}
WORD = re.compile(r"[\w؀-ۿ]{3,}", re.UNICODE)


def communities(nodes: list[dict], edges: list[dict], seed: int = 7) -> list[set[int]]:
    g = nx.Graph()
    g.add_nodes_from(n["id"] for n in nodes)
    for e in edges:
        if e["src"] in g and e["dst"] in g:
            g.add_edge(e["src"], e["dst"], weight=max(float(e.get("confidence", 1.0)), 0.05))
    comms = nx.community.louvain_communities(g, weight="weight", seed=seed, resolution=1.0)
    return sorted((set(c) for c in comms), key=lambda c: (-len(c), min(c)))


def name_for(texts: list[str]) -> str:
    counts: Counter[str] = Counter()
    for t in texts:
        counts.update(w.lower() for w in WORD.findall(t) if w.lower() not in STOP)
    top = [w for w, _ in counts.most_common(2)]
    return " · ".join(top) if top else "متفرقات"


def assign(nodes: list[dict], edges: list[dict], seed: int = 7) -> tuple[dict[int, int], list[dict]]:
    """-> ({node id: cluster key}, [{key, name, size}]). Keys are 0.. by size, largest first."""
    by_id = {n["id"]: n for n in nodes}
    groups = communities(nodes, edges, seed)
    mapping: dict[int, int] = {}
    clusters = []
    for key, members in enumerate(groups):
        texts = [by_id[i]["text"] for i in members]
        clusters.append({"key": key, "name": name_for(texts)[:80], "size": len(members)})
        mapping.update({i: key for i in members})
    return mapping, clusters
