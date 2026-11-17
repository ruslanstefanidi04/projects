@echo off
:: interactive session vision loop: write C:\FarmBootstrap\vision\ every ~2s, never focus windows
cd /d C:\FarmBootstrap
:loop
powershell -NoProfile -ExecutionPolicy Bypass -File C:\FarmBootstrap\guest-shot.ps1 >nul 2>&1
timeout /t 2 /nobreak >nul
goto loop
