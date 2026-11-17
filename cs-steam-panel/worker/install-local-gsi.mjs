// install GSI cfg into host CS2 so record-local can listen on 127.0.0.1:32222
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";

const port = Number(process.env.BOT_GSI_PORT || 32222);
const token = process.env.BOT_GSI_TOKEN || "csfarm";
const host = process.env.GSI_HOST || "127.0.0.1";

const gsi = `"csfarm"
{
  "uri" "http://${host}:${port}"
  "timeout" "5.0"
  "buffer"  "0.05"
  "throttle" "0.05"
  "heartbeat" "5.0"
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
    "player_position"     "1"
    "allplayers_id"       "1"
    "allplayers_state"    "1"
    "allplayers_position" "1"
    "grenade"             "1"
  }
}
`;

const greenDot = [
  "cl_crosshairstyle 2",
  "cl_crosshairdot 1",
  "cl_crosshairsize 1",
  "cl_crosshairthickness 0.5",
  "cl_crosshairgap -3",
  "cl_crosshaircolor 1",
  "cl_crosshairalpha 255",
  "cl_crosshairusealpha 1",
  "cl_crosshair_drawoutline 0",
  "cl_crosshair_outlinethickness 0",
  "cl_crosshair_t 0",
  "cl_crosshair_recoil 0",
  "m_rawinput 1",
  "m_customaccel 0",
  "con_enable 1"
].join("\n");

function steamPathFromReg() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `(Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Valve\\Steam' -EA SilentlyContinue).SteamPath; (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam' -EA SilentlyContinue).InstallPath`
    ],
    { encoding: "utf8", windowsHide: true, timeout: 8000 }
  );
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function libraryRoots(steamRoot) {
  const roots = [steamRoot];
  const vdf = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
  if (!existsSync(vdf)) return roots;
  const text = readFileSync(vdf, "utf8");
  for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
    const p = m[1].replace(/\\\\/g, "\\");
    if (p && !roots.includes(p)) roots.push(p);
  }
  return roots;
}

function findCfgDirs() {
  const steams = steamPathFromReg();
  const dirs = [];
  for (const steam of steams) {
    for (const root of libraryRoots(steam)) {
      const candidates = [
        path.join(root, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg"),
        path.join(root, "steamapps", "common", "Counter-Strike Global Offensive", "csgo", "cfg")
      ];
      for (const c of candidates) {
        if (existsSync(path.dirname(c)) || existsSync(c)) dirs.push(c);
      }
    }
  }
  // common fallbacks
  for (const c of [
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg",
    "D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg",
    "E:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg"
  ]) {
    if (!dirs.includes(c) && (existsSync(path.dirname(c)) || existsSync(c))) dirs.push(c);
  }
  return [...new Set(dirs)];
}

const dirs = findCfgDirs();
if (!dirs.length) {
  console.error("CS2 cfg dir not found. Install CS2 / set Steam library, then re-run.");
  console.error("Manual: put gamestate_integration_csfarm.cfg into .../game/csgo/cfg/");
  process.exit(2);
}

for (const dir of dirs) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "gamestate_integration_csfarm.cfg"), gsi);
  writeFileSync(path.join(dir, "farm_local.cfg"), greenDot + "\n");
  const auto = path.join(dir, "autoexec.cfg");
  let body = existsSync(auto) ? readFileSync(auto, "utf8") : "";
  if (!/exec farm_local/.test(body)) {
    body = (body.trimEnd() + "\nexec farm_local\n").replace(/^\n+/, "");
    writeFileSync(auto, body);
  }
  console.log("wrote", dir);
}

console.log("ok GSI -> http://%s:%s token=%s", host, port, token);
console.log("restart CS2 once, then: node record-local.mjs");
