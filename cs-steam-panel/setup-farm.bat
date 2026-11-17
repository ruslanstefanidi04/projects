@echo off
net session >nul 2>&1
if errorlevel 1 (
  echo need admin - UAC next
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
echo CS Farm bootstrap for this PC
echo checks: disk, Hyper-V, Node, Win10 ISO/WIM, golden VM
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0worker\vm\bootstrap.ps1"
set ERR=%ERRORLEVEL%
if %ERR%==3 (
  echo.
  echo === REBOOT, then run setup-farm.bat again ===
  pause
  exit /b 3
)
if %ERR% neq 0 (
  echo bootstrap failed %ERR%
  pause
  exit /b %ERR%
)
echo.
echo ok. next: worker.bat
pause
