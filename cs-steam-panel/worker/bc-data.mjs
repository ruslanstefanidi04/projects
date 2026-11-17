// load human-record sessions into traj rows. does not rewrite source files.
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { FARM_ROOT } from "./vm/defaults.mjs";
import { actionFromKeys, keysWithMouse } from "./keys-action.mjs";
import { splitByEpisode, checkRow } from "./dataset-adapter.mjs";
import { actionLabel } from "./bc.mjs";

export const HUMAN_ROOT = process.env.FARM_HUMAN_DIR || path.join(FARM_ROOT, "ops", "vision", "human-record");

function readJsonl(file) {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return [];
  const rows = [];
  for (const line of raw.split(/\n/)) {
    try {
      rows.push(JSON.parse(line));
    } catch {}
  }
  return rows;
}

function obsFromFrame(row) {
  const g = row.gsi || {};
  const radar = row.radar_cv || {};
  return {
    player: {
      alive: g.alive !== false,
      health: Number(g.health || 0),
      team: String(g.team || "")
    },
    weapon: { ammo: Number(g.ammo || 0), name: String(g.weapon || "") },
    radar: {
      wall_ahead: Boolean(radar.wall),
      enemy_count: Number(radar.foes || g.foeN || 0),
      self: { nx: Number(radar.nx || 0), ny: Number(radar.ny || 0) }
    },
    detections: Array.isArray(row.yolo) ? row.yolo : [],
    round: { clock: String(row.clock || ""), map: String(g.map || "") },
    screenshot: { mean: Number(row.mean || 0), valid: true }
  };
}

export function sessionToRows(sessDir, sessionId) {
  const trajFile = path.join(sessDir, "traj.jsonl");
  const framesFile = path.join(sessDir, "frames.jsonl");
  const issues = { missing_action: 0, bad_mouse: 0, bad_ts: 0, no_image: 0 };
  let raw = [];
  if (existsSync(trajFile) && statSync(trajFile).size > 2) {
    raw = readJsonl(trajFile).filter((r) => !r.done);
  } else {
    raw = readJsonl(framesFile);
  }
  const rows = [];
  let prev = null;
  for (const row of raw) {
    const keys = keysWithMouse(row.keys || {});
    const action = row.action && row.action !== "idle" ? row.action : actionFromKeys(keys);
    const observation = row.observation || obsFromFrame(row);
    const out = {
      episode_id: String(row.episode_id || sessionId),
      timestamp: Number(row.t || row.timestamp || 0),
      observation,
      action,
      keys,
      source: "human",
      frame: row.file || row.image || null
    };
    const bad = checkRow(
      { timestamp: out.timestamp, keys, action, frame_path: out.frame, width: 1280, height: 720 },
      prev
    );
    for (const b of bad) {
      if (b === "bad_mouse") issues.bad_mouse += 1;
      if (b === "bad_ts") issues.bad_ts += 1;
      if (b === "missing_action") issues.missing_action += 1;
    }
    if (!out.frame) issues.no_image += 1;
    rows.push(out);
    prev = { timestamp: out.timestamp, id: out.frame };
  }
  return { sessionId, rows, issues, n: rows.length };
}

export function loadHumanDataset({ root = HUMAN_ROOT, prefix = "human-" } = {}) {
  if (!existsSync(root)) return { sessions: [], rows: [], issues: {}, split: null };
  const names = readdirSync(root).filter((n) => n.startsWith(prefix));
  const sessions = [];
  const rows = [];
  const issues = { sessions: 0, empty: 0, missing_action: 0, bad_mouse: 0, bad_ts: 0, no_image: 0 };
  for (const name of names) {
    const dir = path.join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    issues.sessions += 1;
    const one = sessionToRows(dir, name);
    issues.missing_action += one.issues.missing_action;
    issues.bad_mouse += one.issues.bad_mouse;
    issues.bad_ts += one.issues.bad_ts;
    issues.no_image += one.issues.no_image;
    if (one.n < 8) {
      issues.empty += 1;
      continue;
    }
    const labels = new Set(one.rows.map((r) => actionLabel(r)));
    if (labels.size < 2) {
      issues.empty += 1;
      continue;
    }
    sessions.push({ id: name, n: one.n, labels: [...labels] });
    rows.push(...one.rows);
  }
  const split = splitByEpisode(rows);
  return { sessions, rows, issues, split };
}
