import http from "http";
import os from "os";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from "fs";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const PORT = Number(process.env.FARM_AGENT_PORT || 39200) || 39200;
const TOKEN = process.env.FARM_AGENT_TOKEN || process.env.WORKER_TOKEN || "csfarm";
const ALLOW_CS = process.env.FARM_ALLOW_CS !== "0";
const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VISION_DIR = process.env.FARM_VISION_DIR || "C:\\FarmBootstrap\\vision";
const SHOT_CANDIDATES = [
  "C:\\FarmBootstrap\\guest-shot.ps1",
  path.join(AGENT_DIR, "guest-shot.ps1")
];
function shotPs() {
  return SHOT_CANDIDATES.find((p) => existsSync(p)) || SHOT_CANDIDATES[0];
}
const INPUT_CANDIDATES = [
  "C:\\FarmBootstrap\\guest-input.ps1",
  path.join(AGENT_DIR, "guest-input.ps1")
];
function inputPs() {
  return INPUT_CANDIDATES.find((p) => existsSync(p)) || INPUT_CANDIDATES[0];
}

const SHOT_LEGACY = process.env.FARM_SHOT_LEGACY === "1";
const LOOP_CANDIDATES = [
  "C:\\FarmBootstrap\\guest-shot-loop.ps1",
  path.join(AGENT_DIR, "guest-shot-loop.ps1")
];
function shotLoopPs() {
  return LOOP_CANDIDATES.find((p) => existsSync(p)) || LOOP_CANDIDATES[0];
}

let shotChild = null;
function killShotChild() {
  if (!shotChild) return;
  try {
    shotChild.kill();
  } catch {}
  shotChild = null;
}
function ensureShotChild() {
  if (SHOT_LEGACY) return false;
  if (shotChild && shotChild.exitCode == null) return true;
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'guest-shot-loop' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }"
    ],
    { windowsHide: true, timeout: 4000 }
  );
  const ps1 = shotLoopPs();
  if (!existsSync(ps1)) return false;
  shotChild = spawn("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", ps1], {
    windowsHide: true,
    stdio: "ignore"
  });
  shotChild.on("exit", () => {
    shotChild = null;
  });
  return true;
}

let inputChild = null;
let inputBuf = "";
let inputReady = false;
let inputQueue = Promise.resolve();

function killInputChild() {
  if (!inputChild) return;
  try {
    inputChild.kill();
  } catch {}
  inputChild = null;
  inputBuf = "";
  inputReady = false;
}

function ensureInputChild() {
  if (inputChild && inputChild.exitCode == null) return true;
  const ps1 = inputPs();
  if (!existsSync(ps1)) return false;
  inputBuf = "";
  inputReady = false;
  inputChild = spawn("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", ps1], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  inputChild.stdout.setEncoding("utf8");
  inputChild.on("exit", () => {
    inputChild = null;
    inputReady = false;
  });
  return true;
}

function readInputLine(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    const tryRead = () => {
      const i = inputBuf.indexOf("\n");
      if (i < 0) return;
      const line = inputBuf.slice(0, i).replace(/\r$/, "").trim();
      inputBuf = inputBuf.slice(i + 1);
      clearTimeout(t);
      if (inputChild) inputChild.stdout.off("data", onData);
      resolve(line);
    };
    const onData = (chunk) => {
      inputBuf += chunk;
      tryRead();
    };
    if (inputChild) inputChild.stdout.on("data", onData);
    tryRead();
  });
}

async function sendInputCmd(cmd, timeoutMs) {
  if (!ensureInputChild()) return "no-ps1";
  if (!inputReady) {
    const ready = await readInputLine(8000);
    if (ready !== "ready") {
      killInputChild();
      return "no-ready";
    }
    inputReady = true;
  }
  try {
    inputChild.stdin.write(cmd + "\n");
  } catch {
    killInputChild();
    return "dead";
  }
  const line = await readInputLine(timeoutMs);
  if (line == null) {
    killInputChild();
    return "timeout";
  }
  return line;
}

const STEAM_EXE =
  ["C:\\Program Files (x86)\\Steam\\steam.exe", "C:\\Program Files\\Steam\\steam.exe"].find((p) =>
    existsSync(p)
  ) || "C:\\Program Files (x86)\\Steam\\steam.exe";
const STEAM_ROOT = path.dirname(STEAM_EXE);

function steamInfo() {
  const apps = path.join(STEAM_ROOT, "steamapps");
  return {
    installed: existsSync(STEAM_EXE),
    exe: existsSync(STEAM_EXE) ? STEAM_EXE : null,
    cs2Manifest: existsSync(path.join(apps, "appmanifest_730.acf")),
    cs2Exe: existsSync(
      path.join(apps, "common", "Counter-Strike Global Offensive", "game", "bin", "win64", "cs2.exe")
    )
  };
}

function desktopSize() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Add-Type -Name N -Namespace W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern int GetSystemMetrics(int n);'; Write-Output (([W.N]::GetSystemMetrics(0)).ToString() + 'x' + ([W.N]::GetSystemMetrics(1)).ToString())"
    ],
    { encoding: "utf8", windowsHide: true, timeout: 8000 }
  );
  const m = String(r.stdout || "").trim().match(/(\d+)x(\d+)/);
  const w = m ? Number(m[1]) : 0;
  const h = m ? Number(m[2]) : 0;
  if (w >= 800 && h >= 600) return { w, h };
  return { w: 1920, h: 1080 };
}

function writeCs2Video(w, h) {
  const video = `"video.cfg"
{
  "setting.cpu_level"    "0"
  "setting.gpu_mem_level"    "0"
  "setting.gpu_level"    "0"
  "setting.mat_vsync"    "0"
  "setting.mem_level"    "0"
  "setting.defaultres"    "${w}"
  "setting.defaultresheight"    "${h}"
  "setting.fullscreen"    "0"
  "setting.nowindowborder"    "1"
  "setting.mat_queue_mode"    "0"
}
`;
  const dirs = [
    path.join(STEAM_ROOT, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg")
  ];
  const ud = path.join(STEAM_ROOT, "userdata");
  try {
    if (existsSync(ud)) {
      for (const id of readdirSync(ud)) {
        dirs.push(path.join(ud, id, "730", "local", "cfg"));
      }
    }
  } catch {}
  for (const dir of dirs) {
    try {
      ensureDir(dir);
      writeFileSync(path.join(dir, "cs2_video.txt"), video);
    } catch {}
  }
}

function fillCs2Window(w, h) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmFill {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr i, int x, int y, int cx, int cy, uint f);
}
"@
$p = Get-Process cs2 -EA SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if (-not $p) { Write-Output "no-cs2"; exit 0 }
$h = $p.MainWindowHandle
[FarmFill]::MoveWindow($h, 0, 0, ${Number(w)|0}, ${Number(h)|0}, $true) | Out-Null
[FarmFill]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, ${Number(w)|0}, ${Number(h)|0}, 0x0040) | Out-Null
Write-Output "ok"
`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000
  });
  return String(r.stdout || "").trim();
}

function json(res, code, body) {
  const raw = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(raw)
  });
  res.end(raw);
}

function auth(req) {
  const h = String(req.headers.authorization || "");
  if (h === `Bearer ${TOKEN}`) return true;
  const q = new URL(req.url || "/", "http://local").searchParams.get("token");
  return q === TOKEN;
}

function memMb() {
  const t = os.totalmem() / 1048576;
  const f = os.freemem() / 1048576;
  return { totalMb: Math.round(t), freeMb: Math.round(f), usedMb: Math.round(t - f) };
}

function procNames() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(steam|steamwebhelper|cs2|csgo)$' } | Select-Object -ExpandProperty ProcessName) -join ','"
    ],
    { encoding: "utf8", windowsHide: true, timeout: 5000 }
  );
  const s = String(r.stdout || "").trim();
  return s ? [...new Set(s.split(",").filter(Boolean))] : [];
}

function hasProc(re) {
  return procNames().some((n) => re.test(n));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ raw });
      }
    });
  });
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function greenDotCrosshair() {
  // classic static green DOT (visible): style 2, big-ish gap collapse, outline
  return [
    "cl_crosshairstyle 2",
    "cl_crosshairdot 1",
    "cl_crosshairsize 2",
    "cl_crosshairthickness 1",
    "cl_crosshairgap -5",
    "cl_crosshaircolor 1",
    "cl_crosshairalpha 255",
    "cl_crosshairusealpha 1",
    "cl_crosshair_drawoutline 1",
    "cl_crosshair_outlinethickness 1",
    "cl_crosshair_t 0",
    "cl_crosshair_recoil 0",
    "cl_fixedcrosshairgap -5"
  ];
}

function randomCrosshair() {
  const style = [2, 4][Math.floor(Math.random() * 2)];
  const color = [1, 2, 3, 4, 5][Math.floor(Math.random() * 5)]; // 1=green
  const size = (0.5 + Math.random() * 2.5).toFixed(1);
  const thickness = (0.3 + Math.random() * 1.2).toFixed(1);
  const gap = (Math.random() * 6 - 4).toFixed(1);
  const dot = Math.random() < 0.45 ? 1 : 0;
  const outline = Math.random() < 0.35 ? 1 : 0;
  const alpha = 200 + Math.floor(Math.random() * 56);
  const lines = [
    `cl_crosshairstyle ${style}`,
    `cl_crosshairdot ${dot}`,
    `cl_crosshairsize ${size}`,
    `cl_crosshairthickness ${thickness}`,
    `cl_crosshairgap ${gap}`,
    `cl_crosshaircolor ${color}`,
    `cl_crosshairalpha ${alpha}`,
    "cl_crosshairusealpha 1",
    `cl_crosshair_drawoutline ${outline}`,
    `cl_crosshair_outlinethickness ${outline ? (0.5 + Math.random()).toFixed(1) : 0}`,
    `cl_crosshair_t ${Math.random() < 0.15 ? 1 : 0}`,
    "cl_crosshair_recoil 0"
  ];
  if (color === 5) {
    lines.push(
      `cl_crosshaircolor_r ${Math.floor(Math.random() * 256)}`,
      `cl_crosshaircolor_g ${80 + Math.floor(Math.random() * 176)}`,
      `cl_crosshaircolor_b ${Math.floor(Math.random() * 256)}`
    );
  }
  return lines;
}

function pickCrosshairLines(body) {
  const mode = String(body.crosshair || body.xhair || "").toLowerCase();
  const playFeel = Number(body.fps) >= 60 || body.play === true;
  if (mode === "random" || body.randomCrosshair === true) return { mode: "random", lines: randomCrosshair() };
  if (mode === "green" || mode === "green_dot" || mode === "dot") {
    return { mode: "green_dot", lines: greenDotCrosshair() };
  }
  // human/play sessions: green dot; bot farm: random each cfg write
  if (playFeel) return { mode: "green_dot", lines: greenDotCrosshair() };
  return { mode: "random", lines: randomCrosshair() };
}

function writeFarmCfgs(body) {
  const fps = Number(body.fps) || 20;
  const playFeel = fps >= 60 || body.play === true;
  const gsiHost = String(body.gsiHost || "10.250.0.1").trim() || "10.250.0.1";
  const gsiPort = Number(body.gsiPort) || 32222;
  const gsiToken = String(body.gsiToken || "csfarm");
  const queueKind = String(body.queueKind || "competitive");
  const connectHost = String(body.connectHost || "");
  const xhair = pickCrosshairLines(body);

  const farm = [
    `fps_max ${playFeel ? 0 : fps}`,
    `fps_max_ui ${playFeel ? 0 : fps}`,
    playFeel ? "engine_low_latency_sleep_after_client_tick false" : "engine_low_latency_sleep_after_client_tick true",
    "r_show_build_info 0",
    "cl_allow_animated_avatars 0",
    "con_enable 1",
    "mp_freezetime 0",
    "mp_round_restart_delay 0",
    "cl_radar_always_centered 0",
    "cl_radar_rotate 0",
    "cl_radar_scale 0.45",
    "cl_hud_radar_scale 1.1",
    "cl_radar_square_with_map 0",
    "m_rawinput 0",
    "m_customaccel 0",
    "m_mouseaccel1 0",
    "m_mouseaccel2 0",
    // play feel: no accel; sensitivity from body or 5
    ...(playFeel
      ? [
          `sensitivity ${Number(body.sensitivity) > 0 ? Number(body.sensitivity) : 5}`,
          "zoom_sensitivity_ratio_mouse 1"
        ]
      : [`sensitivity ${Number(body.sensitivity) > 0 ? Number(body.sensitivity) : 5}`]),
    // crosshair: green_dot default; pass crosshair=random for bot variety
    ...xhair.lines,
    'alias farmstop "-forward;-back;-moveleft;-moveright;-jump;-attack;-attack2;-duck;-speed"',
    'alias farmgo "game_type 0;game_mode 1;game_alias competitive;matchmaking_session_create"',
    'alias farmgodm "game_type 1;game_mode 2;game_alias deathmatch;matchmaking_session_create"',
    'alias farmgocasual "game_type 0;game_mode 0;game_alias casual;matchmaking_session_create"',
    'alias farmxhair "exec farm"',
    'alias farmlabel "exec farm_spec"',
    'unbind mouse4',
    'farmstop',
    'bind F7 "sv_cheats 1; mp_freezetime 0; mp_round_restart_delay 0; mp_restartgame 1"',
    'bind F8 "exec farm_spec"'
  ].join("\n");

  const modeMap = {
    competitive: { t: 0, m: 1, alias: "competitive" },
    premier: { t: 0, m: 1, alias: "premier" },
    wingman: { t: 0, m: 2, alias: "wingman" },
    casual: { t: 0, m: 0, alias: "casual" },
    deathmatch: { t: 1, m: 2, alias: "deathmatch" }
  };
  const g = modeMap[queueKind] || modeMap.competitive;
  const queueLines = [
    "con_enable 1",
    `game_type ${g.t}`,
    `game_mode ${g.m}`,
    `game_alias ${g.alias}`
  ];
  if (connectHost) queueLines.push(`connect ${connectHost}`);
  queueLines.push("exec farm");
  const queueBody = queueLines.join("\n") + "\n";

  const labelBody = [
    "sv_cheats 1",
    "mp_freezetime 0",
    "mp_round_restart_delay 0",
    "mp_ignore_round_win_conditions 1",
    "mp_respawn_immunitytime 0",
    "spec_freeze_time 0",
    "spec_freeze_panel_extended_time 0",
    "spec_freeze_deathanim_time 0",
    "mp_spectators_max 20",
    "mp_forcecamera 0",
    "mp_fadetoblack 0",
    "mp_limitteams 0",
    "mp_autoteambalance 0",
    "bot_quota 10",
    "bot_quota_mode fill",
    "jointeam spec",
    "spectate",
    "kill"
  ].join("\n") + "\n";

  const gsiThrottle = playFeel ? "0.05" : "0.2";
  const gsiBuffer = playFeel ? "0.05" : "0.15";
  const gsi = `"csfarm"
{
  "uri" "http://${gsiHost}:${gsiPort}"
  "timeout" "5.0"
  "buffer"  "${gsiBuffer}"
  "throttle" "${gsiThrottle}"
  "heartbeat" "5.0"
  "auth"
  {
    "token" "${gsiToken}"
  }
  "data"
  {
    "provider"            "1"
    "map"                 "1"
    "round"               "1"
    "player_id"           "1"
    "player_state"        "1"
    "player_weapons"      "1"
    "player_match_stats"  "1"
    "bomb"                "1"
    "phase_countdowns"    "1"
    "player_position"     "1"
    "allplayers_id"       "1"
    "allplayers_state"    "1"
    "allplayers_position" "1"
    "grenade"             "1"
  }
}
`;

  const cfgDirs = [
    path.join(STEAM_ROOT, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg"),
    path.join(STEAM_ROOT, "steamapps", "common", "Counter-Strike Global Offensive", "csgo", "cfg")
  ];
  for (const dir of cfgDirs) {
    try {
      ensureDir(dir);
      writeFileSync(path.join(dir, "farm.cfg"), farm);
      writeFileSync(path.join(dir, "farm_label.cfg"), labelBody);
      writeFileSync(path.join(dir, "farm_nofreeze.cfg"), [
        "sv_cheats 1",
        "mp_freezetime 0",
        "mp_round_restart_delay 0",
        "mp_restartgame 1"
      ].join("\n") + "\n");
      writeFileSync(path.join(dir, "autoexec.cfg"), "exec farm\n");
      writeFileSync(path.join(dir, "farm_queue.cfg"), queueBody);
      writeFileSync(path.join(dir, "gamestate_integration_csfarm.cfg"), gsi);
      writeFileSync(
        path.join(dir, "farm_walk.cfg"),
        [
          "sv_cheats 1",
          "bot_kick",
          "bot_quota 0",
          "bot_quota_mode normal",
          "mp_limitteams 0",
          "mp_autoteambalance 0",
          "mp_ignore_round_win_conditions 1",
          "mp_freezetime 0",
          "mp_round_restart_delay 0",
          "bot_stop 1",
          "mp_warmup_start",
          "mp_warmup_pausetimer 1",
          "cl_radar_rotate 0",
          "cl_radar_always_centered 0",
          "cl_radar_scale 0.45",
          "cl_hud_radar_scale 1.1"
        ].join("\n") + "\n"
      );
    } catch {}
  }
  const desk = desktopSize();
  writeCs2Video(desk.w, desk.h);
  fillCs2Window(desk.w, desk.h);
  return { fps, playFeel, gsiHost, gsiPort, queueKind, crosshair: xhair.mode, crosshairLines: xhair.lines, w: desk.w, h: desk.h };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tapVk(vk, downMs = 40) {
  await psInput("keydown", { vk });
  await delay(downMs);
  await psInput("keyup", { vk });
}

async function consoleExec(line) {
  await psInput("click", { x: 52, y: 48 });
  await delay(180);
  for (const vk of [0xc0, 0x79]) {
    await tapVk(vk, 40);
    await delay(60);
  }
  await psInput("type", { text: String(line || "") });
  await delay(80);
  await tapVk(0x0d, 45);
  await delay(80);
  await tapVk(0x79, 40);
  await delay(40);
  await tapVk(0xc0, 40);
}

async function clickSpecButtons() {
  for (const xy of [
    [18, 92],
    [50, 92],
    [70, 92],
    [82, 92],
    [50, 88],
    [28, 50]
  ]) {
    await psInput("click", { x: xy[0], y: xy[1] });
    await delay(160);
  }
}

async function runNoFreeze() {
  writeFarmCfgs({ play: true, fps: 60, queueKind: "competitive" });
  await consoleExec("exec farm");
  await delay(200);
  await tapVk(0x76, 55);
  await delay(300);
  await consoleExec("exec farm_nofreeze");
  await delay(200);
  await consoleExec("mp_freezetime 0");
  return { nofreeze: true };
}

async function runLabelSession() {
  writeFarmCfgs({ play: true, fps: 60, queueKind: "competitive" });
  await consoleExec("exec farm");
  await delay(250);
  await tapVk(0x77, 50);
  await delay(200);
  await consoleExec("exec farm_spec");
  await delay(400);
  await consoleExec("jointeam spec");
  await delay(250);
  await consoleExec("spectate");
  await delay(250);
  await consoleExec("kill");
  await delay(400);
  await tapVk(0x1b, 40);
  await delay(200);
  await clickSpecButtons();
  return { labeled: true, spec: true };
}

async function runWalkEmpty() {
  writeFarmCfgs({ play: true, fps: 60, queueKind: "competitive" });
  await consoleExec("exec farm_walk");
  await delay(250);
  await consoleExec("bot_kick");
  await delay(200);
  await consoleExec("bot_quota 0");
  return { walkEmpty: true, bots: 0 };
}

function killGames(alsoSteam = false) {
  spawnSync("taskkill", ["/IM", "cs2.exe", "/F"], { windowsHide: true });
  spawnSync("taskkill", ["/IM", "csgo.exe", "/F"], { windowsHide: true });
  if (alsoSteam) {
    spawnSync("taskkill", ["/IM", "steam.exe", "/F"], { windowsHide: true });
    spawnSync("taskkill", ["/IM", "steamwebhelper.exe", "/F"], { windowsHide: true });
  }
}

function writeSessionFiles(session) {
  const map = session && typeof session === "object" ? session : {};
  const keys = Object.keys(map);
  let n = 0;
  const appdata = path.join(process.env.LOCALAPPDATA || "C:\\Users\\farm\\AppData\\Local", "Steam");
  for (const rel of keys) {
    const clean = String(rel).replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.includes("..")) continue;
    try {
      let dest;
      if (clean.startsWith("appdata/")) {
        dest = path.join(appdata, ...clean.slice("appdata/".length).split("/"));
      } else {
        dest = path.join(STEAM_ROOT, ...clean.split("/"));
      }
      ensureDir(path.dirname(dest));
      writeFileSync(dest, Buffer.from(String(map[rel]), "base64"));
      n += 1;
    } catch {}
  }
  return n;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fillExpr(login, password, guard) {
  const u = JSON.stringify(login);
  const p = JSON.stringify(password);
  const g = JSON.stringify(guard || "");
  return `(() => {
    function setVal(el, val) {
      if (!el) return false;
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (desc && desc.set) desc.set.call(el, val); else el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    function deepInputs(root, acc) {
      if (!root) return acc;
      root.querySelectorAll("input").forEach((i) => acc.push(i));
      root.querySelectorAll("*").forEach((n) => { if (n.shadowRoot) deepInputs(n.shadowRoot, acc); });
      return acc;
    }
    const inputs = deepInputs(document, []);
    const vis = inputs.filter((i) => i.type !== "hidden" && i.type !== "checkbox");
    const text = ((document.body && document.body.innerText) || "") + " " + document.title;
    const isGuard = /authenticator|steam guard|guard code|confirmation code|two-factor|two factor/i.test(text)
      || vis.filter((i) => Number(i.maxLength) === 1).length >= 4;
    if (isGuard && !${g}) return { skip: "guard", inputs: vis.length, title: document.title };
    if (${g}) {
      const digits = vis.filter((i) => Number(i.maxLength) === 1);
      if (digits.length >= 4) {
        const code = String(${g}).replace(/\\s/g, "");
        digits.forEach((el, i) => { if (code[i]) setVal(el, code[i]); });
        const btn = [...document.querySelectorAll("button, input[type=submit]")].find((b) => /submit|continue|confirm|sign in/i.test((b.innerText || b.value || "")));
        if (btn) btn.click();
        return { okG: true, inputs: vis.length };
      }
    }
    const pass = vis.find((i) => i.type === "password");
    const user = vis.find((i) => i !== pass && (i.type === "text" || i.type === "email")) || vis.find((i) => i !== pass);
    const okU = ${u} && user ? setVal(user, ${u}) : false;
    const okP = ${p} && pass ? setVal(pass, ${p}) : false;
    const btn = [...document.querySelectorAll("button, input[type=submit]")].find((b) => /sign in|sign-in|submit|continue/i.test((b.innerText || b.value || "")));
    if (btn && (okP || okU)) btn.click();
    return { inputs: vis.length, okU, okP, btn: Boolean(btn), title: document.title };
  })()`;
}

async function cdpEval(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws timeout")), 8000);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(); });
    ws.addEventListener("error", () => { clearTimeout(t); reject(new Error("ws error")); });
  });
  let n = 1;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = n++;
      const t = setTimeout(() => reject(new Error(method + " timeout")), 8000);
      const onMsg = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== id) return;
        ws.removeEventListener("message", onMsg);
        clearTimeout(t);
        if (msg.error) reject(new Error(msg.error.message || method));
        else resolve(msg.result);
      };
      ws.addEventListener("message", onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await call("Runtime.enable", {});
    const res = await call("Runtime.evaluate", { expression, returnByValue: true });
    return res?.result?.value;
  } finally {
    try { ws.close(); } catch {}
  }
}

async function findCdp(ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const port of [8700, 8080, 9222, 9223]) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(800) });
        if (!r.ok) continue;
        const list = await r.json();
        if (Array.isArray(list) && list.length) {
          const page = list.find((t) => t.webSocketDebuggerUrl && /steam|login|account/i.test(String(t.title || "") + String(t.url || ""))) || list.find((t) => t.webSocketDebuggerUrl);
          if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        }
      } catch {}
    }
    await sleep(1000);
  }
  return null;
}

async function uiLogin(login, password, guard) {
  const wsUrl = await findCdp(90000);
  if (!wsUrl) return { ok: false, error: "no cdp" };
  let last = null;
  for (let i = 0; i < 8; i++) {
    try {
      last = await cdpEval(wsUrl, fillExpr(login, password, guard));
      if (last?.okP || last?.okG) return { ok: true, last };
      if (last?.skip === "guard") return { ok: false, error: "need guard", last };
    } catch (e) {
      last = { error: String(e.message || e) };
    }
    await sleep(1500);
  }
  return { ok: false, error: "login fill fail", last };
}

function runInteractive(tr, user, password) {
  const tn = "CSFarmSteamOnce";
  spawnSync(
    "schtasks",
    [
      "/Create",
      "/TN",
      tn,
      "/F",
      "/SC",
      "ONCE",
      "/ST",
      "23:59",
      "/RU",
      user,
      "/RP",
      password,
      "/IT",
      "/RL",
      "HIGHEST",
      "/TR",
      tr
    ],
    { windowsHide: true, encoding: "utf8" }
  );
  const r = spawnSync("schtasks", ["/Run", "/TN", tn], { windowsHide: true, encoding: "utf8" });
  return (r.status || 0) === 0;
}

function startSteamDebug() {
  const args = [
    "-cef-enable-remote-debugging",
    "-cef-enable-debugging",
    "--remote-debugging-port=8700"
  ];
  const child = spawn(STEAM_EXE, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    cwd: STEAM_ROOT
  });
  child.unref();
  return child.pid || null;
}

function startSteamLoginInteractive(steamLogin, steamPass, winUser, winPass) {
  const tr = `"${STEAM_EXE}" -cef-enable-remote-debugging -cef-enable-debugging --remote-debugging-port=8700 -login ${steamLogin} ${steamPass}`;
  return runInteractive(tr, winUser || "farm", winPass || "FarmPass1!");
}

function applaunchCsInteractive(cfg, netcon, user, password) {
  const desk = desktopSize();
  const args = [
    "-applaunch",
    "730",
    "-novid",
    "-nosound",
    "-nohltv",
    "-windowed",
    "-noborder",
    "-w",
    String(desk.w),
    "-h",
    String(desk.h),
    "-freq",
    "144",
    "+fps_max",
    String(cfg.playFeel ? 0 : cfg.fps),
    "+fps_max_ui",
    String(cfg.playFeel ? 0 : cfg.fps),
    "-console",
    "-insecure",
    "+con_enable",
    "1",
    "+exec",
    "farm",
    "-netconport",
    String(netcon)
  ];
  const tr = `"${STEAM_EXE}" ${args.join(" ")}`;
  return runInteractive(tr, user || "farm", password);
}

function applaunchCs(cfg, netcon) {
  const desk = desktopSize();
  const args = [
    "-applaunch",
    "730",
    "-novid",
    "-nosound",
    "-nohltv",
    "-windowed",
    "-noborder",
    "-w",
    String(desk.w),
    "-h",
    String(desk.h),
    "-freq",
    "144",
    "+fps_max",
    String(cfg.playFeel ? 0 : cfg.fps),
    "+fps_max_ui",
    String(cfg.playFeel ? 0 : cfg.fps),
    "-console",
    "-insecure",
    "+con_enable",
    "1",
    "+exec",
    "farm",
    "-netconport",
    String(netcon)
  ];
  const child = spawn(STEAM_EXE, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    cwd: STEAM_ROOT
  });
  child.unref();
  return child.pid || null;
}

async function waitProc(re, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (hasProc(re)) return true;
    await sleep(2000);
  }
  return hasProc(re);
}

async function launchSteamCs(body, cfg) {
  const login = String(body.login || "").trim();
  const password = String(body.password || "").trim();
  const guard = String(body.guard || "").trim();
  const farmUser = String(body.farmUser || "farm").trim() || "farm";
  const farmPass = String(body.farmPass || password || "FarmPass1!").trim();
  const netcon = Number(body.netconPort) || 21234;
  const keepSteam = body.keepSteam === true || body.restart === false || body.skipLogin === true;
  const steamAlive = hasProc(/^steam$/i);
  const sessN = keepSteam ? 0 : writeSessionFiles(body.session || {});

  // keepSteam: do not kill logged-in steam (guard already entered)
  if (!keepSteam || !steamAlive) {
    killGames(true);
    await sleep(2000);
  }

  let loginRes = { ok: false, skipped: false };
  if (keepSteam && steamAlive) {
    loginRes = { ok: true, skipped: true, note: "keepSteam" };
  } else if (login && password) {
    // must run in interactive console session (vmconnect desktop), not session 0
    const okTask = startSteamLoginInteractive(login, password, farmUser, farmPass);
    await sleep(15000);
    loginRes = await uiLogin(login, password, guard);
    if (!loginRes.ok && guard) {
      typeText(guard);
      await sleep(1500);
      typeText("{ENTER}");
      loginRes = { ok: true, note: "guard typed", interactive: okTask };
    }
    if (!loginRes.ok) {
      await sleep(8000);
      loginRes = await uiLogin(login, password, guard);
    }
    loginRes.interactive = okTask;
  } else {
    startSteamDebug();
    await sleep(8000);
    loginRes = { ok: sessN > 0, skipped: true };
  }

  await sleep(1000);
  const usedIt = Boolean(farmPass);
  if (usedIt) applaunchCsInteractive(cfg, netcon, farmUser, farmPass);
  else applaunchCs(cfg, netcon);
  // also try same-session spawn (agent often runs on interactive desktop)
  if (!hasProc(/^cs2$/i)) applaunchCs(cfg, netcon);
  const csUp = await waitProc(/^cs2$/i, 180000);
  return { pid: null, netcon, sessN, login: loginRes, csUp, keepSteam };
}

async function psInput(kind, body) {
  const vk = Number(body.vk) || 0;
  const x = Math.max(1, Math.min(99, Number(body.x) || 50));
  const y = Math.max(1, Math.min(99, Number(body.y) || 50));
  const dx = Math.max(-2000, Math.min(2000, Number(body.dx) || 0));
  const dy = Math.max(-1200, Math.min(1200, Number(body.dy) || 0));
  let cmd = "NOOP";
  if (kind === "keydown") cmd = "KD " + vk;
  else if (kind === "keyup") cmd = "KU " + vk;
  else if (kind === "hold") cmd = "HOLD " + vk + " " + (Math.max(50, Math.min(8000, Number(body.ms) || 900)));
  else if (kind === "release") cmd = "RELEASE";
  else if (kind === "xdown") cmd = "XDOWN";
  else if (kind === "xup") cmd = "XUP";
  else if (kind === "wheel") cmd = "WHEEL";
  else if (kind === "look") cmd = "LOOK " + dx + " " + dy;
  else if (kind === "fire") cmd = "FIRE";
  else if (kind === "type") cmd = "TYPE " + String(body.text || "").replace(/[\r\n]+/g, " ");
  else if (kind === "click") cmd = "CLICK " + x + " " + y;
  else if (kind === "sample") cmd = "SAMPLE";
  const holdMs = kind === "hold" ? Math.max(50, Math.min(8000, Number(body.ms) || 900)) + 1500 : 0;
  const run = inputQueue.then(() =>
    sendInputCmd(cmd, kind === "hold" ? holdMs : kind === "type" ? 4000 : kind === "fire" || kind === "click" ? 2000 : kind === "look" ? 8000 : 1200)
  );
  inputQueue = run.catch(() => {});
  return run;
}

function typeText(text) {
  const safe = String(text || "").replace(/[+^%~(){}]/g, "{$&}");
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('${safe.replace(/'/g, "''")}')`
    ],
    { encoding: "utf8", windowsHide: true, timeout: 5000 }
  );
  return (r.status || 0) === 0;
}

function captureSee() {
  mkdirSync(VISION_DIR, { recursive: true });
  if (!SHOT_LEGACY && ensureShotChild()) {
    const jsonPath = path.join(VISION_DIR, "shot.json");
    const t0 = Date.now();
    while (Date.now() - t0 < 400) {
      try {
        if (existsSync(jsonPath)) {
          const raw = readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, "");
          const seen = JSON.parse(raw);
          seen.ps_ms = Date.now() - t0;
          seen.loop = true;
          return seen;
        }
      } catch {}
    }
  }
  const ps1 = shotPs();
  if (!existsSync(ps1)) {
    return { ok: false, error: "guest-shot.ps1 missing", black: true, spots: [] };
  }
  const t0 = Date.now();
  spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000
  });
  const psMs = Date.now() - t0;
  const jsonPath = path.join(VISION_DIR, "shot.json");
  try {
    if (!existsSync(jsonPath)) return { ok: false, error: "no shot.json", black: true, spots: [], ps_ms: psMs };
    const raw = readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, "");
    const seen = JSON.parse(raw);
    seen.ps_ms = psMs;
    return seen;
  } catch (e) {
    return { ok: false, error: String(e.message || e), black: true, spots: [], ps_ms: psMs };
  }
}

function readShotPng() {
  const p = path.join(VISION_DIR, "live.png");
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

function sampleKeysPs() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmKey {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
}
"@
function D([int]$vk){ if (([FarmKey]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { 'true' } else { 'false' } }
Write-Output ('{"W":'+(D 0x57)+',"A":'+(D 0x41)+',"S":'+(D 0x53)+',"D":'+(D 0x44)+',"SPACE":'+(D 0x20)+',"SHIFT":'+(D 0xA0)+',"CTRL":'+(D 0xA2)+',"R":'+(D 0x52)+',"E":'+(D 0x45)+',"Q":'+(D 0x51)+',"F":'+(D 0x46)+',"B":'+(D 0x42)+',"G":'+(D 0x47)+',"C":'+(D 0x43)+',"N1":'+(D 0x31)+',"N2":'+(D 0x32)+',"N3":'+(D 0x33)+',"N4":'+(D 0x34)+',"N5":'+(D 0x35)+',"M1":'+(D 0x01)+',"M2":'+(D 0x02)+'}')
`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 1500
  });
  try {
    const line = String(r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    return JSON.parse(line || "{}");
  } catch {
    return null;
  }
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://local");
  const route = url.pathname.replace(/\/+$/, "") || "/";
  if (route === "/ping") {
    const steam = steamInfo();
    return json(res, 200, {
      ok: true,
      role: "guest-agent",
      host: os.hostname(),
      allowCs: ALLOW_CS,
      steam: steam.installed,
      cs2: steam.cs2Manifest || steam.cs2Exe,
      procs: procNames()
    });
  }
  if (!auth(req)) return json(res, 401, { ok: false, error: "auth" });

  if (route === "/keysample" && (req.method === "GET" || req.method === "POST")) {
    await readBody(req);
    let keys = null;
    const line = await sendInputCmd("SAMPLE", 700);
    try {
      if (line && String(line).startsWith("{")) keys = JSON.parse(line);
    } catch {}
    if (!keys) keys = sampleKeysPs();
    return json(res, 200, { ok: Boolean(keys), keys: keys || {}, t: Date.now(), source: "human" });
  }

  if (route === "/status" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      host: os.hostname(),
      mem: memMb(),
      procs: procNames(),
      allowCs: ALLOW_CS,
      steam: steamInfo(),
      uptimeSec: Math.round(process.uptime())
    });
  }

  if (route === "/prepare" && req.method === "POST") {
    const body = await readBody(req);
    const cfg = writeFarmCfgs(body);
    return json(res, 200, {
      ok: true,
      prepared: true,
      allowCs: ALLOW_CS,
      steam: steamInfo(),
      fps: cfg.fps,
      crosshair: cfg.crosshair,
      note: ALLOW_CS ? "ready for steam/cs" : "cs launch disabled"
    });
  }

  if (route === "/cfg" && req.method === "POST") {
    const body = await readBody(req);
    const cfg = writeFarmCfgs(body);
    return json(res, 200, { ok: true, cfg });
  }

  if (route === "/fill" && req.method === "POST") {
    await readBody(req);
    const desk = desktopSize();
    writeCs2Video(desk.w, desk.h);
    const out = fillCs2Window(desk.w, desk.h);
    return json(res, 200, { ok: true, ...desk, fill: out });
  }

  if (route === "/see" && req.method === "POST") {
    await readBody(req);
    const seen = captureSee();
    // always 200 so bot can read black/no-hwnd from files without treating as crash
    return json(res, 200, { ok: Boolean(seen.ok), ...seen });
  }

  if (route === "/shot" && req.method === "GET") {
    const p = path.join(VISION_DIR, "live.png");
    const fresh = url.searchParams.get("fresh") === "1";
    let stale = true;
    try {
      stale = fresh || Date.now() - statSync(p).mtimeMs > 180;
    } catch {
      stale = true;
    }
    const tGet = Date.now();
    let meta = {};
    if (!SHOT_LEGACY && ensureShotChild()) {
      const p0 = path.join(VISION_DIR, "live.png");
      let prev = 0;
      try {
        prev = statSync(p0).mtimeMs;
      } catch {}
      const waitMs = fresh ? 40 : 8;
      const tWait = Date.now();
      while (Date.now() - tWait < waitMs) {
        try {
          if (statSync(p0).mtimeMs > prev) break;
        } catch {}
        await sleep(4);
      }
      try {
        meta = JSON.parse(readFileSync(path.join(VISION_DIR, "shot.json"), "utf8").replace(/^\uFEFF/, ""));
      } catch {
        meta = {};
      }
      meta.ps_ms = Date.now() - tGet;
    } else if (stale) meta = captureSee() || {};
    else {
      try {
        meta = JSON.parse(readFileSync(path.join(VISION_DIR, "shot.json"), "utf8").replace(/^\uFEFF/, ""));
      } catch {
        meta = {};
      }
    }
    let buf = readShotPng();
    if (buf && buf.length < 1000) {
      await sleep(40);
      buf = readShotPng() || buf;
    }
    if (!buf) return json(res, 404, { ok: false, error: "no live.png" });
    const headers = {
      "content-type": buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png",
      "content-length": buf.length,
      "cache-control": "no-store",
      "x-farm-frame-id": String(meta.frame_id || ""),
      "x-farm-ps-ms": String(meta.ps_ms ?? ""),
      "x-farm-overlay-ms": String(meta.ms_overlay ?? ""),
      "x-farm-copy-ms": String(meta.ms_copy ?? ""),
      "x-farm-encode-ms": String(meta.ms_encode ?? ""),
      "x-farm-shot-total-ms": String(meta.ms_total ?? ""),
      "x-farm-bytes": String(buf.length),
      "x-farm-stale": stale ? "1" : "0",
      "x-farm-get-ms": String(Date.now() - tGet),
      "x-farm-via": String(meta.via || "")
    };
    res.writeHead(200, headers);
    res.end(buf);
    return;
  }

  // drop files into FarmBootstrap (b64) so host can update shotter without Hyper-V next time
  if (route === "/put" && req.method === "POST") {
    const body = await readBody(req);
    const rel = String(body.path || body.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.includes("..") || rel.includes(":")) {
      return json(res, 400, { ok: false, error: "bad path" });
    }
    const dest = path.join("C:\\FarmBootstrap", ...rel.split("/"));
    if (!dest.toLowerCase().startsWith("c:\\farmbootstrap\\")) {
      return json(res, 400, { ok: false, error: "path outside FarmBootstrap" });
    }
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, Buffer.from(String(body.b64 || body.content || ""), "base64"));
      return json(res, 200, { ok: true, path: dest, bytes: Buffer.byteLength(readFileSync(dest)) });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  if (route === "/input" && req.method === "POST") {
    const body = await readBody(req);
    const kind = String(body.kind || "noop");
    const out = await psInput(kind, body);
    const text = String(out || "");
    const ok = kind === "sample" ? text.startsWith("{") : /^(kd|ku|click-|look-|fire|hold|type-|xdown|xup|wheel|release)/.test(text);
    return json(res, 200, { ok, kind, out });
  }

  if (route === "/cs/nofreeze" && req.method === "POST") {
    await readBody(req);
    try {
      const out = await runNoFreeze();
      return json(res, 200, { ok: true, ...out });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  if (route === "/cs/offline-map" && req.method === "POST") {
    const body = await readBody(req);
    if (!ALLOW_CS) return json(res, 403, { ok: false, error: "FARM_ALLOW_CS=0" });
    const map = String(body.map || "de_mirage").replace(/[^a-z0-9_]/gi, "") || "de_mirage";
    writeFarmCfgs({ play: true, fps: 60, queueKind: "competitive" });
    try {
      await consoleExec("map " + map);
      await delay(7000);
      await consoleExec("exec farm_walk");
      await delay(400);
      await consoleExec("jointeam 2");
      return json(res, 200, { ok: true, map, offline: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  if (route === "/cs/walk-empty" && req.method === "POST") {
    await readBody(req);
    try {
      const out = await runWalkEmpty();
      return json(res, 200, { ok: true, ...out });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  if (route === "/cs/label" && req.method === "POST") {
    await readBody(req);
    try {
      const out = await runLabelSession();
      return json(res, 200, { ok: true, ...out });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  if (route === "/cs/run" && req.method === "POST") {
    const body = await readBody(req);
    if (!ALLOW_CS) return json(res, 403, { ok: false, error: "FARM_ALLOW_CS=0" });
    const info = steamInfo();
    if (!info.installed) return json(res, 500, { ok: false, error: "steam missing" });
    const cfg = writeFarmCfgs(body);
    const netcon = Number(body.netconPort) || 21234;
    const farmUser = String(body.farmUser || "farm").trim() || "farm";
    const farmPass = String(body.farmPass || "FarmPass1!").trim();
    if (!hasProc(/^steam$/i)) {
      return json(res, 409, { ok: false, error: "steam not running", procs: procNames() });
    }
    applaunchCsInteractive(cfg, netcon, farmUser, farmPass);
    const csUp = await waitProc(/^cs2$/i, 120000);
    return json(res, 200, {
      ok: true,
      ran: true,
      hasCs: csUp || hasProc(/^cs2$/i),
      hasSteam: hasProc(/^steam/i),
      procs: procNames(),
      netcon
    });
  }

  if ((route === "/steam/launch" || route === "/cs/launch") && req.method === "POST") {
    const body = await readBody(req);
    if (!ALLOW_CS) return json(res, 403, { ok: false, error: "FARM_ALLOW_CS=0, refuse launch" });
    const info = steamInfo();
    if (!info.installed) return json(res, 500, { ok: false, error: "steam missing in guest" });
    if (!info.cs2Manifest && !info.cs2Exe) {
      return json(res, 500, { ok: false, error: "cs2 missing in guest library" });
    }
    const cfg = writeFarmCfgs(body);
    const launched = await launchSteamCs(body, cfg);
    return json(res, 200, {
      ok: true,
      launched: true,
      pid: launched.pid,
      netcon: launched.netcon,
      sessN: launched.sessN,
      loginOk: Boolean(launched.login && launched.login.ok),
      loginNote: launched.login && (launched.login.error || launched.login.note || launched.login.skipped || "ok"),
      keepSteam: Boolean(launched.keepSteam),
      queueKind: cfg.queueKind,
      gsiHost: cfg.gsiHost,
      hasCs: Boolean(launched.csUp) || hasProc(/^cs2$/i),
      hasSteam: hasProc(/^steam/i)
    });
  }

  if (route === "/queue" && req.method === "POST") {
    const body = await readBody(req);
    if (!ALLOW_CS) return json(res, 403, { ok: false, error: "FARM_ALLOW_CS=0" });
    writeFarmCfgs(body);
    // nudge menu: exec farmgo via netcon is host-side; here click play-ish + return
    psInput("click", { x: 50, y: 90 });
    if (body.guard) typeText(String(body.guard));
    return json(res, 200, { ok: true, queued: true, procs: procNames() });
  }

  if (route === "/stop" && req.method === "POST") {
    const body = await readBody(req);
    const steam = body.steam === true;
    killGames(steam);
    return json(res, 200, { ok: true, stopped: true, steam });
  }

  if (route === "/mouse/lock" && req.method === "POST") {
    await readBody(req);
    const lockerPath = "C:\\FarmBootstrap\\mouse-lock.ps1";
    const locker = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FarmClip {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool ClipCursor(ref RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lp, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
}
"@
# also clip to full virtual screen as fallback when cs hwnd tiny
while ($true) {
  try {
    $proc = Get-Process cs2 -EA SilentlyContinue | Select-Object -First 1
    if (-not $proc) { Start-Sleep 1; continue }
    $target = [uint32]$proc.Id
    $script:best = [IntPtr]::Zero
    $script:bestArea = 0
    $cb = [FarmClip+EnumProc]{
      param($h, $l)
      $p = 0
      [FarmClip]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
      if ($p -ne $target) { return $true }
      if (-not [FarmClip]::IsWindowVisible($h)) { return $true }
      $rc = New-Object FarmClip+RECT
      [FarmClip]::GetClientRect($h, [ref]$rc) | Out-Null
      $a = ($rc.R - $rc.L) * ($rc.B - $rc.T)
      if ($a -gt $script:bestArea) { $script:bestArea = $a; $script:best = $h }
      $true
    }
    [FarmClip]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
    $clip = New-Object FarmClip+RECT
    if ($script:best -ne [IntPtr]::Zero -and $script:bestArea -ge 50000) {
      [FarmClip]::SetForegroundWindow($script:best) | Out-Null
      $rc = New-Object FarmClip+RECT
      [FarmClip]::GetClientRect($script:best, [ref]$rc) | Out-Null
      $tl = New-Object FarmClip+POINT; $tl.X = $rc.L; $tl.Y = $rc.T
      $br = New-Object FarmClip+POINT; $br.X = $rc.R; $br.Y = $rc.B
      [FarmClip]::ClientToScreen($script:best, [ref]$tl) | Out-Null
      [FarmClip]::ClientToScreen($script:best, [ref]$br) | Out-Null
      $clip.L = $tl.X; $clip.T = $tl.Y; $clip.R = $br.X; $clip.B = $br.Y
    } else {
      # lock to primary display (no escape into host-looking letterbox)
      $clip.L = 0; $clip.T = 0
      $clip.R = [FarmClip]::GetSystemMetrics(0)
      $clip.B = [FarmClip]::GetSystemMetrics(1)
    }
    [FarmClip]::ClipCursor([ref]$clip) | Out-Null
  } catch {}
  Start-Sleep -Milliseconds 150
}
`;
    try {
      mkdirSync("C:\\FarmBootstrap", { recursive: true });
      writeFileSync(lockerPath, locker);
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
    // kill old lockers
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'mouse-lock' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }"
      ],
      { windowsHide: true, timeout: 8000 }
    );
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", lockerPath],
      { detached: true, stdio: "ignore", windowsHide: true }
    );
    child.unref();
    return json(res, 200, { ok: true, locked: true, pid: child.pid || null });
  }

  if (route === "/mouse/unlock" && req.method === "POST") {
    await readBody(req);
    spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Add-Type -Name UC -Namespace Farm -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ClipCursor(IntPtr r);'; [Farm.UC]::ClipCursor([IntPtr]::Zero); Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'mouse-lock' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }"
      ],
      { windowsHide: true, timeout: 8000 }
    );
    return json(res, 200, { ok: true, unlocked: true });
  }

  return json(res, 404, { ok: false, error: "unknown " + route });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => json(res, 500, { ok: false, error: String(e.message || e) }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("farm guest-agent", PORT, "allowCs", ALLOW_CS, "shotLoop", !SHOT_LEGACY);
  sendInputCmd("NOOP", 9000).catch(() => {});
  ensureShotChild();
});
