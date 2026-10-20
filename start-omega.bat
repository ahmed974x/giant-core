@echo off
rem OMEGA one-click launcher for Windows (ADR-093).
rem Starts the local data proxy on 127.0.0.1:8796, which also serves the Ops Room, THE CHAIN and NABD pages,
rem prints a live status table for every free data source, then opens the Ops Room in the default browser.
rem Paper only: nothing started here can place an order or move money.
setlocal
cd /d "%~dp0"
if "%OMEGA_PROXY_PORT%"=="" set OMEGA_PROXY_PORT=8796
set "OMEGA_URL=http://127.0.0.1:%OMEGA_PROXY_PORT%/omega-ops-room-v1/omega-ops-room.html"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is needed. Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
for /f %%v in ('node -p "process.versions.node.split(\".\")[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo Node.js %NODE_MAJOR% is too old. Install Node.js 18 or newer from https://nodejs.org/.
  pause
  exit /b 1
)
echo Starting OMEGA on %OMEGA_URL%
echo The proxy runs in its own window with the source status table. Close that window to stop.
start "OMEGA data proxy" cmd /k node scripts\omega-data-proxy.mjs
timeout /t 2 /nobreak >nul
start "" "%OMEGA_URL%"
endlocal
