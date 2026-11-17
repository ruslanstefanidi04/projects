# one-shot elevated farm bootstrap: hyper-v + dirs + switch + golden shell
# cs is installed ONCE on golden (or seeded from host steamapps), slots use differencing disks
param(
  [string]$Iso = $env:FARM_ISO,
  [switch]$SkipGolden,
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent (Split-Path -Parent $here)

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "need admin"
  }
}

Assert-Admin

Write-Output "== enable hyper-v =="
& "$here\enable-hyperv.ps1"
$code = $LASTEXITCODE
if ($code -eq 3) {
  Write-Output "REBOOT_REQUIRED"
  if (-not $NoPause) { pause }
  exit 3
}
if ($code -eq 2) {
  Write-Output "reboot then rerun setup-farm-vm.ps1"
  if (-not $NoPause) { pause }
  exit 2
}
if ($code -ne 0) { exit $code }

Import-Module Hyper-V -ErrorAction Stop

$farmRoot = if ($env:FARM_VM_ROOT) { $env:FARM_VM_ROOT } else { "D:\FarmVMs" }
$switch = if ($env:FARM_SWITCH) { $env:FARM_SWITCH } else { "csfarm-int" }
$golden = if ($env:FARM_GOLDEN) { $env:FARM_GOLDEN } else { "csfarm-golden" }
$libShare = Join-Path $farmRoot "SharedSteamLibrary"

New-Item -ItemType Directory -Force -Path $farmRoot | Out-Null
New-Item -ItemType Directory -Force -Path $libShare | Out-Null

# optional: host steamapps mirror for ONE-TIME seed into golden (not live multi-writer share)
$hostSteam = "C:\Program Files (x86)\Steam\steamapps"
if (Test-Path $hostSteam) {
  Write-Output "host steamapps present -> can seed golden later via seed-golden-library.ps1"
}

if (-not (Get-VMSwitch -Name $switch -ErrorAction SilentlyContinue)) {
  New-VMSwitch -Name $switch -SwitchType Internal | Out-Null
  Write-Output "switch $switch"
}

# host side of internal switch: 10.250.0.1/24 for guest agents
$ifAlias = "vEthernet ($switch)"
$nic = Get-NetAdapter -Name $ifAlias -ErrorAction SilentlyContinue
if ($nic) {
  $ip = Get-NetIPAddress -InterfaceAlias $ifAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -like "10.250.0.*" }
  if (-not $ip) {
    New-NetIPAddress -InterfaceAlias $ifAlias -IPAddress 10.250.0.1 -PrefixLength 24 -ErrorAction SilentlyContinue | Out-Null
    Write-Output "host ip 10.250.0.1 on $ifAlias"
  }
}

if (-not $SkipGolden) {
  Write-Output "== golden shell =="
  $args = @{
    Name = $golden
    Root = $farmRoot
    Switch = $switch
    DiskGB = 80
    StartupMB = 2048
    MinMB = 1024
    MaxMB = 4096
    Cpu = 2
  }
  if ($Iso) { $args.Iso = $Iso }
  & "$here\new-golden.ps1" @args
}

Write-Output "DONE. See STRATEGY.md for ISO / golden / slot steps."
if (-not $NoPause) { pause }
