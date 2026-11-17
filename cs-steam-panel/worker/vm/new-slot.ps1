# create / refresh thin farm slot from golden differencing disk. no guest boot of cs2.
param(
  [Parameter(Mandatory = $true)][string]$Slot,
  [string]$Golden = $env:FARM_GOLDEN,
  [string]$Root = $env:FARM_VM_ROOT,
  [string]$Switch = $env:FARM_SWITCH,
  [int]$StartupMB = 0,
  [int]$MinMB = 0,
  [int]$MaxMB = 0,
  [int]$Cpu = 0,
  [switch]$Start
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
  throw "Hyper-V PowerShell missing. Run setup-hyperv.bat as admin."
}

if (-not $Golden) { $Golden = "csfarm-golden" }
if (-not $Root) { $Root = "D:\FarmVMs" }
if (-not $Switch) { $Switch = "csfarm-int" }
if ($StartupMB -le 0) { $StartupMB = 2048 }
if ($MinMB -le 0) { $MinMB = 1024 }
if ($MaxMB -le 0) { $MaxMB = 4096 }
if ($Cpu -le 0) { $Cpu = 2 }

$Slot = ($Slot -replace "[^a-zA-Z0-9-]", "").ToLowerInvariant()
if (-not $Slot) { throw "empty slot" }
if ($Slot -notlike "csf-*") { $Slot = "csf-$Slot" }

New-Item -ItemType Directory -Force -Path $Root | Out-Null
$slotDir = Join-Path $Root $Slot
New-Item -ItemType Directory -Force -Path $slotDir | Out-Null

$sw = Get-VMSwitch -Name $Switch -ErrorAction SilentlyContinue
if (-not $sw) {
  Write-Output "create switch $Switch"
  New-VMSwitch -Name $Switch -SwitchType Internal | Out-Null
}

$golden = Get-VM -Name $Golden -ErrorAction SilentlyContinue
if (-not $golden) {
  throw "golden VM '$Golden' missing. Create it once (Win10, steam installed, guest-agent), then rerun."
}
if ($golden.State -ne "Off") {
  throw "golden must be Off before cloning (now $($golden.State))"
}

$gDisk = Get-VMHardDiskDrive -VMName $Golden | Select-Object -First 1
if (-not $gDisk -or -not $gDisk.Path) { throw "golden has no vhd" }
$parent = $gDisk.Path
if (-not (Test-Path $parent)) { throw "golden vhd missing: $parent" }

$child = Join-Path $slotDir "$Slot.vhdx"
$vm = Get-VM -Name $Slot -ErrorAction SilentlyContinue
if ($vm) {
  Write-Output "slot exists $Slot state=$($vm.State)"
} else {
  if (Test-Path $child) { Remove-Item -Force $child }
  Write-Output "diff disk $child <- $parent"
  New-VHD -Path $child -ParentPath $parent -Differencing | Out-Null
  Write-Output "new vm $Slot"
  $vm = New-VM -Name $Slot -MemoryStartupBytes ([uint64]$StartupMB * 1MB) -Generation 2 -VHDPath $child -SwitchName $Switch
  Set-VM -VM $vm -CheckpointType Disabled -AutomaticCheckpointsEnabled $false
  Set-VMProcessor -VM $vm -Count $Cpu
  Set-VMMemory -VM $vm -DynamicMemoryEnabled $true `
    -MinimumBytes ([uint64]$MinMB * 1MB) `
    -StartupBytes ([uint64]$StartupMB * 1MB) `
    -MaximumBytes ([uint64]$MaxMB * 1MB)
  # headless farm: no secure boot fuss with mixed isos
  Set-VMFirmware -VM $vm -EnableSecureBoot Off -ErrorAction SilentlyContinue
  Write-Output "created $Slot"
}

Set-VMMemory -VMName $Slot -DynamicMemoryEnabled $true `
  -MinimumBytes ([uint64]$MinMB * 1MB) `
  -StartupBytes ([uint64]$StartupMB * 1MB) `
  -MaximumBytes ([uint64]$MaxMB * 1MB) -ErrorAction SilentlyContinue
Set-VMProcessor -VMName $Slot -Count $Cpu -ErrorAction SilentlyContinue

if ($Start) {
  if ((Get-VM -Name $Slot).State -eq "Off") {
    Start-VM -Name $Slot
    Write-Output "started $Slot"
  } else {
    Write-Output "already running $Slot"
  }
}

$info = Get-VM -Name $Slot | Select-Object Name, State, @{n="MemMB";e={[int]($_.MemoryAssigned/1MB)}}, CPUUsage
Write-Output ("ready " + ($info | ConvertTo-Json -Compress))
