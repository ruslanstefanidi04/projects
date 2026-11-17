import { astar, cellOf, occFromRadar, worldOf } from "../control/astar.mjs";
import { yawFromForward } from "../aim-gsi.mjs";
import { readLab, writeLab } from "./state.mjs";
import { readPose, distTo } from "./pose.mjs";
import { loadMapGraph, nearestNode, graphPath, pathPoints, goalNodeId } from "../nav/graph.mjs";

export function facingDeg(gsi, radar) {
  const y = yawFromForward(gsi?.forward);
  if (y != null) return y;
  const r = Number(radar?.facing_deg);
  return Number.isFinite(r) ? r : null;
}

export function selfOnRadar(frame, gsi) {
  const s = frame?.radar?.self;
  const nx = Number(s?.nx);
  const ny = Number(s?.ny);
  if (Number.isFinite(nx) && Number.isFinite(ny) && (nx !== 0 || ny !== 0)) {
    return { nx, ny, source: "radar" };
  }
  return null;
}

export function planWalk({ frame, gsi, goal } = {}) {
  const radar = frame?.radar || {};
  const pose = readPose({ gsi, frame });
  const self = pose.ok && pose.nx != null ? { nx: pose.nx, ny: pose.ny, source: pose.source } : selfOnRadar(frame, gsi);
  const facing = pose.ok && pose.yawOk ? pose.yaw : facingDeg(gsi, radar);
  const gx = Number(goal?.nx);
  const gy = Number(goal?.ny);
  if (!self) {
    return { ok: false, error: "Нет данных", reason: "no-self" };
  }
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) {
    return { ok: false, error: "Нет точки назначения", reason: "no-goal" };
  }
  const graph = loadMapGraph(pose.map || gsi?.map || "");
  if (graph) {
    const startH = nearestNode(graph, self);
    const endId = goalNodeId(graph, { nx: gx, ny: gy, id: goal?.id });
    if (startH && endId) {
      const ids = graphPath(graph, startH.node.id, endId);
      const pts = pathPoints(graph, ids);
      if (pts.length >= 1) {
        const next = pts[1] || pts[pts.length - 1];
        const dist = Math.hypot(gx - self.nx, gy - self.ny);
        return {
          ok: true,
          error: "",
          reason: dist < 0.07 ? "arrived" : "ok",
          self,
          facing,
          goal: { nx: gx, ny: gy },
          path: pts,
          next,
          dist,
          pathFit: 100,
          map: graph.map,
          source: "nav-graph",
          pose
        };
      }
    }
  }
  const n =
    Array.isArray(radar.occupancy) && radar.occupancy.length >= 8 ? radar.occupancy.length : Number(radar.occupancy_n) || 32;
  const occ = occFromRadar({
    n,
    self,
    goal: { nx: gx, ny: gy },
    wall_ahead: Boolean(radar.wall_ahead),
    facing_deg: facing || 0,
    blocked: radar.blocked,
    occupancy: radar.occupancy
  });
  const start = cellOf(self.nx, self.ny, n);
  const end = cellOf(gx, gy, n);
  const walls = occ.flat().filter((v) => v === 1).length;
  const path = astar(occ, start, end);
  const dbg = {
    start,
    end,
    walls,
    cells: n * n,
    wallPct: Math.round((100 * walls) / (n * n)),
    occupancy: occ,
    hasOcc: Array.isArray(radar.occupancy)
  };
  if (!path.length) {
    const straight = [worldOf(start, n), { nx: gx, ny: gy }];
    return {
      ok: false,
      error: "Маршрут не найден. стены " + dbg.wallPct + "% сетки. красное справа = стены occupancy.",
      reason: "no-path",
      self,
      facing,
      goal: { nx: gx, ny: gy },
      path: straight,
      next: straight[1],
      map: gsi?.map || "",
      source: "radar-astar",
      occCells: walls,
      pathFit: 0,
      debug: dbg
    };
  }
  const pts = path.map((c) => worldOf(c, n));
  const next = pts[1] || pts[pts.length - 1];
  const dx = next.nx - self.nx;
  const dy = next.ny - self.ny;
  const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const rel = facing == null ? 0 : ((ang - facing + 540) % 360) - 180;
  const dist = Math.hypot(gx - self.nx, gy - self.ny);
  const pathFit = pathFitPct(occ, pts, n);
  return {
    ok: true,
    error: "",
    reason: dist < 0.06 ? "arrived" : "ok",
    self,
    facing,
    goal: { nx: gx, ny: gy },
    path: pts,
    next,
    rel,
    dist,
    pathFit,
    map: gsi?.map || "",
    pos: gsi?.pos || null,
    source: "radar-astar",
    occCells: occ.flat().filter((v) => v === 1).length,
    debug: dbg,
    note: "нет navmesh cs2. путь A* по тёмным зданиям на миникарте."
  };
}

export function pathFitPct(occ, pts, n = 32) {
  if (!Array.isArray(occ) || !Array.isArray(pts) || !pts.length) return null;
  let ok = 0;
  for (const p of pts) {
    const c = cellOf(p.nx, p.ny, n);
    if (occ[c.y] && occ[c.y][c.x] !== 1) ok += 1;
  }
  return Math.round((100 * ok) / pts.length);
}

export function fuseWalkFrame(live, freeze) {
  const lr = live?.radar || {};
  const fr = freeze?.radar || {};
  const liveSelf = selfOnRadar({ radar: lr });
  const freezeSelf = selfOnRadar({ radar: fr });
  const self = liveSelf || freezeSelf || fr.self || lr.self || null;
  const faceLive = Number(lr.facing_deg);
  const faceFr = Number(fr.facing_deg);
  return {
    radar: {
      ...fr,
      occupancy: Array.isArray(fr.occupancy) ? fr.occupancy : lr.occupancy,
      occupancy_n: fr.occupancy_n || lr.occupancy_n,
      self,
      facing_deg: Number.isFinite(faceLive) ? faceLive : faceFr,
      facing_ok: Boolean(lr.facing_ok || fr.facing_ok),
      wall_ahead: Boolean(lr.wall_ahead)
    }
  };
}

function relToNext(self, next, facing) {
  const dx = Number(next?.nx) - Number(self?.nx);
  const dy = Number(next?.ny) - Number(self?.ny);
  const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (!Number.isFinite(facing)) return 0;
  return ((ang - facing + 540) % 360) - 180;
}

function nextOnPath(path, self, goal) {
  if (Array.isArray(path)) {
    for (const p of path) {
      if (Math.hypot(Number(p.nx) - self.nx, Number(p.ny) - self.ny) > 0.045) return p;
    }
  }
  return goal || (path && path[path.length - 1]) || null;
}

export function stepsFromPlan(plan) {
  if (!plan?.ok || plan.reason === "arrived") return [];
  const rel = Number(plan.rel) || 0;
  const steps = [];
  if (plan.faceOk && Math.abs(rel) > 18) {
    const dx = Math.max(-220, Math.min(220, Math.round(rel * 1.85)));
    if (dx) steps.push({ action: "LOOK", dx, dy: 0 });
  }
  steps.push({ action: "HOLD", key: "W", ms: 280 });
  return steps;
}

export function walkTick({ frame, freeze, gsi, stuckMs = 0 } = {}) {
  const lab = readLab();
  if (lab.skill !== "walk" || !lab.confirmed) {
    return {
      skill: "idle",
      source: "lab",
      ok: true,
      decision: { fsm: "lab", action: "WAIT", reason: "lab-idle", timeout_ms: 180 }
    };
  }
  const fused = fuseWalkFrame(frame, freeze);
  const pose = readPose({ gsi, frame });
  const self =
    pose.ok && pose.nx != null
      ? { nx: pose.nx, ny: pose.ny, source: pose.source }
      : selfOnRadar(frame, gsi);
  const goal = lab.goal;
  if (!pose.ok || !self || !goal) {
    writeLab({
      ...lab,
      moving: false,
      confirmed: false,
      skill: "idle",
      stopReason: "no-self",
      error: pose.reason || "нет позы, стоп"
    });
    return {
      skill: "idle",
      source: "lab",
      ok: true,
      decision: { fsm: "lab", action: "WAIT", reason: "no-self", timeout_ms: 120 }
    };
  }
  const dist = distTo(pose.ok ? pose : self, goal);
  const minDist = Number(lab.walkMinDist);
  const walkMinDist = Number.isFinite(minDist) ? Math.min(minDist, dist) : dist;
  const passed = Number.isFinite(minDist) && minDist < 0.14 && dist > minDist + 0.04;
  const arrive = pose.x != null && Number.isFinite(Number(goal.x)) ? dist < 40 : dist < 0.045;
  if (arrive || passed) {
    writeLab({
      ...lab,
      moving: false,
      confirmed: false,
      skill: "idle",
      stopReason: "arrived",
      error: "",
      walkMinDist
    });
    return {
      skill: "walk",
      source: "lab",
      ok: true,
      decision: { fsm: "lab", action: "WAIT", reason: "arrived", timeout_ms: 120 }
    };
  }
  const next = nextOnPath(lab.path, self, goal);
  const faceOk = Boolean(pose.yawOk || fused.radar?.facing_ok);
  const face = pose.yawOk ? pose.yaw : Number(fused.radar?.facing_deg);
  const rel = faceOk && Number.isFinite(face) ? relToNext(self, next, face) : 0;
  const plan = { ok: true, reason: "ok", rel, faceOk, path: lab.path, next, pathFit: lab.pathFit };
  const steps = stepsFromPlan(plan);
  writeLab({
    ...lab,
    moving: true,
    next,
    error: "",
    stopReason: "",
    skill: "walk",
    confirmed: true,
    walkMinDist
  });
  return {
    skill: "walk",
    source: "lab",
    ok: true,
    decision: {
      fsm: "lab",
      state: "RUNNING",
      action: "COMBO",
      reason: "lab-walk",
      steps,
      keepW: false,
      timeout_ms: 40
    }
  };
}
