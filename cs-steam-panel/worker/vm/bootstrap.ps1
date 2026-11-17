# one-shot host bootstrap for any PC: pick disk, hyper-v, iso/wim, golden, env, node
param(
  [switch]$SkipIso,
  [switch]$SkipApply,
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $RepoRoot "worker\package.json"))) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}
$VmDir = Join-Path $RepoRoot "worker\vm"
$EnvFile = Join-Path $RepoRoot "worker\.env"
$Log = Join-Path $env:TEMP ("csfarm-bootstrap-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
Start-Transcript -Path $Log -Force | Out-Null

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "need admin. run setup-farm.bat"
  }
}

function Get-BestFarmRoot {
  $vols = Get-Volume | Where-Object {
    $_.DriveLetter -and $_.SizeRemaining -gt 40GB -and $_.FileSystemLabel -notmatch "Recovery|System"
  }
  if (-not $vols) { throw "no disk with >=40GB free" }
  $ranked = $vols | Sort-Object SizeRemaining -Descending
  $best = $ranked | Where-Object { $_.DriveLetter -ne "C" } | Select-Object -First 1
  if (-not $best) { $best = $ranked | Select-Object -First 1 }
  $root = "$($best.DriveLetter):\FarmVMs"
  Write-Host ("disk pick $($best.DriveLetter): freeGB=" + [math]::Round($best.SizeRemaining / 1GB, 1) + " -> $root")
  return $root
}

function Set-EnvKey([string]$key, [string]$val) {
  $lines = @()
  if (Test-Path $EnvFile) {
    $lines = Get-Content $EnvFile
  }
  $hit = $false
  $out = foreach ($line in $lines) {
    if ($line -match ("^" + [regex]::Escape($key) + "=")) {
      $hit = $true
      "$key=$val"
    } else { $line }
  }
  if (-not $hit) { $out = @($out) + "$key=$val" }
  if (-not (Test-Path (Split-Path $EnvFile))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $EnvFile) | Out-Null
  }
  Set-Content -Path $EnvFile -Value $out -Encoding UTF8
}

function Ensure-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    Write-Output ("node ok " + $node.Source)
    return
  }
  Write-Output "install node lts via winget"
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node install failed" }
}

function Ensure-WorkerNpm {
  $mods = Join-Path $RepoRoot "worker\node_modules"
  if (Test-Path $mods) {
    Write-Output "worker node_modules ok"
    return
  }
  Write-Output "npm install worker"
  Push-Location (Join-Path $RepoRoot "worker")
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  } finally { Pop-Location }
}

function Ensure-Fido([string]$tools) {
  $fido = Join-Path $tools "Fido.ps1"
  if (-not (Test-Path $fido)) {
    Write-Output "download Fido.ps1"
    Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/pbatard/Fido/master/Fido.ps1" -OutFile $fido
  }
  return $fido
}

function Ensure-Win10Iso([string]$isoPath, [string]$fido) {
  if ((Test-Path $isoPath) -and ((Get-Item $isoPath).Length -gt 4GB)) {
    Write-Output ("iso ok " + (Get-Item $isoPath).Length)
    return
  }
  Write-Output "download Win10 ISO (long) -> $isoPath"
  New-Item -ItemType Directory -Force -Path (Split-Path $isoPath) | Out-Null
  $url = (& powershell -NoProfile -ExecutionPolicy Bypass -File $fido -Win 10 -Rel Latest -Ed "Windows 10 Home/Pro/Edu" -Lang English -Arch x64 -GetUrl | Select-Object -Last 1).ToString().Trim()
  if ($url -notmatch "^https://") { throw "fido url failed" }
  $curl = Join-Path $env:SystemRoot "System32\curl.exe"
  if (Test-Path $curl) {
    & $curl -L --retry 8 --retry-all-errors --connect-timeout 30 -o $isoPath $url
  } else {
    Import-Module BitsTransfer
    Start-BitsTransfer -Source $url -Destination $isoPath -DisplayName "CSFarm-Win10ISO" -Priority Foreground
  }
  if (-not (Test-Path $isoPath) -or ((Get-Item $isoPath).Length -lt 4GB)) { throw "iso download failed" }
  Write-Output ("iso done " + (Get-Item $isoPath).Length)
}

function Ensure-ProWim([string]$isoPath, [string]$proWim) {
  if ((Test-Path $proWim) -and ((Get-Item $proWim).Length -gt 2GB)) {
    Write-Output ("pro.wim ok " + (Get-Item $proWim).Length)
    return
  }
  Write-Output "export pro.wim from iso"
  $img = Mount-DiskImage -ImagePath $isoPath -PassThru
  try {
    Start-Sleep 2
    $letter = (Get-Volume -DiskImage $img | Where-Object DriveLetter | Select-Object -First 1).DriveLetter
    $wim = "${letter}:\sources\install.wim"
    if (-not (Test-Path $wim)) { throw "install.wim missing in iso" }
    Remove-Item $proWim -Force -ErrorAction SilentlyContinue
    $p = Start-Process dism.exe -ArgumentList @("/Export-Image", "/SourceImageFile:$wim", "/SourceIndex:6", "/DestinationImageFile:$proWim", "/Compress:fast") -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -ne 0) { throw "dism export failed $($p.ExitCode)" }
  } finally {
    Dismount-DiskImage -ImagePath $isoPath -ErrorAction SilentlyContinue | Out-Null
  }
  Write-Output ("pro.wim done " + (Get-Item $proWim).Length)
}

function Ensure-HyperV {
  & (Join-Path $VmDir "enable-hyperv.ps1")
  $code = $LASTEXITCODE
  if ($code -eq 3) {
    Write-Output "REBOOT_REQUIRED"
    return 3
  }
  if ($code -eq 2) { throw "hyper-v tools missing after enable; reboot" }
  if ($code -ne 0) { throw "hyper-v enable failed $code" }
  Import-Module Hyper-V -ErrorAction Stop
  return 0
}

function Ensure-Switch([string]$name) {
  if (-not (Get-VMSwitch -Name $name -ErrorAction SilentlyContinue)) {
    New-VMSwitch -Name $name -SwitchType Internal | Out-Null
    Write-Output "switch $name"
  }
  $ifAlias = "vEthernet ($name)"
  $nic = Get-NetAdapter -Name $ifAlias -ErrorAction SilentlyContinue
  if ($nic) {
    $ip = Get-NetIPAddress -InterfaceAlias $ifAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -like "10.250.0.*" }
    if (-not $ip) {
      New-NetIPAddress -InterfaceAlias $ifAlias -IPAddress 10.250.0.1 -PrefixLength 24 -ErrorAction SilentlyContinue | Out-Null
    }
  }
  $natName = "csfarm-nat"
  if (-not (Get-NetNat -Name $natName -ErrorAction SilentlyContinue)) {
    try {
      New-NetNat -Name $natName -InternalIPInterfaceAddressPrefix "10.250.0.0/24" | Out-Null
      Write-Output "nat $natName"
    } catch {
      Write-Output ("nat skip: " + $_.Exception.Message)
    }
  }
}

function Ensure-Golden([string]$root, [string]$name, [string]$switch, [int]$diskGb) {
  $dir = Join-Path $root $name
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $vhd = Join-Path $dir "$name.vhdx"
  $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
  if (-not $vm) {
    if (-not (Test-Path $vhd)) {
      New-VHD -Path $vhd -SizeBytes ([uint64]$diskGb * 1GB) -Dynamic | Out-Null
    }
    $vm = New-VM -Name $name -MemoryStartupBytes 2GB -Generation 2 -VHDPath $vhd -SwitchName $switch
    Set-VM -VM $vm -CheckpointType Disabled -AutomaticCheckpointsEnabled $false
    Set-VMProcessor -VM $vm -Count 2
    Set-VMMemory -VM $vm -DynamicMemoryEnabled $true -MinimumBytes 1GB -StartupBytes 2GB -MaximumBytes 4GB
    Set-VMFirmware -VM $vm -EnableSecureBoot Off
    Write-Output "created golden $name"
  } else {
    Write-Output "golden exists $name state=$($vm.State)"
  }
  return $vhd
}

function Test-GoldenHasWindows([string]$vhd) {
  if (-not (Test-Path $vhd)) { return $false }
  if ((Get-Item $vhd).Length -lt 1GB) { return $false }
  try {
    $m = Mount-VHD -Path $vhd -Passthru -ErrorAction Stop
    try {
      $parts = Get-Partition -DiskNumber $m.Number -ErrorAction SilentlyContinue
      foreach ($p in $parts) {
        if ($p.Size -lt 1GB) { continue }
        $vol = Get-Volume -Partition $p -ErrorAction SilentlyContinue
        if (-not $vol.DriveLetter) { continue }
        $win = "$($vol.DriveLetter):\Windows\System32\ntoskrnl.exe"
        if (Test-Path $win) { return $true }
      }
      return $false
    } finally {
      Dismount-VHD -Path $vhd -ErrorAction SilentlyContinue
    }
  } catch {
    return $false
  }
}

Assert-Admin
Write-Output "repo $RepoRoot"
Write-Output "log $Log"

$farmRoot = $env:FARM_VM_ROOT
if ($farmRoot -and $farmRoot -match "^([A-Za-z]):") {
  $dl = $Matches[1]
  if (-not (Get-PSDrive -Name $dl -ErrorAction SilentlyContinue)) { $farmRoot = $null }
}
if (-not $farmRoot) { $farmRoot = Get-BestFarmRoot }

$golden = "csfarm-golden"
$switch = "csfarm-int"
$iso = Join-Path $farmRoot "iso\Win10_22H2_English_x64.iso"
$proWim = Join-Path $farmRoot "iso\pro.wim"
$tools = Join-Path $farmRoot "tools"
$diskGb = 80

New-Item -ItemType Directory -Force -Path $farmRoot, (Join-Path $farmRoot "iso"), $tools | Out-Null

Set-EnvKey "FARM_ISOLATION" "vm"
Set-EnvKey "FARM_ALLOW_CS" "0"
Set-EnvKey "FARM_VM_ROOT" $farmRoot
Set-EnvKey "FARM_GOLDEN" $golden
Set-EnvKey "FARM_SWITCH" $switch
Set-EnvKey "FARM_AGENT_PORT" "39200"
Set-EnvKey "FARM_MEM_MIN_MB" "1024"
Set-EnvKey "FARM_MEM_START_MB" "2048"
Set-EnvKey "FARM_MEM_MAX_MB" "4096"
Set-EnvKey "FARM_VCPU" "2"
Set-EnvKey "FARM_DISK_GB" "$diskGb"
Set-EnvKey "FARM_ISO" $iso

$hv = Ensure-HyperV
if ($hv -eq 3) {
  Write-Output "reboot windows, then run setup-farm.bat again"
  if (-not $NoPause) { pause }
  exit 3
}

Ensure-Node
Ensure-WorkerNpm
Ensure-Switch $switch
$vhd = Ensure-Golden $farmRoot $golden $switch $diskGb

# offline guest payload cache
$cache = Join-Path $farmRoot "cache"
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$nodeZip = Join-Path $cache "node-v22.19.0-win-x64.zip"
if (-not (Test-Path $nodeZip) -or ((Get-Item $nodeZip).Length -lt 1MB)) {
  Write-Output "download portable node zip"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip" -OutFile $nodeZip
}
$steamSetup = Join-Path $cache "SteamSetup.exe"
if (-not (Test-Path $steamSetup) -or ((Get-Item $steamSetup).Length -lt 1MB)) {
  Write-Output "download SteamSetup"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe" -OutFile $steamSetup
}
Set-EnvKey "FARM_AGENT_TOKEN" "csfarm"

$fido = Ensure-Fido $tools
if (-not $SkipIso) {
  Ensure-Win10Iso $iso $fido
  Ensure-ProWim $iso $proWim
}

$hasWin = Test-GoldenHasWindows $vhd
Write-Output ("golden has windows: " + $hasWin)
if (-not $hasWin -and -not $SkipApply -and (Test-Path $proWim)) {
  Write-Output "apply pro.wim into golden"
  & (Join-Path $VmDir "apply-from-pro-wim.ps1") -FarmRoot $farmRoot -VmName $golden -ProWim $proWim
}

# host steam hint for later seed
$hostSteam = "C:\Program Files (x86)\Steam\steamapps\appmanifest_730.acf"
if (Test-Path $hostSteam) {
  Write-Output "host CS2 library detected (can seed golden later)"
} else {
  Write-Output "host CS2 not found; install Steam+CS2 on host or inside golden once"
}

Write-Output ""
Write-Output "BOOTSTRAP_OK"
Write-Output "FarmRoot=$farmRoot"
Write-Output "Env=$EnvFile"
Write-Output "Next: worker.bat  (or finish golden OS then seed CS)"
Write-Output "Log=$Log"
Stop-Transcript | Out-Null
if (-not $NoPause) { pause }
exit 0
