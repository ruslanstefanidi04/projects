import { isDeathmatch } from "./round-clock.mjs";

export function decide(s, mem) {
  const round = s.round;
  if (!mem.round || mem.round !== round) {
    mem.round = round;
    mem.bought = false;
    mem.naded = false;
    mem.route = null;
    mem.loot = false;
  }
  if (!s.alive || s.activity === "menu" || s.phase === "gameover") {
    return { type: "idle", reason: "dead" };
  }
  if (s.clock === "dm" || isDeathmatch(s)) {
    return decideDm(s, mem);
  }
  if (s.flashed > 40) return { type: "wait", ms: 250 + Math.random() * 400, reason: "flash" };
  if (s.phase === "freezetime" || s.mapPhase === "freezetime") {
    if (!mem.bought) return { type: "buy", reason: "eco" };
  }
  if (s.phase !== "live" && s.mapPhase !== "live") {
    return { type: "idle", reason: s.phase || "pause" };
  }
  if (s.health < 18) return { type: "hold", reason: "lowhp" };
  if (!mem.route) mem.route = pickRoute(s);
  if (s.flashes < 1 && !mem.loot && s.roundTime > 70) {
    mem.loot = true;
    return { type: "loot", route: mem.route, reason: "pickup" };
  }
  const wantNade = shouldNade(s, mem);
  if (wantNade) return wantNade;
  if (s.hasC4 && s.roundTime > 40 && mem.route?.plant) {
    return { type: "walk", route: mem.route, plant: true, reason: "plant" };
  }
  return { type: "walk", route: mem.route, reason: "pos" };
}

function decideDm(s, mem) {
  if (!mem.dm) mem.dm = { streak: 0, lastTurn: 0 };
  const now = Date.now();
  const r = Math.random();
  // micro pause like a human checking corners
  if (r < 0.12) return { type: "wait", ms: 80 + Math.random() * 220, reason: "dm-check" };
  // hold angle briefly after a burst
  if (mem.dm.streak > 2 && r < 0.35) {
    mem.dm.streak = 0;
    return { type: "hold", reason: "dm-reset" };
  }
  // strafe peek left/right
  if (r < 0.45) {
    mem.dm.streak += 1;
    return {
      type: "fight",
      reason: "dm-strafe",
      style: Math.random() < 0.5 ? "left" : "right",
      burst: 90 + Math.floor(Math.random() * 160)
    };
  }
  // forward push with short spray
  if (r < 0.75) {
    mem.dm.streak += 1;
    return {
      type: "fight",
      reason: "dm-push",
      style: "forward",
      burst: 120 + Math.floor(Math.random() * 200)
    };
  }
  // circle / backpedal
  mem.dm.streak += 1;
  if (now - mem.dm.lastTurn > 1800) mem.dm.lastTurn = now;
  return {
    type: "fight",
    reason: "dm-circle",
    style: Math.random() < 0.5 ? "back" : "circle",
    burst: 70 + Math.floor(Math.random() * 120)
  };
}

function shouldNade(s, mem) {
  if (mem.naded) return null;
  if (s.roundTime < 35 || s.roundTime > 95) return null;
  if (s.smokes > 0 && s.round % 2 === 0) {
    return { type: "nade", kind: "smoke", reason: "exec" };
  }
  if (s.flashes > 0 && s.round % 3 === 1) {
    return { type: "nade", kind: "flash", reason: "peek" };
  }
  if (s.hes > 0 && s.health > 60 && s.roundTime < 70) {
    return { type: "nade", kind: "he", reason: "damage" };
  }
  return null;
}

export function pickRoute(s) {
  const map = (s.map || "").toLowerCase();
  const t = s.team === "T" || s.team === "TERRORIST";
  const slot = s.round % 3;
  if (map.includes("mirage") || !map) {
    if (t) return MIRAGE_T[slot % MIRAGE_T.length];
    return MIRAGE_CT[slot % MIRAGE_CT.length];
  }
  const table = routes[map] || routes.de_mirage;
  const pack = t ? table.t : table.ct;
  return pack[slot % pack.length];
}

const p = (nx, ny, zone) => ({ nx, ny, zone });

// user maps: CT spawn -> jungle/kitchen -> B; T spawn -> palace/ramp -> A (alt mid).
const MIRAGE_T = [
  {
    name: "palace-a",
    plant: true,
    points: [p(0.82, 0.45, "t_spawn"), p(0.70, 0.58, "ramp"), p(0.72, 0.74, "palace"), p(0.48, 0.68, "a")]
  },
  {
    name: "mid",
    plant: false,
    points: [p(0.82, 0.45, "t_spawn"), p(0.68, 0.38, "topmid"), p(0.50, 0.32, "catwalk"), p(0.48, 0.44, "mid")]
  },
  {
    name: "ramp-a",
    plant: true,
    points: [p(0.82, 0.45, "t_spawn"), p(0.64, 0.55, "ramp"), p(0.50, 0.66, "a")]
  }
];

const MIRAGE_CT = [
  {
    name: "b-apps",
    plant: false,
    points: [
      p(0.26, 0.55, "ct_spawn"),
      p(0.30, 0.42, "jungle"),
      p(0.22, 0.34, "kitchen"),
      p(0.22, 0.18, "b")
    ]
  },
  {
    name: "jungle-mid",
    plant: false,
    points: [p(0.26, 0.55, "ct_spawn"), p(0.34, 0.44, "jungle"), p(0.48, 0.44, "mid")]
  },
  {
    name: "ticket-a",
    plant: false,
    points: [p(0.26, 0.55, "ct_spawn"), p(0.40, 0.78, "ticket"), p(0.48, 0.68, "a")]
  }
];

const step = (turn, walk, look = 0) => ({ turn, walk, look });

const routes = {
  de_dust2: {
    t: [
      { name: "long", plant: true, steps: [step(18, 4200, -2), step(-6, 2800, 1), step(10, 2200, 4)] },
      { name: "short", plant: true, steps: [step(-22, 3600, 0), step(8, 2400, 2), step(-4, 1800, 3)] },
      { name: "mid", plant: false, steps: [step(2, 3000, 0), step(12, 2600, 1), step(-8, 2000, 0)] }
    ],
    ct: [
      { name: "a", plant: false, steps: [step(-12, 2800, 1), step(6, 2200, 0), step(0, 1600, 2)] },
      { name: "b", plant: false, steps: [step(24, 3200, 0), step(-8, 2400, 1), step(4, 1800, 0)] },
      { name: "mid", plant: false, steps: [step(6, 2600, 0), step(-10, 2200, 2), step(3, 1600, 0)] }
    ]
  },
  de_mirage: {
    t: [
      { name: "palace", plant: true, steps: [step(-16, 3800, 1), step(8, 2600, 3), step(-4, 2000, 5)] },
      { name: "ramp", plant: true, steps: [step(20, 3600, 0), step(-6, 2500, 2), step(5, 1900, 4)] },
      { name: "mid", plant: false, steps: [step(4, 3200, 0), step(10, 2400, 1), step(-7, 1800, 0)] }
    ],
    ct: [
      { name: "jungle", plant: false, steps: [step(8, 2600, 0), step(-12, 2000, 1), step(0, 1600, 0)] },
      { name: "b", plant: false, steps: [step(-22, 3000, 0), step(6, 2200, 1), step(-3, 1700, 0)] },
      { name: "ticket", plant: false, steps: [step(14, 2400, 1), step(-5, 1800, 0), step(2, 1400, 2)] }
    ]
  },
  de_inferno: {
    t: [
      { name: "apps", plant: true, steps: [step(14, 4000, 0), step(-8, 2800, 2), step(6, 2100, 4)] },
      { name: "alt", plant: true, steps: [step(-18, 3600, 1), step(7, 2400, 3), step(-5, 1900, 2)] },
      { name: "mid", plant: false, steps: [step(2, 3000, 0), step(9, 2200, 1), step(-4, 1700, 0)] }
    ],
    ct: [
      { name: "a", plant: false, steps: [step(-10, 2600, 0), step(8, 2000, 1), step(0, 1500, 0)] },
      { name: "b", plant: false, steps: [step(20, 3200, 0), step(-6, 2200, 1), step(3, 1600, 0)] },
      { name: "arch", plant: false, steps: [step(4, 2400, 1), step(-8, 1800, 0), step(2, 1400, 1)] }
    ]
  }
};

routes["de_anubis"] = routes.de_mirage;
routes["de_ancient"] = routes.de_inferno;
routes["de_nuke"] = routes.de_dust2;
routes["de_overpass"] = routes.de_mirage;
routes["de_vertigo"] = routes.de_dust2;
routes["de_train"] = routes.de_mirage;
routes["de_italy"] = routes.de_inferno;
routes["de_office"] = routes.de_mirage;
// deathmatch / aim pool maps share mirage-like movement packs
routes["ar_baggage"] = routes.de_dust2;
routes["ar_shoots"] = routes.de_mirage;
routes["aim_map"] = routes.de_dust2;
