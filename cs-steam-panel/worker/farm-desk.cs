using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class FarmDesk {
  const uint DESKTOP_ALL = 0x01FF;
  const uint GENERIC_ALL = 0x10000000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint DETACHED = 0x00000008;
  const uint WM_MOUSEMOVE = 0x0200;
  const uint WM_LBUTTONDOWN = 0x0201;
  const uint WM_LBUTTONUP = 0x0202;
  const uint WM_KEYDOWN = 0x0100;
  const uint WM_KEYUP = 0x0101;
  const uint MK_LBUTTON = 1;
  const int SW_SHOWNOACTIVATE = 4;

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr CreateDesktop(string n, IntPtr d, IntPtr h, int f, uint a, IntPtr s);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr OpenDesktop(string n, int f, bool inherit, uint a);

  [DllImport("user32.dll")]
  static extern bool SetThreadDesktop(IntPtr h);

  [DllImport("user32.dll")]
  static extern bool CloseDesktop(IntPtr h);

  [DllImport("user32.dll")]
  static extern bool ShowWindow(IntPtr h, int n);

  [DllImport("user32.dll")]
  static extern bool GetClientRect(IntPtr h, out RECT r);

  [DllImport("user32.dll")]
  static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);

  [DllImport("user32.dll")]
  static extern uint MapVirtualKey(uint c, uint m);

  [DllImport("user32.dll")]
  static extern bool IsWindow(IntPtr h);

  [DllImport("user32.dll")]
  static extern bool EnumDesktopWindows(IntPtr h, EnumCb cb, IntPtr l);

  [DllImport("user32.dll")]
  static extern int GetWindowText(IntPtr h, StringBuilder s, int n);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr h);

  delegate bool EnumCb(IntPtr h, IntPtr l);

  struct RECT { public int L, T, R, B; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }

  struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public uint dwProcessId, dwThreadId;
  }

  static string DeskPath(string name) {
    if (string.IsNullOrEmpty(name)) return "WinSta0\\Default";
    if (name.IndexOf('\\') >= 0) return name;
    return "WinSta0\\" + name;
  }

  static IntPtr Ensure(string name) {
    var h = OpenDesktop(name, 0, true, GENERIC_ALL | DESKTOP_ALL);
    if (h != IntPtr.Zero) return h;
    return CreateDesktop(name, IntPtr.Zero, IntPtr.Zero, 0, GENERIC_ALL | DESKTOP_ALL, IntPtr.Zero);
  }

  static int Main(string[] args) {
    if (args.Length < 1) {
      Console.WriteLine("usage ensure|spawn|agent");
      return 2;
    }
    var cmd = args[0].ToLowerInvariant();
    if (cmd == "ensure") {
      var h = Ensure(args.Length > 1 ? args[1] : "csfarm");
      Console.WriteLine(h != IntPtr.Zero ? "desk-ok" : "desk-fail");
      return h != IntPtr.Zero ? 0 : 1;
    }
    if (cmd == "spawn") {
      if (args.Length < 4) return 2;
      var desk = args[1];
      int i = 2;
      if (args[i] == "--") i++;
      var sb = new StringBuilder();
      for (; i < args.Length; i++) {
        if (sb.Length > 0) sb.Append(' ');
        var a = args[i];
        if (a.IndexOf(' ') >= 0) sb.Append('"').Append(a).Append('"');
        else sb.Append(a);
      }
      return Spawn(desk, sb.ToString());
    }
    if (cmd == "send") {
      if (args.Length < 3) return 2;
      var pipe = args[1];
      var line = string.Join(" ", args, 2, args.Length - 2);
      try {
        var cli = new NamedPipeClientStream(".", pipe, PipeDirection.InOut);
        cli.Connect(2500);
        var enc = new UTF8Encoding(false);
        var wr = new StreamWriter(cli, enc) { AutoFlush = true };
        var rd = new StreamReader(cli, enc);
        wr.WriteLine(line);
        var ans = rd.ReadLine();
        Console.WriteLine(string.IsNullOrEmpty(ans) ? "empty" : ans);
        return 0;
      } catch (Exception e) {
        Console.WriteLine("send-fail " + e.Message);
        return 1;
      }
    }
    if (cmd == "agent") {
      if (args.Length < 3) return 2;
      Agent(args[1], args[2]);
      return 0;
    }
    return 2;
  }

  static int Spawn(string desk, string cmd) {
    var h = Ensure(desk);
    if (h == IntPtr.Zero) {
      Console.WriteLine("desk-fail");
      return 1;
    }
    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.lpDesktop = DeskPath(desk);
    PROCESS_INFORMATION pi;
    var buf = new StringBuilder(cmd);
    bool ok = CreateProcess(null, buf, IntPtr.Zero, IntPtr.Zero, false, CREATE_UNICODE_ENVIRONMENT | DETACHED, IntPtr.Zero, null, ref si, out pi);
    if (ok) {
      CloseHandle(pi.hThread);
      CloseHandle(pi.hProcess);
      Console.WriteLine("spawn-ok " + pi.dwProcessId);
      return 0;
    }
    Console.WriteLine("spawn-fail " + Marshal.GetLastWin32Error());
    return 1;
  }

  static IntPtr FindCs(IntPtr hDesk) {
    IntPtr best = IntPtr.Zero;
    int bestA = 0;
    EnumDesktopWindows(hDesk, (h, l) => {
      var sb = new StringBuilder(256);
      GetWindowText(h, sb, 256);
      var t = sb.ToString();
      if (t.IndexOf("Counter-Strike", StringComparison.OrdinalIgnoreCase) < 0 && t.IndexOf("CS2", StringComparison.OrdinalIgnoreCase) < 0) return true;
      RECT rc;
      GetClientRect(h, out rc);
      int a = Math.Max(0, rc.R - rc.L) * Math.Max(0, rc.B - rc.T);
      if (a >= bestA) {
        bestA = a;
        best = h;
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }

  static void Agent(string desk, string pipe) {
    var hDesk = Ensure(desk);
    Console.WriteLine("agent " + desk);
    while (true) {
      NamedPipeServerStream srv = null;
      try {
        srv = new NamedPipeServerStream(pipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
        srv.WaitForConnection();
        var enc = new UTF8Encoding(false);
        var r = new StreamReader(srv, enc);
        var w = new StreamWriter(srv, enc) { AutoFlush = true };
        string line;
        while ((line = r.ReadLine()) != null) {
          var p = line.Trim().Split(' ');
          if (p.Length == 0) continue;
          if (p[0] == "ping") { w.WriteLine("pong"); continue; }
          var hwnd = FindCs(hDesk);
          if (p[0] == "hwnd") {
            w.WriteLine(hwnd == IntPtr.Zero ? "no-hwnd" : ("hwnd-" + hwnd.ToInt64()));
            continue;
          }
          if (hwnd == IntPtr.Zero) { w.WriteLine("no-hwnd"); continue; }
          if (p[0] == "click" && p.Length >= 3) {
            w.WriteLine(Click(hwnd, int.Parse(p[1]), int.Parse(p[2])));
          } else if (p[0] == "key" && p.Length >= 3) {
            w.WriteLine(Key(hwnd, int.Parse(p[1]), p[2] == "up"));
          } else w.WriteLine("unk");
        }
      } catch (Exception e) {
        Console.WriteLine("agent-err " + e.Message);
        Thread.Sleep(400);
      } finally {
        try { if (srv != null) srv.Dispose(); } catch {}
      }
    }
  }

  static string Click(IntPtr hwnd, int pctX, int pctY) {
    pctX = Math.Max(1, Math.Min(99, pctX));
    pctY = Math.Max(1, Math.Min(99, pctY));
    RECT rc;
    GetClientRect(hwnd, out rc);
    int w = Math.Max(8, rc.R - rc.L);
    int h = Math.Max(8, rc.B - rc.T);
    int cx = w * pctX / 100;
    int cy = h * pctY / 100;
    ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    IntPtr lp = new IntPtr((cy << 16) | (cx & 0xffff));
    PostMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, lp);
    PostMessage(hwnd, WM_LBUTTONDOWN, new IntPtr(MK_LBUTTON), lp);
    Thread.Sleep(20);
    PostMessage(hwnd, WM_LBUTTONUP, IntPtr.Zero, lp);
    return "click-" + cx + "x" + cy + "-" + w + "x" + h;
  }

  static string Key(IntPtr hwnd, int vk, bool up) {
    ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    uint scan = MapVirtualKey((uint)vk, 0);
    int lp = 1 | ((int)scan << 16);
    if (up) lp |= (1 << 30) | (1 << 31);
    PostMessage(hwnd, up ? WM_KEYUP : WM_KEYDOWN, new IntPtr(vk), new IntPtr(lp));
    return up ? "ku" : "kd";
  }
}
