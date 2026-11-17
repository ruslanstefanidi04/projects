import { aimAtFoe } from "../aim-gsi.mjs";
import { isT } from "../round-clock.mjs";
import { pickTiming } from "../timing.mjs";

const LOOK = 10;
const LOOK_CAP = 900;

function look(dx, dy = 0) {
  return {
    action: "LOOK",
    dx: Math.max(-LOOK_CAP, Math.min(LOOK_CAP, Math.round(dx * LOOK))),
    dy: Math.max(-400, Math.min(400, Math.round(dy * LOOK)))
  };
}

function walkHolds(intent, ms = 220, noW = false, sticky = false) {
  const wait = intent.walk === "wait";
  let code = wait ? "" : String(intent.walk || "walk-w").replace(/^walk-/, "");
  if (noW) code = code.replace(/w/gi, "");
  const keys = [];
  for (const k of code.toUpperCase()) {
    if ("WASD".includes(k) && !keys.includes(k)) keys.push(k);
  }
  if (!keys.length && !wait) keys.push(noW ? "A" : "W");
  if (!keys.length) return [];
  const steps = keys.map((k) => ({ action: "KEYDOWN", key: k }));
  if (sticky) return steps;
  steps.push({ action: "WAIT", ms });
  for (let i = keys.length - 1; i >= 0; i--) steps.push({ action: "KEYUP", key: keys[i] });
  return steps;
}

function radarBundle(frame) {
  const obs = frame?.observations?.radar || null;
  const est = frame?.estimates?.radar || null;
  const legacy = frame?.radar && frame.radar.ok ? frame.radar : null;
  return {
    enemies: obs?.enemies || legacy?.enemies || [],
    allies: obs?.allies || legacy?.allies || [],
    sectors: obs?.sectors || legacy?.sectors || [],
    facing_deg: obs?.facing_deg ?? legacy?.facing_deg ?? 0,
    facing_from: obs?.facing_from || null,
    self: obs?.self || legacy?.self || null,
    wall_ahead: Boolean(est?.wall_ahead ?? legacy?.wall_ahead),
    open_best: est?.open_best || legacy?.open_best || null,
    forward_free: est?.path_free_fwd ?? obs?.forward_free ?? legacy?.forward_free ?? 0,
    ok: Boolean(obs?.ok !== false && (obs || legacy))
  };
}

function motionFoes(frame) {
  const list = frame?.estimates?.motion?.likely_enemies || frame?.motion?.movers || [];
  return Array.isArray(list) ? list : [];
}

function forwardOpen(radar) {
  const secs = Array.isArray(radar?.sectors) ? radar.sectors : [];
  const fwd = secs.filter((s) => Math.abs(s.rel) <= 100);
  const pool = fwd.length ? fwd : secs;
  if (!pool.length) return null;
  // prefer longest free ray (mean/free field)
  return pool.slice().sort((a, b) => (b.free ?? b.mean ?? 0) - (a.free ?? a.mean ?? 0) || (a.wall_hits ?? 0) - (b.wall_hits ?? 0))[0];
}

function openForwardClear(radar) {
  if (!radar?.ok) return false;
  if (radar?.wall_ahead) return false;
  const free = Number(radar?.forward_free || 0);
  if (free >= 6) return true;
  const secs = Array.isArray(radar?.sectors) ? radar.sectors : [];
  const fwd = secs.filter((s) => Math.abs(s.rel) <= 40);
  if (!fwd.length) return false;
  const best = Math.max(...fwd.map((s) => s.free ?? s.mean ?? 0));
  return best >= 6;
}

function canShoot(radar, facingThem) {
  if (!radar?.ok) return false;
  if (!facingThem) return false;
  if (radar.wall_ahead) return false;
  if (Number(radar.forward_free || 0) > 0 && Number(radar.forward_free) < 4) return false;
  return true;
}

const YOLO_NAV = new Set(["wall", "turn", "climb", "cover", "drop", "look", "gun"]);
const CT_BOX = new Set(["c", "ch"]);
const T_BOX = new Set(["t", "th"]);

function foeBoxNames(gsi) {
  if (gsi?.dm) return null;
  const team = gsi?.team;
  if (!team) return new Set();
  return isT(team) ? CT_BOX : T_BOX;
}

function pickYolo(frame, gsi, preferHead = true) {
  const raw = frame?.yolo?.dets || frame?.estimates?.yolo?.dets || [];
  const allow = foeBoxNames(gsi);
  const dets = Array.isArray(raw)
    ? raw.filter((d) => {
        const n = String(d.name || "").toLowerCase();
        if (YOLO_NAV.has(n)) return false;
        if (d.side === "ally") return false;
        if (d.side === "foe") return true;
        if (allow === null) return CT_BOX.has(n) || T_BOX.has(n);
        return allow.has(n);
      })
    : [];
  if (!dets.length) return null;
  const heads = dets.filter((d) => d.head || d.name === "ch" || d.name === "th");
  const pool = preferHead !== false && heads.length ? heads : dets;
  let best = null;
  let bestD = 1e9;
  for (const d of pool) {
    const x = Number(d.x);
    const y = Number(d.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dist = Math.hypot(x - 50, y - 48);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

function pickGun(frame, intent) {
  const raw = frame?.yolo?.dets || frame?.estimates?.yolo?.dets || [];
  const yolo = Array.isArray(raw)
    ? raw.filter((d) => String(d.name || "").toLowerCase() === "gun").sort((a, b) => Number(b.conf || 0) - Number(a.conf || 0))[0]
    : null;
  if (yolo && Number.isFinite(Number(yolo.x))) return { x: Number(yolo.x), y: Number(yolo.y), src: "yolo" };
  const loot = intent?.loot;
  if (loot && Number.isFinite(Number(loot.x)) && Number.isFinite(Number(loot.y))) {
    return { x: Number(loot.x), y: Number(loot.y), src: "teach" };
  }
  return null;
}

function pickFoe(foes) {
  if (!foes.length) return null;
  const fwd = foes.filter((e) => Math.abs(e.rel) <= 100).sort((a, b) => a.dist - b.dist);
  if (fwd.length) return fwd[0];
  return foes.slice().sort((a, b) => a.dist - b.dist)[0];
}

function aimPitchFromRadarDist(dist) {
  const d = Number(dist);
  if (!Number.isFinite(d)) return -2;
  if (d < 0.28) return -14;
  if (d < 0.42) return -9;
  if (d < 0.58) return -3;
  return 1;
}

function aimPitchFromMotion(m) {
  if (!m) return -2;
  const area = Number(m.area) || 0;
  const h = Number(m.h) || 0;
  const close = area > 900 || h > 90;
  const mid = area > 450 || h > 55;
  const toCentroid = (Number(m.y) || 48) - 48;
  if (close) return Math.max(-22, Math.min(4, toCentroid * 1.1 - 12));
  if (mid) return Math.max(-14, Math.min(6, toCentroid * 1.2 - 4));
  return Math.max(-8, Math.min(8, toCentroid * 1.3 + 1)); // far: body
}

/** @param {any} frame @param {any} ctx */
export function decideGame(frame, ctx) {
  const g = ctx.gsi || null;
  const stack = ctx.stack || {};
  const radar = stack.radar === false ? { ok: false, enemies: [], allies: [], wall_ahead: false } : radarBundle(frame);
  const stuckMs = ctx.stuckMs || 0;
  const wallHits = ctx.wallHits || 0;
  const noProg = ctx.noProgress || 0;
  const meanDelta = Math.abs((frame.mean || 0) - (ctx.lastMean || frame.mean || 0));
  const hpDrop = Number(ctx.hpDrop || 0);
  const underFire = hpDrop >= 1;
  const softStuck = !underFire && (noProg >= 1 || (meanDelta < 1.5 && stuckMs > 600));
  const hardWall = !underFire && Boolean(radar.wall_ahead) && (wallHits >= 1 || noProg >= 2 || stuckMs > 1400);
  const pathOpen =
    openForwardClear(radar) ||
    (radar.open_best && (radar.open_best.wall_hits || 0) === 0 && Math.abs(radar.open_best.rel) < 55);
  const prefer = ctx.prefer || null;
  const intent = ctx.intent || {};
  const clock = ctx.clock || g?.clock || "mid";
  const dm = clock === "dm" || Boolean(g?.dm);
  const execute = !dm && clock === "execute";
  const leaving = !dm && Boolean(g) && String(g.zone || "").includes("spawn");
  const stuckSpawn = leaving && Boolean(g?.alive);
  const rawFoes = Array.isArray(radar.enemies) ? radar.enemies : [];
  const radarJunk = rawFoes.length > 16 || Number(radar.enemy_count || 0) > 24;
  const foes = radarJunk ? [] : rawFoes.filter((e) => e.src !== "radar_ally");
  const foe = pickFoe(foes);
  const foeBehind = foes.filter((e) => Math.abs(e.rel) > 100).sort((a, b) => a.dist - b.dist)[0] || null;
  const movers = execute || leaving || stuckSpawn ? [] : motionFoes(frame);
  const moverNear = movers.find((m) => m.score >= 280 && Math.abs(m.x - 50) <= 22 && Math.abs(m.y - 48) <= 22);
  const moverAny = movers.find((m) => m.score >= 320) || null;

  if (g && (g.inMenu || g.over)) {
    return { fsm: "game", state: "MAIN_MENU", action: "WAIT", reason: "gsi-menu", timeout_ms: 800, expect: { kind: "any" } };
  }
  const hudDead = frame?.screen === "SPECTATE" || frame?.screen === "DEAD";
  if (hudDead || g?.spectating || (g && !g.alive)) {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "WAIT",
      reason: hudDead || g?.spectating ? "spectator" : "dead-wait-respawn",
      keepW: false,
      timeout_ms: 700,
      expect: { kind: "any" }
    };
  }
  if (g && g.flashed > 40) {
    return { fsm: "game", state: "RUNNING", action: "WAIT", reason: "flashed", timeout_ms: 280, expect: { kind: "any" } };
  }
  if (prefer === "wait") {
    return { fsm: "game", state: "RUNNING", action: "WAIT", reason: "prompt-wait", timeout_ms: 500, expect: { kind: "any" } };
  }

  const timingOn = intent.timing !== "off";
  const urgent = timingOn ? pickTiming(g, "urgent") : null;
  if (urgent?.kind === "run") {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: urgent.why,
      steps: [{ action: "HOLD", key: "S", ms: 200 }],
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }
  if (urgent?.kind === "reload") {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: urgent.why,
      steps: [{ action: "KEY", key: "R" }, { action: "WAIT", ms: 400 }],
      timeout_ms: 50,
      expect: { kind: "ammo_up" }
    };
  }

  const wantAim = intent.aim === "yolo-head" || intent.aim === "yolo-body";
  const yoloHit = wantAim && stack.eyes !== false && stack.aim !== false ? pickYolo(frame, g, intent.aim !== "yolo-body") : null;
  const wallNow = !radarJunk && Boolean(radar.wall_ahead) && !underFire;
  if (yoloHit) {
    const dx = Math.max(-800, Math.min(800, Math.round((Number(yoloHit.x) - 50) * 16)));
    const dy = Math.max(-500, Math.min(500, Math.round((Number(yoloHit.y) - 48) * 14)));
    const on = Math.hypot(Number(yoloHit.x) - 50, Number(yoloHit.y) - 48) < 5.5;
    const steps = [];
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) steps.push({ action: "LOOK", dx, dy });
    if (on) {
      steps.push({ action: "FIRE" });
      steps.push({ action: "FIRE" });
    }
    steps.push(...walkHolds(intent, on ? 90 : 240, wallNow, true));
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: on ? (yoloHit.head ? "yolo-head" : "yolo-body") : "yolo-aim",
      steps,
      keepW: intent.walk !== "wait",
      timeout_ms: 20,
      expect: { kind: "motion" }
    };
  }

  if (wantAim) {
    const sweep = Date.now() % 2000 < 1000 ? 900 : -900;
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "mouse-scan",
      steps: [
        ...walkHolds(intent, 240, false, true),
        { action: "LOOK", dx: sweep, dy: 40 },
        { action: "LOOK", dx: sweep, dy: -25 }
      ],
      keepW: intent.walk !== "wait",
      timeout_ms: 20,
      expect: { kind: "motion" }
    };
  }

  if (wallNow) {
    const side = Math.random() < 0.5 ? "A" : "D";
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "unstick-wall",
      steps: [look(side === "A" ? -42 : 42, 0), { action: "HOLD", key: side, ms: 220 }, { action: "HOLD", key: "S", ms: 80 }],
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }

  const needGun = g && g.alive && !g.hasStarGun && !underFire;
  const gunOnFloor = needGun ? pickGun(frame, intent) : null;
  if (gunOnFloor) {
    const dx = Math.max(-800, Math.min(800, Math.round((Number(gunOnFloor.x) - 50) * 16)));
    const dy = Math.max(-500, Math.min(500, Math.round((Number(gunOnFloor.y) - 62) * 14)));
    const on = Math.hypot(Number(gunOnFloor.x) - 50, Number(gunOnFloor.y) - 62) < 8;
    const steps = [];
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) steps.push({ action: "LOOK", dx, dy });
    steps.push({ action: "HOLD", key: "W", ms: on ? 90 : 160 });
    if (on) steps.push({ action: "HOLD", key: "E", ms: 180 });
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "pickup-" + gunOnFloor.src,
      steps,
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }

  const gsiAim = stack.aim === false ? null : aimAtFoe(g, { yaw: ctx.viewYaw, pitch: ctx.viewPitch });
  const gunOk = /Rifle|Sniper|SMG|Pistol|Machine/i.test(String(g?.weaponType || ""));
  if (gsiAim && g?.alive && gunOk && Number(g.ammo) > 0) {
    const dx = Math.max(-90, Math.min(90, Math.round(gsiAim.dx)));
    const dy = Math.max(-36, Math.min(36, Math.round(gsiAim.dy)));
    const steps = [];
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) steps.push({ action: "LOOK", dx, dy });
    if (gsiAim.onTarget) {
      steps.push({ action: "FIRE" });
      steps.push({ action: "FIRE" });
    } else {
      steps.push({ action: "KEYDOWN", key: "W" });
    }
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: gsiAim.onTarget ? "gsi-fire" : "gsi-aim",
      steps,
      keepW: true,
      timeout_ms: 20,
      expect: { kind: "motion" }
    };
  }

  // PRIORITY 0: took damage — turn to threat (behind shots), do not keep facing wall
  if (underFire) {
    const threat = foeBehind || foe;
    const turn = threat
      ? Math.max(-160, Math.min(160, threat.rel))
      : wallHits % 2 === 0
        ? 150
        : -150;
    const pitch = threat ? aimPitchFromRadarDist(threat.dist) : -4;
    const steps = [look(turn, pitch)];
    if (threat && canShoot(radar, Math.abs(threat.rel) <= 40)) {
      steps.push({ action: "FIRE" });
      steps.push({ action: "FIRE" });
    } else {
      steps.push({ action: "HOLD", key: turn > 0 ? "D" : "A", ms: 100 });
    }
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "react-damage",
      steps,
      timeout_ms: 25,
      expect: { kind: "motion" }
    };
  }

  const soft = timingOn ? pickTiming(g, "soft") : null;
  if (soft?.kind === "reload") {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: soft.why,
      steps: [{ action: "KEY", key: "R" }, { action: "WAIT", ms: 500 }],
      timeout_ms: 50,
      expect: { kind: "ammo_up" }
    };
  }

  const rsGo = ctx.routeStep;
  if (stuckSpawn && !underFire && rsGo) {
    const steps = [];
    if (rsGo.unstick) {
      steps.push({ action: "KEYUP", key: "W" });
      steps.push({ action: "HOLD", key: "S", ms: 80 });
      steps.push(look(rsGo.unstickTurn || 28, 0));
    } else if (rsGo.turnOnce) {
      steps.push(look(rsGo.turn || 0, 0));
    }
    if (rsGo.wallAhead) {
      steps.push({ action: "KEYUP", key: "W" });
      steps.push({ action: "HOLD", key: (rsGo.turn || 0) >= 0 ? "D" : "A", ms: 180 });
    }
    steps.push({ action: "KEYDOWN", key: "W" });
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: `spawn-out-${rsGo.nav || "w"}`,
      steps,
      keepW: true,
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }
  if (stuckSpawn && !underFire && !rsGo) {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "spawn-go",
      steps: [{ action: "KEYDOWN", key: "W" }],
      keepW: true,
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }

  // radar enemy: turn hard, fire only if clear + facing
  if (foe) {
    const turn = Math.max(-150, Math.min(150, foe.rel));
    const pitch = aimPitchFromRadarDist(foe.dist);
    const facingThem = Math.abs(foe.rel) <= 32;
    const steps = [];
    if (Math.abs(turn) > 8 || Math.abs(pitch) > 2) steps.push(look(turn, pitch));
    if (Math.abs(turn) > 30) steps.push({ action: "HOLD", key: turn > 0 ? "D" : "A", ms: 100 });
    if (canShoot(radar, facingThem)) {
      // micro adjust: close keep head, far settle chest
      if (facingThem && Math.abs(pitch) >= 8) steps.push(look(0, Math.round(pitch * 0.25)));
      steps.push({ action: "HOLD", key: "W", ms: 80 });
      steps.push({ action: "FIRE" });
      steps.push({ action: "FIRE" });
    } else if (facingThem && radar.wall_ahead) {
      steps.push({ action: "HOLD", key: turn >= 0 ? "D" : "A", ms: 200 });
    } else {
      steps.push({ action: "HOLD", key: turn > 0 ? "D" : "A", ms: 90 });
    }
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: canShoot(radar, facingThem)
        ? foe.dist < 0.4
          ? "radar-chase-head"
          : "radar-chase-body"
        : radar.wall_ahead
          ? "radar-no-wallshot"
          : "radar-turn",
      steps,
      timeout_ms: 30,
      expect: { kind: "motion" }
    };
  }

  // PRIORITY 2: fresh motion near crosshair only → shoot; far motion → look only
  if (moverNear && canShoot(radar, true)) {
    const turnX = Math.max(-55, Math.min(55, (moverNear.x - 50) * 2.2));
    const pitch = aimPitchFromMotion(moverNear);
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: (moverNear.area || 0) > 700 ? "motion-fire-head" : "motion-fire-body",
      steps: [look(turnX, pitch), { action: "FIRE" }, { action: "FIRE" }],
      timeout_ms: 30,
      expect: { kind: "motion" }
    };
  }
  if (moverNear && radar.wall_ahead) {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "motion-no-wallshot",
      steps: [look((moverNear.x - 50) * 1.5, aimPitchFromMotion(moverNear) * 0.5), { action: "HOLD", key: "A", ms: 160 }],
      timeout_ms: 30,
      expect: { kind: "motion" }
    };
  }
  if (moverAny && Math.abs(moverAny.x - 50) > 22) {
    const turnX = Math.max(-90, Math.min(90, (moverAny.x - 50) * 2.2));
    const pitch = aimPitchFromMotion(moverAny);
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "motion-look",
      steps: [look(turnX, pitch)],
      timeout_ms: 30,
      expect: { kind: "motion" }
    };
  }

  // radar waypoints (or timed fallback): walk spawn-to-site instead of spinning/jumping
  const rs = ctx.routeStep;
  if (rs && !underFire && !foe) {
    const steps = [];
    const side = (rs.turn || 0) >= 0 ? "D" : "A";
    if (rs.unstick) {
      steps.push({ action: "KEYUP", key: "W" });
      steps.push({ action: "HOLD", key: "S", ms: 100 });
      steps.push(look(rs.unstickTurn || 22, 0));
    } else if (rs.turnOnce && (rs.turn || rs.look)) {
      steps.push(look(rs.turn || 0, rs.look || 0));
    }
    if (rs.wallAhead) {
      steps.push({ action: "KEYUP", key: "W" });
      steps.push({ action: "HOLD", key: side, ms: 200 });
    } else if (rs.turnOnly) {
      steps.push({ action: "HOLD", key: side, ms: 70 });
    }
    steps.push({ action: "KEYDOWN", key: "W" });
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: rs.nav ? `nav-${rs.nav}` : rs.unstick ? "site-unstick" : "site-push",
      steps,
      keepW: true,
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }

  // soft stuck / curb: path looks open on radar, jump over ledge
  if (softStuck && pathOpen && !hardWall && radar.ok) {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "curb-jump",
      steps: [
        { action: "JUMP" },
        { action: "HOLD", key: "W", ms: 260 },
        { action: "JUMP" },
        { action: "HOLD", key: "W", ms: 180 }
      ],
      timeout_ms: 40,
      clearWall: true,
      expect: { kind: "motion" }
    };
  }

  // PRIORITY 3b: hard wall — turn away (no jump into wall)
  if (hardWall || noProg >= 3 || (softStuck && !pathOpen)) {
    const open = forwardOpen(radar) || radar.open_best;
    let turn = open ? open.rel : wallHits % 2 === 0 ? 95 : -95;
    if (Math.abs(turn) < 50) turn = turn >= 0 ? 85 : -85;
    turn = Math.max(-130, Math.min(130, turn));
    if (wallHits % 2 === 1) turn = -turn;
    const side = turn >= 0 ? "D" : "A";
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: noProg >= 2 ? "unstick-noprogress" : "avoid-wall",
      steps: [
        { action: "HOLD", key: "S", ms: 120 },
        look(turn, 0),
        { action: "HOLD", key: side, ms: 280 }
      ],
      timeout_ms: 40,
      clearWall: true,
      expect: { kind: "motion" }
    };
  }

  // PRIORITY 3c: bunnyhop when bandit says so (human clone)
  if (
    radar.ok &&
    pathOpen &&
    !softStuck &&
    (prefer === "bunnyhop" || prefer === "jump-peek")
  ) {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "bunnyhop",
      bhop: true,
      hops: 3 + Math.floor(Math.random() * 2),
      steps: [],
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }

  const openFwd = forwardOpen(radar) || radar.open_best;
  if (
    radar.ok &&
    openFwd &&
    Math.abs(openFwd.rel) > 35 &&
    Math.abs(openFwd.rel) < 110 &&
    (prefer === "radar-open" || prefer === "curb-jump")
  ) {
    const turn = Math.max(-80, Math.min(80, openFwd.rel));
    const hop = prefer === "curb-jump" || (Math.abs(openFwd.rel) < 50 && Math.random() < 0.2);
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: hop ? "curb-jump" : "radar-open",
      steps: hop
        ? [look(turn, 0), { action: "JUMP" }, { action: "HOLD", key: "W", ms: 300 }, { action: "JUMP" }]
        : [
            look(turn, 0),
            { action: "HOLD", key: turn > 0 ? "D" : "A", ms: 160 },
            { action: "HOLD", key: "W", ms: 220 }
          ],
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }

  if (prefer === "plant" && g && g.hasC4 && g.atSite) {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "plant",
      steps: [{ action: "HOLD", key: "W", ms: 160 }, { action: "KEY", key: "E" }],
      timeout_ms: 50,
      expect: { kind: "any" }
    };
  }
  if (prefer === "defuse" && g && g.bomb === "planted" && g.team === "CT") {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "defuse",
      steps: [{ action: "KEY", key: "E" }, { action: "WAIT", ms: 400 }],
      timeout_ms: 50,
      expect: { kind: "any" }
    };
  }

  if (prefer === "reload" && g && Number(g.ammo) <= 8 && String(g.weaponType || "") !== "Knife") {
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "reload",
      steps: [{ action: "KEY", key: "R" }, { action: "WAIT", ms: 650 }],
      timeout_ms: 50,
      expect: { kind: "ammo_up" }
    };
  }

  if (prefer === "fight-push") {
    const steps = [...walkHolds(intent, 200, Boolean(radar.wall_ahead))];
    if (canShoot(radar, true)) {
      steps.push({ action: "FIRE" });
      steps.push({ action: "FIRE" });
    } else {
      steps.push(look(Math.random() < 0.5 ? -40 : 40, -4));
    }
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "fight-push",
      steps,
      timeout_ms: 35,
      expect: { kind: "motion" }
    };
  }

  if (prefer === "radar-chase") {
    const steps = [look(Math.floor(Math.random() * 16 - 8), -2), { action: "HOLD", key: "W", ms: 180 }];
    if (canShoot(radar, true)) steps.push({ action: "FIRE" });
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "radar-chase",
      steps,
      timeout_ms: 35,
      expect: { kind: "motion" }
    };
  }

  if (prefer === "fight-peek") {
    const side = Math.random() < 0.5 ? -1 : 1;
    const steps = [
      look(side * (16 + Math.floor(Math.random() * 10)), Math.floor(Math.random() * 4 - 2)),
      { action: "HOLD", key: side > 0 ? "D" : "A", ms: 110 }
    ];
    if (canShoot(radar, true)) steps.push({ action: "FIRE" });
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "fight-peek",
      steps,
      timeout_ms: 35,
      expect: { kind: "motion" }
    };
  }

  if (prefer === "radar-turn") {
    const p = String(ctx.prompt || "").toLowerCase();
    const dir = /лев|left/.test(p) ? -1 : /прав|right/.test(p) ? 1 : Math.random() < 0.5 ? -1 : 1;
    const steps = [];
    for (let i = 0; i < 10; i++) steps.push(look(dir * 40, 0));
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "radar-turn",
      steps,
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }

  if (prefer === "check-corner") {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const steps = [look(dir * (18 + Math.floor(Math.random() * 10)), 0)];
    if (canShoot(radar, true)) steps.push({ action: "FIRE" });
    else steps.push({ action: "HOLD", key: "W", ms: 280 });
    steps.push(look(-dir * 8, 0));
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: "check-corner",
      steps,
      timeout_ms: 35,
      expect: { kind: "motion" }
    };
  }

  if (prefer === "strafe-advance" || String(prefer || "").startsWith("walk-")) {
    const holds = walkHolds(intent.walk ? intent : { walk: prefer }, 320, Boolean(radar.wall_ahead));
    return {
      fsm: "game",
      state: "RUNNING",
      action: "COMBO",
      reason: prefer === "strafe-advance" ? "walk-w" : prefer,
      steps: holds.length ? holds : [{ action: "HOLD", key: "W", ms: 320 }],
      timeout_ms: 40,
      expect: { kind: "motion" }
    };
  }

  const turn0 =
    openFwd && radar.ok && Math.abs(openFwd.rel) > 15
      ? Math.max(-55, Math.min(55, openFwd.rel))
      : Math.floor(Math.random() * 28 - 14);
  const walkMs = radar.ok ? 180 + Math.floor(Math.random() * 80) : 460 + Math.floor(Math.random() * 120);
  return {
    fsm: "game",
    state: "RUNNING",
    action: "COMBO",
    reason: "explore",
    steps: [
      look(turn0, Math.floor(Math.random() * 6 - 3)),
      ...(Math.abs(turn0) > 25 ? [{ action: "HOLD", key: turn0 > 0 ? "D" : "A", ms: 120 }] : []),
      { action: "HOLD", key: "W", ms: walkMs }
    ],
    timeout_ms: 40,
    expect: { kind: "motion" }
  };
}
