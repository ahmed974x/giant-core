@echo off
rem ============================================================================
rem  OMEGA IGNITION - one click: check the machine has room, boot the stack from the
rem  branch you have checked out, wait for the Ops Room, open it.
rem  Put this file in the giant-core folder (or run scripts\omega_ignition.bat).
rem  Safe by design: it never pushes, never touches main, stops on the first error.
rem  Merging the PRs stays your call on GitHub.
rem ============================================================================
setlocal EnableExtensions EnableDelayedExpansion

set "OPS_URL=http://localhost:8088"

rem cmd reads a .bat while it runs; git may rewrite this file, so run from a temp copy.
if /i not "%~1"=="--run" (
  copy /y "%~f0" "%TEMP%\omega_ignition_run.bat" >nul
  call "%TEMP%\omega_ignition_run.bat" --run "%~dp0"
  exit /b !errorlevel!
)

set "REPO=%~2"
if exist "%REPO%docker-compose.yml" (cd /d "%REPO%") else if exist "%REPO%..\docker-compose.yml" (cd /d "%REPO%..") else if exist "%REPO%.git" (cd /d "%REPO%") else (
  call :fail "Put omega_ignition.bat inside the giant-core folder."
  exit /b 1
)

echo.
echo   ==========  O M E G A   I G N I T I O N  ==========
echo   repo: %CD%
echo.

rem ---- 0. preflight ------------------------------------------------------------
where git >nul 2>&1 || (call :fail "git is not installed or not on PATH." & exit /b 1)
where docker >nul 2>&1 || (call :fail "Docker Desktop is not installed." & exit /b 1)
docker info >nul 2>&1 || (call :fail "Docker Desktop is not running. Start it, wait for the whale icon, run me again." & exit /b 1)
rem Low-RAM guard: this laptop froze when Docker + the local LLM ran out of memory.
for /f %%m in ('powershell -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)"') do set "FREE_MB=%%m"
echo       free RAM: %FREE_MB% MB
if %FREE_MB% LSS 1500 (call :fail "Only %FREE_MB% MB RAM free. Close browsers/apps first; the stack needs about 1.5 GB." & exit /b 1)
if not exist "%USERPROFILE%\.wslconfig" (
  echo       No %USERPROFILE%\.wslconfig: copying ops\wslconfig.example so Docker's VM is capped at 4 GB.
  copy /y "ops\wslconfig.example" "%USERPROFILE%\.wslconfig" >nul
  echo       Restart Docker Desktop ^(or run: wsl --shutdown^) for the cap to apply, then run me again.
  pause
  exit /b 0
)

rem ---- 1. code: run whatever branch is checked out (nothing is fetched, switched or pushed) ----
for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
echo [1/4] Running branch %BRANCH% as it is on disk.

rem ---- 2. secrets ---------------------------------------------------------------
echo [2/4] Preparing .env...
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  set "FIRST_RUN=1"
)
rem Fill every empty secret with 32 random bytes (hex). Existing values are never touched.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$keys='N8N_ENCRYPTION_KEY','OMEGA_RELAY_TOKEN','POSTGRES_PASSWORD','SENTINEL_DB_PASSWORD','PGRST_DB_PASSWORD','PGRST_JWT_SECRET','OMEGA_GATEWAY_TOKEN';" ^
  "$rng=[Security.Cryptography.RandomNumberGenerator]::Create();" ^
  "$lines=Get-Content .env | ForEach-Object { $l=$_; foreach($k in $keys){ if($l -eq ($k+'=')){ $b=New-Object byte[] 32; $rng.GetBytes($b); $l=$k+'='+(($b|ForEach-Object{$_.ToString('x2')}) -join '') } }; $l };" ^
  "[IO.File]::WriteAllLines((Resolve-Path .env).Path, $lines)" || (call :fail "Could not write .env" & exit /b 1)
findstr /b /c:"OMEGA_LOCAL_MODEL=" .env >nul || echo OMEGA_LOCAL_MODEL=llama3.2:3b>>.env
if defined FIRST_RUN (
  echo.
  echo       .env created with fresh secrets. Local model: llama3.2:3b ^(~2 GB^).
  echo       Optional: add ANTHROPIC_API_KEY / GROQ_API_KEY etc. now. Notepad is opening;
  echo       save and close it to continue. The local model works without any key.
  start /wait notepad .env
)

rem ---- 3. boot -------------------------------------------------------------------
echo [3/4] Booting the stack (first run builds images and downloads the model)...
set "PROFILES="
if %FREE_MB% GEQ 4000 (
  choice /c YN /n /t 10 /d N /m "      Also start the local LLM (needs ~2.5 GB more RAM)? [Y/N, default N in 10s] "
  if not errorlevel 2 set "PROFILES=--profile llm"
) else echo       Local LLM skipped: under 4 GB RAM free. Cortex uses the cloud tiers.
docker compose %PROFILES% up -d --build || (call :fail "docker compose failed. See the output above." & exit /b 1)

rem ---- 4. wait for the Ops Room ----------------------------------------------------
echo [4/4] Waiting for the Ops Room...
set /a tries=0
:wait
set /a tries+=1
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 '%OPS_URL%/healthz'; exit [int]($r.StatusCode -ne 200) } catch { exit 1 }"
if not errorlevel 1 goto live
if %tries% geq 60 (call :fail "Ops Room did not answer in 5 minutes. Check: docker compose ps" & exit /b 1)
timeout /t 5 /nobreak >nul
goto wait

:live
powershell -NoProfile -Command "[console]::beep(880,180); [console]::beep(1320,260)" >nul 2>&1
echo.
echo   ====================================================
echo     OMEGA IS LIVE   -   Ops Room  %OPS_URL%
echo     Cortex LLM API  -   http://localhost:8089/v1
echo     Stop it all:  docker compose down
echo   ====================================================
start "" "%OPS_URL%"
pause
exit /b 0

:fail
powershell -NoProfile -Command "[console]::beep(220,400)" >nul 2>&1
echo.
echo   [OMEGA] STOPPED: %~1
echo.
pause
exit /b 1
