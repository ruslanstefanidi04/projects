// freeze a snapshot when play looks ok. bad restores that snapshot.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FARM_ROOT } from "./vm/defaults.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUMAN = path.join(FARM_ROOT, "ops", "yolo", "human");
const LOCK = path.join(HUMAN, "lock.json");
const INTENT = path.join(HUMAN, "live-intent.json");
const INTENT_GOOD = path.join(HUMAN, "live-intent.good.json");
const WEIGHTS = path.join(__dirname, "data", "sense-weights.json");
const WEIGHTS_GOOD = path.join(__dirname, "data", "sense-weights.good.json");
const VOTES = path.join(HUMAN, "grade.jsonl");

function emptyLock() {
  return { freeze: false, vote: "", at: "" };
}

export function readLock() {
  try {
    if (!existsSync(LOCK)) return emptyLock();
    return { ...emptyLock(), ...JSON.parse(readFileSync(LOCK, "utf8") || "{}") };
  } catch {
    return emptyLock();
  }
}

function writeLock(row) {
  mkdirSync(HUMAN, { recursive: true });
  writeFileSync(LOCK, JSON.stringify(row, null, 2), "utf8");
}

function snap(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

function restore(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

export function voteGrade(vote) {
  const v = String(vote || "").toLowerCase() === "bad" ? "bad" : "good";
  const at = new Date().toISOString();
  mkdirSync(HUMAN, { recursive: true });
  if (v === "good") {
    snap(INTENT, INTENT_GOOD);
    snap(WEIGHTS, WEIGHTS_GOOD);
    const row = { freeze: true, vote: "good", at, hasIntent: existsSync(INTENT_GOOD), hasWeights: existsSync(WEIGHTS_GOOD) };
    writeLock(row);
    appendVote(row);
    return row;
  }
  const restoredIntent = restore(INTENT_GOOD, INTENT);
  const restoredWeights = restore(WEIGHTS_GOOD, WEIGHTS);
  const row = {
    freeze: false,
    vote: "bad",
    at,
    restoredIntent,
    restoredWeights
  };
  writeLock(row);
  appendVote(row);
  return row;
}

function appendVote(row) {
  try {
    appendFileSync(VOTES, JSON.stringify(row) + "\n");
  } catch {}
}
