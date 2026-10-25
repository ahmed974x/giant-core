# OMEGA local tools installer for the Windows laptop (ADR-129).
# Installs the reviewed tools into their own virtual environment under %USERPROFILE%\.omega\tools, from a lock file
# with a SHA-256 hash for every package (pip refuses anything else), wheels only, no build scripts.
#   powershell -ExecutionPolicy Bypass -File omega_tools\install-omega-tools.ps1              light: Oxigraph, Skyfield, PyPortfolioOpt
#   powershell -ExecutionPolicy Bypass -File omega_tools\install-omega-tools.ps1 -Full        also Docling and LightRAG (several GB)
# Paper only. Nothing here can place an order or move money. Every tool stays off until OMEGA_TOOLS names it.
param([switch]$Full)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Home2 = Join-Path $env:USERPROFILE ".omega"
$Venv = Join-Path $Home2 "tools\.venv"
$Lock = if ($Full) { "requirements-full.txt" } else { "requirements-light.txt" }
$Tools = if ($Full) { "oxigraph,skyfield,portfolio,docling,lightrag" } else { "oxigraph,skyfield,portfolio" }

Write-Host "OMEGA tools: $Lock -> $Venv"
$py = Get-Command py -ErrorAction SilentlyContinue
if (-not $py) { throw "Python 3.12 is needed: install it from https://www.python.org/downloads/ (tick 'py launcher'), then run this again." }
& py -3.12 -c "import sys; assert sys.version_info[:2] == (3, 12)" 2>$null
if ($LASTEXITCODE -ne 0) { throw "Python 3.12 is needed (the lock files are made for 3.12). Install it from python.org, then run this again." }

New-Item -ItemType Directory -Force -Path (Join-Path $Home2 "tools"), (Join-Path $Home2 "inbox") | Out-Null
if (-not (Test-Path $Venv)) { & py -3.12 -m venv $Venv }
$vpy = Join-Path $Venv "Scripts\python.exe"
$env:PIP_DISABLE_PIP_VERSION_CHECK = "1"
& $vpy -m pip install --require-hashes --no-deps --only-binary ":all:" -r (Join-Path $PSScriptRoot $Lock)
if ($LASTEXITCODE -ne 0) { throw "pip refused or failed; nothing was started. Read the lines above." }

if ($Full) {
  # One-time downloads, then everything runs offline. Docling's layout models come from Hugging Face;
  # tiktoken's cl100k_base table comes from openaipublic.blob.core.windows.net.
  $models = Join-Path $Home2 "docling-models"
  $env:HF_HUB_DISABLE_TELEMETRY = "1"
  & (Join-Path $Venv "Scripts\docling-tools.exe") models download -o $models
  if ($LASTEXITCODE -ne 0) { throw "Docling's models did not download; run this again when online." }
  $env:TIKTOKEN_CACHE_DIR = Join-Path $Home2 "tiktoken"
  & $vpy -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"
  if (Get-Command ollama -ErrorAction SilentlyContinue) { ollama pull qwen2.5:3b; ollama pull bge-m3 }
  else { Write-Host "Ollama is not installed: LightRAG needs it (https://ollama.com), then 'ollama pull qwen2.5:3b' and 'ollama pull bge-m3'." }
}

# A start file next to the launchers: loopback only, the installed tools switched on.
$start = Join-Path $Repo "start-omega-tools.bat"
@"
@echo off
rem OMEGA local tools on http://127.0.0.1:8097 (ADR-129). Paper only. Close this window to stop.
cd /d "%~dp0"
set OMEGA_TOOLS=$Tools
set HF_HUB_OFFLINE=1
set HF_HUB_DISABLE_TELEMETRY=1
set PIP_NO_INDEX=1
"$vpy" -m omega_tools.http_api
"@ | Set-Content -Encoding ASCII $start

& $vpy -c "from omega_tools.flags import status; import json; print(json.dumps(status(), indent=1))"
Write-Host ""
Write-Host "Done. Start the tools with start-omega-tools.bat, then check http://127.0.0.1:8097/api/health"
