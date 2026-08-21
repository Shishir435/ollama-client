@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo olc: Node.js 22.12 or newer is required. 1>&2
  exit /b 1
)
node "%~dp0..\dist\olc.mjs" %*
