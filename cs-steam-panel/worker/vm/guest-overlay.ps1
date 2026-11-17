# click-through yolo glass over cs2 inside the guest. host teach stays on the host.
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmGuestGlass {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int n, int v);
  public struct RECT { public int L,T,R,B; }
  public struct POINT { public int X,Y; }
}
"@

$url = "http://10.250.0.1:39210/overlay-glass.png"

$script:csRectAt = 0
$script:csRect = $null
function Get-CsRect {
  $now = [Environment]::TickCount
  if ($script:csRect -ne $null -and ($now - $script:csRectAt) -lt 80) { return $script:csRect }
  $p = Get-Process cs2 -EA SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { $script:csRect = $null; return $null }
  $h = $p.MainWindowHandle
  $rc = New-Object FarmGuestGlass+RECT
  [FarmGuestGlass]::GetClientRect($h, [ref]$rc) | Out-Null
  $w = $rc.R - $rc.L; $ht = $rc.B - $rc.T
  if ($w -lt 200 -or $ht -lt 150) { $script:csRect = $null; return $null }
  $tl = New-Object FarmGuestGlass+POINT
  $tl.X = 0; $tl.Y = 0
  [FarmGuestGlass]::ClientToScreen($h, [ref]$tl) | Out-Null
  $script:csRect = @{ X = $tl.X; Y = $tl.Y; W = $w; H = $ht }
  $script:csRectAt = $now
  return $script:csRect
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "farm-glass-guest"
$form.FormBorderStyle = "None"
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.StartPosition = "Manual"
$form.BackColor = [System.Drawing.Color]::Black
$form.TransparencyKey = [System.Drawing.Color]::Black
$form.Opacity = 1.0
try {
  $flags = [Reflection.BindingFlags]::Instance -bor [Reflection.BindingFlags]::NonPublic
  $form.GetType().GetProperty("DoubleBuffered", $flags).SetValue($form, $true, $null)
} catch {}

$pic = New-Object System.Windows.Forms.PictureBox
$pic.Dock = "Fill"
$pic.SizeMode = "StretchImage"
$pic.BackColor = [System.Drawing.Color]::Black
try {
  $flags = [Reflection.BindingFlags]::Instance -bor [Reflection.BindingFlags]::NonPublic
  $pic.GetType().GetProperty("DoubleBuffered", $flags).SetValue($pic, $true, $null)
} catch {}
$form.Controls.Add($pic)

$script:lastGlassEtag = ""
$script:glassTick = 0
function Load-Glass {
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  try {
    $req = [Net.HttpWebRequest]::Create("$url`?t=$t")
    $req.Timeout = 800
    $req.ReadWriteTimeout = 800
    $req.CachePolicy = New-Object Net.Cache.RequestCachePolicy([Net.Cache.RequestCacheLevel]::NoCacheNoStore)
    if ($script:lastGlassEtag) {
      try { $req.Headers["If-None-Match"] = $script:lastGlassEtag } catch {}
    }
    $resp = $req.GetResponse()
    $etag = [string]$resp.Headers["ETag"]
    $st = $resp.GetResponseStream()
    $img = [System.Drawing.Image]::FromStream($st)
    $st.Close(); $resp.Close()
    if ($etag -and $etag -eq $script:lastGlassEtag) {
      $img.Dispose()
      return
    }
    if ($etag) { $script:lastGlassEtag = $etag }
    $old = $pic.Image
    $pic.Image = $img
    if ($old) { $old.Dispose() }
  } catch [Net.WebException] {
    $resp = $_.Exception.Response
    if ($resp -and [int]$resp.StatusCode -eq 304) {
      try { $resp.Close() } catch {}
    }
  } catch {}
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 50
$timer.Add_Tick({
  $r = Get-CsRect
  if ($r) {
    if ($form.Left -ne $r.X -or $form.Top -ne $r.Y) {
      $form.Location = New-Object System.Drawing.Point $r.X, $r.Y
    }
    if ($form.Width -ne $r.W -or $form.Height -ne $r.H) {
      $form.Size = New-Object System.Drawing.Size $r.W, $r.H
    }
  }
  $script:glassTick++
  Load-Glass
  if (($script:glassTick % 20) -eq 0) {
    try { Set-Content -Path "C:\FarmBootstrap\overlay.live" -Value (Get-Date).ToString("o") -ErrorAction SilentlyContinue } catch {}
  }
})

$form.Add_Shown({
  $h = $form.Handle
  $ex = [FarmGuestGlass]::GetWindowLong($h, -20)
  [FarmGuestGlass]::SetWindowLong($h, -20, ($ex -bor 0x80000 -bor 0x20)) | Out-Null
  Load-Glass
  $timer.Start()
})
$form.Add_FormClosed({ $timer.Stop() })
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::Run($form)
