// session quality gates. quarantine list only, never delete source.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";
import { FARM_ROOT } from "./vm/defaults.mjs";
import { actionFromKeys, keysWithMouse } from "./keys-action.mjs";
import { actionLabel } from "./bc.mjs";

export const DATASETS = path.join(FARM_ROOT, "ops", "datasets");
export const HUMAN_ROOT = process.env.FARM_HUMAN_DIR || path.join(FARM_ROOT, "ops", "vision", "human-record");

function jsonl(file) {
  if (!existsSync(file) || statSync(file).size < 2) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split(/\n/)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function checkSession(sessDir, id) {
  const reasons = [];
  const frames = jsonl(path.join(sessDir, "frames.jsonl"));
  const keys = jsonl(path.join(sessDir, "keys.jsonl"));
  const traj = jsonl(path.join(sessDir, "traj.jsonl"));
  const pngDir = path.join(sessDir, "frames");
  const png = existsSync(pngDir) ? readdirSync(pngDir).filter((f) => f.endsWith(".png")).length : 0;
  if (png < 12) reasons.push("few-frames");
  if (!frames.length && !traj.length) reasons.push("empty-jsonl");
  if (frames.length && png && Math.abs(frames.length - png) > 3) reasons.push("missing-frames");
  const rows = frames.length ? frames : traj;
  let dxn = 0;
  let gaps = 0;
  let back = 0;
  let prevT = -1;
  const acts = {};
  const hashes = new Set();
  let dup = 0;
  const nx = [];
  for (const row of rows) {
    const t = Number(row.t || row.timestamp || 0);
    if (prevT >= 0 && t < prevT) back += 1;
    if (prevT >= 0 && t - prevT > 2500) gaps += 1;
    prevT = t;
    const k = keysWithMouse(row.keys || {});
    if (k.dx !== 0 || k.dy !== 0) dxn += 1;
    const a = actionLabel({ action: row.action || actionFromKeys(k) });
    acts[a] = (acts[a] || 0) + 1;
    const h = row.file || row.observation_id || String(t);
    if (hashes.has(h)) dup += 1;
    hashes.add(h);
    const n = Number(row.gsi?.pos ? 1 : row.observation?.radar?.self?.nx || row.radar_cv?.nx || 0);
    nx.push(n);
  }
  if (rows.length >= 12 && dxn === 0) reasons.push("no-mouse-dx");
  if (gaps > 3) reasons.push("time-gaps");
  if (back > 0) reasons.push("time-back");
  if (dup > rows.length * 0.3) reasons.push("dup-frames");
  const labels = Object.keys(acts);
  if (labels.length < 2) reasons.push("one-action");
  const wait = acts.wait || acts.idle || 0;
  if (rows.length && wait / rows.length > 0.92) reasons.push("wait-heavy");
  if (nx.length > 8 && nx.every((v) => v === nx[0])) reasons.push("const-nx");
  const ok = reasons.length === 0;
  return {
    id,
    ok,
    quarantine: !ok,
    reasons,
    nFrames: png,
    nRows: rows.length,
    nKeys: keys.length,
    mouseDxRows: dxn,
    actions: acts
  };
}

export function runDatasetQc({ root = HUMAN_ROOT, prefix = "human-" } = {}) {
  mkdirSync(DATASETS, { recursive: true });
  const qdir = path.join(DATASETS, "quarantine");
  mkdirSync(qdir, { recursive: true });
  const sessions = [];
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      if (!name.startsWith(prefix)) continue;
      const dir = path.join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      const row = checkSession(dir, name);
      sessions.push(row);
      writeFileSync(path.join(dir, "qc.json"), JSON.stringify(row, null, 2));
      if (row.quarantine) {
        writeFileSync(path.join(qdir, name + ".json"), JSON.stringify(row, null, 2));
      }
    }
  }
  const ok = sessions.filter((s) => s.ok).map((s) => s.id);
  const bad = sessions.filter((s) => s.quarantine).map((s) => s.id);
  const n = sessions.length;
  const nTrain = Math.max(0, Math.floor(ok.length * 0.7));
  const nVal = Math.max(0, Math.floor(ok.length * 0.15));
  const split = {
    train: ok.slice(0, nTrain),
    val: ok.slice(nTrain, nTrain + nVal),
    test: ok.slice(nTrain + nVal)
  };
  const manifest = {
    version: "ds-" + new Date().toISOString().slice(0, 10),
    at: new Date().toISOString(),
    root,
    n,
    ok: ok.length,
    quarantine: bad,
    split,
    sessions
  };
  writeFileSync(path.join(DATASETS, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
