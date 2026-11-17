using System;
using System.Runtime.InteropServices;

internal static class FarmHid {
  const uint WM_MOUSEMOVE = 0x0200;
  const uint WM_LBUTTONDOWN = 0x0201;
  const uint WM_LBUTTONUP = 0x0202;
  const uint WM_KEYDOWN = 0x0100;
  const uint WM_KEYUP = 0x0101;
  const uint WM_CHAR = 0x0102;
  const uint MK_LBUTTON = 0x0001;

  [DllImport("user32.dll")]
  static extern bool GetClientRect(IntPtr h, out RECT r);

  [DllImport("user32.dll")]
  static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);

  [DllImport("user32.dll")]
  static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);

  [DllImport("user32.dll")]
  static extern uint MapVirtualKey(uint c, uint m);

  [DllImport("user32.dll")]
  static extern bool IsWindow(IntPtr h);

  struct RECT {
    public int L, T, R, B;
  }

  static int Main(string[] args) {
    if (args.Length < 1) {
      Console.WriteLine("usage click|key");
      return 2;
    }
    var cmd = args[0].ToLowerInvariant();
    if (cmd == "click") {
      if (args.Length < 4) return 2;
      return Click(new IntPtr(long.Parse(args[1])), int.Parse(args[2]), int.Parse(args[3]));
    }
    if (cmd == "key") {
      if (args.Length < 4) return 2;
      return Key(new IntPtr(long.Parse(args[1])), int.Parse(args[2]), args[3].ToLowerInvariant() == "up");
    }
    Console.WriteLine("usage click|key");
    return 2;
  }

  static int Click(IntPtr hwnd, int pctX, int pctY) {
    if (!IsWindow(hwnd)) {
      Console.WriteLine("no-hwnd");
      return 1;
    }
    pctX = Math.Max(1, Math.Min(99, pctX));
    pctY = Math.Max(1, Math.Min(99, pctY));
    RECT rc;
    if (!GetClientRect(hwnd, out rc)) {
      Console.WriteLine("no-rect");
      return 1;
    }
    int w = Math.Max(8, rc.R - rc.L);
    int h = Math.Max(8, rc.B - rc.T);
    int cx = w * pctX / 100;
    int cy = h * pctY / 100;
    IntPtr lp = new IntPtr((cy << 16) | (cx & 0xffff));
    SendMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, lp);
    PostMessage(hwnd, WM_LBUTTONDOWN, new IntPtr(MK_LBUTTON), lp);
    PostMessage(hwnd, WM_LBUTTONUP, IntPtr.Zero, lp);
    Console.WriteLine("box-" + cx + "x" + cy + "-" + w + "x" + h);
    return 0;
  }

  static int Key(IntPtr hwnd, int vk, bool up) {
    if (!IsWindow(hwnd)) {
      Console.WriteLine("no-hwnd");
      return 1;
    }
    uint scan = MapVirtualKey((uint)vk, 0);
    int lp = 1 | ((int)scan << 16);
    if (up) lp |= (1 << 30) | (1 << 31);
    uint msg = up ? WM_KEYUP : WM_KEYDOWN;
    SendMessage(hwnd, msg, new IntPtr(vk), new IntPtr(lp));
    PostMessage(hwnd, msg, new IntPtr(vk), new IntPtr(lp));
    if (!up && (vk == 0x0d || vk == 0x1b)) {
      PostMessage(hwnd, WM_CHAR, new IntPtr(vk), new IntPtr(lp));
    }
    Console.WriteLine(up ? "ku" : "kd");
    return 0;
  }
}
