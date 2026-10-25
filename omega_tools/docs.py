"""Docling (MIT): turn a PDF or office file from the OMEGA inbox into Markdown for the second brain (ADR-129).

Offline after setup. The installer downloads Docling's layout models once into ~/.omega/docling-models; every
call then runs with HF_HUB_OFFLINE=1, remote services off, external plugins off and that folder as the only
model source. Only files inside ~/.omega/inbox are read, never a URL.
"""

from __future__ import annotations

import os
from pathlib import Path

from .flags import omega_home, require

SUFFIXES = {".pdf", ".docx", ".pptx", ".xlsx", ".html", ".md", ".png", ".jpg", ".jpeg"}
MAX_BYTES = 50 * 1024 * 1024
MAX_PAGES = 300
MAX_CHARS = 200_000


def inbox() -> Path:
    return Path(os.environ.get("OMEGA_INBOX") or omega_home() / "inbox")


def models_dir() -> Path:
    return Path(os.environ.get("OMEGA_DOCLING_MODELS") or omega_home() / "docling-models")


def check_file(name: str) -> Path:
    if not isinstance(name, str) or not name or "://" in name:
        raise ValueError("give the name of a file in the OMEGA inbox, not a URL")
    root = inbox().resolve()
    p = (root / name).resolve()
    if not p.is_relative_to(root) or p == root:
        raise ValueError("only files inside the OMEGA inbox are read")
    if p.suffix.lower() not in SUFFIXES:
        raise ValueError("Docling here reads " + ", ".join(sorted(SUFFIXES)))
    if not p.is_file():
        raise ValueError(f"{name} is not in {root}")
    if p.stat().st_size > MAX_BYTES:
        raise ValueError("the file is larger than 50 MB")
    return p


def offline_env() -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"


def to_markdown(name: str) -> dict:
    """Convert one inbox file to Markdown with Docling, offline."""
    require("docling")
    path = check_file(name)
    models = models_dir()
    if not models.is_dir():
        raise ValueError(f"Docling's models are not in {models}; run the installer's Docling step once")
    offline_env()
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions(artifacts_path=str(models), enable_remote_services=False, allow_external_plugins=False)
    conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})
    res = conv.convert(path, max_num_pages=MAX_PAGES, max_file_size=MAX_BYTES)
    md = res.document.export_to_markdown()
    return {
        "file": path.name,
        "chars": len(md),
        "truncated": len(md) > MAX_CHARS,
        "markdown": md[:MAX_CHARS],
        "method": "Docling 2.137.0, offline models",
        "note": "Text from your own file; check numbers against the original",
    }
