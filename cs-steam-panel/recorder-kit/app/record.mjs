// portable 30min recorder for a foreign windows pc. no sendinput. localhost gsi only.
import { spawnSync } from "child_process";
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startGsi, parseGsi } from "./gsi.mjs";
import { tickClock } from "./round-clock.mjs";
import { installGsi } from "./install-gsi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.join(__dirname, "..");
const OUT = process.env.FARM_HUMAN_DIR || path.join(KIT, "sessions");
const DURATION_MS = Number(process.env.FARM_RECORD_MS || 30 * 60 * 1000);
const FRAME_EVERY_MS = Number(process.env.FARM_RECORD_FRAME_MS || 2000);
const KEY_EVERY_MS = Number(process.env.FARM_RECORD_KEY_MS || 50);
const gsiPort = Number(process.env.BOT_GSI_PORT || 32222);
const gsiToken = process.env.BOT_GSI_TOKEN || "csfarm";

const sessionId = `rec-${Date.now().toString(36)}`;
const sessDir = path.join(OUT, sessionId);
const framesDir = path.join(sessDir, "frames");
mkdirSync(framesDir, { recursive: true });

const metaPath = path.join(sessDir, "meta.json");
const gsiPath = path.join(sessDir, "gsi.jsonl");
const keysPath = path.join(sessDir, "keys.jsonl");
const framesPath = path.join(sessDir, "frames.jsonl");
const mousePath = path.join(sessDir, "mouse.jsonl");
const phasePath = path.join(sessDir, "phase.jsonl");
const logPath = path.join(sessDir, "record.log");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function cs2Running() {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", "if (Get-Process cs2 -EA SilentlyContinue) {'1'} else {'0'}"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000
  });
  return String(r.stdout || "").trim() === "1";
}

function sampleKeysMouse() {
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class FarmKey {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public struct POINT { public int X; public int Y; }
}
"@
function D([int]$vk){ if (([FarmKey]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { 'true' } else { 'false' } }
$p = New-Object FarmKey+POINT
[FarmKey]::GetCursorPos([ref]$p) | Out-Null
Write-Output ('{"W":'+(D 0x57)+',"A":'+(D 0x41)+',"S":'+(D 0x53)+',"D":'+(D 0x44)+',"SPACE":'+(D 0x20)+',"SHIFT":'+(D 0xA0)+',"CTRL":'+(D 0xA2)+',"R":'+(D 0x52)+',"B":'+(D 0x42)+',"M1":'+(D 0x01)+',"M2":'+(D 0x02)+',"E":'+(D 0x45)+',"mx":'+$p.X+',"my":'+$p.Y+'}')
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

const gsiSetup = installGsi();
if (!gsiSetup.ok) {
  console.error("CS2 not found. Install Steam + CS2, then run RECORD.bat again.");
  process.exit(2);
}

const sessionIdNote = sessionId;
writeFileSync(
  metaPath,
  JSON.stringify(
    {
      sessionId: sessionIdNote,
      source: "recorder-kit",
      startedAt: new Date().toISOString(),
      durationMs: DURATION_MS,
      frameEveryMs: FRAME_EVERY_MS,
      keyEveryMs: KEY_EVERY_MS,
      gsiDirs: gsiSetup.dirs,
      note: "gsi+keys+mouse+screens+phase. no sendinput. restart cs2 after first install"
    },
    null,
    2
  )
);

log(`gsi cfg -> ${gsiSetup.dirs.join(" | ")}`);
if (cs2Running()) {
  log("CS2 is running. if GSI stays 0, fully restart CS2 then run RECORD.bat again");
}

let gsiCount = 0;
let keyCount = 0;
let frameCount = 0;
let mouseCount = 0;
let lastGsi = null;
const clockMem = {};

const gsi = startGsi({
  port: gsiPort,
  token: gsiToken,
  host: "127.0.0.1",
  onState: (raw) => {
    const t = Date.now();
    const parsed = parseGsi(raw);
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

log(`record ${sessionId} ${Math.round(DURATION_MS / 60000)}min`);
log(`out ${sessDir}`);
log(`GSI 127.0.0.1:${gsiPort}  play CS2 now. Ctrl+C stops early`);

const t0 = Date.now();
let lastFrame = 0;
let lastKey = 0;
let lastStatus = 0;
let warnedGsi = false;

async function sampleFrame() {
  const name = `f-${String(frameCount).padStart(6, "0")}.png`;
  const fp = path.join(framesDir, name);
  const ok = captureScreenPng(fp);
  if (!ok) {
    log("frame-capture-fail");
    return;
  }
  const t = Date.now();
  appendJsonl(framesPath, { t, file: name, gsi: lastGsi?.rawSlim || null });
  frameCount += 1;
}

async function main() {
  while (Date.now() - t0 < DURATION_MS) {
    const now = Date.now();
    if (!warnedGsi && now - t0 > 25000 && gsiCount === 0) {
      warnedGsi = true;
      log("GSI still 0: close CS2 completely, start CS2 again, then keep this window open");
    }
    if (now - lastKey >= KEY_EVERY_MS) {
      lastKey = now;
      const keys = sampleKeysMouse();
      if (keys) {
        appendJsonl(keysPath, { t: now, keys });
        keyCount += 1;
        appendJsonl(mousePath, { t: now, x: keys.mx, y: keys.my });
        mouseCount += 1;
        const pattern =
          keys.M1 ? "fight" : keys.B ? "buy" : keys.E ? "use" : keys.W ? "walk" : keys.A || keys.D ? "strafe" : "idle";
        appendJsonl(phasePath, {
          t: now,
          clock: lastGsi?.rawSlim?.clock || "",
          elapsedMs: lastGsi?.parsed?.elapsedMs || 0,
          team: lastGsi?.rawSlim?.team || "",
          bomb: lastGsi?.rawSlim?.bomb || "",
          pattern,
          map: lastGsi?.rawSlim?.map || ""
        });
      }
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
        `progress gsi=${gsiCount} keys=${keyCount} mouse=${mouseCount} frames=${frameCount} leftSec=${Math.round(left / 1000)} alive=${lastGsi?.rawSlim?.alive ?? "-"} map=${lastGsi?.rawSlim?.map || "-"}`
      );
      writeFileSync(
        path.join(sessDir, "status.json"),
        JSON.stringify(
          {
            sessionId,
            gsiCount,
            keyCount,
            mouseCount,
            frameCount,
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

  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        sessionId,
        source: "recorder-kit",
        startedAt: new Date(t0).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: DURATION_MS,
        counts: { gsi: gsiCount, keys: keyCount, mouse: mouseCount, frames: frameCount }
      },
      null,
      2
    )
  );
  log(`done gsi=${gsiCount} keys=${keyCount} frames=${frameCount} -> ${sessDir}`);
  try {
    gsi.server.close();
  } catch {}
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
