@echo off
cd /d "%~dp0"
title CS Farm worker (Hyper-V)
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js missing. Run setup-farm.bat as admin.
  pause
  exit /b 1
)
if not exist "worker\node_modules\" (
  pushd worker
  call npm install
  if errorlevel 1 ( popd & pause & exit /b 1 )
  popd
)

set "FARM_ISOLATION=vm"
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"FARM_ISOLATION=" "worker\.env" 2^>nul`) do set "FARM_ISOLATION=%%B"
if /I not "%FARM_ISOLATION%"=="vm" (
  echo FARM_ISOLATION must be vm. See STRATEGY.md
  pause
  exit /b 1
)

node worker\vm\ensure-host.mjs
if errorlevel 1 (
  echo.
  echo Host not ready. Double-click setup-farm.bat as admin, reboot if asked, rerun.
  pause
  exit /b 1
)

powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 32222 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul
node worker\index.mjs
echo exit %ERRORLEVEL%
pause
