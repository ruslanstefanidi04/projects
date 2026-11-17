import { spawnSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { VK, clickPct, keyDown as agentKeyDown, keyUp as agentKeyUp, tap, setInputAgent } from "./input.mjs";
import { sleep } from "./pace.mjs";

let agentIp = "";
let agentToken = "csfarm";
let agentPort = 39200;
let hvBridge = "http://127.0.0.1:39201";
const HOST_VISION = "D:/FarmVMs/ops/vision";

export function setVisionAgent(ip, token = "csfarm", port = 39200) {
  agentIp = String(ip || "").trim();
  agentToken = String(token || "csfarm");
  agentPort = Number(port) || 39200;
  setInputAgent(agentIp, agentToken, agentPort);
}

export function setHvBridge(url) {
  hvBridge = String(url || "").trim();
}

async function agent(route, opts = {}) {
  if (!agentIp) return null;
  try {
    const r = await fetch(`http://${agentIp}:${agentPort}${route}`, {
      method: opts.method || "GET",
      headers: {
        authorization: `Bearer ${agentToken}`,
        ...(opts.body ? { "content-type": "application/json" } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs || 8000)
    });
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

async function hv(route, body = {}) {
  if (!hvBridge) return null;
  try {
    const r = await fetch(`${hvBridge}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function senseClick(x, y) {
  const ax = Math.max(1, Math.min(99, Number(x) || 50));
  const ay = Math.max(1, Math.min(99, Number(y) || 50));
  // prefer guest SendInput (same session as cs2); HV as fallback
  const viaAgent = await agent("/input", {
    method: "POST",
    body: { kind: "click", x: ax, y: ay },
    timeoutMs: 5000
  });
  if (viaAgent && viaAgent.ok) {
    console.log("click agent", ax, ay, viaAgent.out || "ok");
    return true;
  }
  const viaHv = await hv("/click", { x: ax, y: ay });
  if (viaHv && viaHv.ok) {
    console.log("click hv", ax, ay);
    return true;
  }
  clickPct(ax, ay);
  console.log("click fallback", ax, ay);
  return false;
}

export async function senseKey(textOrVk) {
  if (typeof textOrVk === "number") {
    const viaHv = await hv("/key", { vk: textOrVk });
    if (viaHv && viaHv.ok) return true;
    await tap(textOrVk, 50, 60);
    return false;
  }
  const text = String(textOrVk || "{ENTER}");
  if (text === "{ENTER}" || text === "enter") {
    const k = await hv("/key", { vk: 0x0d });
    if (k && k.ok) return true;
  }
  if (text === " " || text === "{SPACE}") {
    const k = await hv("/key", { vk: 0x20 });
    if (k && k.ok) return true;
  }
  if (text === "{ESC}" || text === "esc") {
    const k = await hv("/key", { vk: 0x1b });
    if (k && k.ok) return true;
  }
  const viaHv = await hv("/key", { text });
  if (viaHv && viaHv.ok) return true;
  return false;
}

export async function senseHold(vk, ms) {
  const code = Number(vk) || 0;
  const via = await hv("/hold", { vk: code, ms: Math.max(40, ms | 0) });
  if (via && via.ok) return true;
  agentKeyDown(code);
  await sleep(Math.max(40, ms | 0));
  agentKeyUp(code);
  return false;
}

/** pull guest cs2 shot into host live.png for teach + cv. jpeg from guest is ok. */
export async function pullGuestVision() {
  mkdirSync(HOST_VISION, { recursive: true });
  let j = { ok: false };
  try {
    const r = await fetch(`http://${agentIp}:${agentPort}/shot?token=${encodeURIComponent(agentToken)}`, {
      headers: { authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(path.join(HOST_VISION, "live.png"), buf);
      writeFileSync(path.join(HOST_VISION, "shot.png"), buf);
      j = { ok: true, w: 0, h: 0, mean: 1, black: false, greens: [], spots: [] };
    }
  } catch (e) {
    return { ok: false, spots: [], mean: 0, src: "none", reason: String(e.message || e) };
  }
  return {
    ok: Boolean(j.ok),
    w: j.w,
    h: j.h,
    spots: [],
    cta: null,
    mean: j.mean,
    black: Boolean(j.black),
    src: "guest",
    png: path.join(HOST_VISION, "live.png")
  };
}

const VMCON_SHOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "vm",
  "host-vmconnect-shot.ps1"
);

/** host capture of vmconnect (the console you watch). guest gpu-pv printwindow is black. */
export function pullVmconnectVision() {
  mkdirSync(HOST_VISION, { recursive: true });
  const png = path.join(HOST_VISION, "live.png");
  const jsonPath = path.join(HOST_VISION, "vmconnect-shot.json");
  if (!existsSync(VMCON_SHOT)) {
    return { ok: false, black: true, mean: 0, src: "vmconnect", reason: "no-ps1" };
  }
  spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", VMCON_SHOT, "-OutPng", png, "-OutJson", jsonPath],
    { encoding: "utf8", windowsHide: true, timeout: 4500 }
  );
  let j = {};
  try {
    j = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return { ok: false, black: true, mean: 0, src: "vmconnect", reason: "no-json" };
  }
  return {
    ok: Boolean(j.ok) && !j.black && Number(j.mean) >= 4,
    w: j.w,
    h: j.h,
    mean: j.mean,
    black: Boolean(j.black),
    src: "vmconnect",
    png,
    reason: j.error || (j.black ? "black" : null)
  };
}

export async function seeScreen() {
  // only guest files — never host mss / Cursor desktop
  return pullGuestVision();
}

export async function doSenseAction(action, vision = {}) {
  const a = String(action || "wait");
  if (a === "wait") {
    await sleep(120 + Math.random() * 180);
    return;
  }
  if (a === "cta_click") {
    await senseClick(vision.cta?.x ?? 50, vision.cta?.y ?? 70);
    return;
  }
  if (a === "cta_enter") {
    await senseKey("{ENTER}");
    await sleep(80);
    await senseKey(" ");
    return;
  }
  if (a === "forward") {
    await senseHold(VK.W, 320 + Math.random() * 420);
    return;
  }
  if (a === "back") {
    await senseHold(VK.S, 200 + Math.random() * 200);
    return;
  }
  if (a === "strafe_l") {
    await senseHold(VK.A, 240 + Math.random() * 260);
    return;
  }
  if (a === "strafe_r") {
    await senseHold(VK.D, 240 + Math.random() * 260);
    return;
  }
  if (a === "shoot") {
    await senseClick(50 + (Math.random() * 6 - 3), 50 + (Math.random() * 4 - 2));
    await sleep(70 + Math.random() * 120);
    return;
  }
  if (a === "aim_l") {
    await senseClick(35 + Math.random() * 10, 48 + Math.random() * 6);
    return;
  }
  if (a === "aim_r") {
    await senseClick(55 + Math.random() * 10, 48 + Math.random() * 6);
    return;
  }
  if (a === "plant" || a === "defuse" || a === "use") {
    await senseHold(VK.E, a === "plant" || a === "defuse" ? 1000 : 140);
    return;
  }
  if (a === "jump") await senseKey(VK.SPACE);
}
