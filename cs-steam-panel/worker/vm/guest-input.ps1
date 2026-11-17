# resident sendinput for cs2. add-type once, then stdin: LOOK dx dy | KD vk | KU vk | FIRE | CLICK x y
$ErrorActionPreference = "Continue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmIn {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type;
    public InputUnion U;
  }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lp, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] i, int cb);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint m);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public static int Cb() { return Marshal.SizeOf(typeof(INPUT)); }
  public static uint Key(ushort vk, bool up) {
    ushort scan = (ushort)MapVirtualKey(vk, 0);
    uint flags = up ? 0x0002u : 0;
    INPUT a = new INPUT();
    a.type = 1;
    a.U.ki.wVk = vk;
    a.U.ki.wScan = scan;
    a.U.ki.dwFlags = flags;
    uint n = SendInput(1, new INPUT[] { a }, Cb());
    INPUT b = new INPUT();
    b.type = 1;
    b.U.ki.wVk = 0;
    b.U.ki.wScan = scan;
    b.U.ki.dwFlags = flags | 0x0008u;
    n += SendInput(1, new INPUT[] { b }, Cb());
    return n;
  }
  public static void KeyPost(IntPtr h, ushort vk, bool up) {
    ushort scan = (ushort)MapVirtualKey(vk, 0);
    uint lp = 1u | ((uint)scan << 16);
    if (up) lp |= (1u << 30) | (1u << 31);
    PostMessage(h, up ? 0x0101u : 0x0100u, (IntPtr)vk, unchecked((IntPtr)(int)lp));
  }
  public static uint Mouse(int dx, int dy, uint flags, uint data = 0) {
    INPUT inp = new INPUT();
    inp.type = 0;
    inp.U.mi.dx = dx; inp.U.mi.dy = dy; inp.U.mi.mouseData = data; inp.U.mi.dwFlags = flags;
    return SendInput(1, new INPUT[] { inp }, Cb());
  }
  public static void Focus(IntPtr h) {
    if (h == IntPtr.Zero) return;
    uint pid;
    uint tid = GetWindowThreadProcessId(h, out pid);
    uint mine = GetCurrentThreadId();
    if (tid != 0 && tid != mine) AttachThreadInput(mine, tid, true);
    ShowWindow(h, 9);
    SetForegroundWindow(h);
  }
  public static void Unfocus(IntPtr h) {
    if (h == IntPtr.Zero) return;
    uint pid;
    uint tid = GetWindowThreadProcessId(h, out pid);
    uint mine = GetCurrentThreadId();
    if (tid != 0 && tid != mine) AttachThreadInput(mine, tid, false);
  }
}
"@

$script:csHwnd = [IntPtr]::Zero
$script:csHwndAt = 0
function Get-CsHwnd {
  $now = [Environment]::TickCount
  if ($script:csHwnd -ne [IntPtr]::Zero -and ($now - $script:csHwndAt) -lt 2500) { return $script:csHwnd }
  $proc = Get-Process cs2 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { $script:csHwnd = [IntPtr]::Zero; return [IntPtr]::Zero }
  $target = [uint32]$proc.Id
  $script:best = [IntPtr]::Zero
  $script:bestArea = 0
  $cb = [FarmIn+EnumProc]{
    param($h, $l)
    $p = 0
    [FarmIn]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
    if ($p -ne $target) { return $true }
    if (-not [FarmIn]::IsWindowVisible($h)) { return $true }
    $rc = New-Object FarmIn+RECT
    [FarmIn]::GetClientRect($h, [ref]$rc) | Out-Null
    $area = [Math]::Max(0, $rc.R - $rc.L) * [Math]::Max(0, $rc.B - $rc.T)
    if ($area -gt $script:bestArea) { $script:bestArea = $area; $script:best = $h }
    return $true
  }
  [FarmIn]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  if ($script:best -eq [IntPtr]::Zero) { $script:best = $proc.MainWindowHandle }
  $script:csHwnd = $script:best
  $script:csHwndAt = $now
  return $script:best
}

function Send-Uni([int]$code) {
  [FarmIn]::keybd_event([byte]0, [byte]$code, 4, [UIntPtr]::Zero)
  [FarmIn]::keybd_event([byte]0, [byte]$code, 6, [UIntPtr]::Zero)
}

function Focus-Cs([IntPtr]$h) {
  $fg = [FarmIn]::GetForegroundWindow()
  if ($fg.ToInt64() -eq $h.ToInt64()) { return }
  $pid = [uint32]0
  $tid = [FarmIn]::GetWindowThreadProcessId($h, [ref]$pid)
  $mine = [FarmIn]::GetCurrentThreadId()
  if ($tid -ne 0 -and $tid -ne $mine) { [FarmIn]::AttachThreadInput($mine, $tid, $true) | Out-Null }
  [FarmIn]::ShowWindow($h, 9) | Out-Null
  [FarmIn]::SetForegroundWindow($h) | Out-Null
  if ($tid -ne 0 -and $tid -ne $mine) { [FarmIn]::AttachThreadInput($mine, $tid, $false) | Out-Null }
}

Write-Output "ready"
[Console]::Out.Flush()
$script:lastMx = 0
$script:lastMy = 0
$script:haveMouse = $false
function K([int]$vk) {
  if (([FarmIn]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { return "true" }
  return "false"
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $p = @($line.Trim() -split "\s+")
  $cmd = [string]$p[0]
  if ($cmd -eq "QUIT") { break }
  if ($cmd -eq "SAMPLE") {
    $pt = New-Object FarmIn+POINT
    [FarmIn]::GetCursorPos([ref]$pt) | Out-Null
    $dx = 0; $dy = 0
    if ($script:haveMouse) {
      $dx = [int]($pt.X - $script:lastMx)
      $dy = [int]($pt.Y - $script:lastMy)
    }
    $script:lastMx = $pt.X
    $script:lastMy = $pt.Y
    $script:haveMouse = $true
    Write-Output ('{"W":'+(K 0x57)+',"A":'+(K 0x41)+',"S":'+(K 0x53)+',"D":'+(K 0x44)+',"SPACE":'+(K 0x20)+',"SHIFT":'+(K 0xA0)+',"CTRL":'+(K 0xA2)+',"R":'+(K 0x52)+',"E":'+(K 0x45)+',"Q":'+(K 0x51)+',"F":'+(K 0x46)+',"B":'+(K 0x42)+',"G":'+(K 0x47)+',"C":'+(K 0x43)+',"N1":'+(K 0x31)+',"N2":'+(K 0x32)+',"N3":'+(K 0x33)+',"N4":'+(K 0x34)+',"N5":'+(K 0x35)+',"M1":'+(K 0x01)+',"M2":'+(K 0x02)+',"dx":'+$dx+',"dy":'+$dy+',"mx":'+$pt.X+',"my":'+$pt.Y+'}')
    [Console]::Out.Flush()
    continue
  }
  $h = Get-CsHwnd
  if ($h -eq [IntPtr]::Zero) { Write-Output "no-cs2"; [Console]::Out.Flush(); continue }
  [FarmIn]::Focus($h)
  if ($cmd -eq "LOOK") {
    $mx = [int][Math]::Max(-2000, [Math]::Min(2000, [int]$p[1]))
    $my = [int][Math]::Max(-1200, [Math]::Min(1200, [int]$p[2]))
    $n = 0
    $left = $mx
    $up = $my
    while ($left -ne 0 -or $up -ne 0) {
      $sx = 0; $sy = 0
      if ($left -gt 40) { $sx = 40 } elseif ($left -lt -40) { $sx = -40 } else { $sx = $left }
      if ($up -gt 24) { $sy = 24 } elseif ($up -lt -24) { $sy = -24 } else { $sy = $up }
      $n += [FarmIn]::Mouse($sx, $sy, 0x0001)
      [FarmIn]::mouse_event(0x0001, $sx, $sy, 0, [UIntPtr]::Zero)
      $left -= $sx
      $up -= $sy
      Start-Sleep -Milliseconds 8
    }
    Write-Output ("look-" + $mx + "x" + $my + "-" + $n)
  } elseif ($cmd -eq "RELEASE") {
    foreach ($vk in @(0x57, 0x41, 0x53, 0x44, 0x20, 0x10, 0x11)) {
      [FarmIn]::Key([ushort]$vk, $true) | Out-Null
      [FarmIn]::KeyPost($h, [ushort]$vk, $true)
    }
    Write-Output "release"
  } elseif ($cmd -eq "HOLD") {
    $code = [ushort]$p[1]
    $ms = [int][Math]::Max(50, [Math]::Min(8000, [int]$p[2]))
    $t0 = [Environment]::TickCount
    $n = 0
    while (([Environment]::TickCount - $t0) -lt $ms) {
      [FarmIn]::Focus($h)
      $n += [FarmIn]::Key($code, $false)
      [FarmIn]::KeyPost($h, $code, $false)
      Start-Sleep -Milliseconds 35
    }
    [FarmIn]::Key($code, $true) | Out-Null
    [FarmIn]::KeyPost($h, $code, $true)
    Write-Output ("hold n=" + $n + " ms=" + $ms)
  } elseif ($cmd -eq "KD") {
    $code = [ushort]$p[1]
    $n = [FarmIn]::Key($code, $false)
    $async = [FarmIn]::GetAsyncKeyState([int]$code)
    Write-Output ("kd n=" + $n + " async=" + $async + " cb=" + [FarmIn]::Cb())
  } elseif ($cmd -eq "KU") {
    $code = [ushort]$p[1]
    $n = [FarmIn]::Key($code, $true)
    Write-Output ("ku n=" + $n)
  } elseif ($cmd -eq "XDOWN") {
    [FarmIn]::Mouse(0, 0, 0x0080, 1) | Out-Null
    Write-Output "xdown"
  } elseif ($cmd -eq "XUP") {
    [FarmIn]::Mouse(0, 0, 0x0100, 1) | Out-Null
    Write-Output "xup"
  } elseif ($cmd -eq "FIRE") {
    [FarmIn]::Mouse(0, 0, 0x0002) | Out-Null
    Start-Sleep -Milliseconds 28
    [FarmIn]::Mouse(0, 0, 0x0004) | Out-Null
    Write-Output "fire"
  } elseif ($cmd -eq "WHEEL") {
    [FarmIn]::Mouse(0, 0, 0x0800, 120) | Out-Null
    Write-Output "wheel"
  } elseif ($cmd -eq "TYPE") {
    $text = ""
    if ($line.Length -gt 5) { $text = $line.Substring(5) }
    foreach ($ch in $text.ToCharArray()) {
      Send-Uni ([int][char]$ch)
    }
    Write-Output ("type-" + $text.Length)
  } elseif ($cmd -eq "CLICK") {
    $x = [double]$p[1]; $y = [double]$p[2]
    $rc = New-Object FarmIn+RECT
    [FarmIn]::GetClientRect($h, [ref]$rc) | Out-Null
    $w = [Math]::Max(8, $rc.R - $rc.L)
    $ht = [Math]::Max(8, $rc.B - $rc.T)
    $pt = New-Object FarmIn+POINT
    $pt.X = [int]($w * $x / 100)
    $pt.Y = [int]($ht * $y / 100)
    [FarmIn]::ClientToScreen($h, [ref]$pt) | Out-Null
    $sw = [Math]::Max(1, [FarmIn]::GetSystemMetrics(0))
    $sh = [Math]::Max(1, [FarmIn]::GetSystemMetrics(1))
    $absX = [int](($pt.X * 65535) / $sw)
    $absY = [int](($pt.Y * 65535) / $sh)
    [FarmIn]::Mouse($absX, $absY, 0x8001) | Out-Null
    Start-Sleep -Milliseconds 20
    [FarmIn]::Mouse($absX, $absY, 0x8002) | Out-Null
    Start-Sleep -Milliseconds 20
    [FarmIn]::Mouse($absX, $absY, 0x8004) | Out-Null
    Write-Output ("click-" + $pt.X + "x" + $pt.Y)
  } else {
    Write-Output "noop"
  }
  if ($cmd -ne "KD" -and $cmd -ne "HOLD" -and $cmd -ne "KU" -and $cmd -ne "LOOK" -and $cmd -ne "RELEASE") { [FarmIn]::Unfocus($h) }
  [Console]::Out.Flush()
}
