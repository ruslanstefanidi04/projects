// textbook pid. visual servo: error in screen percent -> look dx/dy.
// not copied from ros; same formula as any intro controls notes.
export function createPid({ kp = 0.85, ki = 0.02, kd = 0.12, iLimit = 28, outLimit = 90 } = {}) {
  let ix = 0;
  let iy = 0;
  let px = 0;
  let py = 0;
  let primed = false;

  function reset() {
    ix = 0;
    iy = 0;
    px = 0;
    py = 0;
    primed = false;
  }

  function update(ex, ey, dt = 0.05) {
    const t = Math.max(0.008, Number(dt) || 0.05);
    ix = Math.max(-iLimit, Math.min(iLimit, ix + ex * t));
    iy = Math.max(-iLimit, Math.min(iLimit, iy + ey * t));
    const dx = primed ? (ex - px) / t : 0;
    const dy = primed ? (ey - py) / t : 0;
    px = ex;
    py = ey;
    primed = true;
    const ox = kp * ex + ki * ix + kd * dx;
    const oy = kp * ey + ki * iy + kd * dy;
    return {
      dx: Math.round(Math.max(-outLimit, Math.min(outLimit, ox))),
      dy: Math.round(Math.max(-outLimit, Math.min(outLimit, oy)))
    };
  }

  return { update, reset };
}
