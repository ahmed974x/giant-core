"""LightRAG (MIT) with a local Ollama model: graph retrieval over the notes Ahmad adds (ADR-129).

Loopback only: the model URL must be 127.0.0.1 or localhost, ":cloud" models are refused, and the store lives
in ~/.omega/lightrag. LightRAG installs missing packages at import time through pipmaster; PIP_NO_INDEX=1 is
set before the import so that can never fetch anything, and the installer pins `ollama` in advance. Answers
are labelled [INFERENCE - local LLM] and change nothing.
"""

from __future__ import annotations

import asyncio
import os
from functools import partial
from pathlib import Path

from .flags import loopback_url, omega_home, require

MODES = {"naive", "local", "global", "hybrid", "mix"}
MAX_TEXT = 200_000
MAX_QUESTION = 2000
LABEL = "[INFERENCE - local LLM] · reads your own notes, changes nothing"


def settings() -> dict:
    model = os.environ.get("OMEGA_RAG_MODEL", "qwen2.5:3b")
    embed = os.environ.get("OMEGA_RAG_EMBED", "bge-m3:latest")
    for m in (model, embed):
        if m.endswith(":cloud") or "cloud" in m.split(":")[-1]:
            raise ValueError("cloud models are not allowed; use a model that runs on this machine")
    return {
        "host": loopback_url(os.environ.get("OLLAMA_HOST_URL", "http://127.0.0.1:11434")),
        "model": model,
        "embed": embed,
        "dir": Path(os.environ.get("OMEGA_RAG_DIR") or omega_home() / "lightrag"),
    }


async def _rag(cfg: dict):
    os.environ["PIP_NO_INDEX"] = "1"
    os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(omega_home() / "tiktoken"))
    os.environ["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    from lightrag import LightRAG
    from lightrag.llm.ollama import ollama_embed, ollama_model_complete
    from lightrag.utils import EmbeddingFunc

    cfg["dir"].mkdir(parents=True, exist_ok=True)
    rag = LightRAG(
        working_dir=str(cfg["dir"]),
        llm_model_func=ollama_model_complete,
        llm_model_name=cfg["model"],
        llm_model_kwargs={"host": cfg["host"]},
        embedding_func=EmbeddingFunc(
            embedding_dim=1024,
            max_token_size=8192,
            model_name=cfg["embed"],
            func=partial(ollama_embed.func, embed_model=cfg["embed"], host=cfg["host"]),
        ),
    )
    await rag.initialize_storages()
    return rag


def rag_insert(text: str) -> dict:
    require("lightrag")
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise ValueError(f"send 1 to {MAX_TEXT} characters of your own notes")
    cfg = settings()

    async def run():
        rag = await _rag(cfg)
        try:
            await rag.ainsert(text)
        finally:
            await rag.finalize_storages()

    asyncio.run(run())
    return {"stored": len(text), "dir": str(cfg["dir"]), "model": cfg["model"], "label": LABEL}


def rag_query(question: str, mode: str = "mix") -> dict:
    require("lightrag")
    if not isinstance(question, str) or not question.strip() or len(question) > MAX_QUESTION:
        raise ValueError(f"ask a question of 1 to {MAX_QUESTION} characters")
    if mode not in MODES:
        raise ValueError("mode must be one of " + ", ".join(sorted(MODES)))
    cfg = settings()

    async def run():
        from lightrag import QueryParam

        rag = await _rag(cfg)
        try:
            return await rag.aquery(question, param=QueryParam(mode=mode))
        finally:
            await rag.finalize_storages()

    answer = asyncio.run(run())
    return {"answer": str(answer)[:20_000], "mode": mode, "model": cfg["model"], "label": LABEL}
