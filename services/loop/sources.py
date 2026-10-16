"""Web evidence for the researcher: a local SearXNG (ADR-050), keyless. Everything it returns is tainted.

Results are data, never instructions: the engine marks them 'tainted' and the database refuses a write from them.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

SEARX = os.environ.get("SEARXNG_URL", "http://searxng:8080").rstrip("/")
PER_QUERY = 5


class SearxSources:
    def gather(self, subqs: list[str]) -> list[dict]:
        seen: set[str] = set()
        out: list[dict] = []
        for q in subqs[:3]:
            for r in self._search(q):
                url = r.get("url") or ""
                if url and url not in seen and url.startswith(("http://", "https://")):
                    seen.add(url)
                    out.append({"url": url, "title": (r.get("title") or "")[:160], "snippet": (r.get("content") or "")[:400]})
        return out[: PER_QUERY * 2]

    def _search(self, q: str) -> list[dict]:
        try:
            url = f"{SEARX}/search?{urllib.parse.urlencode({'q': q, 'format': 'json'})}"
            with urllib.request.urlopen(url, timeout=8) as r:  # noqa: S310 - internal SearXNG address from compose
                return json.load(r).get("results", [])[:PER_QUERY]
        except Exception:  # an unreachable search means no sources: the critic will say so
            return []


class StaticSources:
    """For tests and for demos without the network."""

    def __init__(self, items: list[dict]):
        self.items = items

    def gather(self, subqs: list[str]) -> list[dict]:
        return list(self.items)
