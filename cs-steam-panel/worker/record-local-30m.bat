@echo off
REM full local record: GSI + keys + mouse + screens + radar CV + audio
cd /d C:\root\prgt\external\projects\cs-steam-panel\worker
set FARM_RECORD_MS=1800000
set FARM_RECORD_KEY_MS=50
set FARM_RECORD_FRAME_MS=2000
set FARM_RECORD_CV=1
set FARM_RECORD_AUDIO=1
set BOT_GSI_PORT=32222
set BOT_GSI_TOKEN=csfarm
set GSI_HOST=127.0.0.1
set FARM_HUMAN_DIR=D:\FarmVMs\ops\vision\human-record

echo Install GSI into local CS2 cfg (safe to re-run)...
node install-local-gsi.mjs
if errorlevel 1 (
  echo FAILED: CS2 cfg not found
  pause
  exit /b 1
)

echo.
echo Play COMPETITIVE (or casual) matchmaking - NOT deathmatch.
echo 1) Start CS2, JOIN A LIVE MM MATCH, start playing
echo 2) Come back here and press any key to START 30min recording
pause

node record-local.mjs
echo done - session under D:\FarmVMs\ops\vision\human-record\local-*
pause
