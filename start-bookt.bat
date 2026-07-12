@echo off
title BookT Launcher
cd /d "%~dp0"

echo ============================================
echo   Starting BookT...
echo ============================================
echo.

REM --- If it's already running, just open it ---
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:3001 -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo BookT is already running - opening it in your browser...
  start "" "http://localhost:3001"
  exit
)

REM --- Local AI service (translation + audio sync) ---
start "BookT AI service" cmd /k "python scripts\local_ai_service.py"

REM --- Web app (Next.js) ---
start "BookT app" cmd /k "npm run dev -- -p 3001"

echo Waiting for the app to start (first launch can take ~30s)...
set /a tries=0
:waitloop
ping -n 3 127.0.0.1 >nul
set /a tries+=1
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:3001 -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto ready
if %tries% GEQ 60 goto ready
goto waitloop

:ready
echo Opening BookT in your browser...
start "" "http://localhost:3001"
exit
