@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on PATH.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

node server.mjs
if errorlevel 1 (
  echo.
  echo PDF Merger stopped because of an error.
  pause
)
