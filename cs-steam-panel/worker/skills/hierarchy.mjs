import { createClassicBrain } from "../control/classic.mjs";

// hierarchical skills. controllers first, not one net for the whole match.
const classic = createClassicBrain();
export const PLAYER_NAMES = new Set(["c", "ch", "t", "th"]);
export const SKILL_IDS = ["walk", "aim", "fire", "idle"];

export function packWalkObs(frame, gsi) {
  const radar = frame?.radar || {};
  const self = radar.self || {};
  return {
    wall_ahead: Boolean(radar.wall_ahead || gsi?.wallAhead),
    nx: Number(self.nx || 0),
    ny: Number(self.ny || 0),
    facing: radar.facing_deg,
    openRel: Number(radar.open_best?.rel || 0),
    mean: Number(frame?.mean || 0),
    alive: gsi?.alive !== false
  };
}

export function packAimObs(frame, gsi) {
  const dets = Array.isArray(frame?.yolo?.dets) ? frame.yolo.dets : [];
  const team = String(gsi?.team || "").toUpperCase();
  const foeNames = team.startsWith("T") && !team.includes("CT") ? ["c", "ch"] : ["t", "th"];
  const foes = dets.filter((d) => foeNames.includes(String(d.name || d.cls || "")));
  const d = foes[0] || null;
  return {
    hasFoe: Boolean(d),
    x: d ? Number(d.x) : null,
    y: d ? Number(d.y) : null,
    ammo: Number(gsi?.ammo || 0)
  };
}

export function walkController(obs, { stuckMs = 0 } = {}) {
  if (!obs?.alive) return { skill: "walk", reason: "dead", steps: [{ action: "WAIT", ms: 80 }] };
  if (obs.wall_ahead || stuckMs > 1800) {
    const yaw = obs.openRel || 48;
    const dx = Math.max(-90, Math.min(90, yaw || 48));
    return {
      skill: "walk",
      reason: "unstick",
      keepW: false,
      steps: [
        { action: "LOOK", dx, dy: 0 },
        { action: "HOLD", key: dx > 0 ? "D" : "A", ms: 160 },
        { action: "HOLD", key: "W", ms: 180 }
      ]
    };
  }
  return {
    skill: "walk",
    reason: "forward",
    keepW: true,
    steps: [{ action: "HOLD", key: "W", ms: 260 }]
  };
}

export function aimController(obs) {
  if (!obs?.hasFoe) return { skill: "aim", reason: "no-target", steps: [], err: null };
  const dx = (Number(obs.x) - 50) * 5;
  const dy = (Number(obs.y) - 42) * 4;
  return {
    skill: "aim",
    reason: "track",
    err: Math.hypot(dx, dy),
    steps: [{ action: "LOOK", dx: Math.round(dx), dy: Math.round(dy) }]
  };
}

export function fireController({ err, ammo }) {
  if (!(ammo > 0) || err == null || err > 16) {
    return { skill: "fire", reason: "hold", steps: [] };
  }
  return { skill: "fire", reason: "shot", steps: [{ action: "FIRE" }] };
}

export function planSkill({ frame, gsi, force }) {
  if (force && SKILL_IDS.includes(force)) return force;
  const aim = packAimObs(frame, gsi);
  if (aim.hasFoe) return errSmall(aim) ? "fire" : "aim";
  return "walk";
}

function errSmall(aim) {
  if (!aim.hasFoe) return false;
  return Math.hypot((aim.x - 50) * 5, (aim.y - 42) * 4) < 16;
}

export function skillToDecision(out, skill) {
  const steps = (out.steps || []).filter(Boolean);
  if (!steps.length) {
    return {
      fsm: "skill",
      state: "RUNNING",
      action: "WAIT",
      reason: "skill-" + skill + "-" + (out.reason || "empty"),
      timeout_ms: 60,
      skill
    };
  }
  return {
    fsm: "skill",
    state: "RUNNING",
    action: "COMBO",
    reason: "skill-" + skill + "-" + (out.reason || "go"),
    steps,
    keepW: Boolean(out.keepW),
    timeout_ms: 40,
    expect: { kind: "motion" },
    skill
  };
}

export function runHierarchy({ frame, gsi, stuckMs = 0, force = null, route = null, routeI = 0, now } = {}) {
  const out = classic.tick({ frame, gsi, stuckMs, force, route, routeI, now });
  const skill = out.skill || "idle";
  return { skill, source: "skill", ok: true, decision: skillToDecision(out, skill) };
}
