# create empty golden gen2 vm shell. attach your win10 iso and install once (prefer ltsc/iot, not win11).
param(
  [string]$Name = $env:FARM_GOLDEN,
  [string]$Root = $env:FARM_VM_ROOT,
  [string]$Switch = $env:FARM_SWITCH,
  [string]$Iso = $env:FARM_ISO,
  [int]$DiskGB = 80,
  [int]$StartupMB = 2048,
  [int]$MinMB = 1024,
  [int]$MaxMB = 4096,
  [int]$Cpu = 2
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
  throw "Hyper-V PowerShell missing. Run setup-hyperv.bat as admin."
}
if (-not $Name) { $Name = "csfarm-golden" }
if (-not $Root) { $Root = "D:\FarmVMs" }
if (-not $Switch) { $Switch = "csfarm-int" }

New-Item -ItemType Directory -Force -Path $Root | Out-Null
$dir = Join-Path $Root $Name
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$sw = Get-VMSwitch -Name $Switch -ErrorAction SilentlyContinue
if (-not $sw) {
  New-VMSwitch -Name $Switch -SwitchType Internal | Out-Null
  Write-Output "switch $Switch"
}

if (Get-VM -Name $Name -ErrorAction SilentlyContinue) {
  Write-Output "golden exists $Name"
  exit 0
}

$vhd = Join-Path $dir "$Name.vhdx"
if (-not (Test-Path $vhd)) {
  New-VHD -Path $vhd -SizeBytes ([uint64]$DiskGB * 1GB) -Dynamic | Out-Null
}

$vm = New-VM -Name $Name -MemoryStartupBytes ([uint64]$StartupMB * 1MB) -Generation 2 -VHDPath $vhd -SwitchName $Switch
Set-VM -VM $vm -CheckpointType Disabled -AutomaticCheckpointsEnabled $false
Set-VMProcessor -VM $vm -Count $Cpu
Set-VMMemory -VM $vm -DynamicMemoryEnabled $true `
  -MinimumBytes ([uint64]$MinMB * 1MB) `
  -StartupBytes ([uint64]$StartupMB * 1MB) `
  -MaximumBytes ([uint64]$MaxMB * 1MB)
Set-VMFirmware -VM $vm -EnableSecureBoot Off -ErrorAction SilentlyContinue

if ($Iso -and (Test-Path $Iso)) {
  Add-VMDvdDrive -VMName $Name -Path $Iso
  $dvd = Get-VMDvdDrive -VMName $Name
  Set-VMFirmware -VMName $Name -FirstBootDevice $dvd
  Write-Output "iso attached $Iso"
} else {
  Write-Output "no iso. set FARM_ISO or Attach DVD in Hyper-V Manager"
}

Write-Output "golden shell ready: $Name (see STRATEGY.md)"
