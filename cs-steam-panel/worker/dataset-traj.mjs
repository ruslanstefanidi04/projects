// trajectory rows for behavioral cloning. not yolo boxes alone.
export const TRAJ_VERSION = 1;
const ACTIONS_OK = new Set([
  "idle",
  "fire",
  "aim",
  "reload",
  "use",
  "buy",
  "jump",
  "duck",
  "crouch",
  "walk-w",
  "walk-a",
  "walk-s",
  "walk-d",
  "walk-wa",
  "walk-wd",
  "walk-sa",
  "walk-sd",
  "walk-slow",
  "last-weapon",
  "inspect",
  "drop",
  "slot1",
  "slot2",
  "slot3",
  "slot4",
  "slot5",
  "wait"
]);

export function makeTrajStep({
  episodeId,
  t,
  observation,
  action,
  keys,
  mouse,
  reward,
  done,
  source,
  sourceRole,
  terminal,
  modelVersion,
  actionDurationMs,
  observationId
} = {}) {
  const dx = Number(mouse?.dx ?? keys?.dx ?? 0) || 0;
  const dy = Number(mouse?.dy ?? keys?.dy ?? 0) || 0;
  return {
    version: TRAJ_VERSION,
    episode_id: String(episodeId || ""),
    observation_id: String(observationId || ""),
    t: Number(t) || Date.now(),
    observation: observation || null,
    action: String(action || "idle"),
    keys: keys || null,
    mouse: { dx, dy, m1: Boolean(keys?.M1 || mouse?.m1), m2: Boolean(keys?.M2 || mouse?.m2) },
    reward: Number(reward) || 0,
    done: Boolean(done),
    source: source === "agent" ? "agent" : "human",
    source_role: String(sourceRole || (source === "agent" ? "agent" : "human")),
    terminal_reason: terminal || null,
    model_version: String(modelVersion || "none"),
    action_duration_ms: Number(actionDurationMs) || 0
  };
}

export function validateTrajStep(row) {
  const errors = [];
  if (!row || typeof row !== "object") return { ok: false, errors: ["missing"] };
  if (row.version !== TRAJ_VERSION) errors.push("version");
  if (!row.episode_id) errors.push("episode_id");
  if (!Number.isFinite(Number(row.t))) errors.push("t");
  if (!row.action) errors.push("action");
  if (row.source !== "human" && row.source !== "agent") errors.push("source");
  if (row.done && !row.terminal_reason) errors.push("terminal_reason");
  return { ok: errors.length === 0, errors };
}

export function validateTrajectory(rows, { maxGapMs = 2500 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const errors = [];
  if (!list.length) return { ok: false, errors: ["empty"] };
  let prevT = -1;
  const ep = list[0].episode_id;
  const seenT = new Set();
  for (let i = 0; i < list.length; i++) {
    const v = validateTrajStep(list[i]);
    if (!v.ok) errors.push(`row${i}:` + v.errors.join(","));
    if (list[i].episode_id !== ep) errors.push(`row${i}:episode-mix`);
    const t = Number(list[i].t);
    if (t < prevT) errors.push(`row${i}:time-back`);
    if (seenT.has(t) && list[i].action === list[i - 1]?.action) errors.push(`row${i}:dup-t`);
    if (prevT >= 0 && t - prevT > maxGapMs) errors.push(`row${i}:gap`);
    seenT.add(t);
    prevT = t;
    if (list[i].mouse && (!Number.isFinite(Number(list[i].mouse.dx)) || !Number.isFinite(Number(list[i].mouse.dy)))) {
      errors.push(`row${i}:mouse`);
    }
  }
  const last = list[list.length - 1];
  if (last.done !== true) errors.push("missing-done");
  return { ok: errors.length === 0, errors, n: list.length, episode_id: ep };
}

export function actionAllowed(name) {
  return ACTIONS_OK.has(String(name || ""));
}
