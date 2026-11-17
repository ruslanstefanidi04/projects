// pose from official gsi xyz/forward + radar pip. never invent yaw 0.
import { yawFromForward } from "../aim-gsi.mjs";

export function readPose({ gsi, frame } = {}) {
  const ts = Date.now();
  const map = String(gsi?.map || frame?.gsi?.map || "").toLowerCase();
  const pos = gsi?.pos && Number.isFinite(Number(gsi.pos.x)) ? gsi.pos : null;
  const yawFwd = yawFromForward(gsi?.forward);
  const radar = frame?.radar || {};
  const nx = Number(radar.self?.nx);
  const ny = Number(radar.self?.ny);
  const radarOk = Number.isFinite(nx) && Number.isFinite(ny) && (nx !== 0 || ny !== 0);
  const faceR = Number(radar.facing_deg);
  const yawRadar = radar.facing_ok && Number.isFinite(faceR) ? faceR : null;
  const yaw = yawFwd != null ? yawFwd : yawRadar;
  let confidence = 0;
  const sources = [];
  if (pos) {
    confidence += 0.55;
    sources.push("gsi-xyz");
  }
  if (yawFwd != null) {
    confidence += 0.25;
    sources.push("gsi-fwd");
  } else if (yawRadar != null) {
    confidence += 0.12;
    sources.push("radar-yaw");
  }
  if (radarOk) {
    confidence += 0.2;
    sources.push("radar");
  }
  const gsiLive = Boolean(pos) || Boolean(map) || gsi?.alive === true;
  if (gsiLive && gsi?.inMenu) {
    return { ok: false, reason: "menu", map, ts, confidence: 0 };
  }
  if (gsiLive && gsi?.alive === false) {
    return { ok: false, reason: "dead", map, ts, confidence: 0 };
  }
  if (!pos && !radarOk) {
    return { ok: false, reason: "no-pose", map, ts, confidence: 0 };
  }
  return {
    ok: true,
    map,
    x: pos ? Number(pos.x) : null,
    y: pos ? Number(pos.y) : null,
    z: pos ? Number(pos.z) || 0 : null,
    yaw: yaw,
    yawOk: yaw != null,
    nx: radarOk ? nx : null,
    ny: radarOk ? ny : null,
    confidence,
    source: sources.join("+"),
    timestamp: ts
  };
}

export function poseMoved(a, b, minWorld = 8, minRadar = 0.012) {
  if (!a || !b) return false;
  if (a.x != null && b.x != null) {
    return Math.hypot(b.x - a.x, b.y - a.y) >= minWorld;
  }
  if (a.nx != null && b.nx != null) {
    return Math.hypot(b.nx - a.nx, b.ny - a.ny) >= minRadar;
  }
  return false;
}

export function distTo(pose, goal) {
  if (!pose || !goal) return Infinity;
  if (pose.x != null && Number.isFinite(Number(goal.x))) {
    return Math.hypot(Number(goal.x) - pose.x, Number(goal.y) - pose.y);
  }
  const nx = Number(goal.nx);
  const ny = Number(goal.ny);
  if (pose.nx != null && Number.isFinite(nx)) return Math.hypot(nx - pose.nx, ny - pose.ny);
  return Infinity;
}
