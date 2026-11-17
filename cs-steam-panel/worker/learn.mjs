import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const storePath = path.join(root, "sense-weights.json");

export const ACTIONS = [
  "wait",
  "forward",
  "strafe_l",
  "strafe_r",
  "back",
  "shoot",
  "aim_l",
  "aim_r",
  "plant",
  "defuse",
  "use",
  "cta_click",
  "cta_enter",
  "jump",
  "reload",
  "unstick-wall",
  "fight-peek",
  "fight-push",
  "check-corner",
  "strafe-advance",
  "jump-peek",
  "bunnyhop",
  "curb-jump",
  "explore",
  "radar-turn",
  "radar-chase",
  "radar-open",
  "walk-w",
  "walk-a",
  "walk-d",
  "walk-s",
  "walk-wa",
  "walk-wd",
  "walk-sa",
  "walk-sd",
  "pickup"
];

// no radar: walk/look only. jumps and spray stay out unless gsi says combat.
export const LIVE_MOVE = [
  "explore",
  "strafe-advance",
  "radar-open",
  "check-corner",
  "radar-turn",
  "unstick-wall",
  "reload"
];
export const LIVE_FIGHT = [
  "fight-push",
  "fight-peek",
  "radar-chase",
  "strafe-advance",
  "explore",
  "check-corner"
];
export const LIVE_DM = [
  "fight-push",
  "fight-peek",
  "radar-chase",
  "strafe-advance",
  "explore",
  "check-corner",
  "radar-open"
];

function emptyBucket() {
  const o = {};
  for (const a of ACTIONS) o[a] = { n: 0, sum: 0 };
  return o;
}

export function loadWeights() {
  try {
    if (!existsSync(storePath)) return {};
    return JSON.parse(readFileSync(storePath, "utf8") || "{}");
  } catch {
    return {};
  }
}

export function saveWeights(w) {
  mkdirSync(root, { recursive: true });
  writeFileSync(storePath, JSON.stringify(w, null, 2));
}

export function reasonToAction(reason) {
  const r = String(reason || "");
  if (ACTIONS.includes(r)) return r;
  if (r.includes("reload")) return "reload";
  if (r.includes("pickup") || r.includes("loot")) return "pickup";
  if (r.includes("unstick")) return "unstick-wall";
  if (r.includes("radar-chase") || r.includes("chase")) return "radar-chase";
  if (r.includes("radar-open") || r.includes("open-path")) return "radar-open";
  if (r.includes("radar-turn") || r.includes("radar")) return "radar-turn";
  if (r.includes("fight-peek") || r.includes("peek")) return "fight-peek";
  if (r.includes("fight-push") || r.includes("push")) return "fight-push";
  if (r.includes("corner")) return "check-corner";
  if (r.startsWith("walk-")) return r;
  if (r.includes("strafe")) return "strafe-advance";
  if (r.includes("bunny")) return "bunnyhop";
  if (r.includes("curb")) return "curb-jump";
  if (r.includes("jump")) return "jump-peek";
  if (r.includes("explore")) return "explore";
  return "explore";
}

export function stateKey(s, vision = {}) {
  if (!s || s.inMenu || !s.map) return vision?.cta ? "menu_cta" : "menu";
  if (s.warmup) return "warmup";
  if (!s.alive) return "dead";
  const t = /^t(errorist)?$/i.test(String(s.team || "").trim());
  const side = t ? "t" : "ct";
  const clock = s.clock || "mid";
  const wall = vision?.radar?.wall_ahead ? "wall" : "open";
  const foe = (vision?.radar?.enemy_count || 0) > 0 ? "foe" : "clear";
  if (clock === "dm") return `live_dm_${wall}_${foe}`;
  if (clock === "planted") return `live_${side}_planted_${wall}`;
  if (clock === "execute") return `live_${side}_exec_${wall}`;
  if (s.mapPhase === "live" || s.phase === "live" || s.alive) return `live_${side}_${wall}_${foe}`;
  return `other_${side}_${wall}`;
}

export function pickAction(weights, key, { explore = 0.18, allow = null } = {}) {
  const pool = Array.isArray(allow) && allow.length ? allow.filter((a) => ACTIONS.includes(a)) : ACTIONS;
  const bucket = weights[key] || emptyBucket();
  if (!weights[key]) weights[key] = bucket;
  if (Math.random() < explore) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  let best = pool[0];
  let bestScore = -1e9;
  const n0 = 24;
  for (const a of pool) {
    const cell = bucket[a] || { n: 0, sum: 0 };
    const mean = cell.sum / (cell.n + n0);
    const bonus = 0.35 / Math.sqrt(1 + cell.n);
    const score = mean + bonus + Math.random() * 0.02;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

export function learn(weights, key, action, reward) {
  const a = reasonToAction(action);
  if (!ACTIONS.includes(a)) return weights;
  if (!weights[key]) weights[key] = emptyBucket();
  const cell = weights[key][a] || { n: 0, sum: 0 };
  cell.n += 1;
  cell.sum += Number(reward) || 0;
  weights[key][a] = cell;
  return weights;
}
