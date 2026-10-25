"""Switches and guards shared by every tool (ADR-129).

A tool runs only when its name is listed in OMEGA_TOOLS (comma separated) and its library is installed.
Nothing is switched on by default.
"""

from __future__ import annotations

import importlib.util
import ipaddress
import os
from pathlib import Path
from urllib.parse import urlparse

# name -> (the Python module it needs, the reviewed version pinned by the installer)
TOOLS = {
    "oxigraph": ("pyoxigraph", "0.5.11"),
    "skyfield": ("skyfield", "1.55"),
    "portfolio": ("pypfopt", "1.6.0"),
    "docling": ("docling", "2.137.0"),
    "lightrag": ("lightrag", "1.5.7"),
}


class ToolOff(Exception):
    """The tool is not switched on in OMEGA_TOOLS."""


class ToolMissing(Exception):
    """The tool is switched on but its library is not installed in this environment."""


def enabled() -> set[str]:
    raw = os.environ.get("OMEGA_TOOLS", "")
    return {t.strip().lower() for t in raw.split(",") if t.strip().lower() in TOOLS}


def installed(name: str) -> bool:
    return importlib.util.find_spec(TOOLS[name][0]) is not None


def require(name: str) -> None:
    if name not in enabled():
        raise ToolOff(f"{name} is off; add it to OMEGA_TOOLS to switch it on")
    if not installed(name):
        raise ToolMissing(f"{name} is on but {TOOLS[name][0]} is not installed; run the omega-tools installer")


def status() -> dict:
    on = enabled()
    return {n: {"on": n in on, "installed": installed(n), "pinned": v} for n, (_, v) in TOOLS.items()}


def omega_home() -> Path:
    return Path(os.environ.get("OMEGA_HOME") or Path.home() / ".omega")


def loopback_url(url: str) -> str:
    """Accept only an http URL whose host is a loopback address or localhost (Ollama must stay on this machine)."""
    u = urlparse(url)
    host = (u.hostname or "").lower()
    if u.scheme != "http" or not host:
        raise ValueError("the local model URL must be http://127.0.0.1:<port>")
    if host != "localhost":
        try:
            if not ipaddress.ip_address(host).is_loopback:
                raise ValueError("the local model must run on this machine (loopback only)")
        except ValueError as e:
            raise ValueError("the local model must run on this machine (loopback only)") from e
    return f"http://{host}:{u.port or 11434}"
