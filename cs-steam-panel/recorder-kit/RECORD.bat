@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CS Record 30min
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs"

echo.
echo  CS recorder: 30 min, GSI + keys + mouse + screens
echo  Folder: %CD%\sessions
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Installing LTS via winget...
  winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs"
  where node >nul 2>&1
  if errorlevel 1 (
    echo Install Node.js LTS from https://nodejs.org then run RECORD.bat again.
    pause
    exit /b 1
  )
)

set "MINS=30"
if not "%~1"=="" set "MINS=%~1"
set /a FARM_RECORD_MS=%MINS%*60000
if "%FARM_RECORD_MS%"=="0" set "FARM_RECORD_MS=1800000"
echo Duration %MINS% min

echo Installing CS2 GSI cfg (localhost only, no autoexec / crosshair)...
node app\install-gsi.mjs
if errorlevel 1 (
  echo Failed. Need Steam + CS2 installed.
  pause
  exit /b 1
)

echo.
echo If CS2 is already running: close it fully, start CS2, then press a key here.
echo If CS2 was closed: start CS2 now, then press a key.
echo Play normally. This window records. Ctrl+C stops.
echo.
pause

node app\record.mjs
set ERR=%ERRORLEVEL%
echo.
echo Session is in %CD%\sessions
echo Send that folder back.
echo.
pause
exit /b %ERR%
