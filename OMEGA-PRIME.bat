@echo off
rem OMEGA PRIME one-click launcher (ADR-094, ADR-108). Copy this file to the Desktop and double-click it.
rem 1. Clones giant-core into %USERPROFILE%\Desktop\OMEGA-PRIME, or pulls the latest main if it is already there.
rem 2. Starts the local data proxy on 127.0.0.1:8796 in its own window (close that window to stop it).
rem 3. Waits for the proxy, runs the omega-local-mcp bridge checks, then opens the Ops Room with its 18-check
rem    self-test (?selftest=1).
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

if not exist "%OMEGA_DIR%\.git" (
  echo Downloading giant-core into %OMEGA_DIR% ...
  git clone https://github.com/ahmed974x/giant-core.git "%OMEGA_DIR%" || (echo Clone failed. Check the internet connection. & pause & exit /b 1)
) else (
  echo Updating %OMEGA_DIR% to the latest main ...
  pushd "%OMEGA_DIR%"
  git checkout main && git pull --ff-only origin main || echo Update failed, so the copy already on disk is used. Local edits block a fast-forward pull.
  popd
)
cd /d "%OMEGA_DIR%"
if not exist "%USERPROFILE%\.omega\sec-ua.txt" echo SEC filings stay off until %USERPROFILE%\.omega\sec-ua.txt holds "Your Name your@email".

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
echo Bridge checks (omega-local-mcp):
node scripts\omega-mcp-bridge.mjs --selftest
echo.
echo Opening %OMEGA_URL%
start "" "%OMEGA_URL%"
endlocal
