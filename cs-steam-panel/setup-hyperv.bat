@echo off
net session >nul 2>&1
if errorlevel 1 (
  echo need admin - UAC prompt next
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
rem load farm env
if exist "worker\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b "FARM_" "worker\.env"`) do set "%%A=%%B"
)
echo CS Farm Hyper-V setup (VM only, no Sandboxie)
powershell -NoProfile -ExecutionPolicy Bypass -File "worker\vm\setup-farm-vm.ps1"
set ERR=%ERRORLEVEL%
if %ERR%==3 (
  echo.
  echo === REBOOT NOW, then run setup-hyperv.bat again ===
)
exit /b %ERR%
