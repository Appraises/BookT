@echo off
title Stop BookT
echo Stopping BookT (app on port 3001, AI service on port 8000)...

for %%P in (3001 8000) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
    taskkill /PID %%A /F >nul 2>&1
  )
)

echo Done. You can close this window.
ping -n 4 127.0.0.1 >nul
