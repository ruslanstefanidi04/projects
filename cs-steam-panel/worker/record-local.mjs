// record-local: HOST CS2 — GSI + keys + mouse + screens + radar CV + loopback audio
import { spawn, spawnSync } from "child_process";
import {
  appendFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync
} from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startGsi, parseGsi } from "./gsi.mjs";
import { tickClock, isDeathmatch } from "./round-clock.mjs";
import { sleep } from "./pace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FARM_HUMAN_DIR || "D:/FarmVMs/ops/vision/human-record";
const PY = process.env.FARM_PYTHON || "C:/Users/R00/AppData/Local/Programs/Python/Python312/python.exe";
const ENGINE = path.join(__dirname, "cv", "engine.py");
const FFMPEG =
  process.env.FARM_FFMPEG ||
  "C:/Users/R00/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe";

const DURATION_MS = Number(process.env.FARM_RECORD_MS || 30 * 60 * 1000);
const FRAME_EVERY_MS = Number(process.env.FARM_RECORD_FRAME_MS || 2000);
const KEY_EVERY_MS = Number(process.env.FARM_RECORD_KEY_MS || 50);
const DO_CV = process.env.FARM_RECORD_CV !== "0";
const DO_AUDIO = process.env.FARM_RECORD_AUDIO !== "0";
const gsiPort = Number(process.env.BOT_GSI_PORT || 32222);
const gsiToken = process.env.BOT_GSI_TOKEN || "csfarm";

const sessionId = `local-${Date.now().toString(36)}`;
const sessDir = path.join(OUT, sessionId);
const framesDir = path.join(sessDir, "frames");
mkdirSync(framesDir, { recursive: true });

const metaPath = path.join(sessDir, "meta.json");
const gsiPath = path.join(sessDir, "gsi.jsonl");
const keysPath = path.join(sessDir, "keys.jsonl");
const framesPath = path.join(sessDir, "frames.jsonl");
const mousePath = path.join(sessDir, "mouse.jsonl");
const radarPath = path.join(sessDir, "radar.jsonl");
const audioPath = path.join(sessDir, "audio.ogg");
const logPath = path.join(sessDir, "record.log");

function log(line) {
  const s = `${new Date().toISOString()} ${line}`;
  console.log(s);
  try {
    appendFileSync(logPath, s + "\n");
  } catch {}
}

function appendJsonl(file, obj) {
  appendFileSync(file, JSON.stringify(obj) + "\n");
}

function sampleKeysLocal() {
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class FarmKey { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v); }
"@
function D([int]$vk){ if (([FarmKey]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { 'true' } else { 'false' } }
Write-Output ('{"W":'+(D 0x57)+',"A":'+(D 0x41)+',"S":'+(D 0x53)+',"D":'+(D 0x44)+',"SPACE":'+(D 0x20)+',"SHIFT":'+(D 0xA0)+',"CTRL":'+(D 0xA2)+',"R":'+(D 0x52)+',"M1":'+(D 0x01)+',"M2":'+(D 0x02)+',"E":'+(D 0x45)+'}')
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

function countJsonlLines(file) {
  try {
    if (!existsSync(file)) return 0;
    const t = readFileSync(file, "utf8");
    if (!t) return 0;
    let n = 0;
    for (let i = 0; i < t.length; i++) if (t[i] === "\n") n++;
    return n;
  } catch {
    return 0;
  }
}

function startMouseRaw() {
  const exe = "D:/FarmVMs/ops/tools/MouseRawRec.exe";
  if (!existsSync(exe)) {
    log("mouse-raw skip: MouseRawRec.exe missing");
    return null;
  }
  const child = spawn(exe, [mousePath, "0"], {
    windowsHide: true,
    stdio: "ignore",
    cwd: "D:/FarmVMs/ops/tools",
    detached: false
  });
  child.on("error", (e) => log(`mouse-raw-err ${e.message}`));
  child.on("exit", (code) => log(`mouse-raw-exit code=${code}`));
  log(`mouse raw-input -> ${mousePath}`);
  return child;
}

/** grab primary screen (host CS fullscreen / borderless) */
function captureScreenPng(outFile) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$g.Dispose()
$bmp.Save('${outFile.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ('ok ' + $b.Width + 'x' + $b.Height)
`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000
  });
  return r.status === 0 && existsSync(outFile);
}

function runCv(pngPath, jsonPath) {
  if (!DO_CV || !existsSync(PY) || !existsSync(ENGINE)) return null;
  const r = spawnSync(PY, [ENGINE, "--image", pngPath, "--out", jsonPath], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 25000
  });
  if (r.status !== 0 || !existsSync(jsonPath)) return null;
  try {
    return JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return null;
  }
}

function startAudio() {
  if (!DO_AUDIO) {
    log("audio disabled");
    return null;
  }
  const wavPath = path.join(sessDir, "audio.wav");
  const exe = "D:/FarmVMs/ops/tools/LoopbackRec.exe";
  const dll = "D:/FarmVMs/ops/tools/NAudio.dll";
  if (existsSync(exe) && existsSync(dll)) {
    const child = spawn(exe, [wavPath, "0"], {
      windowsHide: true,
      stdio: "ignore",
      cwd: "D:/FarmVMs/ops/tools"
    });
    child.on("error", (e) => log(`audio-err ${e.message}`));
    child.on("exit", (code) => log(`audio-exit code=${code}`));
    log(`audio wasapi-loopback -> ${wavPath}`);
    return child;
  }
  log("audio skip: LoopbackRec.exe missing");
  return null;
}

writeFileSync(
  metaPath,
  JSON.stringify(
    {
      sessionId,
      source: "host-local",
      startedAt: new Date().toISOString(),
      durationMs: DURATION_MS,
      frameEveryMs: FRAME_EVERY_MS,
      keyEveryMs: KEY_EVERY_MS,
      cv: DO_CV,
      audio: DO_AUDIO,
      gsiPort,
      modeHint: process.env.FARM_RECORD_MODE || "",
      note: "local CS2: gsi+keys+raw-mouse+screens+radar cv+wasapi audio; no SendInput; clock=dm if cybershoke/dm map"
    },
    null,
    2
  )
);

let gsiCount = 0;
let keyCount = 0;
let frameCount = 0;
let mouseCount = 0;
let radarCount = 0;
let lastGsi = null;
let audioProc = null;
let mouseProc = null;
const clockMem = {};
const phasePath = path.join(sessDir, "phase.jsonl");

const gsi = startGsi({
  port: gsiPort,
  token: gsiToken,
  host: "127.0.0.1",
  onState: (raw) => {
    const t = Date.now();
    const parsed = parseGsi(raw);
    if (process.env.FARM_RECORD_MODE === "dm" && !isDeathmatch(parsed)) return;
    const clock = tickClock(parsed, clockMem);
    parsed.clock = clock.clock;
    parsed.elapsedMs = clock.elapsedMs;
    lastGsi = {
      t,
      parsed,
      rawSlim: {
        map: raw?.map?.name,
        phase: raw?.map?.phase,
        health: parsed.health,
        armor: parsed.armor,
        ammo: parsed.ammo,
        alive: parsed.alive,
        weapon: parsed.weapon,
        kills: parsed.kills,
        deaths: parsed.deaths,
        flashed: parsed.flashed,
        team: parsed.team,
        activity: parsed.activity,
        bomb: parsed.bomb,
        hasC4: parsed.hasC4,
        money: parsed.money,
        clock: clock.clock,
        elapsedMs: clock.elapsedMs
      }
    };
    appendJsonl(gsiPath, { t, ...lastGsi.rawSlim });
    gsiCount += 1;
  }
});

log(`record-local start ${sessionId} for ${Math.round(DURATION_MS / 60000)}min`);
log(`out ${sessDir}`);
log(`GSI :${gsiPort} frames=${FRAME_EVERY_MS}ms cv=${DO_CV} audio=${DO_AUDIO}`);

audioProc = startAudio();
mouseProc = startMouseRaw();

const t0 = Date.now();
let lastFrame = 0;
let lastKey = 0;
let lastStatus = 0;

async function sampleFrame() {
  const name = `f-${String(frameCount).padStart(6, "0")}.png`;
  const fp = path.join(framesDir, name);
  const ok = captureScreenPng(fp);
  if (!ok) {
    log("frame-capture-fail");
    return;
  }
  const jsonOut = path.join(framesDir, name.replace(/\.png$/, ".json"));
  const frame = runCv(fp, jsonOut);
  const t = Date.now();
  const radarSlim = frame?.radar
    ? {
        ok: frame.radar.ok,
        facing: frame.radar.facing_deg,
        wall: frame.radar.wall_ahead,
        foes: frame.radar.enemy_count,
        allies: frame.radar.ally_count,
        nx: frame.radar.self?.nx,
        ny: frame.radar.self?.ny,
        openRel: frame.radar.open_best?.rel,
        free: frame.estimates?.radar?.path_free_fwd
      }
    : null;
  if (radarSlim) {
    appendJsonl(radarPath, { t, file: name, ...radarSlim });
    radarCount += 1;
  }
  appendJsonl(framesPath, {
    t,
    file: name,
    mean: frame?.mean ?? frame?.capture_health?.mean,
    screen: frame?.screen,
    radar: radarSlim,
    gsi: lastGsi?.rawSlim || null
  });
  frameCount += 1;
}

async function main() {
  while (Date.now() - t0 < DURATION_MS) {
    const now = Date.now();
    if (now - lastKey >= KEY_EVERY_MS) {
      lastKey = now;
      const keys = sampleKeysLocal();
      if (keys) {
        appendJsonl(keysPath, { t: now, keys });
        keyCount += 1;
        const clock = lastGsi?.parsed?.clock || lastGsi?.rawSlim?.clock || "";
        const pattern =
          keys.M1 ? "fight" : keys.E ? "use" : keys.W ? "walk" : keys.A || keys.D ? "strafe" : "idle";
        appendJsonl(phasePath, {
          t: now,
          clock,
          elapsedMs: lastGsi?.parsed?.elapsedMs || 0,
          team: lastGsi?.rawSlim?.team || "",
          bomb: lastGsi?.rawSlim?.bomb || "",
          pattern,
          map: lastGsi?.rawSlim?.map || ""
        });
      }
      mouseCount = countJsonlLines(mousePath);
    }
    if (FRAME_EVERY_MS > 0 && now - lastFrame >= FRAME_EVERY_MS) {
      lastFrame = now;
      try {
        await sampleFrame();
      } catch (e) {
        log(`frame-err ${e.message}`);
      }
    }
    if (now - lastStatus >= 15000) {
      lastStatus = now;
      const left = Math.max(0, DURATION_MS - (now - t0));
      log(
        `progress gsi=${gsiCount} keys=${keyCount} mouse=${mouseCount} frames=${frameCount} radar=${radarCount} leftSec=${Math.round(left / 1000)} alive=${lastGsi?.rawSlim?.alive ?? "-"} map=${lastGsi?.rawSlim?.map || "-"}`
      );
      writeFileSync(
        path.join(sessDir, "status.json"),
        JSON.stringify(
          {
            sessionId,
            source: "host-local",
            gsiCount,
            keyCount,
            mouseCount,
            frameCount,
            radarCount,
            mouse: Boolean(mouseProc && !mouseProc.killed),
            audio: Boolean(audioProc && !audioProc.killed),
            elapsedMs: now - t0,
            leftMs: left,
            lastGsi: lastGsi?.rawSlim || null,
            at: new Date().toISOString()
          },
          null,
          2
        )
      );
    }
    await sleep(15);
  }

  if (mouseProc && !mouseProc.killed) {
    try {
      mouseProc.kill();
    } catch {}
  }
  if (audioProc && !audioProc.killed) {
    try {
      audioProc.kill();
    } catch {}
    await sleep(800);
  }

  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        sessionId,
        source: "host-local",
        startedAt: new Date(t0).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: DURATION_MS,
        counts: {
          gsi: gsiCount,
          keys: keyCount,
          mouse: mouseCount,
          frames: frameCount,
          radar: radarCount
        },
        audioFile: existsSync(path.join(sessDir, "audio.wav"))
          ? "audio.wav"
          : existsSync(audioPath)
            ? "audio.ogg"
            : null
      },
      null,
      2
    )
  );
  log(`record-local done gsi=${gsiCount} keys=${keyCount} frames=${frameCount} radar=${radarCount} audio=${existsSync(audioPath)}`);
  try {
    gsi.server.close();
  } catch {}
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  try {
    if (audioProc) audioProc.kill();
    if (mouseProc) mouseProc.kill();
  } catch {}
  process.exit(1);
});
