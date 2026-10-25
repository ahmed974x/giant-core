"""Oxigraph (pyoxigraph, MIT OR Apache-2.0): SPARQL over the knowledge domain's exported graph (ADR-129).

The graph comes from the knowledge page's JSON export (format omega-knowledge-graph-v1) and is loaded into an
in-memory store for each call. Only SELECT and ASK run. SERVICE, LOAD and every update form are refused before
the query reaches Oxigraph, so a query can neither change data nor reach the network.
"""

from __future__ import annotations

import re

from .flags import require

NS = "urn:omega:"
MAX_QUERY = 4000
MAX_ROWS = 500
MAX_NODES = 20_000
FORBIDDEN = re.compile(r"\b(SERVICE|LOAD|INSERT|DELETE|CLEAR|DROP|CREATE|COPY|MOVE|ADD|WITH|USING)\b", re.IGNORECASE)
FORM = re.compile(r"^\s*(?:(?:PREFIX\s+\w*:\s*<[^>]*>|BASE\s+<[^>]*>)\s*)*(SELECT|ASK)\b", re.IGNORECASE)
LITERAL_FIELDS = ("kind", "ar", "en", "ref", "status", "licence", "url")


def check_query(q: str) -> str:
    if not isinstance(q, str) or not q.strip():
        raise ValueError("write a SPARQL SELECT or ASK query")
    if len(q) > MAX_QUERY:
        raise ValueError(f"the query is longer than {MAX_QUERY} characters")
    # Strings and IRIs may hold any word; look for forbidden keywords outside them.
    bare = re.sub(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|<[^<>\s]*>', " ", q)
    bare = re.sub(r"#[^\n]*", " ", bare)
    if FORBIDDEN.search(bare):
        raise ValueError("only read queries run here: SERVICE, LOAD and update forms are refused")
    if not FORM.match(re.sub(r"#[^\n]*", " ", q)):
        raise ValueError("only SELECT and ASK queries run here")
    return q


def check_graph(graph: dict) -> dict:
    if not isinstance(graph, dict) or graph.get("format") != "omega-knowledge-graph-v1":
        raise ValueError("load the knowledge domain's JSON export (format omega-knowledge-graph-v1)")
    nodes, edges = graph.get("nodes"), graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list) or len(nodes) > MAX_NODES or len(edges) > MAX_NODES * 8:
        raise ValueError("the graph export has no node list or is too large")
    return graph


def iri(kind: str, value: str) -> str:
    return NS + kind + ":" + re.sub(r"[^A-Za-z0-9._~:/-]", lambda m: "%%%02X" % ord(m.group()), str(value))  # noqa: UP031


def build_store(graph: dict):
    from pyoxigraph import DefaultGraph, Literal, NamedNode, Quad, Store

    g, store, quads = DefaultGraph(), Store(), []
    for n in graph["nodes"]:
        if not isinstance(n, dict) or not n.get("id"):
            continue
        s = NamedNode(iri("node", n["id"]))
        for f in LITERAL_FIELDS:
            v = n.get(f)
            if isinstance(v, str) and v:
                quads.append(Quad(s, NamedNode(iri("p", f)), Literal(v[:500]), g))
    for e in graph["edges"]:
        if not isinstance(e, dict) or not e.get("a") or not e.get("b"):
            continue
        quads.append(
            Quad(NamedNode(iri("node", e["a"])), NamedNode(iri("p", str(e.get("kind") or "link"))), NamedNode(iri("node", e["b"])), g)
        )
    store.extend(quads)
    return store


def term(t) -> str | None:
    if t is None:
        return None
    return t.value


def kg_query(graph: dict, query: str) -> dict:
    """Run one read-only SPARQL query over the exported knowledge graph."""
    require("oxigraph")
    check_graph(graph)
    q = check_query(query)
    store = build_store(graph)
    res = store.query(q, prefixes={"o": NS + "node:", "p": NS + "p:"})
    if isinstance(res, bool) or type(res).__name__ == "QueryBoolean":
        return {"ask": bool(res), "ns": NS, "label": "Read only · [INFERENCE] links come from the knowledge domain"}
    names = [v.value for v in res.variables]
    rows = []
    for sol in res:
        rows.append({n: term(sol[n]) for n in names})
        if len(rows) >= MAX_ROWS:
            break
    return {
        "vars": names,
        "rows": rows,
        "truncated": len(rows) >= MAX_ROWS,
        "triples": len(store),
        "ns": NS,
        "label": "Read only · [INFERENCE] links come from the knowledge domain",
    }
