@echo off
cd /d "%~dp0"
title CS Farm
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs"
if "%~1"=="" (
  node worker\farm.mjs
  goto :eof
)
node worker\farm.mjs %*
