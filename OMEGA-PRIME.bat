@echo off
rem OMEGA PRIME one-click launcher (ADR-094, ADR-108, ADR-112). Copy this file to the Desktop and double-click it.
rem 1. Clones giant-core into %USERPROFILE%\Desktop\OMEGA-PRIME, or pulls the latest main if it is already there.
rem 2. The first time, sets up laptop control for Claude Desktop with scripts\setup-windows-mcp.ps1: Windows-MCP
rem    0.8.8 pinned, stdio only, telemetry off, screen, mouse and keyboard tools only, plus omega-local-mcp. The
rem    script backs up the Claude Desktop config first and asks before it installs uv.
rem 3. Starts the local data proxy on 127.0.0.1:8796 in its own window (close that window to stop it).
rem 4. Waits for the proxy, says whether the optional local model (Ollama) answers, runs the omega-local-mcp bridge
rem    checks, then opens the Ops Room with its 24-check self-test (?selftest=1).
rem SEC routes read the contact line from %USERPROFILE%\.omega\sec-ua.txt ("Your Name your@email"); no address
rem lives in this file. Paper only: nothing started here can place an order or move money.
setlocal
if "%OMEGA_DIR%"=="" set "OMEGA_DIR=%USERPROFILE%\Desktop\OMEGA-PRIME"
if "%OMEGA_PROXY_PORT%"=="" set OMEGA_PROXY_PORT=8796
set "OMEGA_URL=http://127.0.0.1:%OMEGA_PROXY_PORT%/omega-ops-room.html?selftest=1"

where git >nul 2>nul || (echo Git is needed. Install it from https://git-scm.com/ and run this file again. & pause & exit /b 1)
where node >nul 2>nul || (echo Node.js 18 or newer is needed. Install it from https://nodejs.org/ and run this file again. & pause & exit /b 1)
for /f %%v in ('node -p "process.versions.node.split(\".\")[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (echo Node.js %NODE_MAJOR% is too old. Install Node.js 18 or newer. & pause & exit /b 1)

if exist "%OMEGA_DIR%\.git" goto update
echo Downloading giant-core into %OMEGA_DIR% ...
git clone https://github.com/ahmed974x/giant-core.git "%OMEGA_DIR%" || (echo Clone failed. Check the internet connection. & pause & exit /b 1)
goto updated

rem ADR-113: nothing new runs without a look first. The launcher fetches main, lists the incoming commits and
rem pulls only when you press Y; with no answer in 60 s it keeps the copy already on disk.
:update
pushd "%OMEGA_DIR%"
git fetch --quiet origin main || (echo Could not reach GitHub, so the copy already on disk is used. & goto pulled)
git log --oneline HEAD..origin/main > "%TEMP%\omega-incoming.txt" 2>nul
for %%A in ("%TEMP%\omega-incoming.txt") do if %%~zA==0 (echo This copy is already the latest main. & goto pulled)
echo.
echo New commits on GitHub main:
type "%TEMP%\omega-incoming.txt"
echo.
choice /c YN /t 60 /d N /m "Pull these commits and run them"
if errorlevel 2 (echo Kept the copy already on disk. & goto pulled)
git checkout main && git pull --ff-only origin main || echo Update failed, so the copy already on disk is used. Local edits block a fast-forward pull.
:pulled
del "%TEMP%\omega-incoming.txt" >nul 2>nul
popd
:updated
cd /d "%OMEGA_DIR%"
if not exist "%USERPROFILE%\.omega\sec-ua.txt" echo SEC filings stay off until %USERPROFILE%\.omega\sec-ua.txt holds "Your Name your@email".

rem Laptop control, once: skipped when Claude Desktop already has the pinned Windows-MCP entry.
findstr /c:"windows-mcp==0.8.8" "%APPDATA%\Claude\claude_desktop_config.json" >nul 2>nul
if errorlevel 1 (
  echo.
  echo Setting up laptop control for Claude Desktop: Windows-MCP 0.8.8 and omega-local-mcp ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%OMEGA_DIR%\scripts\setup-windows-mcp.ps1" || echo Laptop control setup stopped; OMEGA itself still starts. Run this file again to retry.
) else (
  echo Laptop control: Windows-MCP 0.8.8 is already set up for Claude Desktop.
)

echo Starting the data proxy on 127.0.0.1:%OMEGA_PROXY_PORT% ...
start "OMEGA data proxy" cmd /k node scripts\omega-data-proxy.mjs
set /a TRIES=0
:wait
set /a TRIES+=1
curl.exe -s -o nul http://127.0.0.1:%OMEGA_PROXY_PORT%/health && goto up
if %TRIES% GEQ 20 (echo The proxy did not answer in 20 s. Read the "OMEGA data proxy" window for the reason. & pause & exit /b 1)
timeout /t 1 /nobreak >nul
goto wait
:up
echo.
echo Local model (optional, Ollama on this computer; GLM-5.2 is cloud-only in Ollama, so use a local GLM such as glm4):
curl.exe -s http://127.0.0.1:%OMEGA_PROXY_PORT%/llm/ollama/status
echo.
echo.
echo Bridge checks (omega-local-mcp):
node scripts\omega-mcp-bridge.mjs --selftest
echo.
echo Opening %OMEGA_URL%
start "" "%OMEGA_URL%"
endlocal
