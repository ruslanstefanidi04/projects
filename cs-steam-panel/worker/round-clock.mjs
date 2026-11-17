// round clock: first 20s execute (walk only), then mid, then planted hurry.
export const EXEC_MS = 20000;

export function isT(team) {
  const t = String(team || "").toUpperCase();
  return t === "T" || t === "TERRORIST";
}

// cybershoke / community dm: map looks like "de_dust2 | DM #186 | ... CYBERSHOKE"
export function isDeathmatch(gsi) {
  const mode = String(gsi?.mode || "").toLowerCase();
  const map = String(gsi?.map || "").toLowerCase();
  if (/deathmatch|death_match|gungame/i.test(mode)) return true;
  if (/\|\s*dm\b|\bdm\s*#|deathmatch|^aim_|_dm\b/.test(map)) return true;
  return false;
}

export function tickClock(gsi, mem) {
  if (!mem || typeof mem !== "object") mem = {};
  if (isDeathmatch(gsi)) {
    const dead = gsi && !gsi.alive;
    return { clock: dead ? "dead" : "dm", elapsedMs: 0, planted: false, tSide: isT(gsi?.team), mem, dm: true };
  }
  const live = gsi && (gsi.phase === "live" || gsi.mapPhase === "live");
  const freeze = gsi && (gsi.phase === "freezetime" || gsi.mapPhase === "freezetime");
  const key = `${gsi?.round ?? "x"}|${gsi?.team || ""}`;
  if (mem.roundKey !== key) {
    mem.roundKey = key;
    mem.liveAt = 0;
  }
  if (freeze) mem.liveAt = 0;
  else if (live && gsi?.alive && !mem.liveAt) mem.liveAt = Date.now();
  const elapsedMs = mem.liveAt ? Date.now() - mem.liveAt : 0;
  const planted =
    gsi?.bomb === "planted" ||
    gsi?.bombState === "planted" ||
    gsi?.bombState === "exploding";
  let clock = "idle";
  if (!gsi) clock = "idle";
  else if (freeze) clock = "freeze";
  else if (!gsi.alive) clock = "dead";
  else if (planted) clock = "planted";
  else if (elapsedMs < EXEC_MS) clock = "execute";
  else clock = "mid";
  return { clock, elapsedMs, planted, tSide: isT(gsi?.team), mem, dm: false };
}
