"""Embeddings for the agents' memory, computed on the laptop only.

Two backends, picked by environment (the same pair Director 00 uses, services/director00/embed.py):
  - HashingEmbedder (default): no model, no download, ~0 MB RAM. Signed feature hashing of words, character
    trigrams and word pairs (Arabic and English), L2-normalised. Good at "same words / same entities".
  - HttpEmbedder: an OpenAI-compatible /embeddings endpoint on this machine (Ollama). Set AMEEN_EMBED_URL and
    AMEEN_EMBED_MODEL. Only local URLs are accepted, so memory text never leaves the laptop.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
import os
import re
import urllib.parse
import urllib.request

DIM = int(os.environ.get("AMEEN_EMBED_DIM", "384"))
_WORD = re.compile(r"\w+", re.UNICODE)
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "ollama", "host.docker.internal"}


class HashingEmbedder:
    def __init__(self, dim: int = DIM):
        self.dim = dim
        self.name = f"hashing-{dim}"

    @staticmethod
    def features(text: str) -> dict[str, float]:
        feats: dict[str, float] = {}
        words = [w for w in _WORD.findall(text.lower()) if len(w) > 1]
        for w in words:
            feats[f"w:{w}"] = feats.get(f"w:{w}", 0.0) + 1.0
            padded = f"#{w}#"
            for i in range(len(padded) - 2):                 # trigrams catch inflections: ship / shipping, النفط / نفط
                g = f"g:{padded[i:i + 3]}"
                feats[g] = feats.get(g, 0.0) + 0.5
        for a, b in itertools.pairwise(words):     # word pairs keep a little order ("not approved")
            feats[f"b:{a}_{b}"] = feats.get(f"b:{a}_{b}", 0.0) + 0.7
        return feats

    def embed(self, text: str) -> list[float]:
        v = [0.0] * self.dim
        for f, weight in self.features(text).items():
            h = hashlib.blake2b(f.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(h[:4], "little") % self.dim
            v[idx] += (1.0 if h[4] & 1 else -1.0) * (1.0 + math.log(weight))
        n = math.sqrt(sum(x * x for x in v))
        return [x / n for x in v] if n else v


class HttpEmbedder:
    def __init__(self, url: str, model: str, dim: int = DIM):
        host = urllib.parse.urlparse(url).hostname or ""
        if urllib.parse.urlparse(url).scheme not in ("http", "https") or host not in LOCAL_HOSTS:
            raise ValueError(f"AMEEN_EMBED_URL must point at this machine ({', '.join(sorted(LOCAL_HOSTS))}); got {host!r}")
        self.url, self.model, self.dim = url.rstrip("/"), model, dim
        self.name = f"http:{model}"

    def embed(self, text: str) -> list[float]:
        body = json.dumps({"model": self.model, "input": text}).encode()
        req = urllib.request.Request(f"{self.url}/embeddings", data=body, headers={"Content-Type": "application/json"})  # noqa: S310 - local URL checked in __init__
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 - local URL checked in __init__
            vec = json.load(r)["data"][0]["embedding"]
        if len(vec) != self.dim:
            raise ValueError(f"{self.model} returns {len(vec)}-d vectors; set AMEEN_EMBED_DIM={len(vec)}")
        return vec


def get_embedder():
    url, model = os.environ.get("AMEEN_EMBED_URL"), os.environ.get("AMEEN_EMBED_MODEL")
    return HttpEmbedder(url, model) if url and model else HashingEmbedder()
