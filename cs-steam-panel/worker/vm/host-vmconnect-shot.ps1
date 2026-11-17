# capture Virtual Machine Connection window on the host (the view you watch).
# not guest PrintWindow (gpu-pv black), not SendKeys.
param(
  [string]$OutPng = "D:\FarmVMs\ops\vision\live.png",
  [string]$OutJson = "D:\FarmVMs\ops\vision\vmconnect-shot.json"
)
$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path (Split-Path $OutPng) | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmVmShot {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr d, int dx, int dy, int w, int h, IntPtr s, int sx, int sy, int rop);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@

function Fail($err) {
  $j = @{ ok = $false; black = $true; error = $err; w = 0; h = 0; mean = 0; via = "vmconnect" } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($OutJson, $j)
  Write-Output $j
  exit 0
}

$p = Get-Process vmconnect -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Fail "no-vmconnect" }
$hwnd = $p.MainWindowHandle
if ([FarmVmShot]::IsIconic($hwnd)) { [FarmVmShot]::ShowWindow($hwnd, 9) | Out-Null }
$rc = New-Object FarmVmShot+RECT
[FarmVmShot]::GetClientRect($hwnd, [ref]$rc) | Out-Null
$w = [Math]::Max(0, $rc.R - $rc.L)
$h = [Math]::Max(0, $rc.B - $rc.T)
if ($w -lt 200 -or $h -lt 150) {
  [FarmVmShot]::ShowWindow($hwnd, 9) | Out-Null
  [FarmVmShot]::MoveWindow($hwnd, 40, 80, 1100, 720, $true) | Out-Null
  Start-Sleep -Milliseconds 80
  [FarmVmShot]::GetClientRect($hwnd, [ref]$rc) | Out-Null
  $w = [Math]::Max(0, $rc.R - $rc.L)
  $h = [Math]::Max(0, $rc.B - $rc.T)
}
if ($w -lt 200 -or $h -lt 150) { Fail ("tiny-hwnd " + $w + "x" + $h) }

$hdc = [FarmVmShot]::GetDC($hwnd)
$mem = [FarmVmShot]::CreateCompatibleDC($hdc)
$bmpH = [FarmVmShot]::CreateCompatibleBitmap($hdc, $w, $h)
$old = [FarmVmShot]::SelectObject($mem, $bmpH)
$okPw = [FarmVmShot]::PrintWindow($hwnd, $mem, 2)
if (-not $okPw) { $okPw = [FarmVmShot]::PrintWindow($hwnd, $mem, 0) }
if (-not $okPw) { [FarmVmShot]::BitBlt($mem, 0, 0, $w, $h, $hdc, 0, 0, 0x00CC0020) | Out-Null }
$bmp = [System.Drawing.Image]::FromHbitmap($bmpH)
[FarmVmShot]::SelectObject($mem, $old) | Out-Null
[FarmVmShot]::DeleteObject($bmpH) | Out-Null
[FarmVmShot]::DeleteDC($mem) | Out-Null
[FarmVmShot]::ReleaseDC($hwnd, $hdc) | Out-Null

$bmp.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$sum = 0L; $n = 0
$step = 12
for ($y = 0; $y -lt $h; $y += $step) {
  for ($x = 0; $x -lt $w; $x += $step) {
    $c = $bmp.GetPixel($x, $y)
    $sum += [int64](0.2126 * $c.R + 0.7152 * $c.G + 0.0722 * $c.B)
    $n++
  }
}
$bmp.Dispose()
$mean = if ($n -gt 0) { [math]::Round(($sum / $n), 2) } else { 0 }
$black = $mean -lt 4
$j = @{
  ok = -not $black
  black = $black
  w = $w; h = $h; mean = $mean
  via = "vmconnect-printwindow"
  png = $OutPng
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText($OutJson, $j)
Write-Output $j
