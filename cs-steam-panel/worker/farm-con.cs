using System;
using System.Net.Sockets;
using System.Text;
using System.Threading;

internal static class FarmCon {
  static int Main(string[] args) {
    if (args.Length < 2) {
      Console.WriteLine("usage port cmd");
      return 2;
    }
    int port;
    if (!int.TryParse(args[0], out port) || port < 1) {
      Console.WriteLine("con-fail port");
      return 2;
    }
    if (args[1] == "--hold" && args.Length >= 4) {
      var on = args[2];
      int ms;
      if (!int.TryParse(args[3], out ms)) ms = 400;
      var off = on.StartsWith("+") ? ("-" + on.Substring(1)) : ("-" + on);
      if (!Send(port, on)) return 1;
      Thread.Sleep(Math.Max(40, Math.Min(4000, ms)));
      return Send(port, off) ? 0 : 1;
    }
    var cmd = string.Join(" ", args, 1, args.Length - 1);
    return Send(port, cmd) ? 0 : 1;
  }

  static bool Send(int port, string cmd) {
    try {
      using (var c = new TcpClient()) {
        var ar = c.BeginConnect("127.0.0.1", port, null, null);
        if (!ar.AsyncWaitHandle.WaitOne(1200)) {
          Console.WriteLine("con-fail timeout");
          return false;
        }
        c.EndConnect(ar);
        var s = c.GetStream();
        s.WriteTimeout = 1200;
        var b = Encoding.ASCII.GetBytes(cmd.Replace('\r', ' ').Replace('\n', ' ') + "\n");
        s.Write(b, 0, b.Length);
        s.Flush();
        Thread.Sleep(40);
        Console.WriteLine("con-ok");
        return true;
      }
    } catch (Exception e) {
      Console.WriteLine("con-fail " + e.Message);
      return false;
    }
  }
}
