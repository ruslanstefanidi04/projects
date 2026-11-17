export function fireCommand({ fresh, ammo, err, errMax = 16 } = {}) {
  if (!fresh) return { skill: "fire", reason: "stale", steps: [] };
  if (!(Number(ammo) > 0)) return { skill: "fire", reason: "no-ammo", steps: [] };
  if (err == null || err > errMax) return { skill: "fire", reason: "hold", steps: [] };
  return { skill: "fire", reason: "shot", steps: [{ action: "FIRE" }] };
}
