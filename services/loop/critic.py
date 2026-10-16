"""بدر's rules: a separate check on the answer, not self-review (ADR-082). Pure and deterministic.

It returns the gaps it finds. An empty list means the answer may go out, as an answer with its sources.
"""

from __future__ import annotations

from urllib.parse import urlparse


def domains(sources: list[dict]) -> set[str]:
    return {urlparse(s.get("url", "")).hostname or "" for s in sources} - {""}


def review(goal: str, answer: str | None, sources: list[dict]) -> list[str]:
    gaps: list[str] = []
    if not sources:
        return ["no sources were found"]
    if len(domains(sources)) < 2:
        gaps.append("fewer than two independent sources")
    if not answer or not any(s.get("url", "") in answer for s in sources):
        gaps.append("the answer does not cite a source")
    return gaps
