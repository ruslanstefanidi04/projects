// append-only daily jsonl for later analysis
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { FARM_ROOT } from "./vm/defaults.mjs";

export const BRAIN_DIR = path.join(FARM_ROOT, "ops", "vision", "brain");

export function brainAppend(kind, obj) {
  mkdirSync(BRAIN_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(BRAIN_DIR, day + "-" + kind + ".jsonl");
  const row = typeof obj === "string" ? { at: new Date().toISOString(), text: obj } : { at: new Date().toISOString(), ...obj };
  appendFileSync(file, JSON.stringify(row) + "\n");
  return file;
}

export function brainTail(kind, n = 120) {
  mkdirSync(BRAIN_DIR, { recursive: true });
  const files = readdirSync(BRAIN_DIR)
    .filter((f) => f.endsWith("-" + kind + ".jsonl"))
    .sort();
  const last = files[files.length - 1];
  if (!last) return { file: "", lines: [] };
  const file = path.join(BRAIN_DIR, last);
  const raw = readFileSync(file, "utf8").trim();
  const lines = raw ? raw.split(/\n/).filter(Boolean) : [];
  return { file, lines: lines.slice(-Math.max(1, n)) };
}

export function brainFiles() {
  mkdirSync(BRAIN_DIR, { recursive: true });
  return readdirSync(BRAIN_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((name) => {
      const p = path.join(BRAIN_DIR, name);
      let bytes = 0;
      try {
        bytes = statSync(p).size;
      } catch {}
      return { name, bytes };
    });
}
