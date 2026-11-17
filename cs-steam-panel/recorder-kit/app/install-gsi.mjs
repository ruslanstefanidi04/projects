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

export function findCfgDirs() {
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
  for (const c of [
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg",
    "D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg",
    "E:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\cfg"
  ]) {
    if (!dirs.includes(c) && (existsSync(path.dirname(c)) || existsSync(c))) dirs.push(c);
  }
  return [...new Set(dirs)];
}

export function installGsi() {
  const dirs = findCfgDirs();
  if (!dirs.length) return { ok: false, dirs: [], error: "cs2-cfg-not-found" };
  const wrote = [];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "gamestate_integration_csfarm.cfg"), gsi);
    wrote.push(dir);
  }
  return { ok: true, dirs: wrote, host, port, token };
}

if (process.argv[1] && /install-gsi\.mjs$/.test(String(process.argv[1]).replace(/\\/g, "/"))) {
  const r = installGsi();
  if (!r.ok) {
    console.error("CS2 cfg not found. Install CS2, then run RECORD.bat again.");
    process.exit(2);
  }
  for (const d of r.dirs) console.log("gsi wrote", d);
  console.log("ok GSI http://%s:%s", r.host, r.port);
}
