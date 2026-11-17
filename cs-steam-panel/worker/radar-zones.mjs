import { isT } from "./round-clock.mjs";

// mirage hud disc (north-up): T east, CT west-south, A south, B northwest.
// nx,ny = self on radar disc, 0..1, y down. calibrated from live vmconnect crop.

function inBox(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

export function radarZone(map, team, nx, ny) {
  const m = String(map || "").toLowerCase();
  const x = Number(nx);
  const y = Number(ny);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "unknown";
  if (m && !m.includes("mirage") && m !== "de_mirage") return "map";
  if (inBox(x, y, 0.08, 0.04, 0.40, 0.30)) return "b";
  if (inBox(x, y, 0.10, 0.26, 0.34, 0.44)) return "kitchen";
  if (inBox(x, y, 0.12, 0.42, 0.40, 0.70)) return "ct_spawn";
  if (inBox(x, y, 0.34, 0.52, 0.62, 0.82)) return "a";
  if (inBox(x, y, 0.58, 0.58, 0.92, 0.90)) return "palace";
  if (inBox(x, y, 0.66, 0.30, 0.96, 0.60)) return "t_spawn";
  if (inBox(x, y, 0.50, 0.42, 0.74, 0.66)) return "ramp";
  if (inBox(x, y, 0.36, 0.20, 0.62, 0.40)) return "catwalk";
  if (inBox(x, y, 0.54, 0.28, 0.78, 0.48)) return "topmid";
  if (inBox(x, y, 0.26, 0.34, 0.46, 0.52)) return "jungle";
  if (inBox(x, y, 0.36, 0.32, 0.62, 0.56)) return "mid";
  if (inBox(x, y, 0.30, 0.72, 0.50, 0.92)) return "ticket";
  return "map";
}

export function leftSpawn(zone, team) {
  if (!zone || zone === "unknown" || zone === "map") return false;
  if (isT(team)) return zone !== "t_spawn";
  return zone !== "ct_spawn";
}

export function atSite(zone) {
  return zone === "a" || zone === "b";
}

export function steerWaypoint(route, routeI, self, facingDeg) {
  const pts = route?.points;
  if (!pts?.length) return null;
  const nx = Number(self?.nx);
  const ny = Number(self?.ny);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const zone = radarZone("", "", nx, ny);
  let i = Math.max(0, Number(routeI) || 0);
  const left = Boolean(zone) && !["unknown", "map", "t_spawn", "ct_spawn"].includes(zone);
  while (i < pts.length) {
    const near = Math.hypot(nx - pts[i].nx, ny - pts[i].ny) < 0.08;
    const same = zone !== "map" && zone !== "unknown" && zone === pts[i].zone;
    const back = left && String(pts[i].zone || "").includes("spawn");
    if (near || same || back) i += 1;
    else break;
  }
  const tgt = pts[Math.min(i, pts.length - 1)];
  const dx = tgt.nx - nx;
  const dy = tgt.ny - ny;
  const dist = Math.hypot(dx, dy);
  const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const facing = Number(facingDeg) || 0;
  const rel = ((ang - facing + 540) % 360) - 180;
  const last = i >= pts.length - 1;
  return {
    i: Math.min(i, pts.length - 1),
    dist,
    rel,
    nav: tgt.zone || "wp",
    turn: Math.max(-38, Math.min(38, rel * 0.5)),
    look: 0,
    ms: dist < 0.12 ? 280 : 500,
    turnOnce: Math.abs(rel) > 10,
    turnOnly: Math.abs(rel) > 58,
    plant: Boolean(route.plant) && last && dist < 0.10 && (tgt.zone === "a" || tgt.zone === "b"),
    arrived: last && dist < 0.09
  };
}
