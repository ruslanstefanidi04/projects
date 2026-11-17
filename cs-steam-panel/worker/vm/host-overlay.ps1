# always-on-top glass over vmconnect: yolo/radar hud, click-through. teach stays on host browser.
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmGlass {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int n, int v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f);
  public struct RECT { public int L,T,R,B; }
  public struct POINT { public int X,Y; }
}
"@

$png = "D:\FarmVMs\ops\vision\overlay-glass.png"
$fallback = "D:\FarmVMs\ops\vision\overlay.png"
$think = "D:\FarmVMs\ops\vision\think-last.json"

function Get-VmRect {
  $p = Get-Process vmconnect -EA SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { return $null }
  $h = $p.MainWindowHandle
  $rc = New-Object FarmGlass+RECT
  [FarmGlass]::GetClientRect($h, [ref]$rc) | Out-Null
  $w = $rc.R - $rc.L; $ht = $rc.B - $rc.T
  if ($w -lt 200 -or $ht -lt 150) { return $null }
  $tl = New-Object FarmGlass+POINT
  $tl.X = 0; $tl.Y = 0
  [FarmGlass]::ClientToScreen($h, [ref]$tl) | Out-Null
  return @{ X = $tl.X; Y = $tl.Y; W = $w; H = $ht; Hwnd = $h }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "farm-glass"
$form.FormBorderStyle = "None"
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.StartPosition = "Manual"
$form.BackColor = [System.Drawing.Color]::Black
$form.TransparencyKey = [System.Drawing.Color]::Black
$form.Opacity = 0.92

$pic = New-Object System.Windows.Forms.PictureBox
$pic.Dock = "Fill"
$pic.SizeMode = "StretchImage"
$pic.BackColor = [System.Drawing.Color]::Black
$form.Controls.Add($pic)

$script:last = ""
function Load-Glass {
  $path = if (Test-Path $png) { $png } elseif (Test-Path $fallback) { $fallback } else { $null }
  if (-not $path) { return }
  try {
    $fs = [IO.File]::Open($path, "Open", "Read", "ReadWrite")
    $img = [System.Drawing.Image]::FromStream($fs)
    $fs.Close()
    if ($pic.Image) { $pic.Image.Dispose() }
    $pic.Image = $img
  } catch {}
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  $r = Get-VmRect
  if ($r) {
    $form.Location = New-Object System.Drawing.Point $r.X, $r.Y
    $form.Size = New-Object System.Drawing.Size $r.W, $r.H
    $form.TopMost = $true
  }
  Load-Glass
})

$form.Add_Shown({
  $h = $form.Handle
  $ex = [FarmGlass]::GetWindowLong($h, -20)
  [FarmGlass]::SetWindowLong($h, -20, ($ex -bor 0x80000 -bor 0x20)) | Out-Null
  Load-Glass
  $timer.Start()
})
$form.Add_FormClosed({ $timer.Stop() })
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
