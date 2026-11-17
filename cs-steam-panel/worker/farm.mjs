// farm cli: one entry for status / show / play local comp-bots. no _tmp bring-up.
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { farmLanOn } from "./vm/farm-net.mjs";
import { netconPort } from "./con.mjs";
import { GOLDEN_NAME, FARM_ROOT } from "./vm/defaults.mjs";
import { ensureCvWorker, restartCvWorker } from "./cv-worker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const VISION = path.join(FARM_ROOT, "ops", "vision");
const FSM_LOG = path.join(VISION, "fsm.log");
const PID_FILE = path.join(VISION, "farm-bot.pid");
const BRIDGE_PS = path.join(FARM_ROOT, "ops", "hv-bridge.ps1");

function loadEnv() {
  for (const rel of ["worker/.env", ".env", path.join(__dirname, ".env")]) {
    const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const ip = process.env.FARM_GOLDEN_IP || "10.250.0.10";
const agentPort = Number(process.env.FARM_AGENT_PORT || 39200);
const token = process.env.FARM_AGENT_TOKEN || "csfarm";
const gsiPort = Number(process.env.BOT_GSI_PORT || 32222);
const mapName = process.env.FARM_MAP || "de_mirage";
const hvUrl = "http://127.0.0.1:39201";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ps(cmd, timeout = 20000) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", cmd], {
    encoding: "utf8",
    windowsHide: true,
    timeout
  });
  return {
    status: r.status || 0,
    out: String(r.stdout || "").trim(),
    err: String(r.stderr || "").trim()
  };
}

function log(line) {
  console.log(line);
}

async function agent(route, body, timeoutMs = 12000) {
  const sep = route.includes("?") ? "&" : "?";
  const url = `http://${ip}:${agentPort}${route}${sep}token=${encodeURIComponent(token)}`;
  try {
    const r = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const t = await r.text();
    try {
      return JSON.parse(t);
    } catch {
      return { ok: false, raw: t.slice(0, 240), status: r.status };
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function hv(route, body = {}, timeoutMs = 15000) {
  try {
    const r = await fetch(hvUrl + route, {
      method: route === "/ping" ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: route === "/ping" ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return await r.json().catch(() => ({ ok: false }));
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function nodeByCmd(re) {
  const r = ps(
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }`
  );
  const hits = [];
  for (const line of r.out.split(/\r?\n/)) {
    const i = line.indexOf("|");
    if (i < 1) continue;
    const pid = Number(line.slice(0, i));
    const cmd = line.slice(i + 1);
    if (pid && re.test(cmd)) hits.push({ pid, cmd });
  }
  return hits;
}

function killPids(pids) {
  for (const pid of pids) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  }
}

function killLoop() {
  const vks = [0x57, 0x41, 0x53, 0x44, 0x20];
  for (const vk of vks) {
    agent("/input", { kind: "keyup", vk }, 1500).catch(() => {});
  }
  const pids = new Set(nodeByCmd(/fsm[\\/]loop\.mjs/).map((x) => x.pid));
  const listen = ps(
    `Get-NetTCPConnection -LocalPort ${gsiPort} -State Listen -EA SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
  );
  for (const n of listen.out.split(/\s+/)) {
    const pid = Number(n);
    if (pid) pids.add(pid);
  }
  killPids([...pids]);
  try {
    writeFileSync(PID_FILE, "");
  } catch {}
}

async function pingAgent() {
  return agent("/ping");
}

function vmState() {
  const r = ps(`(Get-VM -Name '${GOLDEN_NAME}' -EA SilentlyContinue).State`);
  return r.out || "missing";
}

function ensureVm() {
  const st = vmState();
  if (/running/i.test(st)) return st;
  log("start vm " + GOLDEN_NAME);
  ps(`Start-VM -Name '${GOLDEN_NAME}'`, 60000);
  return vmState();
}

function hostScreen() {
  const r = ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
}
"@
[FarmDpi]::SetProcessDPIAware() | Out-Null
$w = [FarmDpi]::GetSystemMetrics(0)
$h = [FarmDpi]::GetSystemMetrics(1)
Write-Output ("0 0 " + $w + " " + $h)
`);
  const p = r.out.split(/\s+/).map(Number);
  const x = Number.isFinite(p[0]) ? p[0] : 0;
  const y = Number.isFinite(p[1]) ? p[1] : 0;
  const w = p[2] >= 800 ? p[2] : 1920;
  const h = p[3] >= 600 ? p[3] : 1080;
  return { x, y, w, h };
}

function ensureVideo(size) {
  const s = size || hostScreen();
  ps(
    `try { Set-VMHost -EnableEnhancedSessionMode $false } catch {}; try { Set-VMVideo -VMName '${GOLDEN_NAME}' -HorizontalResolution ${s.w} -VerticalResolution ${s.h} -ResolutionType Single } catch {}`
  );
  return s;
}

function fillVmconnect(size) {
  const s = size || hostScreen();
  ps(`
Add-Type @"
using System; using System.Runtime.InteropServices;
public class FarmShow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f);
}
"@
Get-Process vmconnect -EA SilentlyContinue | ForEach-Object {
  if ($_.MainWindowHandle -ne [IntPtr]::Zero) {
    $h = $_.MainWindowHandle
    [FarmShow]::ShowWindow($h, 3) | Out-Null
    [FarmShow]::MoveWindow($h, ${s.x}, ${s.y}, ${s.w}, ${s.h}, $true) | Out-Null
    [FarmShow]::SetWindowPos($h, [IntPtr]::Zero, ${s.x}, ${s.y}, ${s.w}, ${s.h}, 0x0040) | Out-Null
    [FarmShow]::SetForegroundWindow($h) | Out-Null
  }
}
`);
}

function showConsole() {
  const s = ensureVideo();
  const has = ps(`Get-Process vmconnect -EA SilentlyContinue | Select-Object -First 1 -ExpandProperty Id`).out;
  if (!has) {
    spawn("C:\\Windows\\System32\\vmconnect.exe", ["localhost", GOLDEN_NAME], {
      detached: true,
      stdio: "ignore"
    }).unref();
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    fillVmconnect(s);
    const hwnd = ps(
      `Get-Process vmconnect -EA SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 -ExpandProperty Id`
    ).out;
    if (hwnd) break;
    spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 250"], {
      windowsHide: true
    });
  }
  fillVmconnect(s);
  log("console fill " + s.w + "x" + s.h + " " + GOLDEN_NAME);
  return s;
}

function startTeachServer() {
  const already = nodeByCmd(/teach-server\.mjs/);
  if (already.length) return already[0].pid;
  const child = spawn(process.execPath, ["teach-server.mjs"], {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  log("teach http://127.0.0.1:39210");
  return child.pid;
}

function restartTeachServer() {
  killPids(nodeByCmd(/teach-server\.mjs/).map((x) => x.pid));
  return startTeachServer();
}

function stopGlass() {
  ps(
    `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'host-overlay.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }`
  );
}

async function deployGuestEyes() {
  const files = [
    ["guest-shot.ps1", path.join(__dirname, "vm", "guest-shot.ps1")],
    ["guest-shot-loop.ps1", path.join(__dirname, "vm", "guest-shot-loop.ps1")],
    ["guest-shot.oneshot.ps1", path.join(__dirname, "vm", "guest-shot.oneshot.ps1")],
    ["guest-overlay.ps1", path.join(__dirname, "vm", "guest-overlay.ps1")],
    ["guest-agent.mjs", path.join(__dirname, "vm", "guest-agent.mjs")],
    ["guest-input.ps1", path.join(__dirname, "vm", "guest-input.ps1")]
  ];
  for (const [name, src] of files) {
    if (!existsSync(src)) continue;
    const b64 = readFileSync(src).toString("base64");
    const put = await agent("/put", { path: name, b64 }, 20000);
    if (!put.ok) log("put " + name + " " + (put.error || "fail"));
    else log("guest " + (put.path || name));
    ps(
      `Copy-VMFile -Name '${GOLDEN_NAME}' -SourcePath '${src.replace(/'/g, "''")}' -DestinationPath 'C:\\FarmAgent\\${name}' -FileSource Host -Force -ErrorAction SilentlyContinue; Copy-VMFile -Name '${GOLDEN_NAME}' -SourcePath '${src.replace(/'/g, "''")}' -DestinationPath 'C:\\FarmBootstrap\\${name}' -FileSource Host -Force -ErrorAction SilentlyContinue`
    );
  }
  await agent("/put", { path: "reload-agent.flag", b64: Buffer.from("1").toString("base64") }, 8000);
  await agent("/put", { path: "overlay-reload.flag", b64: Buffer.from("1").toString("base64") }, 8000);
  try {
    ps(
      `New-NetFirewallRule -DisplayName 'csfarm-teach' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 39210 -ErrorAction SilentlyContinue | Out-Null`
    );
  } catch {}
}

function openTeachHost() {
  startTeachServer();
  spawn("cmd", ["/c", "start", "", "http://127.0.0.1:39210/"], { detached: true, stdio: "ignore" }).unref();
}

function startYoloTrain() {
  const hit = ps(
    `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'train_yolo.py' } | Select-Object -First 1 -ExpandProperty ProcessId`
  ).out;
  if (hit) {
    log("yolo train already pid " + hit);
    return Number(hit);
  }
  const py = process.env.FARM_PYTHON || "C:/Users/R00/AppData/Local/Programs/Python/Python312/python.exe";
  const script = path.join(__dirname, "cv", "train_yolo.py");
  const logFile = path.join(FARM_ROOT, "ops", "yolo", "train.log");
  mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = openSync(logFile, "a");
  spawn(py, ["-u", script], {
    cwd: path.join(__dirname, "cv"),
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true
  }).unref();
  log("yolo train started -> " + logFile);
}

async function ensureBridge() {
  const p = await hv("/ping");
  if (p.ok) {
    log("hv-bridge up");
    return;
  }
  if (!existsSync(BRIDGE_PS)) throw new Error("missing " + BRIDGE_PS);
  spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", BRIDGE_PS], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    if ((await hv("/ping")).ok) {
      log("hv-bridge started");
      return;
    }
  }
  log("hv-bridge not answering (play still ok via guest /input)");
}

async function ensureLan() {
  const j = await pingAgent();
  if (j.ok) return j;
  log("agent down, farm lan on (no nat)");
  await farmLanOn();
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const p = await pingAgent();
    if (p.ok) return p;
  }
  return pingAgent();
}

async function ensureCs2() {
  const ping = await pingAgent();
  if (!ping.ok) throw new Error("guest-agent down: " + (ping.error || "no ping"));
  const has = (ping.procs || []).some((p) => /^cs2$/i.test(p));
  let seen = await agent("/see", {}, 25000);
  const tiny = !seen || Number(seen.w) < 400;
  if (has && !tiny) {
    await agent("/input", { kind: "click", x: 50, y: 50 }, 8000);
    log("cs2 hwnd " + seen.w + "x" + seen.h);
    return seen;
  }
  if (has && tiny) {
    log("cs2 running, guest see tiny (gpu-pv). keep window");
    await agent("/input", { kind: "click", x: 50, y: 50 }, 8000);
    return seen || { w: 0, h: 0, black: true };
  }
  const cfg = {
    queueKind: "competitive",
    gsiHost: process.env.GSI_HOST || "10.250.0.1",
    gsiPort,
    gsiToken: process.env.BOT_GSI_TOKEN || "csfarm",
    netconPort: netconPort("vmfarm"),
    fps: 60,
    play: true,
    crosshair: "green"
  };
  log("cs/run...");
  const launched = await agent("/cs/run", cfg, 180000);
  log("cs/run hasCs=" + launched.hasCs);
  for (let i = 0; i < 8; i++) {
    await sleep(2000);
    const p = await pingAgent();
    if ((p.procs || []).some((x) => /^cs2$/i.test(x))) {
      seen = await agent("/see", {}, 12000);
      log("cs2 proc up see=" + (seen?.w || 0) + "x" + (seen?.h || 0));
      if (Number(seen?.w) >= 400) {
        await agent("/input", { kind: "click", x: 50, y: 50 }, 8000);
      }
      return seen || { w: 0, h: 0 };
    }
    log("wait cs2 proc " + i);
  }
  if (launched.hasCs) {
    log("cs/run hasCs, guest see skipped");
    await agent("/input", { kind: "click", x: 50, y: 50 }, 8000).catch(() => {});
    return { w: 0, h: 0, black: true };
  }
  throw new Error("cs2 window not ready");
}

async function labelWatch() {
  killLoop();
  const files = [
    ["guest-agent.mjs", path.join(__dirname, "vm", "guest-agent.mjs")],
    ["guest-overlay.ps1", path.join(__dirname, "vm", "guest-overlay.ps1")]
  ];
  for (const [name, src] of files) {
    const b64 = readFileSync(src).toString("base64");
    const put = await agent("/put", { path: name, b64 }, 25000);
    log("put " + name + " " + (put.ok ? "ok" : put.error || "fail"));
  }
  await agent("/put", { path: "reload-agent.flag", b64: Buffer.from("1").toString("base64") }, 8000);
  await agent("/put", { path: "overlay-reload.flag", b64: Buffer.from("1").toString("base64") }, 8000);
  await agent("/put", { path: "shot-loop-reload.flag", b64: Buffer.from("1").toString("base64") }, 8000);
  log("wait agent");
  let ping = { ok: false };
  for (let i = 0; i < 25; i++) {
    await sleep(700);
    ping = await pingAgent();
    if (ping.ok) break;
  }
  restartTeachServer();
  restartCvWorker();
  startLiveYolo();
  await agent("/shot?fresh=1", undefined, 20000);
  const lab = await agent("/cs/label", {}, 30000);
  log("spec " + JSON.stringify(lab));
  log("save boxes to D:/FarmVMs/ops/yolo/human  teach http://127.0.0.1:39210  say when enough");
}

async function loadCompBots() {
  await agent("/input", { kind: "click", x: 50, y: 50 }, 8000);
  await sleep(120);
}

function startLiveYolo() {
  const already = nodeByCmd(/live-yolo\.mjs/);
  if (already.length) return already[0].pid;
  mkdirSync(VISION, { recursive: true });
  const child = spawn(process.execPath, ["live-yolo.mjs"], {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  log("live-yolo pid " + child.pid);
  return child.pid;
}

function startLoop() {
  startTeachServer();
  ensureCvWorker();
  startLiveYolo();
  killLoop();
  mkdirSync(VISION, { recursive: true });
  const child = spawn(process.execPath, ["fsm/loop.mjs"], {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid || ""));
  log("bot pid " + child.pid);
  return child.pid;
}

function tailHas(file, re, fromByte) {
  if (!existsSync(file)) return false;
  const t = readFileSync(file, "utf8");
  const slice = fromByte > 0 ? t.slice(fromByte) : t.slice(-8000);
  return re.test(slice);
}

async function waitLive(startedAt) {
  const from = existsSync(FSM_LOG) ? readFileSync(FSM_LOG, "utf8").length : 0;
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    if (tailHas(FSM_LOG, /gsi-live .*de_|map=de_/, from)) {
      log("live in " + Math.round((Date.now() - startedAt) / 1000) + "s");
      return true;
    }
  }
  if (tailHas(FSM_LOG, /gsi-live .*de_/, 0)) {
    log("live (already in match)");
    return true;
  }
  log("no gsi-live yet (menu/load). watch console, or farm.bat play again");
  return false;
}

async function status() {
  const ping = await pingAgent();
  const loop = nodeByCmd(/fsm[\\/]loop\.mjs/);
  const bridge = await hv("/ping");
  const vm = vmState();
  const vmcon = ps(`Get-Process vmconnect -EA SilentlyContinue | Select-Object -ExpandProperty MainWindowTitle`).out;
  let seen = null;
  if (ping.ok) seen = await agent("/see", {}, 12000);
  const last = existsSync(FSM_LOG)
    ? readFileSync(FSM_LOG, "utf8").trim().split(/\n/).slice(-3).join(" | ")
    : "";
  console.log(
    JSON.stringify(
      {
        vm,
        console: vmcon || "closed",
        agent: Boolean(ping.ok),
        procs: ping.procs || [],
        cs2: Boolean((ping.procs || []).some((p) => /^cs2$/i.test(p))),
        frame: seen ? { w: seen.w, h: seen.h, black: seen.black, mean: seen.mean } : null,
        hvBridge: Boolean(bridge.ok),
        bot: loop.map((x) => x.pid),
        last
      },
      null,
      2
    )
  );
}

async function play() {
  log("farm play map=" + mapName);
  ensureVm();
  ensureVideo();
  stopGlass();
  const ping = await ensureLan();
  if (!ping.ok) throw new Error("guest-agent still down");
  await deployGuestEyes();
  log("agent ok " + (ping.procs || []).join(","));
  await ensureCs2();
  startLoop();
  await sleep(2500);
  await loadCompBots();
  await waitLive(Date.now());
  log("teach http://127.0.0.1:39210  no host vmconnect needed");
}

async function grind() {
  log("farm grind: local short rounds vs easy bots. not matchmaking");
  ensureVm();
  ensureVideo();
  stopGlass();
  const ping = await ensureLan();
  if (!ping.ok) throw new Error("guest-agent still down");
  await deployGuestEyes();
  await ensureCs2();
  if (process.env.FARM_SKIP_MAP === "1") {
    startLoop();
    log("cs2 up, bot on, skip console map. teach http://127.0.0.1:39210");
    return;
  }
  startLoop();
  log("cs2 up. buy is B then digits. teach http://127.0.0.1:39210");
}

async function botOnly() {
  ensureVideo();
  try {
    await deployGuestEyes();
    await agent("/cfg", { play: true, fps: 60 }, 15000);
    await sleep(2500);
    await agent("/fill", {}, 8000);
    log("guest input + cfg pushed, agent reloads on next shot");
  } catch (e) {
    log("guest push skip " + (e.message || e));
  }
  startLoop();
  log("bot restarted");
}

function usage() {
  console.log(`farm cli
  farm.bat status     vm / agent / cs2 / bot
  farm.bat show       vm video = host screen, vmconnect fill, cs2 borderless same size
  farm.bat play       lan, cs2, local competitive vs bots, fsm (your weights)
  farm.bat grind      local mirage vs expert bots. policy+rewards, not human-record gold
  (gsi auto-dm)       map "| DM #": clock=dm, no sites/plant; buy still via B menu
  farm.bat bot        restart fsm only
  farm.bat stop       kill fsm
  farm.bat fit        clone human-record into sense-weights
  farm.bat record     record local host play (30m default)
  farm.bat label      spec + no freeze, bot off, boxes to yolo/human
  farm.bat teach      host browser labels. shot from guest, glass inside vm
  farm.bat eyes       live yolo boxes in the vm. no bot keys
  farm.bat train      yolo download+cpu train (log D:\\FarmVMs\\ops\\yolo\\train.log)
`);
}

const cmd = String(process.argv[2] || "").toLowerCase();
const cmds = {
  status,
  show: async () => {
    ensureVm();
    stopGlass();
    const s = showConsole();
    await deployGuestEyes();
    let fill = { ok: false };
    for (let i = 0; i < 8; i++) {
      await agent("/see", {}, 20000);
      fill = await agent("/fill", {}, 8000);
      if (fill.ok && fill.w) break;
      await sleep(800);
    }
    const cfg = await agent("/cfg", { play: true, fps: 60 }, 15000);
    log(
      "vm " +
        s.w +
        "x" +
        s.h +
        " guest " +
        (cfg.w || fill.w || "?") +
        "x" +
        (cfg.h || fill.h || "?") +
        " fill=" +
        (fill.fill || fill.ok || fill.error || "n/a")
    );
    log("if cs2 still letterboxed, restart cs2 once (video.txt is new size)");
  },
  play,
  grind,
  label: labelWatch,
  bot: botOnly,
  stop: async () => {
    killLoop();
    log("bot stopped");
  },
  fit: async () => {
    spawnSync(process.execPath, ["fit-human.mjs"], { cwd: __dirname, stdio: "inherit" });
  },
  record: async () => {
    spawnSync(process.execPath, ["record-local.mjs"], { cwd: __dirname, stdio: "inherit", env: process.env });
  },
  teach: async () => {
    ensureVm();
    ensureVideo();
    stopGlass();
    await deployGuestEyes();
    openTeachHost();
    startLoop();
    log("teach http://127.0.0.1:39210  lab. no auto yolo. walk needs confirm");
  },
  eyes: async () => {
    ensureVm();
    ensureVideo();
    stopGlass();
    await deployGuestEyes();
    startTeachServer();
    restartCvWorker();
    startLiveYolo();
    const seen = await agent("/see", {}, 25000);
    log(
      "live yolo in vm. glass click-through. no bot. shot mean=" +
        (seen && seen.mean) +
        " teach http://127.0.0.1:39210"
    );
  },
  train: async () => {
    startYoloTrain();
  },
};

if (!cmds[cmd]) {
  usage();
  process.exit(cmd ? 2 : 0);
}
cmds[cmd]().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
