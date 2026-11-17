// fit-human: clone recorded play into sense-weights (bc + gsi credit)
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ACTIONS, loadWeights, saveWeights, stateKey } from "./learn.mjs";
import { makeRewardTracker } from "./reward.mjs";
import { tickClock } from "./round-clock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FARM_HUMAN_DIR || "D:/FarmVMs/ops/vision/human-record";
const DATA = path.join(__dirname, "data");
const WEIGHTS = path.join(DATA, "sense-weights.json");
const REPORT = path.join(DATA, "human-fit-report.json");
const BIN_MS = 200;
const EVENT_MS = 2500;
const JUMP = new Set(["jump-peek", "bunnyhop", "curb-jump"]);
const WALK = new Set(["explore", "strafe-advance", "radar-open"]);
const LOOK = new Set(["check-corner", "radar-turn"]);
const FIGHT = new Set(["radar-chase", "fight-peek", "fight-push"]);

function readJsonl(file) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const out = [];
  for (const line of text.split(/\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {}
  }
  return out;
}

function latestAt(rows, t, iRef) {
  let i = iRef.i;
  while (i + 1 < rows.length && rows[i + 1].t <= t) i += 1;
  iRef.i = i;
  if (i < 0 || i >= rows.length || rows[i].t > t) return null;
  return rows[i];
}

function radarOk(r) {
  if (!r) return false;
  if ((r.foes || 0) > 0) return true;
  if (Number(r.facing) && Number(r.facing) !== 0) return true;
  if (Number(r.free) > 0) return true;
  return false;
}

function toState(g, clock = "mid") {
  if (!g) return null;
  return {
    map: g.map || "",
    inMenu: g.activity === "menu" || !g.map,
    warmup: g.phase === "warmup",
    alive: Boolean(g.alive),
    hasC4: Boolean(g.hasC4),
    bomb: g.bomb || "",
    team: g.team || "",
    mapPhase: g.phase || "",
    phase: g.phase || "",
    clock,
    health: g.health,
    ammo: g.ammo,
    kills: g.kills || 0,
    deaths: g.deaths || 0,
    assists: g.assists || 0,
    activity: g.activity || "",
    weapon: g.weapon || ""
  };
}

function cloneOf(action, combatFoe) {
  if (!action) return 0;
  if (JUMP.has(action)) return 0;
  if (WALK.has(action)) return 1.25;
  if (LOOK.has(action)) return 0.32;
  if (FIGHT.has(action)) return combatFoe ? 2.2 : 0.4;
  if (action === "plant" || action === "defuse") return 0.9;
  if (action === "use") return 0.4;
  return 0.85;
}

function mapAction(k, mouse, gsi, combatFoe) {
  k = k || {};
  const turn = Math.abs(mouse.dx) >= 6 || Math.abs(mouse.dy) >= 6;
  const shoot = Boolean(k.M1);
  if (k.R) return "reload";
  if (k.E && gsi.bomb === "planted" && gsi.team === "CT") return "defuse";
  if (k.E && gsi.hasC4) return "plant";
  if (k.E) return "use";
  // standing jump / spray without a hit are not human site play
  if (k.SPACE && !k.W) return null;
  if (shoot && combatFoe) return k.W ? "fight-push" : k.A || k.D ? "fight-peek" : "radar-chase";
  if (shoot && !combatFoe) {
    if (k.W && (k.A || k.D)) return "strafe-advance";
    if (k.W) return "explore";
    if (k.A || k.D) return "check-corner";
    return turn ? "radar-turn" : null;
  }
  if (k.SPACE && k.W) return "strafe-advance";
  if (k.W && k.S) return "unstick-wall";
  if (k.W && (k.A || k.D)) return "strafe-advance";
  if ((k.A || k.D) && !k.W) return "check-corner";
  if (k.S && !k.W) return "unstick-wall";
  if (k.W && turn) return "radar-open";
  if (k.W) return "explore";
  if (turn) return "radar-turn";
  return null;
}

function bump(table, key, action, n, sum) {
  if (!ACTIONS.includes(action)) return;
  if (!table[key]) table[key] = {};
  const cell = table[key][action] || { n: 0, sum: 0 };
  cell.n += n;
  cell.sum += sum;
  table[key][action] = cell;
}

function fitSession(dir, name, table, stats) {
  const keys = readJsonl(path.join(dir, "keys.jsonl")).filter((r) => r && r.t);
  const gsiRows = readJsonl(path.join(dir, "gsi.jsonl")).filter((r) => r && r.t);
  if (!keys.length || !gsiRows.length) {
    stats.skipped.push({ name, reason: "no-keys-or-gsi" });
    return;
  }
  const radarRows = readJsonl(path.join(dir, "radar.jsonl")).filter((r) => r && r.t);
  const mouseRows = readJsonl(path.join(dir, "mouse.jsonl")).filter((r) => r && r.t);
  keys.sort((a, b) => a.t - b.t);
  gsiRows.sort((a, b) => a.t - b.t);
  radarRows.sort((a, b) => a.t - b.t);
  mouseRows.sort((a, b) => a.t - b.t);

  const t0 = Math.min(keys[0].t, gsiRows[0].t);
  const t1 = Math.max(keys[keys.length - 1].t, gsiRows[gsiRows.length - 1].t);
  const gsiRef = { i: 0 };
  const radRef = { i: 0 };
  const keyRef = { i: 0 };
  let mouseI = 0;
  let prevGsi = null;
  let hpHurtUntil = 0;
  const clockMem = {};
  const rewards = makeRewardTracker();
  const samples = [];
  let bins = 0;
  let used = 0;
  const maps = {};
  const acts = {};

  for (let t = t0; t <= t1; t += BIN_MS) {
    bins += 1;
    const gRaw = latestAt(gsiRows, t, gsiRef);
    const clock = tickClock(gRaw, clockMem).clock;
    const g = toState(gRaw, clock);
    if (!g || g.inMenu || !g.map || g.warmup) {
      prevGsi = g;
      continue;
    }
    const kRaw = latestAt(keys, t, keyRef);
    const keysNow = kRaw?.keys || {};
    let dx = 0;
    let dy = 0;
    while (mouseI < mouseRows.length && mouseRows[mouseI].t <= t) {
      if (mouseRows[mouseI].t > t - BIN_MS) {
        dx += Number(mouseRows[mouseI].dx) || 0;
        dy += Number(mouseRows[mouseI].dy) || 0;
      }
      mouseI += 1;
    }
    const rad = latestAt(radarRows, t, radRef);
    const hpDrop = Boolean(prevGsi?.alive && g.alive && g.health < prevGsi.health);
    const ammoDrop = Boolean(prevGsi && g.ammo < prevGsi.ammo);
    if (hpDrop) hpHurtUntil = t + 1800;
    const combatFoe = hpDrop || t < hpHurtUntil || Boolean(keysNow.M1 && ammoDrop);
    const action = g.alive ? mapAction(keysNow, { dx, dy }, g, combatFoe) : null;
    const vis = {
      radar: {
        wall_ahead: radarOk(rad) ? Boolean(rad.wall) : false,
        enemy_count: radarOk(rad) ? rad.foes || 0 : combatFoe ? 1 : 0
      }
    };
    const key = stateKey(g, vis);
    maps[g.map] = (maps[g.map] || 0) + 1;

    const scored = rewards.step(g);
    if (action) {
      const w = cloneOf(action, combatFoe);
      if (w > 0) {
        bump(table, key, action, 1, w);
        samples.push({ t, key, action });
        used += 1;
        acts[action] = (acts[action] || 0) + 1;
      }
    }
    if (scored.events.length && scored.events[0] !== "boot" && scored.reward) {
      const lo = t - EVENT_MS;
      const win = samples.filter((s) => s.t >= lo && s.t <= t && !JUMP.has(s.action));
      const share = win.length ? scored.reward / win.length : 0;
      for (const s of win) bump(table, s.key, s.action, 0, share);
      if (share) stats.events.push({ sess: name, t, reward: scored.reward, events: scored.events, n: win.length });
    }
    prevGsi = g;
    while (samples.length && samples[0].t < t - EVENT_MS - 400) samples.shift();
  }

  stats.sessions.push({
    name,
    bins,
    used,
    gsi: gsiRows.length,
    keys: keys.length,
    mouse: mouseRows.length,
    maps
  });
  stats.actions = stats.actions || {};
  for (const [a, n] of Object.entries(acts)) stats.actions[a] = (stats.actions[a] || 0) + n;
}

function mergeInto(weights, table) {
  for (const [key, acts] of Object.entries(table)) {
    if (!weights[key]) {
      weights[key] = {};
      for (const a of ACTIONS) weights[key][a] = { n: 0, sum: 0 };
    }
    for (const a of ACTIONS) {
      if (!weights[key][a]) weights[key][a] = { n: 0, sum: 0 };
      const add = acts[a];
      if (!add) continue;
      weights[key][a].n += add.n;
      weights[key][a].sum += add.sum;
    }
  }
}

function topOf(weights, key, n = 6) {
  const b = weights[key] || {};
  return Object.entries(b)
    .map(([a, c]) => ({ a, n: c.n || 0, mean: c.n ? c.sum / c.n : 0 }))
    .filter((x) => x.n > 0)
    .sort((x, y) => y.mean - x.mean || y.n - x.n)
    .slice(0, n);
}

function main() {
  if (!existsSync(ROOT)) {
    console.error("no human-record dir", ROOT);
    process.exit(2);
  }
  const dirs = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const table = {};
  const stats = { sessions: [], skipped: [], events: [], actions: {} };
  for (const name of dirs) {
    console.log("fit", name);
    fitSession(path.join(ROOT, name), name, table, stats);
  }

  const merge = process.argv.includes("--merge");
  const weights = merge ? loadWeights() : {};
  if (existsSync(WEIGHTS)) {
    const bak = path.join(DATA, `sense-weights.prev.json`);
    copyFileSync(WEIGHTS, bak);
    console.log("backup", bak);
  }
  mergeInto(weights, table);
  saveWeights(weights);

  const keys = Object.keys(table).sort();
  const report = {
    at: new Date().toISOString(),
    sessions: stats.sessions,
    skipped: stats.skipped,
    actions: stats.actions,
    eventCount: stats.events.length,
    states: keys.map((k) => ({
      key: k,
      n: Object.values(table[k]).reduce((s, c) => s + c.n, 0),
      top: topOf(weights, k)
    }))
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log("saved", WEIGHTS);
  console.log("report", REPORT);
  console.log(
    "used bins",
    stats.sessions.reduce((s, x) => s + x.used, 0),
    "events",
    stats.events.length
  );
  for (const s of report.states) {
    const t = s.top.map((x) => `${x.a}:${x.n}@${x.mean.toFixed(2)}`).join(" ");
    console.log(" ", s.key, "n=" + s.n, t);
  }
}

main();
