# Starts the OMEGA web app (127.0.0.1:3100) and Caddy (HTTPS on the LAN) for phone access.
#   powershell -ExecutionPolicy Bypass -File ops\caddy\start-https.ps1
# Caddy binary: OMEGA_PRIME_PROJECT\tools\caddy\bin\caddy.exe (v2.11.7, SHA-512 verified against the release checksums).

$ErrorActionPreference = "Stop"
$core  = Resolve-Path "$PSScriptRoot\..\.."
$caddy = Resolve-Path "$core\..\tools\caddy\bin\caddy.exe"
$data  = Join-Path $core "..\tools\caddy\data"
New-Item -ItemType Directory -Force $data | Out-Null

# The Wi-Fi address the phone will use (first private IPv4 on an active adapter).
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -match '^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)' -and $_.AddressState -eq 'Preferred' } |
    Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress
if (-not $ip) { throw "No private Wi-Fi/LAN IPv4 address found." }

# 1. Web app, if it is not already listening.
if (-not (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath "node" -ArgumentList @("$core\web\node_modules\next\dist\bin\next", "start", "$core\web", "-p", "3100", "-H", "127.0.0.1") `
        -WorkingDirectory "$core\web" -WindowStyle Hidden
}

# 2. Caddy.
$env:OMEGA_LAN_IP = $ip
$env:OMEGA_CADDY_DATA = (Resolve-Path $data).Path
Get-Process caddy -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath $caddy -ArgumentList @("run", "--config", "$PSScriptRoot\Caddyfile", "--adapter", "caddyfile") `
    -WorkingDirectory $PSScriptRoot -WindowStyle Hidden

Write-Host ""
Write-Host "OMEGA PRIME over HTTPS"
Write-Host "  Phone, step 1 (once): open http://$($ip):8480/omega-root.crt and install it as a trusted CA"
Write-Host "  Phone, step 2:        open https://$($ip):8443"
Write-Host "  Stop:                 Get-Process caddy | Stop-Process"
