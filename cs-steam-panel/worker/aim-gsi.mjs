// world aim from gsi xyz. official gsi has no viewangles; yaw is tracked from mouse + move.

export function wrap180(deg) {
  return ((Number(deg) + 540) % 360) - 180;
}

export function yawTowards(from, to) {
  return (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
}

export function pitchTowards(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chest = (to.z || 0) - (from.z || 0) + 64;
  const ground = Math.hypot(dx, dy) || 1;
  return (-Math.atan2(chest, ground) * 180) / Math.PI;
}

export function yawFromForward(fwd) {
  if (!fwd || !Number.isFinite(fwd.x) || !Number.isFinite(fwd.y)) return null;
  if (fwd.x * fwd.x + fwd.y * fwd.y < 0.01) return null;
  return (Math.atan2(fwd.x, fwd.y) * 180) / Math.PI;
}

export function nearestFoe(gsi) {
  const me = gsi?.pos;
  if (!me || !Array.isArray(gsi.foes)) return null;
  let best = null;
  let bestD = Infinity;
  for (const f of gsi.foes) {
    if (!f?.pos || Number(f.health || 0) <= 0) continue;
    const d = Math.hypot(f.pos.x - me.x, f.pos.y - me.y);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best ? { foe: best, dist: bestD } : null;
}

const M_YAW = 0.022;
const SENS = Number(process.env.FARM_SENS || 5) || 5;

export function mouseFromDeg(deg) {
  return deg / (M_YAW * SENS);
}

export function applyMouseToView(view, dx, dy) {
  const yaw = wrap180((view?.yaw || 0) + Number(dx || 0) * M_YAW * SENS);
  const pitch = Math.max(-89, Math.min(89, (view?.pitch || 0) + Number(dy || 0) * M_YAW * SENS));
  return { yaw, pitch };
}

export function aimAtFoe(gsi, view) {
  if (!gsi?.alive || !gsi.pos) return null;
  const hit = nearestFoe(gsi);
  if (!hit || hit.dist > 4000) return null;
  const wantYaw = yawTowards(gsi.pos, hit.foe.pos);
  const wantPitch = pitchTowards(gsi.pos, hit.foe.pos);
  const yaw = Number.isFinite(view?.yaw) ? view.yaw : wantYaw;
  const pitch = Number.isFinite(view?.pitch) ? view.pitch : 0;
  const dyaw = wrap180(wantYaw - yaw);
  const dpitch = wantPitch - pitch;
  return {
    dyaw,
    dpitch,
    dist: hit.dist,
    name: hit.foe.name,
    dx: mouseFromDeg(dyaw),
    dy: mouseFromDeg(dpitch),
    onTarget: Math.abs(dyaw) < 3.2 && Math.abs(dpitch) < 6
  };
}
