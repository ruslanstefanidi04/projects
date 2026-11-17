# install steam into running golden (admin + PSD)
param(
  [string]$VmName = $(if ($env:FARM_GOLDEN) { $env:FARM_GOLDEN } else { "csfarm-golden" }),
  [string]$FarmRoot = $(if ($env:FARM_VM_ROOT) { $env:FARM_VM_ROOT } else { "D:\FarmVMs" }),
  [string]$AdminUser = "farm",
  [string]$AdminPass = "FarmPass1!"
)

$ErrorActionPreference = "Stop"
Import-Module Hyper-V

$setup = Join-Path $FarmRoot "cache\SteamSetup.exe"
if (-not (Test-Path $setup) -or (Get-Item $setup).Length -lt 1MB) {
  New-Item -ItemType Directory -Force -Path (Split-Path $setup) | Out-Null
  Write-Output "download SteamSetup..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe" -OutFile $setup
}

$cred = New-Object PSCredential($AdminUser, (ConvertTo-SecureString $AdminPass -AsPlainText -Force))
$session = New-PSSession -VMName $VmName -Credential $cred
Invoke-Command -Session $session -ScriptBlock { New-Item -ItemType Directory -Force -Path C:\FarmBootstrap\cache | Out-Null }
Copy-Item -ToSession $session -Path $setup -Destination "C:\FarmBootstrap\cache\SteamSetup.exe" -Force
Invoke-Command -Session $session -ScriptBlock {
  $steam = "${env:ProgramFiles(x86)}\Steam\steam.exe"
  if (-not (Test-Path $steam)) {
    $p = Start-Process "C:\FarmBootstrap\cache\SteamSetup.exe" -ArgumentList "/S" -Wait -PassThru
    Write-Output ("setup exit=" + $p.ExitCode)
    Start-Sleep 2
  }
  Write-Output ("steam=" + (Test-Path $steam))
}
Remove-PSSession $session
Write-Output "STEAM_OK"
