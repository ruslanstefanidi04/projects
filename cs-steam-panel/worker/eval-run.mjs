// write eval snapshot. does not claim live cs2.
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FARM_ROOT } from "./vm/defaults.mjs";
import { latencySnapshot } from "./fsm/protocol.mjs";
import { validateTrajectory } from "./dataset-traj.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(FARM_ROOT, "ops", "eval");

function gitRev() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: path.join(__dirname, ".."), encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function readJson(p) {
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function writeEvalReport(extra = {}) {
  mkdirSync(OUT, { recursive: true });
  const latencyFile = path.join(FARM_ROOT, "ops", "vision", "latency.json");
  const ds = readJson(path.join(FARM_ROOT, "ops", "yolo", "dataset-version.json"));
  const liveLat = existsSync(latencyFile) ? readJson(latencyFile) : { ...latencySnapshot() };
  const report = {
    at: new Date().toString(),
    git: gitRev(),
    model: existsSync(path.join(FARM_ROOT, "ops", "yolo", "best.pt"))
      ? { path: "ops/yolo/best.pt", baseline: existsSync(path.join(FARM_ROOT, "ops", "yolo", "best.baseline.pt")) }
      : null,
    dataset: ds,
    latency: liveLat,
    traj: extra.traj || null,
    bc: extra.bc || null,
    notes: extra.notes || [],
    live_cs2: false
  };
  const dest = path.join(OUT, "last.json");
  writeFileSync(dest, JSON.stringify(report, null, 2));
  return { dest, report };
}

if (process.argv[1] && process.argv[1].endsWith("eval-run.mjs")) {
  const r = writeEvalReport({ notes: ["offline snapshot; hyper-v not claimed"] });
  console.log(r.dest);
}
