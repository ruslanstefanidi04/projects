// keep live.png fresh so cv-worker paints overlay-glass for the guest click-through.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FARM_ROOT } from "./vm/defaults.mjs";
import { pullGuestVision, setVisionAgent } from "./vision.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const VISION = path.join(FARM_ROOT, "ops", "vision");
const LOG = path.join(VISION, "live-yolo.log");
const PID = path.join(VISION, "live-yolo.pid");

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

function log(line) {
  const s = new Date().toISOString() + " " + line;
  console.log(s);
  try {
    mkdirSync(VISION, { recursive: true });
    writeFileSync(LOG, (existsSync(LOG) ? readFileSync(LOG, "utf8").slice(-80000) : "") + s + "\n");
  } catch {}
}

loadEnv();
const ip = process.env.FARM_GOLDEN_IP || "10.250.0.10";
setVisionAgent(ip, process.env.FARM_AGENT_TOKEN || "csfarm", Number(process.env.FARM_AGENT_PORT || 39200));
mkdirSync(VISION, { recursive: true });
writeFileSync(PID, String(process.pid));

function yoloCount() {
  try {
    const j = JSON.parse(readFileSync(path.join(VISION, "frame.json"), "utf8"));
    const dets = j.estimates?.yolo?.dets || j.yolo?.dets || [];
    return Array.isArray(dets) ? dets.length : 0;
  } catch {
    return -1;
  }
}

log("live-yolo start agent=" + ip);
for (;;) {
  const t0 = Date.now();
  const shot = await pullGuestVision();
  const ms = Date.now() - t0;
  log(
    "shot ok=" +
      Boolean(shot.ok) +
      " black=" +
      Boolean(shot.black) +
      " mean=" +
      shot.mean +
      " " +
      ms +
      "ms yolo=" +
      yoloCount()
  );
  await new Promise((r) => setTimeout(r, 0));
}
