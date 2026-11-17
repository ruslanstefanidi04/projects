# apply Win10 Pro from ISO into golden vhdx (offline), inject unattend + first-logon bootstrap
param(
  [string]$Iso = "D:\FarmVMs\iso\Win10_22H2_English_x64.iso",
  [string]$Vhd = "D:\FarmVMs\csfarm-golden\csfarm-golden.vhdx",
  [string]$VmName = "csfarm-golden",
  [string]$AdminPass = "FarmPass1!",
  [string]$AgentSrc = ""
)

$ErrorActionPreference = "Stop"
Import-Module Hyper-V

if (-not (Test-Path $Iso)) { throw "iso missing: $Iso" }
if (-not (Test-Path $Vhd)) { throw "vhd missing: $Vhd" }

$vm = Get-VM -Name $VmName
if ($vm.State -ne "Off") { throw "vm must be Off" }

Get-VMDvdDrive -VMName $VmName -ErrorAction SilentlyContinue | ForEach-Object {
  Set-VMDvdDrive -VMName $VmName -ControllerNumber $_.ControllerNumber -ControllerLocation $_.ControllerLocation -Path $null -ErrorAction SilentlyContinue
}

Write-Output "mount iso"
$img = Mount-DiskImage -ImagePath $Iso -PassThru
Start-Sleep -Seconds 2
$isoLetter = ($img | Get-Volume | Where-Object { $_.DriveLetter } | Select-Object -First 1).DriveLetter + ":"
$wim = Join-Path $isoLetter "sources\install.wim"
if (-not (Test-Path $wim)) { throw "install.wim missing on $isoLetter" }

$infoText = (dism /Get-WimInfo /WimFile:$wim) | Out-String
Write-Output $infoText
$index = 6
$m = [regex]::Match($infoText, "(?s)Index : (\d+)\r?\nName : Windows 10 Pro\b")
if ($m.Success) { $index = [int]$m.Groups[1].Value }
Write-Output "using wim index $index"

Write-Output "mount vhd"
$vhdObj = Mount-VHD -Path $Vhd -Passthru
$disk = Get-Disk -Number $vhdObj.Number

Clear-Disk -Number $disk.Number -RemoveData -Confirm:$false -ErrorAction SilentlyContinue
Initialize-Disk -Number $disk.Number -PartitionStyle GPT -ErrorAction SilentlyContinue

Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | ForEach-Object {
  try { Remove-Partition -DiskNumber $disk.Number -PartitionNumber $_.PartitionNumber -Confirm:$false } catch {}
}

$efi = New-Partition -DiskNumber $disk.Number -Size 260MB -GptType "{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}" -AssignDriveLetter
Format-Volume -Partition $efi -FileSystem FAT32 -NewFileSystemLabel "System" -Confirm:$false | Out-Null
New-Partition -DiskNumber $disk.Number -Size 16MB -GptType "{e3c9e316-0b5c-4db8-817d-f92df00215ae}" | Out-Null
$winPart = New-Partition -DiskNumber $disk.Number -UseMaximumSize -GptType "{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}" -AssignDriveLetter
Format-Volume -Partition $winPart -FileSystem NTFS -NewFileSystemLabel "Windows" -Confirm:$false | Out-Null

$efi = Get-Partition -DiskNumber $disk.Number | Where-Object { $_.GptType -eq "{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}" } | Select-Object -First 1
$winPart = Get-Partition -DiskNumber $disk.Number | Where-Object { $_.Size -gt 1GB } | Select-Object -First 1
$efiLetter = (Get-Partition -DiskNumber $disk.Number -PartitionNumber $efi.PartitionNumber | Get-Volume).DriveLetter + ":"
$winLetter = (Get-Partition -DiskNumber $disk.Number -PartitionNumber $winPart.PartitionNumber | Get-Volume).DriveLetter + ":"
if (-not $efiLetter.TrimEnd(":") -or -not $winLetter.TrimEnd(":")) { throw "partition letters missing" }
Write-Output "efi $efiLetter win $winLetter"

Write-Output "expand image (slow)"
Expand-WindowsImage -ImagePath $wim -Index $index -ApplyPath ($winLetter + "\") 

Write-Output "bcdboot"
& bcdboot ($winLetter + "\Windows") /s $efiLetter /f UEFI

function Encode-Unattend([string]$plain, [string]$suffix) {
  return [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($plain + $suffix))
}

$adminEnc = Encode-Unattend $AdminPass "AdministratorPassword"
$passEnc = Encode-Unattend $AdminPass "Password"

$unattend = @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>
      <UserAccounts>
        <AdministratorPassword>
          <Value>$adminEnc</Value>
          <PlainText>false</PlainText>
        </AdministratorPassword>
        <LocalAccounts>
          <LocalAccount>
            <Password>
              <Value>$passEnc</Value>
              <PlainText>false</PlainText>
            </Password>
            <Description>farm</Description>
            <DisplayName>farm</DisplayName>
            <Group>Administrators</Group>
            <Name>farm</Name>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
      <AutoLogon>
        <Password>
          <Value>$passEnc</Value>
          <PlainText>false</PlainText>
        </Password>
        <Enabled>true</Enabled>
        <Username>farm</Username>
        <LogonCount>5</LogonCount>
      </AutoLogon>
      <RegisteredOwner>CSFarm</RegisteredOwner>
      <ComputerName>CSFARM-GOLDEN</ComputerName>
      <FirstLogonCommands>
        <SynchronousCommand>
          <Order>1</Order>
          <CommandLine>powershell -NoProfile -ExecutionPolicy Bypass -File C:\FarmBootstrap\first-boot.ps1</CommandLine>
          <Description>farm bootstrap</Description>
        </SynchronousCommand>
      </FirstLogonCommands>
    </component>
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <InputLocale>en-US</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage>
      <UserLocale>en-US</UserLocale>
    </component>
  </settings>
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <ComputerName>CSFARM-GOLDEN</ComputerName>
      <RegisteredOwner>CSFarm</RegisteredOwner>
      <TimeZone>UTC</TimeZone>
    </component>
  </settings>
</unattend>
"@

$panther = Join-Path $winLetter "Windows\Panther"
New-Item -ItemType Directory -Force -Path $panther | Out-Null
Set-Content -Path (Join-Path $panther "unattend.xml") -Value $unattend -Encoding UTF8

$boot = Join-Path $winLetter "FarmBootstrap"
New-Item -ItemType Directory -Force -Path $boot | Out-Null
if (-not $AgentSrc) { $AgentSrc = "c:\root\prgt\external\projects\cs-steam-panel\worker\vm\guest-agent.mjs" }
if (Test-Path $AgentSrc) { Copy-Item -Force $AgentSrc (Join-Path $boot "guest-agent.mjs") }
$netSrc = "c:\root\prgt\external\projects\cs-steam-panel\worker\vm\guest-net.ps1"
if (Test-Path $netSrc) { Copy-Item -Force $netSrc (Join-Path $boot "guest-net.ps1") }

Set-Content -Path (Join-Path $boot "first-boot.ps1") -Encoding UTF8 -Value @'
$ErrorActionPreference = "Continue"
Start-Transcript C:\FarmBootstrap\first-boot.log -Force
try {
  if (Test-Path C:\FarmBootstrap\guest-net.ps1) {
    & C:\FarmBootstrap\guest-net.ps1 -SlotOctet 10
  }
  New-NetFirewallRule -DisplayName "CSFarm Agent" -Direction Inbound -Protocol TCP -LocalPort 39200 -Action Allow -ErrorAction SilentlyContinue | Out-Null
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
  }
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  if ((Test-Path C:\FarmBootstrap\guest-agent.mjs) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $launcher = "C:\FarmBootstrap\run-agent.cmd"
    @(
      "@echo off",
      "set FARM_AGENT_PORT=39200",
      "set FARM_AGENT_TOKEN=csfarm",
      "set FARM_ALLOW_CS=0",
      "node C:\FarmBootstrap\guest-agent.mjs"
    ) | Set-Content -Encoding ASCII $launcher
    schtasks /Create /TN CSFarmGuestAgent /SC ONLOGON /RL HIGHEST /TR $launcher /F | Out-Null
    Start-Process -FilePath $launcher -WindowStyle Hidden
  }
  Write-Output "first-boot ok"
} catch {
  Write-Output $_
}
Stop-Transcript
'@

Write-Output "dismount"
Dismount-VHD -Path $Vhd -ErrorAction SilentlyContinue
Dismount-DiskImage -ImagePath $Iso -ErrorAction SilentlyContinue

Set-VMFirmware -VMName $VmName -EnableSecureBoot Off -ErrorAction SilentlyContinue
$hdd = Get-VMHardDiskDrive -VMName $VmName | Select-Object -First 1
if ($hdd) { Set-VMFirmware -VMName $VmName -FirstBootDevice $hdd -ErrorAction SilentlyContinue }

Write-Output "start vm"
Start-VM -Name $VmName
Write-Output "APPLY_OK"
