@echo off
rem OMEGA one-click launcher for Windows (ADR-093, ADR-112).
rem Starts the local data proxy on 127.0.0.1:8796, which also serves the Ops Room, THE CHAIN and NABD pages,
rem prints a live status table for every free data source, waits until the proxy answers, says whether the
rem optional local model (Ollama) and laptop control (Windows-MCP) are ready, then opens the Ops Room.
rem   start-omega.bat            open the Ops Room
rem   start-omega.bat selftest   open it with the 24-check self-test (?selftest=1)
rem Paper only: nothing started here can place an order or move money.
setlocal
cd /d "%~dp0"
if "%OMEGA_PROXY_PORT%"=="" set OMEGA_PROXY_PORT=8796
set "OMEGA_URL=http://127.0.0.1:%OMEGA_PROXY_PORT%/omega-ops-room-v1/omega-ops-room.html"
if /i "%~1"=="selftest" set "OMEGA_URL=%OMEGA_URL%?selftest=1"
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
set /a TRIES=0
:wait
set /a TRIES+=1
curl.exe -s -o nul http://127.0.0.1:%OMEGA_PROXY_PORT%/health && goto up
if %TRIES% GEQ 20 (echo The proxy did not answer in 20 s. Read the "OMEGA data proxy" window for the reason. & pause & exit /b 1)
timeout /t 1 /nobreak >nul
goto wait
:up
echo.
echo Local model (optional, Ollama on this computer):
curl.exe -s http://127.0.0.1:%OMEGA_PROXY_PORT%/llm/ollama/status
echo.
findstr /c:"windows-mcp==0.8.8" "%APPDATA%\Claude\claude_desktop_config.json" >nul 2>nul && (echo Laptop control: Windows-MCP 0.8.8 is set up for Claude Desktop.) || (echo Laptop control: Windows-MCP is not set up yet. Run OMEGA-PRIME.bat once to set it up.)
start "" "%OMEGA_URL%"
endlocal
