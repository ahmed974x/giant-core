# Brings OMEGA back after a reboot (ADR-064). Run by the "OMEGA Boot" scheduled task at sign-in; safe to run by hand.
#   1. Docker Desktop: start it if the engine is not answering, wait up to 4 minutes
#   2. Director 00 Postgres on :5435 (the rest return by their own restart: unless-stopped; nothing new is created)
#   3. web app on 127.0.0.1:3100 through secure-run (dotenvx, ADR-042) if nothing is listening there
# Never stops anything. Caddy and the rest are left to Phoenix (every 5 min, ADR-020). Log: %LOCALAPPDATA%\OMEGA\boot.log
$ErrorActionPreference = "Continue"
$core = Resolve-Path "$PSScriptRoot\..\.."
$logDir = Join-Path $env:LOCALAPPDATA "OMEGA"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "boot.log"
function Log($msg) { "$(Get-Date -Format s)  $msg" | Add-Content $log -Encoding utf8 }

function DockerUp { docker info *> $null; return $LASTEXITCODE -eq 0 }

Log "boot start"
if (-not (DockerUp)) {
    $desktop = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"
    if (-not (Test-Path $desktop)) { $desktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe" }
    if (Test-Path $desktop) { Start-Process $desktop; Log "started Docker Desktop" } else { Log "Docker Desktop not found"; }
    for ($i = 0; $i -lt 48 -and -not (DockerUp); $i++) { Start-Sleep 5 }
}
if (DockerUp) {
    Push-Location $core
    # Containers that were running come back by their own restart: unless-stopped once the engine is up; ones stopped
    # by hand stay stopped. `up -d` of the whole file would also create n8n, relay, agents, quant (~1.1 GB more) that
    # never ran on this 7 GB laptop, so only Director Postgres, the one service always required, is ensured here.
    $out = cmd /c "docker compose --profile director up -d memory 2>&1" | Out-String
    Log "memory up exit=$LASTEXITCODE $($out.Trim() -replace '\s+', ' ')"
    Pop-Location
} else {
    Log "Docker engine not ready after 4 min; Phoenix will retry"
}

if (-not (Get-NetTCPConnection -State Listen -LocalPort 3100 -ErrorAction SilentlyContinue)) {
    $web = Join-Path $core "web"
    Start-Process node -ArgumentList "scripts/secure-run.mjs", "start", "-p", "3100", "-H", "127.0.0.1" -WorkingDirectory $web -WindowStyle Hidden
    Log "started web on 127.0.0.1:3100"
} else {
    Log "web already listening on 3100"
}
Log "boot done"
