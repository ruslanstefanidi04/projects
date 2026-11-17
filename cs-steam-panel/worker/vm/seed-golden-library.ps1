# copy host steamapps (cs2) into golden vhdx once while golden is Off.
# slots cloned after this inherit game files via differencing - no per-slot download.
param(
  [string]$Golden = $env:FARM_GOLDEN,
  [string]$Root = $env:FARM_VM_ROOT,
  [string]$HostSteam = "",
  [string]$GuestSteamRel = "Program Files (x86)\Steam",
  [uint64]$MinVhdGb = 200
)

$ErrorActionPreference = "Stop"
if (-not $Golden) { $Golden = "csfarm-golden" }
if (-not $Root) { $Root = "D:\FarmVMs" }

if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
  throw "Hyper-V missing"
}

function Resolve-CsLibrary {
  param([string]$Hint)
  if ($Hint -and (Test-Path (Join-Path $Hint "steamapps\appmanifest_730.acf"))) {
    return $Hint
  }
  $main = "C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf"
  if (Test-Path $main) {
    $raw = Get-Content $main -Raw
    $matches = [regex]::Matches($raw, '"path"\s+"([^"]+)"')
    foreach ($m in $matches) {
      $p = $m.Groups[1].Value -replace "\\\\", "\"
      if (Test-Path (Join-Path $p "steamapps\appmanifest_730.acf")) { return $p }
    }
  }
  foreach ($p in @("F:\SteamLibrary", "D:\SteamLibrary", "E:\SteamLibrary", "C:\Program Files (x86)\Steam")) {
    if (Test-Path (Join-Path $p "steamapps\appmanifest_730.acf")) { return $p }
  }
  return $null
}

$HostSteam = Resolve-CsLibrary $HostSteam
if (-not $HostSteam) { throw "CS2 library not found on host (appmanifest_730.acf)" }

$vm = Get-VM -Name $Golden -ErrorAction Stop
if ($vm.State -ne "Off") {
  Write-Output "stopping golden for seed..."
  Stop-VM -Name $Golden -Force -TurnOff
  Start-Sleep 2
}

$disk = Get-VMHardDiskDrive -VMName $Golden | Select-Object -First 1
if (-not $disk) { throw "no vhd on golden" }
$vhd = $disk.Path
if (-not (Test-Path $vhd)) { throw "missing $vhd" }

$hostApps = Join-Path $HostSteam "steamapps"
$csManifest = Join-Path $hostApps "appmanifest_730.acf"
$csDir = Join-Path $hostApps "common\Counter-Strike Global Offensive"
if (-not (Test-Path $csDir)) { throw "CS2 folder missing: $csDir" }

$vhdInfo = Get-VHD -Path $vhd
if ($vhdInfo.Size -lt ($MinVhdGb * 1GB)) {
  Write-Output "resize golden vhdx to ${MinVhdGb}GB"
  Resize-VHD -Path $vhd -SizeBytes ($MinVhdGb * 1GB)
}

$mount = Mount-VHD -Path $vhd -Passthru
try {
  $dsk = Get-Disk -Number $mount.Number
  $part = Get-Partition -DiskNumber $dsk.Number | Where-Object { $_.Size -gt 1GB } | Select-Object -First 1
  if (-not $part) { throw "mounted vhd has no large partition" }
  if (-not $part.DriveLetter) {
    $part | Add-PartitionAccessPath -AssignDriveLetter
    $part = Get-Partition -DiskNumber $dsk.Number | Where-Object { $_.Size -gt 1GB } | Select-Object -First 1
  }
  try {
    $max = Get-PartitionSupportedSize -DiskNumber $dsk.Number -PartitionNumber $part.PartitionNumber
    if ($part.Size -lt $max.SizeMax) {
      Resize-Partition -DiskNumber $dsk.Number -PartitionNumber $part.PartitionNumber -Size $max.SizeMax
    }
  } catch {}

  $letter = $part.DriveLetter + ":"
  $destSteam = Join-Path $letter $GuestSteamRel
  $destApps = Join-Path $destSteam "steamapps"
  $destCommon = Join-Path $destApps "common"
  New-Item -ItemType Directory -Force -Path $destCommon | Out-Null
  Write-Output "seed from $HostSteam -> $destApps"

  Copy-Item -Force $csManifest (Join-Path $destApps "appmanifest_730.acf")
  $destCs = Join-Path $destCommon "Counter-Strike Global Offensive"
  $rc = Start-Process -FilePath robocopy -ArgumentList @(
    $csDir, $destCs,
    "/E", "/XO", "/R:2", "/W:2", "/MT:16",
    "/XD", "downloading", "temp", "shadercache"
  ) -Wait -PassThru -NoNewWindow
  if ($rc.ExitCode -ge 8) { throw "robocopy failed $($rc.ExitCode)" }

  foreach ($wipe in @("userdata", "config\loginusers.vdf", "config\config.vdf")) {
    $p = Join-Path $destSteam $wipe
    if (Test-Path $p) {
      Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
      Write-Output "cleared $wipe"
    }
  }
  Write-Output "seed ok"
} finally {
  Dismount-VHD -Path $vhd -ErrorAction SilentlyContinue
}
