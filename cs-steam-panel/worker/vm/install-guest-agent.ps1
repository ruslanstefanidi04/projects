# run inside golden guest once (admin). installs node if needed, registers agent autostart.
param(
  [string]$RepoAgent = "",
  [int]$Port = 39200,
  [string]$Token = $env:FARM_AGENT_TOKEN
)

$ErrorActionPreference = "Stop"
if (-not $Token) { $Token = "csfarm" }

$destDir = "C:\FarmAgent"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$src = $RepoAgent
if (-not $src -or -not (Test-Path $src)) {
  $src = Join-Path $PSScriptRoot "guest-agent.mjs"
}
if (-not (Test-Path $src)) { throw "guest-agent.mjs not found: $src" }
Copy-Item -Force $src (Join-Path $destDir "guest-agent.mjs")

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$node = if ($nodeCmd) { $nodeCmd.Source } else { "" }
if (-not $node) {
  Write-Output "install node lts"
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $node = if ($nodeCmd) { $nodeCmd.Source } else { "" }
}
if (-not $node) { throw "node missing after install" }

$launcher = Join-Path $destDir "run-agent.cmd"
@"
@echo off
set FARM_AGENT_PORT=$Port
set FARM_AGENT_TOKEN=$Token
set FARM_ALLOW_CS=0
"$node" "$destDir\guest-agent.mjs"
"@ | Set-Content -Encoding ASCII $launcher

$task = "CSFarmGuestAgent"
schtasks /Delete /TN $task /F 2>$null | Out-Null
schtasks /Create /TN $task /SC ONLOGON /RL HIGHEST /TR $launcher /F | Out-Null
Write-Output "scheduled $task"
Write-Output "start now"
Start-Process -FilePath $launcher -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
  $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/ping" -TimeoutSec 3
  Write-Output "agent ping $($r.Content)"
} catch {
  Write-Output "agent not answering yet; reboot guest once"
}
Write-Output "done. shut down golden, then clone slots from host"
