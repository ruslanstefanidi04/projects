@echo off
net session >nul 2>&1
if errorlevel 1 (
  echo need admin - UAC next
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
echo apply pro.wim into golden...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker\vm\apply-from-pro-wim.ps1"
echo exit %ERRORLEVEL%
pause
