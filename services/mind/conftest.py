"""Tests import the shared embedder from services/ameen (the same code runs in both containers)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ameen"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
