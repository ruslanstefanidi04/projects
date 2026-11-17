// copy reports/checkpoints into archive. does not delete raw recordings.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";
import { FARM_ROOT } from "./vm/defaults.mjs";
import { confirmPolicy } from "./policy-router.mjs";

const STAMP = "2026-09-17-ml-reboot";
const DEST = path.join(FARM_ROOT, "ops", "archive", STAMP);

function copyIf(src, destDir, name) {
  if (!existsSync(src) || !statSync(src).isFile()) return false;
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, path.join(destDir, name || path.basename(src)));
  return true;
}

function listSessions(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => statSync(path.join(root, n)).isDirectory())
    .map((n) => {
      const d = path.join(root, n);
      const files = {};
      for (const f of ["traj.jsonl", "frames.jsonl", "keys.jsonl", "meta.json"]) {
        const p = path.join(d, f);
        files[f] = existsSync(p) ? statSync(p).size : 0;
      }
      const fr = path.join(d, "frames");
      files.png = existsSync(fr) ? readdirSync(fr).filter((x) => x.endsWith(".png")).length : 0;
      return { id: n, path: d, files };
    });
}

mkdirSync(DEST, { recursive: true });
const copied = [];
const pairs = [
  [path.join(FARM_ROOT, "ops", "bc", "model.json"), "bc"],
  [path.join(FARM_ROOT, "ops", "bc", "train-report.json"), "bc"],
  [path.join(FARM_ROOT, "ops", "eval", "last.json"), "eval"],
  [path.join(FARM_ROOT, "ops", "eval", "bc-vs-fsm.json"), "eval"],
  [path.join(FARM_ROOT, "ops", "eval", "iql-inspect.json"), "eval"],
  [path.join(FARM_ROOT, "ops", "vision", "policy.json"), "cfg"],
  [path.join(FARM_ROOT, "ops", "yolo", "dataset-version.json"), "yolo"],
  [path.join(FARM_ROOT, "ops", "yolo", "best.pt"), "yolo"],
  [path.join(process.cwd(), "data", "bc-model.json"), "bc"],
  [path.join(process.cwd(), "data", "human-fit-report.json"), "eval"]
];
for (const [src, sub] of pairs) {
  if (copyIf(src, path.join(DEST, sub))) copied.push(src);
}

const recRoot = path.join(FARM_ROOT, "ops", "vision", "human-record");
const yoloHuman = path.join(FARM_ROOT, "ops", "yolo", "human");
const manifest = {
  at: new Date().toISOString(),
  stamp: STAMP,
  dest: DEST,
  note: "raw recordings stay in place. this folder is reports+checkpoints only.",
  copied,
  human_sessions: listSessions(recRoot),
  yolo_images: existsSync(path.join(yoloHuman, "images"))
    ? readdirSync(path.join(yoloHuman, "images")).length
    : 0,
  yolo_labels: existsSync(path.join(yoloHuman, "labels"))
    ? readdirSync(path.join(yoloHuman, "labels")).length
    : 0
};
writeFileSync(path.join(DEST, "RESTORE.json"), JSON.stringify(manifest, null, 2));
confirmPolicy("fsm");
writeFileSync(
  path.join(DEST, "DISABLED.txt"),
  "old linear bc detached. active policy fsm. confirmPolicy required for bc.\n"
);
console.log(JSON.stringify({ dest: DEST, copied: copied.length, sessions: manifest.human_sessions.length }, null, 2));
