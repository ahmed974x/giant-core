# Sets up laptop control for Claude Desktop on Windows (ADR-108).
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows-mcp.ps1            set up both servers
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows-mcp.ps1 -BridgeOnly  only omega-local-mcp
#
# Adds two MCP servers to Claude Desktop's config, after a dated backup of the old file:
#   windows-mcp      Windows-MCP 0.8.8, pinned, stdio only, telemetry off, and only the screen, mouse and keyboard
#                    tools (no App, PowerShell, Registry, FileSystem, Process or Clipboard). These are the
#                    conditions of the 2026-10-16 security review; if any of them is changed the review's verdict
#                    is "rejected". Moving the mouse yourself, or Ctrl+Alt+Shift+Backspace, takes control back.
#   omega-local-mcp  scripts\omega-mcp-bridge.mjs from this checkout: read-only public data and paper maths.
# It installs uv only after asking (winget, the official astral-sh.uv package). uv fetches Python 3.14 for
# Windows-MCP by itself. Nothing here runs as administrator, opens a network port, places an order or moves money.
param([switch]$BridgeOnly)
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$Bridge = Join-Path $Repo "scripts\omega-mcp-bridge.mjs"

function Say($text) { Write-Host $text }
function Fail($text) { Write-Host $text -ForegroundColor Red; exit 1 }

Say "OMEGA laptop control setup. Checkout: $Repo"

# 1. Node.js 18 or newer for the bridge.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js 18 or newer is needed. Install it from https://nodejs.org/ and run this script again." }
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 18) { Fail "Node.js $major is too old. Install Node.js 18 or newer from https://nodejs.org/." }
if (-not (Test-Path $Bridge)) { Fail "Missing $Bridge. Run 'git pull origin main' in the checkout first." }

# 2. uv for Windows-MCP (skipped with -BridgeOnly).
$uvx = $null
if (-not $BridgeOnly) {
  $uvx = Get-Command uvx -ErrorAction SilentlyContinue
  if (-not $uvx) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { Fail "uv is not installed and winget is missing. Install uv from https://docs.astral.sh/uv/ and run this script again, or run it with -BridgeOnly." }
    $answer = Read-Host "uv is not installed. Install it now with 'winget install --id astral-sh.uv -e'? (y/n)"
    if ($answer -ne "y") { Fail "Stopped without changes. Run again with -BridgeOnly to set up only the OMEGA bridge." }
    & winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
    $uvx = Get-Command uvx -ErrorAction SilentlyContinue
    if (-not $uvx) { Fail "uv was installed but uvx is not on PATH yet. Close this window, open a new one and run the script again." }
  }
  Say "Installing Python 3.14 for Windows-MCP through uv (first run only)..."
  & uv python install 3.14
  if ($LASTEXITCODE -ne 0) { Fail "uv could not install Python 3.14. Check the internet connection and run again, or use -BridgeOnly." }
  # Claude Desktop downloads windows-mcp==0.8.8 itself through uvx the first time it starts the server.
}

# 3. The bridge's own checks. A failed data check is reported, not fatal: the proxy may simply not be running yet.
Say "Running the OMEGA bridge checks..."
& node $Bridge --selftest
if ($LASTEXITCODE -ne 0) { Say "Some bridge checks failed (see above). Data checks pass once OMEGA-PRIME.bat has started the proxy." }

# 4. Claude Desktop config: the classic installer and the Microsoft Store (MSIX) package keep it in different places.
$targets = @(Join-Path $env:APPDATA "Claude\claude_desktop_config.json")
$pkg = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "Claude_*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pkg) { $targets += (Join-Path $pkg.FullName "LocalCache\Roaming\Claude\claude_desktop_config.json") }

$servers = [ordered]@{
  "omega-local-mcp" = [ordered]@{ command = $node.Source; args = @($Bridge); env = [ordered]@{ OMEGA_PROXY_PORT = "8796" } }
}
if (-not $BridgeOnly) {
  $servers["windows-mcp"] = [ordered]@{
    command = $uvx.Source
    args = @("--python", "3.14", "windows-mcp==0.8.8", "serve", "--transport", "stdio", "--tools", "Snapshot,Screenshot,Click,Type,Scroll,Move,Shortcut,Wait,WaitFor")
    env = [ordered]@{ ANONYMIZED_TELEMETRY = "false"; POSTHOG_API_KEY = "" }
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($file in $targets) {
  $dir = Split-Path -Parent $file
  if (-not (Test-Path $dir)) { if ($file -eq $targets[0]) { New-Item -ItemType Directory -Path $dir | Out-Null } else { continue } }
  $config = [ordered]@{}
  if (Test-Path $file) {
    Copy-Item $file "$file.backup-$stamp"
    Say "Backup: $file.backup-$stamp"
    $text = [System.IO.File]::ReadAllText($file)
    if ($text.Trim()) {
      try { $parsed = $text | ConvertFrom-Json } catch { Fail "$file is not valid JSON, so it was left as it is. Fix it or move it aside, then run again." }
      foreach ($p in $parsed.PSObject.Properties) { $config[$p.Name] = $p.Value }
    }
  }
  $existing = [ordered]@{}
  if ($config.Contains("mcpServers") -and $config["mcpServers"]) { foreach ($p in $config["mcpServers"].PSObject.Properties) { $existing[$p.Name] = $p.Value } }
  foreach ($k in $servers.Keys) { $existing[$k] = $servers[$k] }
  $config["mcpServers"] = $existing
  [System.IO.File]::WriteAllText($file, ($config | ConvertTo-Json -Depth 12), $utf8)
  Say "Updated: $file"
}

Say ""
Say "Done. Quit Claude Desktop from the tray icon (not just the window) and open it again."
Say "In a new chat, the tools menu should list omega-local-mcp$(if (-not $BridgeOnly) { ' and windows-mcp' })."
Say "To undo: copy the .backup file back over claude_desktop_config.json."
