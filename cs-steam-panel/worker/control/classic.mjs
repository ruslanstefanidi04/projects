import { isFreshForAim } from "./freshness.mjs";
import { createPid } from "./pid.mjs";
import { createKalman2d } from "./kalman2d.mjs";
import { astar, cellOf, occFromRadar, worldOf } from "./astar.mjs";
import { fireCommand } from "./fire.mjs";
import { followWaypoint, keysFromRel } from "./waypoint.mjs";
import { strafeCommand } from "./strafe.mjs";

const FOE = {
  T: ["c", "ch"],
  CT: ["t", "th"]
};

export function pickFoeDet(dets, team) {
  const t = String(team || "").toUpperCase();
  const names = t.startsWith("T") && !t.includes("CT") ? FOE.T : FOE.CT;
  const list = Array.isArray(dets) ? dets : [];
  return list.find((d) => names.includes(String(d.name || d.cls || ""))) || null;
}

export function createClassicBrain() {
  const pid = createPid();
  const kf = createKalman2d();
  let lastT = 0;

  function reset() {
    pid.reset();
    kf.reset();
    lastT = 0;
  }

  function tick({ frame, gsi, stuckMs = 0, force = null, route = null, routeI = 0, now = Date.now() } = {}) {
    const dt = lastT ? Math.min(0.25, Math.max(0.016, (now - lastT) / 1000)) : 0.05;
    lastT = now;
    if (gsi?.alive === false) {
      reset();
      return { skill: "idle", reason: "dead", steps: [{ action: "WAIT", ms: 80 }] };
    }
    const dets = frame?.yolo?.dets || [];
    const foe = pickFoeDet(dets, gsi?.team);
    const fresh = isFreshForAim(frame);
    kf.predict(dt);
    if (foe && fresh) kf.update(foe.x, foe.y);
    else if (!foe) kf.lost();
    const track = kf.state();
    const want = force || (foe && fresh ? "aim" : "walk");
    if (want === "fire" || (want === "aim" && track.ok && fresh)) {
      const aim = aimOut(track, pid, dt, fresh, gsi?.ammo);
      if (want === "fire" || aim.err <= 16) {
        const shot = fireCommand({ fresh, ammo: gsi?.ammo, err: aim.err });
        if (shot.steps.length) return shot;
      }
      if (want === "aim" || want === "fire") return aim;
    }
    if (want === "aim" && !fresh) {
      pid.reset();
      return { skill: "aim", reason: "stale", err: null, steps: [] };
    }
    return walkOut(frame, gsi, stuckMs, route, routeI);
  }

  return { tick, reset, kf, pid };
}

function aimOut(track, pid, dt, fresh, ammo) {
  if (!fresh || !track.ok) {
    pid.reset();
    return { skill: "aim", reason: fresh ? "no-track" : "stale", err: null, steps: [] };
  }
  const ex = track.x - 50;
  const ey = track.y - 42;
  const look = pid.update(ex, ey, dt);
  const err = Math.hypot(look.dx, look.dy);
  return {
    skill: "aim",
    reason: "track",
    err,
    ammo,
    steps: [{ action: "LOOK", dx: look.dx, dy: look.dy }]
  };
}

function walkOut(frame, gsi, stuckMs, route, routeI) {
  const radar = frame?.radar || {};
  const self = radar.self || {};
  const wall = Boolean(radar.wall_ahead || gsi?.wallAhead);
  const wp = route?.points?.length
    ? followWaypoint({ route, routeI, self, facing_deg: radar.facing_deg })
    : null;
  if (wp && Number.isFinite(self.nx)) {
    const n = 32;
    const occ = occFromRadar({
      n,
      self,
      wall_ahead: wall,
      facing_deg: radar.facing_deg,
      blocked: radar.blocked
    });
    const goalPt = route.points[Math.min(wp.i, route.points.length - 1)];
    const path = astar(occ, cellOf(self.nx, self.ny, n), cellOf(goalPt.nx, goalPt.ny, n));
    const next = path[1] || path[0];
    let rel = wp.rel;
    if (next) {
      const w = worldOf(next, n);
      const dx = w.nx - self.nx;
      const dy = w.ny - self.ny;
      const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const facing = Number(radar.facing_deg) || 0;
      rel = ((ang - facing + 540) % 360) - 180;
    }
    const k = keysFromRel(rel, wall);
    const steps = [];
    if (k.turnOnly || wp.turnOnce) steps.push({ action: "LOOK", dx: Math.max(-38, Math.min(38, rel * 0.5)), dy: 0 });
    for (const key of k.keys) steps.push({ action: "HOLD", key, ms: wp.ms || 220 });
    if (!steps.length) steps.push({ action: "WAIT", ms: 80 });
    return { skill: "walk", reason: "astar-wp", keepW: k.keepW, steps, nav: wp.nav, dist: wp.dist };
  }
  const st = strafeCommand({ wallAhead: wall, openRel: radar.open_best?.rel, stuckMs });
  if (st.steps.length) return { ...st, skill: "walk" };
  return { skill: "walk", reason: "forward", keepW: true, steps: [{ action: "HOLD", key: "W", ms: 260 }] };
}
