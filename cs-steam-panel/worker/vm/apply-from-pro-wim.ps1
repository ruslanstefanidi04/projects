# apply verified pro.wim into golden vhdx and start vm
param(
  [string]$FarmRoot = $(if ($env:FARM_VM_ROOT) { $env:FARM_VM_ROOT } else { "D:\FarmVMs" }),
  [string]$VmName = $(if ($env:FARM_GOLDEN) { $env:FARM_GOLDEN } else { "csfarm-golden" }),
  [string]$ProWim = "",
  [string]$AdminPass = "FarmPass1!",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
Import-Module Hyper-V

if (-not $ProWim) { $ProWim = Join-Path $FarmRoot "iso\pro.wim" }
$vhdPath = Join-Path $FarmRoot "$VmName\$VmName.vhdx"
$repoVm = $PSScriptRoot
if (-not (Test-Path $ProWim)) { throw "pro.wim missing: $ProWim" }

Write-Output "apply $ProWim -> $vhdPath"

Dismount-VHD -Path $vhdPath -ErrorAction SilentlyContinue
Start-Sleep 1
$vm = Get-VM -Name $VmName -ErrorAction Stop
if ($vm.State -ne "Off") { Stop-VM -Name $VmName -Force -TurnOff }

Get-VMHardDiskDrive -VMName $VmName | Remove-VMHardDiskDrive -ErrorAction SilentlyContinue
Remove-Item $vhdPath -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Split-Path $vhdPath) | Out-Null
New-VHD -Path $vhdPath -SizeBytes 80GB -Dynamic | Out-Null
Add-VMHardDiskDrive -VMName $VmName -Path $vhdPath

$vhd = Mount-VHD -Path $vhdPath -Passthru
$disk = Get-Disk -Number $vhd.Number
Initialize-Disk -Number $disk.Number -PartitionStyle GPT
$efi = New-Partition -DiskNumber $disk.Number -Size 260MB -GptType "{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}" -AssignDriveLetter
Format-Volume -Partition $efi -FileSystem FAT32 -NewFileSystemLabel SYS -Confirm:$false | Out-Null
New-Partition -DiskNumber $disk.Number -Size 16MB -GptType "{e3c9e316-0b5c-4db8-817d-f92df00215ae}" | Out-Null
$win = New-Partition -DiskNumber $disk.Number -UseMaximumSize -GptType "{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}" -AssignDriveLetter
Format-Volume -Partition $win -FileSystem NTFS -NewFileSystemLabel Windows -Confirm:$false | Out-Null

$efiL = (Get-Partition -DiskNumber $disk.Number | Where-Object { $_.GptType -eq "{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}" } | Get-Volume).DriveLetter.ToString() + ":"
$winL = (Get-Partition -DiskNumber $disk.Number | Where-Object { $_.Size -gt 1GB } | Get-Volume).DriveLetter.ToString() + ":"
Write-Output "efi $efiL win $winL"

# exported pro.wim usually has single index 1
$idx = 1
$info = (dism /Get-WimInfo /WimFile:$ProWim) | Out-String
if ($info -match "Index : 6") { $idx = 6 }
Write-Output "dism apply index $idx"
$p = Start-Process dism.exe -ArgumentList @("/Apply-Image", "/ImageFile:$ProWim", "/Index:$idx", "/ApplyDir:${winL}\") -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "dism apply failed $($p.ExitCode)" }

& bcdboot "${winL}\Windows" /s $efiL /f UEFI | Out-Null

function Enc([string]$plain, [string]$suffix) {
  [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($plain + $suffix))
}
New-Item -ItemType Directory -Force -Path (Join-Path $winL "Windows\Panther") | Out-Null
$xml = @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>
      <UserAccounts>
        <AdministratorPassword><Value>$(Enc $AdminPass AdministratorPassword)</Value><PlainText>false</PlainText></AdministratorPassword>
        <LocalAccounts>
          <LocalAccount>
            <Password><Value>$(Enc $AdminPass Password)</Value><PlainText>false</PlainText></Password>
            <Name>farm</Name><Group>Administrators</Group><DisplayName>farm</DisplayName>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
      <AutoLogon>
        <Password><Value>$(Enc $AdminPass Password)</Value><PlainText>false</PlainText></Password>
        <Enabled>true</Enabled><Username>farm</Username><LogonCount>999999</LogonCount>
      </AutoLogon>
      <ComputerName>CSFARM-GOLDEN</ComputerName>
      <FirstLogonCommands>
        <SynchronousCommand>
          <Order>1</Order>
          <CommandLine>powershell -NoProfile -ExecutionPolicy Bypass -File C:\FarmBootstrap\first-boot.ps1</CommandLine>
        </SynchronousCommand>
      </FirstLogonCommands>
    </component>
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale>
    </component>
  </settings>
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <ComputerName>CSFARM-GOLDEN</ComputerName><TimeZone>UTC</TimeZone>
    </component>
  </settings>
</unattend>
"@
Set-Content (Join-Path $winL "Windows\Panther\unattend.xml") $xml -Encoding UTF8

$boot = Join-Path $winL "FarmBootstrap"
New-Item -ItemType Directory -Force -Path $boot | Out-Null
Copy-Item -Force (Join-Path $repoVm "guest-agent.mjs") (Join-Path $boot "guest-agent.mjs")
Copy-Item -Force (Join-Path $repoVm "guest-net.ps1") (Join-Path $boot "guest-net.ps1")
Copy-Item -Force (Join-Path $repoVm "first-boot.ps1") (Join-Path $boot "first-boot.ps1")

# offline portable node into image (internal switch has no internet until NAT)
$nodeZip = Join-Path $FarmRoot "cache\node-v22.19.0-win-x64.zip"
if (-not (Test-Path $nodeZip)) {
  $cache = Join-Path $FarmRoot "cache"
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  Write-Output "download portable node zip -> $nodeZip"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip" -OutFile $nodeZip
}
if (Test-Path $nodeZip) {
  $cacheGuest = Join-Path $boot "cache"
  New-Item -ItemType Directory -Force -Path $cacheGuest | Out-Null
  Copy-Item -Force $nodeZip (Join-Path $cacheGuest "node.zip")
  $exp = Join-Path $boot "_node_exp"
  if (Test-Path $exp) { Remove-Item $exp -Recurse -Force }
  Expand-Archive -Path $nodeZip -DestinationPath $exp -Force
  $inner = Get-ChildItem $exp -Directory | Select-Object -First 1
  $nodeDir = Join-Path $boot "node"
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  Move-Item $inner.FullName $nodeDir
  Remove-Item $exp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output "portable node injected"
}

Dismount-VHD -Path $vhdPath
Set-VMFirmware -VMName $VmName -EnableSecureBoot Off
$hdd = Get-VMHardDiskDrive -VMName $VmName | Select-Object -First 1
Set-VMFirmware -VMName $VmName -FirstBootDevice $hdd
if (-not $NoStart) {
  Start-VM -Name $VmName
  Write-Output "vm started"
}
Write-Output "APPLY_OK"
