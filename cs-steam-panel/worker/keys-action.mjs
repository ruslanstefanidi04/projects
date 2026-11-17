// map guest key sample to traj action label.
export function actionFromKeys(k) {
  if (!k || typeof k !== "object") return "idle";
  if (k.M1) return "fire";
  if (k.M2) return "aim";
  if (k.R) return "reload";
  if (k.E) return "use";
  if (k.B) return "buy";
  if (k.Q) return "last-weapon";
  if (k.F) return "inspect";
  if (k.G) return "drop";
  if (k.C) return "crouch";
  if (k.SPACE) return "jump";
  if (k.N1) return "slot1";
  if (k.N2) return "slot2";
  if (k.N3) return "slot3";
  if (k.N4) return "slot4";
  if (k.N5) return "slot5";
  const w = Boolean(k.W);
  const a = Boolean(k.A);
  const s = Boolean(k.S);
  const d = Boolean(k.D);
  if (w && a) return "walk-wa";
  if (w && d) return "walk-wd";
  if (s && a) return "walk-sa";
  if (s && d) return "walk-sd";
  if (w) return "walk-w";
  if (s) return "walk-s";
  if (a) return "walk-a";
  if (d) return "walk-d";
  if (k.SHIFT) return "walk-slow";
  if (k.CTRL) return "duck";
  return "idle";
}

export function keysWithMouse(k) {
  const keys = k && typeof k === "object" ? { ...k } : {};
  keys.dx = Number(keys.dx || 0);
  keys.dy = Number(keys.dy || 0);
  return keys;
}
