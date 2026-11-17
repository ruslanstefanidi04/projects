$ErrorActionPreference = "Continue"
Start-Transcript C:\FarmBootstrap\first-boot.log -Force
try {
  # permanent autologon farm
  $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
  Set-ItemProperty -Path $winlogon -Name AutoAdminLogon -Value "1" -Type String -Force
  Set-ItemProperty -Path $winlogon -Name DefaultUserName -Value "farm" -Type String -Force
  if (-not (Get-ItemProperty -Path $winlogon -Name DefaultPassword -ErrorAction SilentlyContinue)) {
    Set-ItemProperty -Path $winlogon -Name DefaultPassword -Value "FarmPass1!" -Type String -Force
  }
  Set-ItemProperty -Path $winlogon -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String -Force
  New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization" -Force | Out-Null
  Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization" -Name NoLockScreen -Value 1 -Type DWord -Force
  # console-only farm: kill Enhanced Session (RDP) trap
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" -Name fDenyTSConnections -Value 1 -Force -ErrorAction SilentlyContinue
  New-Item "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device" -Force | Out-Null
  Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device" DevicePasswordLessBuildVersion 0 -Type DWord -Force

  @'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Disp {
  [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE d, int f);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName;
    public short SpecVersion, DriverVersion, Size, DriverExtra;
    public int Fields, PosX, PosY, DisplayOrientation, DisplayFixedOutput;
    public short Color, Duplex, YResolution, TTOption, Collate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string FormName;
    public short LogPixels;
    public int BitsPerPel, PelsWidth, PelsHeight, DisplayFlags, DisplayFrequency;
  }
}
"@
$d = New-Object Disp+DEVMODE
$d.Size = [Runtime.InteropServices.Marshal]::SizeOf($d)
$d.PelsWidth = 1280
$d.PelsHeight = 720
$d.BitsPerPel = 32
$d.Fields = 0x80000 -bor 0x100000 -bor 0x40000
[Disp]::ChangeDisplaySettings([ref]$d, 0)
'@ | Set-Content C:\FarmBootstrap\set-res.ps1 -Encoding UTF8
  $resCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\FarmBootstrap\set-res.ps1'
  Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name CSFarmRes -Value $resCmd -Force
  schtasks /Create /TN CSFarmRes /SC ONLOGON /RL HIGHEST /TR $resCmd /F | Out-Null

  if (Test-Path C:\FarmBootstrap\guest-net.ps1) {
    powershell -NoProfile -ExecutionPolicy Bypass -File C:\FarmBootstrap\guest-net.ps1 -SlotOctet 10
  }
  New-NetFirewallRule -DisplayName "CSFarm Agent" -Direction Inbound -Protocol TCP -LocalPort 39200 -Action Allow -ErrorAction SilentlyContinue | Out-Null

  $portable = "C:\FarmBootstrap\node\node.exe"
  if (-not (Test-Path $portable)) {
    $zip = "C:\FarmBootstrap\cache\node.zip"
    if (Test-Path $zip) {
      Expand-Archive -Path $zip -DestinationPath "C:\FarmBootstrap\cache\node-exp" -Force
      $inner = Get-ChildItem "C:\FarmBootstrap\cache\node-exp" -Directory | Select-Object -First 1
      if ($inner) {
        New-Item -ItemType Directory -Force -Path C:\FarmBootstrap\node | Out-Null
        Copy-Item -Recurse -Force "$($inner.FullName)\*" C:\FarmBootstrap\node
      }
      Remove-Item "C:\FarmBootstrap\cache\node-exp" -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path $portable) {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($machinePath -notlike "*FarmBootstrap\node*") {
      [Environment]::SetEnvironmentVariable("Path", "$machinePath;C:\FarmBootstrap\node", "Machine")
    }
  } elseif (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
  }

  $env:Path = "C:\FarmBootstrap\node;" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $hasNode = (Test-Path $portable) -or (Get-Command node -ErrorAction SilentlyContinue)
  if ((Test-Path C:\FarmBootstrap\guest-agent.mjs) -and $hasNode) {
    @(
      "@echo off",
      "set PATH=C:\FarmBootstrap\node;%PATH%",
      "set FARM_AGENT_PORT=39200",
      "set FARM_AGENT_TOKEN=csfarm",
      "set FARM_ALLOW_CS=1",
      "cd /d C:\FarmBootstrap",
      "node guest-agent.mjs"
    ) | Set-Content C:\FarmBootstrap\run-agent.cmd -Encoding ASCII
    schtasks /Create /TN CSFarmGuestAgent /SC ONLOGON /RL HIGHEST /TR C:\FarmBootstrap\run-agent.cmd /F | Out-Null
    Start-Process C:\FarmBootstrap\run-agent.cmd -WindowStyle Hidden
  }
  Write-Output "first-boot ok"
} catch {
  Write-Output $_
}
Stop-Transcript
