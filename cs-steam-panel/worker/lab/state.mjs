import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { FARM_ROOT } from "../vm/defaults.mjs";

export const LAB_FILE = path.join(FARM_ROOT, "ops", "vision", "lab-active.json");

export function defaultLab() {
  return {
    skill: "idle",
    confirmed: false,
    goal: null,
    path: [],
    next: null,
    moving: false,
    error: "",
    stopReason: "",
    pathFit: null,
    grade: null,
    at: null
  };
}

export function readLab() {
  try {
    if (!existsSync(LAB_FILE)) return defaultLab();
    const j = JSON.parse(readFileSync(LAB_FILE, "utf8"));
    return { ...defaultLab(), ...j };
  } catch {
    return defaultLab();
  }
}

export function writeLab(next) {
  const cur = { ...defaultLab(), ...next, at: new Date().toISOString() };
  mkdirSync(path.dirname(LAB_FILE), { recursive: true });
  writeFileSync(LAB_FILE, JSON.stringify(cur, null, 2), "utf8");
  return cur;
}

export function stopLab(reason) {
  return writeLab({
    ...readLab(),
    skill: "idle",
    confirmed: false,
    moving: false,
    stopReason: reason || "stop",
    error: ""
  });
}
