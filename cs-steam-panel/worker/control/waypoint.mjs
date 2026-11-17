import { steerWaypoint } from "../radar-zones.mjs";

export function followWaypoint({ route, routeI, self, facing_deg }) {
  return steerWaypoint(route, routeI, self, facing_deg);
}

export function keysFromRel(rel, wallAhead) {
  const r = Number(rel) || 0;
  if (wallAhead) {
    return { keys: [r >= 0 ? "D" : "A", "W"], keepW: false, turn: r };
  }
  if (Math.abs(r) > 58) return { keys: [], keepW: false, turn: r, turnOnly: true };
  if (r < -12) return { keys: ["W", "A"], keepW: true, turn: r };
  if (r > 12) return { keys: ["W", "D"], keepW: true, turn: r };
  return { keys: ["W"], keepW: true, turn: r };
}
