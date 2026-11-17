// persistent python engine.py --loop so fsm does not spawnSync every tick
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FARM_ROOT } from "./vm/defaults.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VISION = path.join(FARM_ROOT, "ops", "vision");
const PID = path.join(VISION, "cv-worker.pid");
const PREVIEW_PID = path.join(VISION, "cv-preview.pid");
const LOG = path.join(VISION, "cv-worker.log");
const PY = process.env.FARM_PYTHON || "C:/Users/R00/AppData/Local/Programs/Python/Python312/python.exe";
const ENGINE = path.join(__dirname, "cv", "engine.py");
const PREVIEW = path.join(__dirname, "cv", "preview.py");

function procCmd(pid) {
  const n = Number(pid);
  if (!n) return "";
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${n}").CommandLine`],
    { windowsHide: true, encoding: "utf8" }
  );
  return String(r.stdout || "").trim();
}

function isEnginePid(pid) {
  const cmd = procCmd(pid);
  return /engine\.py/i.test(cmd) && /python/i.test(cmd);
}

function enginePids() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'engine.py' } | ForEach-Object { $_.ProcessId }"
    ],
    { windowsHide: true, encoding: "utf8" }
  );
  return String(r.stdout || "")
    .split(/\s+/)
    .map((x) => Number(x))
    .filter((n) => n > 0);
}

export function cvWorkerPid() {
  try {
    if (!existsSync(PID)) return 0;
    return Number(String(readFileSync(PID, "utf8")).trim()) || 0;
  } catch {
    return 0;
  }
}

function previewPids() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'preview.py' } | ForEach-Object { $_.ProcessId }"
    ],
    { windowsHide: true, encoding: "utf8" }
  );
  return String(r.stdout || "")
    .split(/\s+/)
    .map((x) => Number(x))
    .filter((n) => n > 0);
}

export function killCvWorker() {
  const ids = new Set([...enginePids(), ...previewPids()]);
  const cur = cvWorkerPid();
  if (isEnginePid(cur)) ids.add(cur);
  for (const id of ids) {
    spawnSync("taskkill", ["/PID", String(id), "/T", "/F"], { windowsHide: true });
  }
  try {
    writeFileSync(PID, "");
  } catch {}
  try {
    writeFileSync(PREVIEW_PID, "");
  } catch {}
}

export function ensureCvWorker() {
  const cur = cvWorkerPid();
  if (isEnginePid(cur)) return cur;
  const live = enginePids();
  if (live.length) {
    writeFileSync(PID, String(live[0]));
    return live[0];
  }
  mkdirSync(VISION, { recursive: true });
  let logFd;
  try {
    logFd = openSync(LOG, "a");
  } catch {
    logFd = "ignore";
  }
  const out = spawn(
    PY,
    ["-u", ENGINE, "--loop", "--interval", "0.05", "--image", path.join(VISION, "live.png"), "--out", path.join(VISION, "frame.json")],
    {
      cwd: path.join(__dirname, "cv"),
      detached: true,
      stdio: logFd === "ignore" ? "ignore" : ["ignore", logFd, logFd],
      windowsHide: true,
      env: { ...process.env, FARM_YOLO_FAST: "1", FARM_YOLO_IMGSZ: process.env.FARM_YOLO_IMGSZ || "640", FARM_YOLO_CONF: process.env.FARM_YOLO_CONF || "0.45", FARM_YOLO_ONNX: process.env.FARM_YOLO_ONNX || "D:/FarmVMs/ops/yolo/priler-src/yolov8/cs2_yolov8m_640_augmented_v4.onnx", FARM_YOLO_WEIGHTS: process.env.FARM_YOLO_WEIGHTS || "D:/FarmVMs/ops/yolo/priler-src/yolov8/cs2_yolov8m_640_augmented_v4.pt", YOLO_OFFLINE: "1" }
    }
  );
  out.unref();
  const pid = out.pid || 0;
  writeFileSync(PID, String(pid));
  ensurePreview();
  return pid;
}

export function ensurePreview() {
  const live = previewPids();
  if (live.length) {
    writeFileSync(PREVIEW_PID, String(live[0]));
    return live[0];
  }
  mkdirSync(VISION, { recursive: true });
  const out = spawn(PY, ["-u", PREVIEW], {
    cwd: path.join(__dirname, "cv"),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    env: { ...process.env, FARM_YOLO_PREVIEW: path.join(VISION, "preview.jpg") }
  });
  out.unref();
  const pid = out.pid || 0;
  writeFileSync(PREVIEW_PID, String(pid));
  return pid;
}

export function restartCvWorker() {
  killCvWorker();
  const t0 = Date.now();
  while (enginePids().length && Date.now() - t0 < 2500) {
    spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 80"], { windowsHide: true });
  }
  return ensureCvWorker();
}
