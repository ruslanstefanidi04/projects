using System;
using System.Runtime.InteropServices;
using System.Threading;

internal static class FarmPad {
  const uint VIGEM_OK = 0x20000000;
  const ushort XUSB_A = 0x1000;

  [StructLayout(LayoutKind.Sequential)]
  struct XUSB_REPORT {
    public ushort wButtons;
    public byte bLeftTrigger;
    public byte bRightTrigger;
    public short sThumbLX;
    public short sThumbLY;
    public short sThumbRX;
    public short sThumbRY;
  }

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern IntPtr vigem_alloc();

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern void vigem_free(IntPtr vigem);

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern uint vigem_connect(IntPtr vigem);

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern void vigem_disconnect(IntPtr vigem);

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern IntPtr vigem_target_x360_alloc();

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern void vigem_target_free(IntPtr target);

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern uint vigem_target_add(IntPtr vigem, IntPtr target);

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern uint vigem_target_remove(IntPtr vigem, IntPtr target);

  [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.StdCall)]
  static extern uint vigem_target_x360_update(IntPtr vigem, IntPtr target, XUSB_REPORT report);

  static int Main(string[] args) {
    if (args.Length < 1) {
      Console.WriteLine("usage a|idle");
      return 2;
    }
    var cmd = args[0].ToLowerInvariant();
    var client = vigem_alloc();
    if (client == IntPtr.Zero) {
      Console.WriteLine("pad-fail alloc");
      return 1;
    }
    var err = vigem_connect(client);
    if (err != VIGEM_OK) {
      Console.WriteLine("pad-fail connect " + err.ToString("X"));
      vigem_free(client);
      return 1;
    }
    var pad = vigem_target_x360_alloc();
    err = vigem_target_add(client, pad);
    if (err != VIGEM_OK) {
      Console.WriteLine("pad-fail add " + err.ToString("X"));
      vigem_target_free(pad);
      vigem_disconnect(client);
      vigem_free(client);
      return 1;
    }
    var r = new XUSB_REPORT();
    if (cmd == "a" || cmd == "go") {
      r.wButtons = XUSB_A;
      vigem_target_x360_update(client, pad, r);
      Thread.Sleep(80);
      r.wButtons = 0;
      vigem_target_x360_update(client, pad, r);
      Console.WriteLine("pad-a");
    } else if (cmd == "idle") {
      vigem_target_x360_update(client, pad, r);
      Console.WriteLine("pad-ok");
      Thread.Sleep(100);
    } else {
      Console.WriteLine("unknown");
    }
    vigem_target_remove(client, pad);
    vigem_target_free(pad);
    vigem_disconnect(client);
    vigem_free(client);
    return 0;
  }
}
