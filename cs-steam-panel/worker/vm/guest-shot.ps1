# guest capture of cs2 for host teach. gpu-pv: dwm desktop, not host vmconnect.
$ErrorActionPreference = "Continue"
$flag = "C:\FarmBootstrap\reload-agent.flag"
if (Test-Path $flag) {
  Remove-Item $flag -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile",
    "-Command",
    "Start-Sleep -Seconds 2; Get-Process node -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue; Start-Sleep -Milliseconds 500; Start-Process -FilePath node -ArgumentList 'C:\FarmBootstrap\guest-agent.mjs' -WorkingDirectory 'C:\FarmBootstrap' -WindowStyle Hidden"
  )
}
$outDir = "C:\FarmBootstrap\vision"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$pngPath = Join-Path $outDir "live.png"
$jsonPath = Join-Path $outDir "shot.json"
$script:sw = [Diagnostics.Stopwatch]::StartNew()
$script:prof = @{ frame_id = [int]([DateTime]::UtcNow.Ticks % 2000000000); bytes = 0 }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmShot {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdcBlt, uint nFlags);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
  [DllImport("user32.dll")] public static extern bool BitBlt(IntPtr d, int dx, int dy, int w, int h, IntPtr s, int sx, int sy, int rop);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);
  public struct RECT { public int L,T,R,B; }
  public struct POINT { public int X,Y; }
}
"@

function Write-Shot($ok, $black, $w, $h, $mean, $via, $err) {
  $script:prof.total = [int]$script:sw.ElapsedMilliseconds
  $result = @{
    ok = [bool]$ok; black = [bool]$black; w = [int]$w; h = [int]$h; mean = $mean
    spots = @(); greens = @(); png = $pngPath; via = $via
    error = $err; ts = (Get-Date).ToString("o")
    frame_id = $script:prof.frame_id
    ms_overlay = $script:prof.overlay
    ms_copy = $script:prof.copy
    ms_encode = $script:prof.encode
    ms_total = $script:prof.total
    bytes = $script:prof.bytes
  }
  $json = $result | ConvertTo-Json -Compress -Depth 4
  [IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding $false))
  Write-Output $json
}

function Hide-Glass([int]$show) {
  try {
    $h = [FarmShot]::FindWindow($null, "farm-glass-guest")
    if ($h -ne [IntPtr]::Zero) { [FarmShot]::ShowWindow($h, $show) | Out-Null }
  } catch {}
}

function Save-IfGood([System.Drawing.Bitmap]$bmp, $via) {
  if (-not $bmp -or $bmp.Width -lt 32 -or $bmp.Height -lt 32) { return $false }
  $e0 = $script:sw.ElapsedMilliseconds
  $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $script:prof.encode = [int]($script:sw.ElapsedMilliseconds - $e0)
  try { $script:prof.bytes = [int](Get-Item $pngPath).Length } catch { $script:prof.bytes = 0 }
  Write-Shot $true $false $bmp.Width $bmp.Height 64 $via $null
  return $true
}

$o0 = $script:sw.ElapsedMilliseconds
$ov = "C:\FarmBootstrap\guest-overlay.ps1"
$ovLive = "C:\FarmBootstrap\overlay.live"
$ovFlag = "C:\FarmBootstrap\overlay-reload.flag"
$needOv = $false
if (Test-Path $ovFlag) {
  Remove-Item $ovFlag -Force -ErrorAction SilentlyContinue
  $needOv = $true
}
if (-not (Test-Path $ovLive) -or ((Get-Date) - (Get-Item $ovLive).LastWriteTime).TotalSeconds -gt 4) {
  $needOv = $true
}
if ((Test-Path $ov) -and $needOv) {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
    Where-Object { $_.CommandLine -match 'guest-overlay.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
  Start-Process -FilePath powershell.exe -ArgumentList '-STA','-NoProfile','-ExecutionPolicy','Bypass','-File',$ov -WindowStyle Hidden
}
$script:prof.overlay = [int]($script:sw.ElapsedMilliseconds - $o0)

$proc = Get-Process cs2 -EA SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  Write-Shot $false $true 0 0 0 "none" "no-cs2"
  exit 0
}

$hwnd = $proc.MainWindowHandle
$deskW = [FarmShot]::GetSystemMetrics(0)
$deskH = [FarmShot]::GetSystemMetrics(1)
if ($hwnd -ne [IntPtr]::Zero -and $deskW -ge 800 -and $deskH -ge 600) {
  $rc0 = New-Object FarmShot+RECT
  [FarmShot]::GetClientRect($hwnd, [ref]$rc0) | Out-Null
  $cw0 = [Math]::Max(0, $rc0.R - $rc0.L)
  $ch0 = [Math]::Max(0, $rc0.B - $rc0.T)
  if ($cw0 -lt [int]($deskW * 0.9) -or $ch0 -lt [int]($deskH * 0.9)) {
    [FarmShot]::MoveWindow($hwnd, 0, 0, $deskW, $deskH, $true) | Out-Null
  }
}
$rc = New-Object FarmShot+RECT
[FarmShot]::GetClientRect($hwnd, [ref]$rc) | Out-Null
$cw = [Math]::Max(0, $rc.R - $rc.L)
$ch = [Math]::Max(0, $rc.B - $rc.T)
$tl = New-Object FarmShot+POINT
$tl.X = 0; $tl.Y = 0
[FarmShot]::ClientToScreen($hwnd, [ref]$tl) | Out-Null

try { [FarmShot]::DwmFlush() | Out-Null } catch {}

if ($cw -ge 200 -and $ch -ge 150) {
  try {
    $c0 = $script:sw.ElapsedMilliseconds
    $bmp = New-Object System.Drawing.Bitmap $cw, $ch
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($tl.X, $tl.Y, 0, 0, (New-Object System.Drawing.Size $cw, $ch), [System.Drawing.CopyPixelOperation]::SourceCopy)
    $g.Dispose()
    $script:prof.copy = [int]($script:sw.ElapsedMilliseconds - $c0)
    if (Save-IfGood $bmp "copyfromscreen") { $bmp.Dispose(); exit 0 }
    $bmp.Dispose()
  } catch {}
}

$desk = [FarmShot]::GetDesktopWindow()
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$dw = [Math]::Max(8, $bounds.Width)
$dh = [Math]::Max(8, $bounds.Height)
$hdc = [FarmShot]::GetDC($desk)
$mem = [FarmShot]::CreateCompatibleDC($hdc)
$bmpH = [FarmShot]::CreateCompatibleBitmap($hdc, $dw, $dh)
$old = [FarmShot]::SelectObject($mem, $bmpH)
[FarmShot]::PrintWindow($desk, $mem, 2) | Out-Null
$full = [System.Drawing.Image]::FromHbitmap($bmpH)
[FarmShot]::SelectObject($mem, $old) | Out-Null
[FarmShot]::DeleteObject($bmpH) | Out-Null
[FarmShot]::DeleteDC($mem) | Out-Null
[FarmShot]::ReleaseDC($desk, $hdc) | Out-Null

if ($cw -ge 200 -and $ch -ge 150) {
  $sx = [Math]::Max(0, $tl.X - $bounds.X)
  $sy = [Math]::Max(0, $tl.Y - $bounds.Y)
  $rw = [Math]::Min($cw, $full.Width - $sx)
  $rh = [Math]::Min($ch, $full.Height - $sy)
  if ($rw -gt 32 -and $rh -gt 32) {
    $crop = New-Object System.Drawing.Bitmap $rw, $rh
    $gc = [System.Drawing.Graphics]::FromImage($crop)
    $gc.DrawImage($full, (New-Object System.Drawing.Rectangle 0,0,$rw,$rh), $sx, $sy, $rw, $rh, [System.Drawing.GraphicsUnit]::Pixel)
    $gc.Dispose()
    if (Save-IfGood $crop "desktop-crop") { $crop.Dispose(); $full.Dispose(); exit 0 }
    $crop.Dispose()
  }
}
if (Save-IfGood $full "desktop") { $full.Dispose(); exit 0 }
$full.Dispose()

$hdc2 = [FarmShot]::GetDC($hwnd)
$mem2 = [FarmShot]::CreateCompatibleDC($hdc2)
$w = [Math]::Max(8, $cw); $h = [Math]::Max(8, $ch)
$bh = [FarmShot]::CreateCompatibleBitmap($hdc2, $w, $h)
$old2 = [FarmShot]::SelectObject($mem2, $bh)
[FarmShot]::PrintWindow($hwnd, $mem2, 2) | Out-Null
$pw = [System.Drawing.Image]::FromHbitmap($bh)
[FarmShot]::SelectObject($mem2, $old2) | Out-Null
[FarmShot]::DeleteObject($bh) | Out-Null
[FarmShot]::DeleteDC($mem2) | Out-Null
[FarmShot]::ReleaseDC($hwnd, $hdc2) | Out-Null
if (Save-IfGood $pw "printwindow") { $pw.Dispose(); exit 0 }
$pw.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Shot $true $false $pw.Width $pw.Height 64 "printwindow-dark" $null
$pw.Dispose()
