// farm host net: Happ/wintun safe. only Default Switch + csfarm-int by exact name.
import { runHostOps } from "./ops.mjs";

/** park Hyper-V farm + default switch so Happ/wintun can work */
export async function vpnSafeHyperV() {
  const body = `
$ErrorActionPreference = "Continue"
$out = "D:\\FarmVMs\\ops\\see-out.txt"
function W($m){ $m | Add-Content $out }
"" | Set-Content $out
W "=== vpn-safe $(Get-Date -Format o) ==="
Import-Module Hyper-V
foreach ($name in @("vEthernet (Default Switch)", "vEthernet (csfarm-int)")) {
  $a = Get-NetAdapter -Name $name -EA SilentlyContinue
  if ($a -and $a.Status -eq "Up") {
    Disable-NetAdapter -Name $name -Confirm:$false
    W "down $name"
  } else { W "ok $name already down/missing" }
}
if (Get-NetNat -Name "csfarm-nat" -EA SilentlyContinue) {
  Remove-NetNat -Name "csfarm-nat" -Confirm:$false
  W "removed csfarm-nat"
}
try { Set-VMHost -EnableEnhancedSessionMode $false } catch {}
W "DONE"
`;
  return runHostOps(body, { marker: "DONE", timeoutMs: 120000 });
}

/**
 * host <-> guest LAN only (10.250.0.0/24). never Default Switch, never NetNat.
 * safe with Happ/v2ray/wintun: guest has no internet via host, only agent/GSI.
 */
export async function farmLanOn() {
  const body = `
$ErrorActionPreference = "Continue"
$out = "D:\\FarmVMs\\ops\\see-out.txt"
function W($m){ $m | Add-Content $out }
"" | Set-Content $out
W "=== farm-lan-on $(Get-Date -Format o) ==="
Import-Module Hyper-V
$d = Get-NetAdapter -Name "vEthernet (Default Switch)" -EA SilentlyContinue
if ($d -and $d.Status -eq "Up") { Disable-NetAdapter -Name $d.Name -Confirm:$false; W "forced default down" }
if (Get-NetNat -Name "csfarm-nat" -EA SilentlyContinue) {
  Remove-NetNat -Name "csfarm-nat" -Confirm:$false
  W "removed csfarm-nat (vpn-safe)"
}
if (-not (Get-VMSwitch -Name "csfarm-int" -EA SilentlyContinue)) {
  New-VMSwitch -Name csfarm-int -SwitchType Internal | Out-Null
}
$v = Get-NetAdapter -Name "vEthernet (csfarm-int)" -EA SilentlyContinue
if ($v) {
  if ($v.Status -ne "Up") { Enable-NetAdapter -Name $v.Name -Confirm:$false }
  $has = Get-NetIPAddress -InterfaceIndex $v.ifIndex -AddressFamily IPv4 -EA SilentlyContinue |
    Where-Object { $_.IPAddress -eq "10.250.0.1" }
  if (-not $has) {
    New-NetIPAddress -InterfaceIndex $v.ifIndex -IPAddress 10.250.0.1 -PrefixLength 24 -EA SilentlyContinue | Out-Null
  }
  W "lan $($v.Name) up 10.250.0.1 no-nat"
} else { W "NO_vnic" }
W "DONE"
`;
  return runHostOps(body, { marker: "DONE", timeoutMs: 120000 });
}

/** full guest internet via NetNat - fights some VPNs; only if user asks */
export async function farmNetOn() {
  const body = `
$ErrorActionPreference = "Continue"
$out = "D:\\FarmVMs\\ops\\see-out.txt"
function W($m){ $m | Add-Content $out }
"" | Set-Content $out
W "=== farm-net-on $(Get-Date -Format o) ==="
Import-Module Hyper-V
$d = Get-NetAdapter -Name "vEthernet (Default Switch)" -EA SilentlyContinue
if ($d -and $d.Status -eq "Up") { Disable-NetAdapter -Name $d.Name -Confirm:$false; W "forced default down" }

if (-not (Get-VMSwitch -Name "csfarm-int" -EA SilentlyContinue)) {
  New-VMSwitch -Name csfarm-int -SwitchType Internal | Out-Null
}
$v = Get-NetAdapter -Name "vEthernet (csfarm-int)" -EA SilentlyContinue
if ($v) {
  if ($v.Status -ne "Up") { Enable-NetAdapter -Name $v.Name -Confirm:$false }
  $has = Get-NetIPAddress -InterfaceIndex $v.ifIndex -AddressFamily IPv4 -EA SilentlyContinue |
    Where-Object { $_.IPAddress -eq "10.250.0.1" }
  if (-not $has) {
    New-NetIPAddress -InterfaceIndex $v.ifIndex -IPAddress 10.250.0.1 -PrefixLength 24 -EA SilentlyContinue | Out-Null
  }
}
if (-not (Get-NetNat -Name "csfarm-nat" -EA SilentlyContinue)) {
  New-NetNat -Name csfarm-nat -InternalIPInterfaceAddressPrefix "10.250.0.0/24" | Out-Null
}
W "farm net on WITH nat"
W "DONE"
`;
  return runHostOps(body, { marker: "DONE", timeoutMs: 120000 });
}

export async function farmNetOff() {
  return vpnSafeHyperV();
}
