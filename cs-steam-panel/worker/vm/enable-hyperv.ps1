# enable hyper-v role + management tools (admin). reboot may be required.
$ErrorActionPreference = "Stop"
$features = @(
  "Microsoft-Hyper-V-All",
  "Microsoft-Hyper-V",
  "Microsoft-Hyper-V-Tools-All",
  "Microsoft-Hyper-V-Management-PowerShell"
)
$needReboot = $false
foreach ($f in $features) {
  $cur = Get-WindowsOptionalFeature -Online -FeatureName $f -ErrorAction SilentlyContinue
  if (-not $cur) { continue }
  if ($cur.State -eq "Enabled") {
    Write-Output "ok $f"
    continue
  }
  Write-Output "enable $f"
  $r = Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart
  if ($r.RestartNeeded) { $needReboot = $true }
}
if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
  Write-Output "hyper-v powershell still missing; reboot then rerun"
  exit 2
}
Write-Output "hyper-v ready"
if ($needReboot) {
  Write-Output "REBOOT_REQUIRED"
  exit 3
}
exit 0
