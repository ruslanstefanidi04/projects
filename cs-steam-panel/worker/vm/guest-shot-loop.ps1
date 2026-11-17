# resident cs2 capture. add-type once. jpeg bytes written as live.png for host cv.
# rollback: set FARM_SHOT_LEGACY=1 on guest-agent to spawn guest-shot.ps1 per frame.
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmShotLoop {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);
  public struct RECT { public int L,T,R,B; }
  public struct POINT { public int X,Y; }
}
"@

$outDir = "C:\FarmBootstrap\vision"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$pngPath = Join-Path $outDir "live.png"
$jsonPath = Join-Path $outDir "shot.json"
$script:frameId = 0
$script:bmp = $null
$script:g = $null
$script:lastOv = 0
$script:lastMove = 0
$script:lastFlag = 0
$script:csProcAt = 0
$script:csProc = $null

function Write-Shot($ok, $black, $w, $h, $via, $err, $prof) {
  $result = @{
    ok = [bool]$ok; black = [bool]$black; w = [int]$w; h = [int]$h; mean = 64
    spots = @(); greens = @(); png = $pngPath; via = $via
    error = $err; ts = (Get-Date).ToString("o")
    frame_id = $prof.frame_id
    ms_overlay = $prof.overlay
    ms_copy = $prof.copy
    ms_encode = $prof.encode
    ms_total = $prof.total
    bytes = $prof.bytes
    loop = $true
  }
  $json = $result | ConvertTo-Json -Compress -Depth 4
  [IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding $false))
}

function Ensure-Overlay {
  $now = [Environment]::TickCount
  if (($now - $script:lastOv) -lt 8000 -and $script:lastOv -ne 0) { return 0 }
  $script:lastOv = $now
  $ovFlag = "C:\FarmBootstrap\overlay-reload.flag"
  if (-not (Test-Path $ovFlag)) { return 0 }
  Remove-Item $ovFlag -Force -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $ov = "C:\FarmBootstrap\guest-overlay.ps1"
  if (-not (Test-Path $ov)) { return [int]$sw.ElapsedMilliseconds }
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
    Where-Object { $_.CommandLine -match 'guest-overlay.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
  Start-Process -FilePath powershell.exe -ArgumentList '-STA','-NoProfile','-ExecutionPolicy','Bypass','-File',$ov -WindowStyle Hidden
  return [int]$sw.ElapsedMilliseconds
}

function Check-Reload {
  $now = [Environment]::TickCount
  if (($now - $script:lastFlag) -lt 1500) { return }
  $script:lastFlag = $now
  $flag = "C:\FarmBootstrap\reload-agent.flag"
  if (-not (Test-Path $flag)) { return }
  Remove-Item $flag -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-Command",
    "Start-Sleep -Seconds 2; Get-Process node -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue; Start-Sleep -Milliseconds 500; Start-Process -FilePath node -ArgumentList 'C:\FarmBootstrap\guest-agent.mjs' -WorkingDirectory 'C:\FarmBootstrap' -WindowStyle Hidden"
  )
}

function Hide-Glass([int]$show) {
  try {
    $h = [FarmShotLoop]::FindWindow($null, "farm-glass-guest")
    if ($h -ne [IntPtr]::Zero) { [FarmShotLoop]::ShowWindow($h, $show) | Out-Null }
  } catch {}
}

function Ensure-Bmp([int]$w, [int]$h) {
  if ($script:bmp -ne $null -and $script:bmp.Width -eq $w -and $script:bmp.Height -eq $h) { return }
  if ($script:g) { try { $script:g.Dispose() } catch {} }
  if ($script:bmp) { try { $script:bmp.Dispose() } catch {} }
  $script:bmp = New-Object System.Drawing.Bitmap $w, $h
  $script:g = [System.Drawing.Graphics]::FromImage($script:bmp)
}

function Save-Jpeg([System.Drawing.Bitmap]$bmp, [string]$path) {
  $ms = New-Object IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  $tmp = $path + ".tmp"
  [IO.File]::WriteAllBytes($tmp, $bytes)
  [IO.File]::Copy($tmp, $path, $true)
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  return $bytes.Length
}

while ($true) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $script:frameId++
  $prof = @{ frame_id = $script:frameId; overlay = 0; copy = 0; encode = 0; total = 0; bytes = 0 }
  try { $prof.overlay = Ensure-Overlay } catch { $prof.overlay = -1 }
  $loopFlag = "C:\FarmBootstrap\shot-loop-reload.flag"
  if (Test-Path $loopFlag) {
    Remove-Item $loopFlag -Force -ErrorAction SilentlyContinue
    exit 0
  }
  Check-Reload
  $now = [Environment]::TickCount
  if ($script:csProc -eq $null -or ($now - $script:csProcAt) -gt 1500) {
    $script:csProc = Get-Process cs2 -EA SilentlyContinue | Select-Object -First 1
    $script:csProcAt = $now
  }
  $proc = $script:csProc
  if (-not $proc) {
    $prof.total = [int]$sw.ElapsedMilliseconds
    Write-Shot $false $true 0 0 "none" "no-cs2" $prof
    Start-Sleep -Milliseconds 120
    continue
  }
  $hwnd = $proc.MainWindowHandle
  $rc = New-Object FarmShotLoop+RECT
  [FarmShotLoop]::GetClientRect($hwnd, [ref]$rc) | Out-Null
  $cw = [Math]::Max(0, $rc.R - $rc.L)
  $ch = [Math]::Max(0, $rc.B - $rc.T)
  $tl = New-Object FarmShotLoop+POINT
  $tl.X = 0; $tl.Y = 0
  [FarmShotLoop]::ClientToScreen($hwnd, [ref]$tl) | Out-Null
  if ($cw -lt 200 -or $ch -lt 150) {
    $prof.total = [int]$sw.ElapsedMilliseconds
    Write-Shot $false $true $cw $ch "small" "client-too-small" $prof
    Start-Sleep -Milliseconds 40
    continue
  }
  try {
    Ensure-Bmp $cw $ch
    $c0 = $sw.ElapsedMilliseconds
    $script:g.CopyFromScreen($tl.X, $tl.Y, 0, 0, (New-Object System.Drawing.Size $cw, $ch), [System.Drawing.CopyPixelOperation]::SourceCopy)
    $prof.copy = [int]($sw.ElapsedMilliseconds - $c0)
    $e0 = $sw.ElapsedMilliseconds
    $prof.bytes = Save-Jpeg $script:bmp $pngPath
    $prof.encode = [int]($sw.ElapsedMilliseconds - $e0)
    $prof.total = [int]$sw.ElapsedMilliseconds
    Write-Shot $true $false $cw $ch "loop-jpeg" $null $prof
  } catch {
    $prof.total = [int]$sw.ElapsedMilliseconds
    Write-Shot $false $true $cw $ch "loop-fail" $_.Exception.Message $prof
  }
  $left = 40 - [int]$sw.ElapsedMilliseconds
  if ($left -gt 1) { Start-Sleep -Milliseconds $left }
}
