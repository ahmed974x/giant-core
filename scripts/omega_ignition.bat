@echo off
rem ============================================================================
rem  OMEGA IGNITION - one click: merge the OMEGA branch into main, boot the stack,
rem  wait for the Ops Room, open it.
rem  Put this file in the giant-core folder (or run scripts\omega_ignition.bat).
rem  Safe by design: a normal merge (never a force push), stops on the first error.
rem ============================================================================
setlocal EnableExtensions EnableDelayedExpansion

set "BRANCH=claude/project-thread-7x7mot"
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
git diff --quiet && git diff --cached --quiet || (call :fail "You have uncommitted changes. Commit or stash them first." & exit /b 1)

rem ---- 1. merge the OMEGA branch into main --------------------------------------
echo [1/4] Merging %BRANCH% into main...
git fetch origin || (call :fail "git fetch failed. Check your internet / GitHub login." & exit /b 1)
git checkout main || (call :fail "Could not switch to main." & exit /b 1)
git pull --ff-only origin main || (call :fail "Local main has diverged from GitHub. Resolve that first." & exit /b 1)
git merge-base --is-ancestor origin/%BRANCH% HEAD
if errorlevel 1 (
  git merge --no-ff origin/%BRANCH% -m "Merge OMEGA stack + Cortex LLM gateway (PR #1, #2)"
  if errorlevel 1 (
    git merge --abort >nul 2>&1
    call :fail "Merge conflict. Nothing was changed; tell OMEGA PRIME and it will resolve it."
    exit /b 1
  )
  git push origin main || (call :fail "Merged locally but push to GitHub failed. Run: git push origin main" & exit /b 1)
  echo       merged and pushed. GitHub marks PR #1 and #2 as merged.
) else (
  echo       already merged, skipping.
)

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
  "$lines=Get-Content .env | ForEach-Object { $l=$_; foreach($k in $keys){ if($l -eq \"$k=\"){ $b=New-Object byte[] 32; $rng.GetBytes($b); $l=\"$k=\"+(($b|ForEach-Object{$_.ToString('x2')}) -join '') } }; $l };" ^
  "[IO.File]::WriteAllLines((Resolve-Path .env), $lines)" || (call :fail "Could not write .env" & exit /b 1)
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
docker compose up -d --build || (call :fail "docker compose failed. See the output above." & exit /b 1)

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
echo     The local model keeps downloading in the background
echo     the first time ^(docker compose logs -f ollama-pull^).
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
