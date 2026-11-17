import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { steamGuard } from "./totp.mjs";
import { shellLayout, spawnEnv } from "./proxy.mjs";
import { wrapSandbox, ensureBox, restoreSession, harvestSession, boxSteamDir, boxHasCs, boxHasCsWindow, sandboxBox, sessionIsLive, killBox, boxHasSteam } from "./sandbox.mjs";
import { cefDebugArgs, steamClientReady, steamUiLogin, steamDismissUi } from "./steam-login.mjs";
import { sleep } from "./pace.mjs";
import { isolationMode, prepareVmAccount, launchVmGame } from "./vm/host.mjs";
import { netconPort, setConBox, setConHost } from "./con.mjs";
import { setInputBox, setInputAgent } from "./input.mjs";

export const DEFAULT_STEAM = "C:\\Program Files (x86)\\Steam\\steam.exe";

function sessFile(login) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "sess");
  mkdirSync(dir, { recursive: true });
  const safe = String(login || "acc").replace(/[^a-z0-9._-]+/gi, "_");
  return path.join(dir, safe + ".json");
}

function readDiskSession(login) {
  try {
    const j = JSON.parse(readFileSync(sessFile(login), "utf8"));
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

function writeDiskSession(login, files) {
  if (!sessionIsLive(files)) {
    console.log("sess skip, not live");
    return;
  }
  try {
    writeFileSync(sessFile(login), JSON.stringify(files));
    console.log("sess saved", login, Object.keys(files).length);
  } catch (e) {
    console.log("sess save fail", String(e.message || e));
  }
}

function mergeSess(...packs) {
  const out = {};
  for (const p of packs) {
    for (const [k, v] of Object.entries(p || {})) {
      if (k === "config/loginusers.vdf") {
        try {
          const t = Buffer.from(String(v), "base64").toString("utf8");
          if (!/"AccountName"/i.test(t)) continue;
        } catch {
          continue;
        }
      }
      if (!out[k] || String(v).length >= String(out[k]).length) out[k] = v;
    }
  }
  return out;
}

export function steamId32(steamId) {
  try {
    return (BigInt(steamId) - 76561197960265728n).toString();
  } catch {
    return "";
  }
}

export function gameArgs(fps, w, h, conPort) {
  const cap = Number(fps) || 20;
  const args = [
    "-novid",
    "-nosound",
    "-nohltv",
    "-windowed",
    "-w",
    "1280",
    "-h",
    "720",
    "-freq",
    "60",
    "-threads",
    "1",
    "+fps_max",
    String(cap),
    "+fps_max_ui",
    String(cap),
    "+exec",
    "farm",
    "-console",
    "+con_enable",
    "1"
  ];
  if (conPort) args.push("-netconport", String(conPort));
  return args;
}

export function writeLowCfg(steamRoot, steamId, fps, w, h) {
  const cap = Number(fps) || 20;
  const width = Number(w) || 640;
  const height = Number(h) || 480;
  const acc = steamId32(steamId);
  const cfgDir = path.join(steamRoot, "userdata", acc || "0", "730", "local", "cfg");
  try {
    mkdirSync(cfgDir, { recursive: true });
  } catch {
    return;
  }
  const farm = [
    `fps_max ${cap}`,
    `fps_max_ui ${cap}`,
    "engine_low_latency_sleep_after_client_tick true",
    "r_show_build_info 0",
    "cl_allow_animated_avatars 0",
    "cl_invites_only_friends 0",
    "con_enable 1",
    'alias farmstop "-forward;-back;-moveleft;-moveright;-jump;-attack;-attack2;-duck;-speed"',
    'alias farmgo "game_type 0;game_mode 1;game_alias competitive;matchmaking_session_create"'
  ].join("\n");
  writeFileSync(path.join(cfgDir, "farm.cfg"), farm);
  writeFileSync(path.join(cfgDir, "autoexec.cfg"), "exec farm\n");
  const video = `"video.cfg"
{
  "setting.cpu_level"    "0"
  "setting.gpu_mem_level"    "0"
  "setting.gpu_level"    "0"
  "setting.mat_vsync"    "0"
  "setting.mem_level"    "0"
  "setting.defaultres"    "${width}"
  "setting.defaultresheight"    "${height}"
  "setting.fullscreen"    "0"
  "setting.nowindowborder"    "0"
  "setting.mat_queue_mode"    "0"
}
`;
  writeFileSync(path.join(cfgDir, "cs2_video.txt"), video);
  const common = path.join(steamRoot, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg");
  try {
    mkdirSync(common, { recursive: true });
    writeFileSync(path.join(common, "farm.cfg"), farm);
  } catch {}
  installGsi(steamRoot);
}

function gsiReachableHost() {
  const want = String(process.env.GSI_HOST || "").trim();
  if (want) return want;
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (!n || n.internal) continue;
      if (n.family !== "IPv4" && n.family !== 4) continue;
      const ip = String(n.address || "");
      if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return ip;
    }
  }
  return "127.0.0.1";
}

export function installGsi(steamRoot) {
  const port = Number(process.env.BOT_GSI_PORT || 32222);
  const token = process.env.BOT_GSI_TOKEN || "csfarm";
  const host = gsiReachableHost();
  const text = `"csfarm"
{
  "uri" "http://${host}:${port}"
  "timeout" "5.0"
  "buffer"  "0.15"
  "throttle" "0.2"
  "heartbeat" "8.0"
  "auth"
  {
    "token" "${token}"
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
  }
}
`;
  const dirs = [
    path.join(steamRoot, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg"),
    path.join(steamRoot, "steamapps", "common", "Counter-Strike Global Offensive", "csgo", "cfg")
  ];
  for (const cfgDir of dirs) {
    try {
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(path.join(cfgDir, "gamestate_integration_csfarm.cfg"), text);
    } catch {}
  }
}

export function steamRootFromExe(exe) {
  return path.dirname(exe);
}

export function placeWindow() {}

export function killPid(pid) {
  if (!pid) return;
  spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}

export async function launchSteam(acc, index = 0, opts = {}) {
  const mode = isolationMode();
  if (mode === "vm") {
    const allow = process.env.FARM_ALLOW_CS !== "0";
    console.log("isolation vm", acc.login || acc.id, "allowCs", allow);
    if (!allow) {
      const ready = await prepareVmAccount(acc);
      console.log("vm prepared, cs launch skipped", ready.name, ready.ip);
      return ready;
    }
    if (!(acc.login || "").trim() || !(acc.password || "").trim()) {
      throw new Error("нет логина или пароля");
    }
    const boxKey = "";
    const nc = netconPort("vmfarm");
    const guard = steamGuard(acc.sharedSecret);
    const launched = await launchVmGame(acc, {
      queue: opts.queue || { kind: acc.matchKind || "competitive", host: "" },
      guard,
      netconPort: nc
    });
    setConBox(boxKey);
    setConHost(launched.ip);
    setInputBox("");
    setInputAgent(launched.ip, process.env.FARM_AGENT_TOKEN || "csfarm", Number(process.env.FARM_AGENT_PORT || 39200));
    console.log("vm cs launch", launched.name, launched.ip, "netcon", nc, "guard", Boolean(guard));
    return { ...launched, cs: true, pid: launched.pid };
  }

  // host GPU path (hyped farms): one steam on discrete GPU, no Hyper-V video
  if (mode === "host") {
    const exe = acc.steamPath || process.env.STEAM_EXE || DEFAULT_STEAM;
    if (!existsSync(exe)) throw new Error("steam.exe not found");
    if (!(acc.login || "").trim() || !(acc.password || "").trim()) {
      throw new Error("нет логина или пароля");
    }
    const steamRoot = steamRootFromExe(exe);
    const lay = shellLayout(acc.login || acc.id, index);
    const fps = acc.fpsCap || lay.fps || 30;
    const ipc = acc.ipcName || acc.login || acc.id;
    const q = opts.queue || { kind: acc.matchKind || "competitive", host: "" };
    writeLowCfg(steamRoot, acc.steamId, fps, lay.w || 1280, lay.h || 720);
    if (q) writeQueue(steamRoot, acc.steamId, q.kind, q.host || "", "");
    const nc = netconPort(ipc);
    setConBox("");
    setConHost("127.0.0.1");
    setInputBox("");
    setInputAgent("", "", 0);

    const already = spawnSync("powershell", ["-NoProfile", "-Command", "(Get-Process cs2 -EA SilentlyContinue | Measure-Object).Count"], {
      encoding: "utf8",
      windowsHide: true
    });
    if (Number(String(already.stdout || "").trim()) > 0) {
      console.log("host cs2 already up");
      return { pid: null, cs: true, host: true, netcon: nc, note: "host cs2 up" };
    }

    const args = [
      "-master_ipc_name_override",
      String(ipc),
      "-nofriendsui",
      "-nooverlay",
      "-applaunch",
      "730",
      "-novid",
      "-windowed",
      "-w",
      String(lay.w || 1280),
      "-h",
      String(lay.h || 720),
      "-console",
      "+fps_max",
      String(fps),
      "+exec",
      "farm",
      "+exec",
      "farm_queue"
    ];
    console.log("isolation host", acc.login, "applaunch 730");
    const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false, cwd: steamRoot });
    child.unref();
    // wait up to 90s for cs2 on host
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 90000) {
      await sleep(3000);
      const c = spawnSync("powershell", ["-NoProfile", "-Command", "(Get-Process cs2 -EA SilentlyContinue | Measure-Object).Count"], {
        encoding: "utf8",
        windowsHide: true
      });
      if (Number(String(c.stdout || "").trim()) > 0) {
        up = true;
        break;
      }
    }
    console.log("host cs2", up ? "up" : "not yet", "pidSteam", child.pid);
    return { pid: child.pid || null, cs: up, host: true, netcon: nc, note: up ? "host cs2 up" : "host steam started, waiting cs2" };
  }

  const exe = acc.steamPath || process.env.STEAM_EXE || DEFAULT_STEAM;
  if (!existsSync(exe)) {
    throw new Error("steam.exe not found");
  }
  if (!(acc.login || "").trim() || !(acc.password || "").trim()) {
    throw new Error("нет логина или пароля");
  }
  const steamRoot = steamRootFromExe(exe);
  const lay = shellLayout(acc.login || acc.id, index);
  const fps = acc.fpsCap || lay.fps;
  writeLowCfg(steamRoot, acc.steamId, fps, lay.w, lay.h);
  const ipc = acc.ipcName || acc.login || acc.id;
  const code = steamGuard(acc.sharedSecret);
  const env = spawnEnv(acc.proxy);
  const proxyWrap = process.env.PROXY_WRAPPER || "";
  let file = exe;
  let startArgs = ["-master_ipc_name_override", ipc, ...cefDebugArgs(sandboxBox(acc))];
  if (proxyWrap && acc.proxy && existsSync(proxyWrap)) {
    startArgs = [exe, ...startArgs];
    file = proxyWrap;
  }
  const boxed = wrapSandbox(file, startArgs, acc, steamRoot);
  setConBox(boxed.sandbox);
  setInputBox(boxed.sandbox);
  if (!boxed.sandbox) {
    throw new Error("нет Sandboxie. Запусти setup-sandbox.bat от админа");
  }
  ensureBox(boxed.sandbox, steamRoot);
  if (boxHasCs(boxed.sandbox) || boxHasCsWindow(boxed.sandbox)) {
    console.log("cs2 already up, skip login", boxed.sandbox);
    const session = harvestSession(boxed.sandbox, steamRoot);
    writeDiskSession(acc.login, session);
    if (opts.queue) {
      writeQueue(steamRoot, acc.steamId, opts.queue.kind, opts.queue.host, boxed.sandbox);
      console.log("queue cfg", opts.queue.kind);
    }
    return { pid: null, session, cs: true };
  }
  const keepSteam = boxHasSteam(boxed.sandbox);
  if (keepSteam) {
    console.log("keep boxed steam for guard", boxed.sandbox);
  } else {
    console.log("recycle box", boxed.sandbox);
    killBox(boxed.sandbox);
    await sleep(2000);
  }
  const flushed = harvestSession(boxed.sandbox, steamRoot);
  writeDiskSession(acc.login, flushed);
  const packed = mergeSess(readDiskSession(acc.login), flushed, acc.steamSession);
  const reused = restoreSession(boxed.sandbox, steamRoot, packed);
  console.log("sandbox box", boxed.sandbox, "session", reused ? "box" : "fresh", "files", Object.keys(packed).length, "steam", keepSteam ? "up" : "down");
  let child = { pid: null };
  if (!keepSteam) {
    console.log("start steam", acc.login, boxed.sandbox);
    child = spawn(boxed.file, boxed.args, { detached: true, stdio: "ignore", windowsHide: false, env });
    child.unref();
    await sleep(14000);
  }
  const ui = {
    login: acc.login,
    password: acc.password,
    guard: code,
    box: boxed.sandbox,
    reuseSession: reused || keepSteam
  };
  let ready = false;
  if (ui.reuseSession) {
    console.log("wait steam saved session or guard");
    ready = await steamClientReady(keepSteam ? 8000 : 50000, ui);
  }
  if (!ready) {
    console.log("fill steam login, no host input", boxed.sandbox);
    await steamUiLogin(ui);
    console.log("wait steam library, type guard in boxed steam");
    ready = await steamClientReady(10 * 60 * 1000, ui);
  }
  if (!ready) {
    console.log("steam not ready, retry fill");
    await steamUiLogin(ui);
    ready = await steamClientReady(3 * 60 * 1000, ui);
  }
  if (!ready) {
    console.log("steam ui unclear, still try cs2");
  }
  await steamDismissUi(boxed.sandbox);
  await sleep(2000);
  let session = harvestSession(boxed.sandbox, steamRoot);
  writeDiskSession(acc.login, session);
  const q = opts.queue;
  if (q) {
    writeQueue(steamRoot, acc.steamId, q.kind, q.host, boxed.sandbox);
    console.log("queue cfg", q.kind);
  }
  const extra = q ? ["+exec", "farm_queue"] : [];
  const gameArgsList = ["-applaunch", "730", ...gameArgs(fps, lay.w, lay.h, netconPort(boxed.sandbox)), ...extra];
  const pid = child.pid || null;
  const boxedRoot = boxSteamDir(boxed.sandbox, steamRoot);
  if (boxedRoot) {
    try {
      installGsi(boxedRoot);
      writeLowCfg(boxedRoot, acc.steamId, fps, lay.w, lay.h);
    } catch {}
  }
  let cs = boxHasCs(boxed.sandbox) || boxHasCsWindow(boxed.sandbox);
  for (let n = 0; n < 5 && !cs; n++) {
    const game = wrapSandbox(exe, gameArgsList, acc, steamRoot);
    console.log("applaunch 730 try", n + 1);
    spawn(game.file, game.args, { detached: true, stdio: "ignore", windowsHide: false, env }).unref();
    cs = await waitCsInBox(boxed.sandbox, 90000);
  }
  console.log(cs ? "cs2 window" : "cs2 no window");
  session = mergeSess(session, harvestSession(boxed.sandbox, steamRoot));
  writeDiskSession(acc.login, session);
  if (cs) setTimeout(() => placeWindow(boxed.sandbox, lay.x, lay.y, lay.w, lay.h), 2000);
  return { pid, session, cs };
}

export async function waitCsInBox(box, ms = 240000) {
  const t0 = Date.now();
  let saw = false;
  while (Date.now() - t0 < ms) {
    if (boxHasCsWindow(box)) return true;
    if (boxHasCs(box)) {
      saw = true;
      console.log("wait cs2 window", box);
    } else {
      console.log("wait cs2", box);
    }
    await sleep(saw ? 2500 : 4000);
  }
  return boxHasCs(box) || boxHasCsWindow(box);
}

export function csRunning() {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", "(Get-Process cs2,csgo -ErrorAction SilentlyContinue | Select-Object -First 1).Id"],
    { encoding: "utf8", windowsHide: true }
  );
  return /\d+/.test(String(r.stdout || ""));
}

export function launchCs2(acc) {
  const exe = acc.steamPath || process.env.STEAM_EXE || DEFAULT_STEAM;
  const steamRoot = steamRootFromExe(exe);
  const lay = shellLayout(acc.login || acc.id, 0);
  const fps = acc.fpsCap || lay.fps;
  const box = sandboxBox(acc);
  setConBox(box);
  setInputBox(box);
  const game = wrapSandbox(exe, ["-applaunch", "730", ...gameArgs(fps, lay.w, lay.h, netconPort(box))], acc, steamRoot);
  console.log("applaunch 730");
  spawn(game.file, game.args, { detached: true, stdio: "ignore", windowsHide: false }).unref();
}

export function queueCfg(kind, host) {
  const map = {
    competitive: { t: 0, m: 1 },
    premier: { t: 0, m: 1 },
    wingman: { t: 0, m: 2 },
    casual: { t: 0, m: 0 },
    deathmatch: { t: 1, m: 2 }
  };
  const g = map[kind] || map.competitive;
  const lines = [
    "con_enable 1",
    `game_type ${g.t}`,
    `game_mode ${g.m}`
  ];
  if (kind === "deathmatch") lines.push("game_alias deathmatch");
  if (kind === "casual") lines.push("game_alias casual");
  if (kind === "wingman") lines.push("game_alias wingman");
  if (kind === "premier") lines.push("game_alias premier");
  if (kind === "competitive") lines.push("game_alias competitive");
  if (host) lines.push(`connect ${host}`);
  else lines.push("matchmaking_session_create");
  return lines.join("\n") + "\n";
}

export function queueTarget(acc, payload) {
  let kind = acc?.matchKind || "competitive";
  let host = acc?.connectHost || "";
  const p = String(payload || "").trim();
  if (p.startsWith("{")) {
    try {
      const j = JSON.parse(p);
      if (j.matchKind) kind = j.matchKind;
      if (j.host) host = j.host;
    } catch {}
  } else if (p) {
    host = p;
  }
  return { kind, host };
}

export function writeQueue(steamRoot, steamId, kind, host, box) {
  const body = queueCfg(kind, host) + "exec farm\n";
  const acc = steamId32(steamId);
  const boxed = box ? boxSteamDir(box, steamRoot) : "";
  const dirs = [
    path.join(steamRoot, "userdata", acc || "0", "730", "local", "cfg"),
    path.join(steamRoot, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg"),
    path.join(steamRoot, "steamapps", "common", "Counter-Strike Global Offensive", "csgo", "cfg")
  ];
  if (boxed) {
    dirs.push(path.join(boxed, "userdata", acc || "0", "730", "local", "cfg"));
    dirs.push(path.join(boxed, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg"));
  }
  for (const cfgDir of dirs) {
    try {
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(path.join(cfgDir, "farm_queue.cfg"), body);
    } catch {}
  }
}
