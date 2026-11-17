# first-boot guest helper: static IP on farm switch + steam library paths
param(
  [Parameter(Mandatory = $true)][int]$SlotOctet,
  [string]$Gateway = "10.250.0.1",
  [string]$Prefix = "24",
  [string]$IfAlias = ""
)

$ErrorActionPreference = "Stop"
if ($SlotOctet -lt 10 -or $SlotOctet -gt 250) { throw "SlotOctet 10..250" }
$ip = "10.250.0.$SlotOctet"

$nic = if ($IfAlias) {
  Get-NetAdapter -Name $IfAlias
} else {
  Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.InterfaceDescription -notmatch "Loopback" } | Select-Object -First 1
}
if (-not $nic) { throw "no nic" }

Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like "10.250.0.*" -or $_.PrefixOrigin -eq "Dhcp" } |
  ForEach-Object { Remove-NetIPAddress -IPAddress $_.IPAddress -Confirm:$false -ErrorAction SilentlyContinue }

New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $ip -PrefixLength ([int]$Prefix) -DefaultGateway $Gateway -ErrorAction SilentlyContinue | Out-Null
Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ServerAddresses "1.1.1.1","8.8.8.8" -ErrorAction SilentlyContinue
Write-Output "guest ip $ip on $($nic.Name)"
Write-Output "ping host: ping $Gateway"
