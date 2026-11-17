# attach host GPU partition to farm VM (hyped-farm path: real GPU in guest)
param(
  [string]$VmName = "csfarm-golden",
  [string]$GpuName = "",
  [int]$RamGB = 8
)

$ErrorActionPreference = "Stop"
$log = "D:\FarmVMs\ops\gpu-pv.log"
Start-Transcript $log -Force | Out-Null
Import-Module Hyper-V

$vm = Get-VM -Name $VmName -ErrorAction Stop
Write-Output "vm=$($vm.Name) state=$($vm.State)"

# GPU-PV incompatible with dynamic memory
if ($vm.State -ne "Off") {
  Write-Output "stopping vm"
  Stop-VM -Name $VmName -Force -TurnOff
  Start-Sleep 3
}

# prefer discrete AMD/NVIDIA over Basic/Hyper-V
$gpus = Get-VMHostPartitionableGpu -ErrorAction SilentlyContinue
if (-not $gpus) {
  # older alias
  $gpus = Get-VMPartitionableGpu -ErrorAction SilentlyContinue
}
Write-Output ("partitionable=" + (($gpus | ForEach-Object { $_.Name }) -join ", "))
if (-not $gpus) { throw "no partitionable GPU (GPU-PV unsupported on this host/driver)" }

$pick = $null
if ($GpuName) { $pick = $gpus | Where-Object { $_.Name -match [regex]::Escape($GpuName) } | Select-Object -First 1 }
if (-not $pick) {
  $pick = $gpus | Where-Object { $_.Name -match "AMD|Radeon|NVIDIA|GeForce|RTX|GTX" } | Select-Object -First 1
}
if (-not $pick) { $pick = @($gpus)[0] }
Write-Output "using gpu=$($pick.Name)"

# remove old adapters
Get-VMGpuPartitionAdapter -VMName $VmName -ErrorAction SilentlyContinue | Remove-VMGpuPartitionAdapter -ErrorAction SilentlyContinue

Add-VMGpuPartitionAdapter -VMName $VmName
# assign instance if cmdlet supports it
try {
  Set-VMGpuPartitionAdapter -VMName $VmName -MinPartitionVRAM 80000000 -MaxPartitionVRAM 1000000000 -OptimalPartitionVRAM 1000000000 `
    -MinPartitionEncode 80000000 -MaxPartitionEncode 1000000000 -OptimalPartitionEncode 1000000000 `
    -MinPartitionDecode 80000000 -MaxPartitionDecode 1000000000 -OptimalPartitionDecode 1000000000 `
    -MinPartitionCompute 80000000 -MaxPartitionCompute 1000000000 -OptimalPartitionCompute 1000000000
} catch {
  Write-Output ("Set-VMGpuPartitionAdapter warn: " + $_.Exception.Message)
}

Set-VM -Name $VmName -GuestControlledCacheTypes $true -ErrorAction SilentlyContinue
try { Set-VM -Name $VmName -LowMemoryMappedIoSpace 1GB } catch {}
try { Set-VM -Name $VmName -HighMemoryMappedIoSpace 32GB } catch {}

# fixed RAM for GPU-PV
Set-VMMemory -VMName $VmName -DynamicMemoryEnabled $false -StartupBytes ([int64]$RamGB * 1GB)
Write-Output "ram fixed ${RamGB}GB dyn=off"

# automatic checkpoint off (safer for gpu-p)
Set-VM -Name $VmName -AutomaticCheckpointsEnabled $false -ErrorAction SilentlyContinue

Start-VM -Name $VmName
Write-Output "started"

$deadline = (Get-Date).AddMinutes(4)
do {
  Start-Sleep 5
  try {
    $p = (Invoke-WebRequest -UseBasicParsing http://10.250.0.10:39200/ping -TimeoutSec 3).Content
    Write-Output "AGENT $p"
    break
  } catch { Write-Output "wait agent" }
} while ((Get-Date) -lt $deadline)

$cred = New-Object PSCredential("farm", (ConvertTo-SecureString "FarmPass1!" -AsPlainText -Force))
try {
  $s = New-PSSession -VMName $VmName -Credential $cred
  $gpuGuest = Invoke-Command -Session $s -ScriptBlock {
    Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, AdapterRAM | ConvertTo-Json -Compress
  }
  Remove-PSSession $s
  Write-Output "GUEST_GPU $gpuGuest"
} catch {
  Write-Output ("psd: " + $_.Exception.Message)
}

Write-Output "GPU_PV_OK"
Stop-Transcript | Out-Null
