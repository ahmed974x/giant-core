#!/usr/bin/env bash
# OMEGA local tools installer for Linux and macOS (ADR-129); the Windows laptop uses install-omega-tools.ps1.
# Hash-locked wheels only, into ~/.omega/tools/.venv.   ./omega_tools/install-omega-tools.sh [--full]
# Paper only. Every tool stays off until OMEGA_TOOLS names it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(dirname "$here")"; home="${OMEGA_HOME:-$HOME/.omega}"; venv="$home/tools/.venv"
lock=requirements-light.txt; tools=oxigraph,skyfield,portfolio
if [ "${1:-}" = "--full" ]; then lock=requirements-full.txt; tools=oxigraph,skyfield,portfolio,docling,lightrag; fi
command -v python3.12 >/dev/null || { echo "Python 3.12 is needed (the lock files are made for 3.12)."; exit 1; }
mkdir -p "$home/tools" "$home/inbox"
[ -d "$venv" ] || python3.12 -m venv "$venv"
PIP_DISABLE_PIP_VERSION_CHECK=1 "$venv/bin/python" -m pip install --require-hashes --no-deps --only-binary ":all:" -r "$here/$lock"
if [ "$lock" = requirements-full.txt ]; then
  HF_HUB_DISABLE_TELEMETRY=1 "$venv/bin/docling-tools" models download -o "$home/docling-models"
  TIKTOKEN_CACHE_DIR="$home/tiktoken" "$venv/bin/python" -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"
  if command -v ollama >/dev/null; then ollama pull qwen2.5:3b; ollama pull bge-m3; else echo "LightRAG needs Ollama (https://ollama.com)."; fi
fi
cat > "$repo/start-omega-tools.sh" <<START
#!/usr/bin/env bash
# OMEGA local tools on http://127.0.0.1:8097 (ADR-129). Paper only. Ctrl+C to stop.
cd "\$(dirname "\$0")"
OMEGA_TOOLS=$tools HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 PIP_NO_INDEX=1 exec "$venv/bin/python" -m omega_tools.http_api
START
chmod +x "$repo/start-omega-tools.sh"
(cd "$repo" && "$venv/bin/python" -c "from omega_tools.flags import status; import json; print(json.dumps(status(), indent=1))")
echo "Done. Start with ./start-omega-tools.sh, then check http://127.0.0.1:8097/api/health"
