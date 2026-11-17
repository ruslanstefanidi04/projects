// hybrid stack: yolo=eyes, prompts=policy (not demo bc), bandit=rl, guest input=hands
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { FARM_ROOT } from "./vm/defaults.mjs";

const FILE = path.join(FARM_ROOT, "ops", "yolo", "human", "stack.json");

export const DEFAULT_STACK = {
  eyes: true,
  radar: true,
  prompt: true,
  rules: true,
  rl: true,
  aim: true,
  fire: true,
  move: true
};

export function readStack() {
  try {
    if (!existsSync(FILE)) return { ...DEFAULT_STACK };
    return { ...DEFAULT_STACK, ...JSON.parse(readFileSync(FILE, "utf8") || "{}") };
  } catch {
    return { ...DEFAULT_STACK };
  }
}

export function writeStack(patch) {
  const next = { ...readStack(), ...(patch && typeof patch === "object" ? patch : {}) };
  for (const k of Object.keys(DEFAULT_STACK)) next[k] = next[k] !== false;
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function filterSteps(steps, stack) {
  const s = stack || DEFAULT_STACK;
  return (Array.isArray(steps) ? steps : []).filter((st) => {
    const a = String(st?.action || "").toUpperCase();
    if (!s.fire && a === "FIRE") return false;
    if (!s.move && (a === "HOLD" || a === "KEYDOWN" || a === "KEYUP" || a === "JUMP")) return false;
    if (!s.aim && a === "LOOK") return false;
    return true;
  });
}
