import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";

const exe = path.join(path.dirname(fileURLToPath(import.meta.url)), "bin", "farm-desk.exe");

export function deskName(box) {
  return String(box || "csfarm").replace(/[^a-z0-9]/gi, "").slice(0, 32) || "csfarm";
}

export function deskPipe(box) {
  return "csfarm-" + deskName(box);
}

export function deskExe() {
  return exe;
}

export function ensureDesk(box) {
  if (!existsSync(exe)) return false;
  const r = spawnSync(exe, ["ensure", deskName(box)], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  const out = String(r.stdout || "").trim();
  console.log("desk ensure", out || r.status);
  return /desk-ok/.test(out);
}

export function spawnOnDesk(box, file, args) {
  if (!existsSync(exe)) return false;
  const desk = deskName(box);
  const r = spawnSync(exe, ["spawn", desk, "--", file, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000
  });
  const out = String(r.stdout || "").trim();
  console.log("desk spawn", out || "fail");
  return /spawn-ok/.test(out);
}

export function startDeskAgent(box) {
  if (!existsSync(exe)) return false;
  const desk = deskName(box);
  const pipe = deskPipe(box);
  spawn(exe, ["agent", desk, pipe], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();
  console.log("desk agent", pipe);
  return true;
}

export async function waitDeskAgent(box, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const out = await deskCmd(box, "ping");
    if (out === "pong") {
      console.log("desk agent ready");
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("desk agent wait fail");
  return false;
}

export function deskCmd(box, line) {
  return new Promise((resolve) => {
    const sock = net.connect({ path: "\\\\.\\pipe\\" + deskPipe(box) });
    let buf = "";
    const t = setTimeout(() => {
      try { sock.destroy(); } catch {}
      resolve("");
    }, 3000);
    sock.on("connect", () => {
      sock.write(String(line).trim() + "\n");
    });
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      if (buf.indexOf("\n") >= 0) {
        clearTimeout(t);
        try { sock.end(); } catch {}
        resolve(buf.trim().split(/\r?\n/)[0]);
      }
    });
    sock.on("error", () => {
      clearTimeout(t);
      resolve("");
    });
  });
}
