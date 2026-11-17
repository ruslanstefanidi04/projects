import { spawnSync } from "child_process";
import { csHwndInBox } from "./sandbox.mjs";

export const VK = {
  ESC: 0x1b,
  RETURN: 0x0d,
  SPACE: 0x20,
  TAB: 0x09,
  SHIFT: 0x10,
  W: 0x57,
  A: 0x41,
  S: 0x53,
  D: 0x44,
  B: 0x42,
  G: 0x47,
  E: 0x45,
  R: 0x52,
  F: 0x46,
  N1: 0x31,
  N2: 0x32,
  N3: 0x33,
  N4: 0x34,
  N5: 0x35,
  N6: 0x36
};

let activeBox = "";
let agentIp = "";
let agentToken = "csfarm";
let agentPort = 39200;

export function setInputBox(box) {
  activeBox = String(box || "");
  if (activeBox) agentIp = "";
}

export function setInputAgent(ip, token = "csfarm", port = 39200) {
  agentIp = String(ip || "").trim();
  agentToken = String(token || "csfarm");
  agentPort = Number(port) || 39200;
  if (agentIp) activeBox = "";
}

async function agentInput(kind, extra = {}) {
  if (!agentIp) return "";
  try {
    const r = await fetch(`http://${agentIp}:${agentPort}/input`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ kind, ...extra }),
      signal: AbortSignal.timeout(5000)
    });
    const j = await r.json().catch(() => ({}));
    return j.out || (j.ok ? "ok" : "");
  } catch {
    return "";
  }
}

function run(ps) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000
  });
  return String(r.stdout || "").trim();
}

function hwnd() {
  return csHwndInBox(activeBox);
}

function msg(extra) {
  const h = hwnd();
  if (!h) {
    console.log("box input skip, no cs2 hwnd");
    return "";
  }
  return run(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BoxMsg {
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint m);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
$h = [IntPtr]${h}
${extra}
`);
}

export function focusCs() {}

export function keyDown(vk) {
  const code = Number(vk) || 0;
  if (agentIp) {
    agentInput("keydown", { vk: code });
    return;
  }
  msg(`
$scan = [BoxMsg]::MapVirtualKey(${code}, 0)
$lp = [IntPtr][int]((1) -bor ($scan -shl 16))
[BoxMsg]::SendMessage($h, 0x100, [IntPtr]${code}, $lp) | Out-Null
[BoxMsg]::PostMessage($h, 0x100, [IntPtr]${code}, $lp) | Out-Null
Write-Output 'kd'
`);
}

export function keyUp(vk) {
  const code = Number(vk) || 0;
  if (agentIp) {
    agentInput("keyup", { vk: code });
    return;
  }
  msg(`
$scan = [BoxMsg]::MapVirtualKey(${code}, 0)
$lp = [IntPtr][int]((1) -bor ($scan -shl 16) -bor (1 -shl 30) -bor (1 -shl 31))
[BoxMsg]::SendMessage($h, 0x101, [IntPtr]${code}, $lp) | Out-Null
[BoxMsg]::PostMessage($h, 0x101, [IntPtr]${code}, $lp) | Out-Null
Write-Output 'ku'
`);
}

export function releaseAll() {
  for (const k of [VK.W, VK.A, VK.S, VK.D, VK.SPACE, VK.SHIFT, VK.E, VK.R]) keyUp(k);
}

export function padA() {
  return false;
}

export function clickPct(px, py) {
  const x = Math.max(1, Math.min(99, Number(px) || 50));
  const y = Math.max(1, Math.min(99, Number(py) || 50));
  if (agentIp) {
    agentInput("click", { x, y }).then((out) => console.log("vm msg", x, y, out || "fail"));
    return true;
  }
  const out = msg(`
$rc = New-Object BoxMsg+RECT
[BoxMsg]::GetClientRect($h, [ref]$rc) | Out-Null
$w = [Math]::Max(8, $rc.R - $rc.L)
$ht = [Math]::Max(8, $rc.B - $rc.T)
$cx = [int]($w * ${x} / 100)
$cy = [int]($ht * ${y} / 100)
$lp = [IntPtr][int](($cy -shl 16) -bor ($cx -band 0xffff))
[BoxMsg]::SendMessage($h, 0x0200, [IntPtr]0, $lp) | Out-Null
[BoxMsg]::PostMessage($h, 0x0201, [IntPtr]1, $lp) | Out-Null
[BoxMsg]::PostMessage($h, 0x0202, [IntPtr]0, $lp) | Out-Null
Write-Output ('msg-' + $cx + 'x' + $cy + '-' + $w + 'x' + $ht)
`);
  console.log("box msg", x, y, out || "fail");
  return /msg-/.test(out);
}

export function click() {
  clickPct(50, 50);
}

export function mouse() {}
export function mouseDown() {}
export function mouseUp() {}

export async function tap(vk, downMs = 50, afterMs = 80) {
  keyDown(vk);
  await new Promise((r) => setTimeout(r, downMs));
  keyUp(vk);
  await new Promise((r) => setTimeout(r, afterMs));
}
