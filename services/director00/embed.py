"""Text embeddings for Director 00's memory.

Two backends, picked by environment:
  - HashingEmbedder (default): no model, no download, ~0 MB RAM. Signed feature hashing of words and character
    trigrams (Arabic and English), L2-normalised. Good at "same words / same entities", weak at synonyms.
  - HttpEmbedder: any OpenAI-compatible /embeddings endpoint (Ollama with all-minilm, a llama.cpp server, Cortex).
    Set DIRECTOR_EMBED_URL and DIRECTOR_EMBED_MODEL; the model's dimension must match DIM (384).
"""

import hashlib
import json
import math
import os
import re
import urllib.request

import numpy as np

DIM = int(os.environ.get("DIRECTOR_EMBED_DIM", "384"))
_WORD = re.compile(r"\w+", re.UNICODE)


class HashingEmbedder:
    name = "hashing-384"

    def __init__(self, dim: int = DIM):
        self.dim = dim

    def _features(self, text: str) -> dict[str, float]:
        feats: dict[str, float] = {}
        words = [w for w in _WORD.findall(text.lower()) if len(w) > 1]
        for w in words:
            feats[f"w:{w}"] = feats.get(f"w:{w}", 0.0) + 1.0
            padded = f"#{w}#"
            for i in range(len(padded) - 2):                 # trigrams catch inflections: ship / shipping / ships
                g = f"g:{padded[i:i + 3]}"
                feats[g] = feats.get(g, 0.0) + 0.5
        for a, b in zip(words, words[1:]):                   # word pairs keep a little order ("not approved")
            feats[f"b:{a}_{b}"] = feats.get(f"b:{a}_{b}", 0.0) + 0.7
        return feats

    def embed(self, text: str) -> list[float]:
        v = np.zeros(self.dim, dtype=np.float32)
        for f, weight in self._features(text).items():
            h = hashlib.blake2b(f.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(h[:4], "little") % self.dim
            sign = 1.0 if h[4] & 1 else -1.0
            v[idx] += sign * (1.0 + math.log(weight))
        n = float(np.linalg.norm(v))
        return (v / n).tolist() if n else v.tolist()


class HttpEmbedder:
    def __init__(self, url: str, model: str, dim: int = DIM):
        self.url, self.model, self.dim = url.rstrip("/"), model, dim
        self.name = f"http:{model}"

    def embed(self, text: str) -> list[float]:
        body = json.dumps({"model": self.model, "input": text}).encode()
        req = urllib.request.Request(f"{self.url}/embeddings", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            vec = json.load(r)["data"][0]["embedding"]
        if len(vec) != self.dim:
            raise ValueError(f"{self.model} returns {len(vec)}-d vectors; agent_memories expects {self.dim}")
        return vec


def get_embedder():
    url, model = os.environ.get("DIRECTOR_EMBED_URL"), os.environ.get("DIRECTOR_EMBED_MODEL")
    return HttpEmbedder(url, model) if url and model else HashingEmbedder()
