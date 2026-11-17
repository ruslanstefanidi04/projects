import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";

const DIR_PLUS = "C:\\Program Files\\Sandboxie-Plus";
const DIR_CLASSIC = "C:\\Program Files\\Sandboxie";

const STARTS = [
  process.env.SANDBOXIE_START || "",
  path.join(DIR_PLUS, "Start.exe"),
  path.join(DIR_CLASSIC, "Start.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Sandboxie-Plus", "Start.exe")
];

const INIS = [
  path.join(DIR_PLUS, "SbieIni.exe"),
  path.join(DIR_CLASSIC, "SbieIni.exe")
];

export function sandboxieStart() {
  for (const p of STARTS) {
    if (p && existsSync(p)) return p;
  }
  return "";
}

function sbieIni() {
  for (const p of INIS) {
    if (existsSync(p)) return p;
  }
  return "";
}

export function sandboxBox(acc) {
  const raw = String(acc.ipcName || acc.login || "test").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return (("csf" + raw).slice(0, 32) || "csfarm");
}

function iniSet(box, key, val) {
  const exe = sbieIni();
  if (!exe) return;
  spawnSync(exe, ["set", box, key, val], { stdio: "ignore", windowsHide: true });
}

function iniAppend(box, key, val) {
  const exe = sbieIni();
  if (!exe) return;
  spawnSync(exe, ["append", box, key, val], { stdio: "ignore", windowsHide: true });
}

function iniDel(box, key) {
  const exe = sbieIni();
  if (!exe) return;
  spawnSync(exe, ["set", box, key], { stdio: "ignore", windowsHide: true });
}

export function ensureBox(box, steamRoot) {
  const start = sandboxieStart();
  if (!start) return false;
  iniSet(box, "Enabled", "y");
  iniSet(box, "BoxNameTitle", "y");
  iniSet(box, "BorderColor", "#00FFFF,ttl,8");
  iniSet("UserSettings", "SbieCtrl_AutoApplyTemplates", "y");
  iniSet(box, "ConfigLevel", "10");
  iniDel(box, "ClosedFilePath");
  iniDel(box, "OpenPipePath");
  iniSet(box, "OpenPipePath", "\\Device\\NamedPipe\\csfarm*");
  iniSet(box, "OpenIpcPath", "\\RPC Control\\*steam*");
  iniAppend(box, "OpenIpcPath", "\\RPC Control\\*Steam*");
  iniAppend(box, "OpenWinClass", "Valve001");
  iniAppend(box, "OpenWinClass", "SDL_app");
  iniSet(box, "AllowNetworkAccess", "y");
  if (steamRoot && existsSync(steamRoot)) {
    const apps = path.join(steamRoot, "steamapps");
    const bin = path.join(steamRoot, "bin");
    const cfg = path.join(steamRoot, "config");
    const users = path.join(steamRoot, "userdata");
    if (existsSync(apps)) iniSet(box, "OpenFilePath", apps);
    if (existsSync(bin)) iniAppend(box, "OpenFilePath", bin);
    if (existsSync(cfg)) iniSet(box, "ClosedFilePath", cfg);
    if (existsSync(users)) iniAppend(box, "ClosedFilePath", users);
  }
  spawnSync(start, ["/reload"], { stdio: "ignore", windowsHide: true });
  return true;
}

export function boxSteamDir(box, steamRoot) {
  const dirs = allSteamDirs(box, steamRoot);
  return dirs.find((d) => existsSync(d)) || dirs[0] || "";
}

function allSteamDirs(box, steamRoot) {
  const m = String(steamRoot || "").match(/^([A-Za-z]):(.*)$/);
  if (!m || !box) return [];
  const drive = m[1].toUpperCase();
  const rest = m[2].replace(/^[\\/]+/, "");
  const fromIni = expandRoot(queryIni(box, "FileRootPath"), box);
  const roots = [fromIni, ...boxDirs(box)].filter(Boolean);
  return [...new Set(roots.map((r) => path.join(r, "drive", drive, rest)))];
}

export function seedBoxSteam(box, steamRoot) {
  for (const base of allSteamDirs(box, steamRoot)) {
    try {
      mkdirSync(path.join(base, "config"), { recursive: true });
      mkdirSync(path.join(base, "userdata"), { recursive: true });
    } catch (e) {
      console.log("seed fail", String(e.message || e));
    }
  }
}

function loginusersLive(t) {
  const s = String(t || "");
  if (/"AccountName"/i.test(s) && /"steamid"/i.test(s)) return true;
  if (/"RememberPassword"\s+"1"/i.test(s) && /"[0-9]{17}"/.test(s)) return true;
  return false;
}

function decodeB64(s) {
  try {
    return Buffer.from(String(s || ""), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function sessionLooksLive(files) {
  if (!files || typeof files !== "object") return false;
  const keys = Object.keys(files);
  if (keys.some((k) => /^ssfn/i.test(k))) return true;
  for (const k of keys) {
    if (!/local\.vdf$|config\.vdf$/i.test(k)) continue;
    try {
      if (Buffer.from(String(files[k]), "base64").length > 80) return true;
    } catch {}
  }
  return loginusersLive(decodeB64(files["config/loginusers.vdf"]));
}

function appdataSteamDirs(box) {
  return boxDirs(box).map((r) => path.join(r, "user", "current", "AppData", "Local", "Steam"));
}

export function sessionIsLive(files) {
  return sessionLooksLive(files);
}

export function restoreSession(box, steamRoot, files) {
  const existing = harvestSession(box, steamRoot);
  if (sessionLooksLive(existing)) {
    console.log("keep sandbox session", Object.keys(existing).join(","));
    return true;
  }
  const map = files && typeof files === "object" ? files : {};
  const keys = Object.keys(map);
  if (!keys.length) {
    seedBoxSteam(box, steamRoot);
    return false;
  }
  if (!sessionLooksLive(map) && !Object.keys(map).some((k) => /^ssfn/i.test(k))) {
    seedBoxSteam(box, steamRoot);
    return false;
  }
  const dirs = allSteamDirs(box, steamRoot);
  if (!dirs.length) return false;
  try {
    for (const base of dirs) {
      mkdirSync(path.join(base, "config"), { recursive: true });
      for (const rel of keys) {
        const clean = String(rel).replace(/\\/g, "/").replace(/^\/+/, "");
        if (!clean || clean.includes("..")) continue;
        if (clean === "config/loginusers.vdf" && !loginusersLive(decodeB64(map[rel]))) continue;
        if (clean.startsWith("appdata/")) {
          for (const ad of appdataSteamDirs(box)) {
            const dest = path.join(ad, ...clean.slice("appdata/".length).split("/"));
            mkdirSync(path.dirname(dest), { recursive: true });
            writeFileSync(dest, Buffer.from(String(map[rel]), "base64"));
          }
          continue;
        }
        const dest = path.join(base, ...clean.split("/"));
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, Buffer.from(String(map[rel]), "base64"));
      }
    }
    console.log("restore session", keys.length, "files", dirs[0]);
    return true;
  } catch (e) {
    console.log("restore fail", String(e.message || e));
    return false;
  }
}

export function harvestSession(box, steamRoot) {
  const out = {};
  const add = (base, rel) => {
    const full = path.join(base, rel);
    if (!existsSync(full)) return;
    try {
      const st = statSync(full);
      if (!st.isFile() || st.size > 800000) return;
      const key = rel.replace(/\\/g, "/");
      if (key === "config/loginusers.vdf") {
        const t = readFileSync(full, "utf8");
        if (!loginusersLive(t)) return;
      }
      if (!out[key] || st.size >= Buffer.from(out[key], "base64").length) {
        out[key] = readFileSync(full).toString("base64");
      }
    } catch {}
  };
  const walkUserdata = (base) => {
    const root = path.join(base, "userdata");
    if (!existsSync(root)) return;
    let ids = [];
    try {
      ids = readdirSync(root);
    } catch {
      return;
    }
    for (const id of ids) {
      if (!/^\d+$/.test(id)) continue;
      add(base, `userdata/${id}/config/local.vdf`);
      add(base, `userdata/${id}/7/remote/sharedconfig.vdf`);
      add(base, `userdata/${id}/config/config.vdf`);
    }
  };
  for (const base of allSteamDirs(box, steamRoot)) {
    if (!existsSync(base)) continue;
    add(base, "config/loginusers.vdf");
    add(base, "config/config.vdf");
    try {
      for (const name of readdirSync(base)) {
        if (/^ssfn/i.test(name)) add(base, name);
      }
    } catch {}
    try {
      const cfg = path.join(base, "config");
      if (existsSync(cfg)) {
        for (const name of readdirSync(cfg)) {
          if (/\.vdf$/i.test(name) && !/libraryfolders|dialogconfig/i.test(name)) add(base, "config/" + name);
        }
      }
    } catch {}
    walkUserdata(base);
  }
  for (const ad of appdataSteamDirs(box)) {
    if (!existsSync(ad)) continue;
    try {
      for (const name of readdirSync(ad)) {
        if (/\.vdf$/i.test(name)) add(ad, name);
      }
    } catch {}
    if (out["local.vdf"] && !out["appdata/local.vdf"]) {
      out["appdata/local.vdf"] = out["local.vdf"];
      delete out["local.vdf"];
    }
  }
  console.log("harvest session", Object.keys(out).join(",") || "empty");
  if (out["config/loginusers.vdf"]) {
    try {
      let t = Buffer.from(out["config/loginusers.vdf"], "base64").toString("utf8");
      t = t.replace(/"RememberPassword"\s+"0"/gi, '"RememberPassword"\t"1"');
      t = t.replace(/"WantsOfflineMode"\s+"1"/gi, '"WantsOfflineMode"\t"0"');
      out["config/loginusers.vdf"] = Buffer.from(t).toString("base64");
    } catch {}
  }
  return out;
}

export function boxHasSteam(box) {
  const ids = boxPids(box);
  if (!ids.length) return false;
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${ids.join(",")} -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'steam' } | Select-Object -First 1 -ExpandProperty Id`
    ],
    { encoding: "utf8", windowsHide: true }
  );
  return /\d+/.test(String(r.stdout || ""));
}

export function killBox(box) {
  const start = sandboxieStart();
  if (!start || !box) return;
  console.log("box terminate", box);
  spawnSync(start, ["/box:" + box, "/terminate"], { stdio: "ignore", windowsHide: true, timeout: 20000 });
}

export function steamShutdown(box, steamExe) {
  const start = sandboxieStart();
  if (!start || !box || !steamExe || !existsSync(steamExe)) return;
  if (!boxHasSteam(box)) return;
  console.log("steam shutdown", box);
  spawnSync(start, ["/box:" + box, steamExe, "-shutdown"], { stdio: "ignore", windowsHide: true, timeout: 20000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    if (!boxHasSteam(box)) break;
    spawnSync("ping", ["127.0.0.1", "-n", "3"], { stdio: "ignore", windowsHide: true });
  }
}

export function stopBox(box, steamExe) {
  const start = sandboxieStart();
  if (!start || !box) return;
  if (steamExe) steamShutdown(box, steamExe);
  spawnSync(start, ["/box:" + box, "/terminate"], { stdio: "ignore", windowsHide: true, timeout: 20000 });
}

export function boxPids(box) {
  const start = sandboxieStart();
  if (!start || !box) return [];
  const r = spawnSync(start, ["/box:" + box, "/listpids"], { encoding: "utf8", windowsHide: true });
  const text = String(r.stdout || "") + "\n" + String(r.stderr || "");
  const nums = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^\d+$/.test(t)) nums.push(Number(t));
  }
  if (nums.length >= 2 && nums[0] === nums.length - 1) nums.shift();
  return nums.filter((n) => n > 100);
}

function expandRoot(s, box) {
  return String(s || "")
    .replace(/%SANDBOX%/gi, box)
    .replace(/%USER%/gi, process.env.USERNAME || "")
    .replace(/%USERNAME%/gi, process.env.USERNAME || "")
    .replace(/%SystemDrive%/gi, process.env.SystemDrive || "C:")
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || "")
    .trim();
}

function queryIni(box, key) {
  const exe = sbieIni();
  if (!exe) return "";
  const r = spawnSync(exe, ["query", box, key], { encoding: "utf8", windowsHide: true });
  const line = String(r.stdout || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find((x) => x && !x.startsWith("[") && x.toLowerCase() !== "y" && x.toLowerCase() !== "n");
  return line || "";
}

function boxDirs(box) {
  const user = process.env.USERNAME || "";
  const home = process.env.USERPROFILE || "";
  const fromIni = expandRoot(queryIni(box, "FileRootPath"), box);
  return [
    fromIni,
    `C:\\Sandbox\\${user}\\${box}`,
    path.join(home, "Sandbox", box),
    path.join(process.env.LOCALAPPDATA || "", "Sandboxie-Plus", "Sandboxes", box)
  ].filter(Boolean);
}

function safeWipe(dir, box) {
  const n = path.resolve(dir).toLowerCase();
  const b = String(box).toLowerCase();
  if (!n.includes(b)) return false;
  if (n.includes("program files")) return false;
  if (n.length < 12) return false;
  if (!existsSync(dir)) return false;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 400 });
    console.log("wiped", dir);
    return true;
  } catch (e) {
    console.log("wipe fail", dir, String(e.message || e));
    return false;
  }
}

export function resetBox(box) {
  const start = sandboxieStart();
  if (!start || !box) return;
  console.log("reset sandbox", box);
  spawnSync(start, ["/box:" + box, "/terminate"], { stdio: "ignore", windowsHide: true, timeout: 20000 });
  spawnSync("ping", ["127.0.0.1", "-n", "3"], { stdio: "ignore", windowsHide: true });
  for (const dir of boxDirs(box)) safeWipe(dir, box);
}

export function boxHasCs(box) {
  return Boolean(csPidInBox(box, false));
}

export function boxHasCsWindow(box) {
  return Boolean(csHwndInBox(box));
}

function csPidInBox(box, needWindow) {
  const ids = boxPids(box);
  if (!ids.length) return 0;
  if (needWindow) return csHwndInBox(box) ? 1 : 0;
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${ids.join(",")} -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'cs2|csgo' } | Select-Object -First 1 -ExpandProperty Id`
    ],
    { encoding: "utf8", windowsHide: true }
  );
  const n = Number(String(r.stdout || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function csFindPs(ids) {
  return `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class CsFind2 {
  public delegate bool Cb(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Cb cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
$cs = @(Get-Process -Id @(${ids.join(",")}) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(cs2|csgo)$' } | Select-Object -ExpandProperty Id)
$script:cands = New-Object System.Collections.Generic.List[string]
$script:best = [IntPtr]::Zero
$script:bestA = 0
$script:bestT = ''
$cb = [CsFind2+Cb]{
  param($h, $l)
  $p = 0
  [void][CsFind2]::GetWindowThreadProcessId($h, [ref]$p)
  if ($cs -notcontains [int]$p) { return $true }
  $rc = New-Object CsFind2+RECT
  [void][CsFind2]::GetClientRect($h, [ref]$rc)
  $a = [Math]::Max(0, $rc.R - $rc.L) * [Math]::Max(0, $rc.B - $rc.T)
  if ($a -lt 40000) {
    [void][CsFind2]::GetWindowRect($h, [ref]$rc)
    $a = [Math]::Max(0, $rc.R - $rc.L) * [Math]::Max(0, $rc.B - $rc.T)
  }
  $sb = New-Object System.Text.StringBuilder 256
  [void][CsFind2]::GetWindowText($h, $sb, 256)
  $title = $sb.ToString()
  if ($title -match 'IME|MSCTF') { return $true }
  $vis = [CsFind2]::IsWindowVisible($h)
  $score = $a
  if ($title -match 'Counter-Strike|CS2') { $score += 100000000 }
  if ($a -lt 20000 -and $score -lt 100000000) { return $true }
  $script:cands.Add('cand-' + [int]$p + '-' + $score + '-' + $vis + '-' + ($rc.R-$rc.L) + 'x' + ($rc.B-$rc.T) + '-' + $title)
  if ($score -gt $script:bestA) {
    $script:best = $h
    $script:bestA = $score
    $script:bestT = $title
  }
  return $true
}
[CsFind2]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$best = $script:best
$bestT = $script:bestT
if ($best -eq [IntPtr]::Zero) { Write-Output 'none'; exit 0 }
`;
}

export function showCsWindow(box) {
  const h = csHwndInBox(box);
  if (h) console.log("cs2 hwnd", h);
  return Boolean(h);
}

export function csHwndInBox(box) {
  const ids = boxPids(box);
  if (!ids.length) return 0;
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      csFindPs(ids) + `Write-Output ([int64]$best)`
    ],
    { encoding: "utf8", windowsHide: true, timeout: 12000 }
  );
  const lines = String(r.stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const n = Number(lines[lines.length - 1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function shotCsWindow(box, file) {
  const ids = boxPids(box);
  if (!ids.length || !file) return false;
  const dest = String(file).replace(/'/g, "''");
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      csFindPs(ids) + `
Add-Type -AssemblyName System.Drawing
$wr = New-Object CsFind2+RECT
[CsFind2]::GetWindowRect($best, [ref]$wr) | Out-Null
$w = [Math]::Max(8, $wr.R - $wr.L)
$ht = [Math]::Max(8, $wr.B - $wr.T)
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[CsFind2]::PrintWindow($best, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save('${dest}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$rc = New-Object CsFind2+RECT
[CsFind2]::GetClientRect($best, [ref]$rc) | Out-Null
Write-Output ('shot-' + ($rc.R-$rc.L) + 'x' + ($rc.B-$rc.T) + '-' + $bestT)
`
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000 }
  );
  const out = String(r.stdout || "").trim();
  console.log("cs2 shot", out || "fail");
  return out.startsWith("shot-");
}

export function wrapSandbox(exe, args, acc, steamRoot) {
  const start = sandboxieStart();
  if (!start) return { file: exe, args, sandbox: "" };
  const box = sandboxBox(acc);
  ensureBox(box, steamRoot || path.dirname(exe));
  return { file: start, args: ["/box:" + box, exe, ...args], sandbox: box };
}
