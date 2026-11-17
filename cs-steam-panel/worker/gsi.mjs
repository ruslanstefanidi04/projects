import http from "http";

export function startGsi({ port, token, onState, host = "0.0.0.0" }) {
  let last = null;
  let lastAt = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(204);
      res.end();
      return;
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("");
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const got = body.auth?.token || "";
        if (token && got && got !== token) return;
        last = body;
        lastAt = Date.now();
        onState(body);
      } catch {}
    });
  });
  server.on("error", (e) => {
    console.error("gsi", e.code || e.message);
  });
  server.listen(port, host || "0.0.0.0");
  return {
    server,
    snapshot: () => last,
    receivedAt: () => lastAt
  };
}

export function parseGsi(raw) {
  const weapons = Object.values(raw?.player?.weapons || {});
  const nades = weapons.filter((w) => w && w.type === "Grenade");
  const active = weapons.find((w) => w && w.state === "active") || {};
  const count = (name) =>
    nades
      .filter((n) => n.name === name)
      .reduce((s, n) => s + (Number(n.ammo_reserve) || Number(n.ammo_clip) || 1), 0);
  const health = Number(raw?.player?.state?.health ?? 0);
  const stats = raw?.player?.match_stats || {};
  const providerId = String(raw?.provider?.steamid || "");
  const playerId = String(raw?.player?.steamid || "");
  const spectating = Boolean(providerId && playerId && providerId !== playerId);
  const selfFromAll = raw?.allplayers && providerId ? raw.allplayers[providerId] : null;
  const selfHealth = spectating
    ? Number(selfFromAll?.state?.health ?? 0)
    : health;
  const activity = String(raw?.player?.activity || "");
  return {
    map: String(raw?.map?.name || "").replace(/^de_/, "de_"),
    mapPhase: String(raw?.map?.phase || ""),
    round: Number(raw?.map?.round ?? 0),
    phase: String(raw?.round?.phase || raw?.map?.phase || ""),
    bomb: String(raw?.round?.bomb || ""),
    winTeam: String(raw?.round?.win_team || ""),
    team: String((spectating ? selfFromAll?.team : null) || raw?.player?.team || ""),
    health: spectating ? selfHealth : health,
    armor: Number((spectating ? selfFromAll?.state?.armor : null) ?? raw?.player?.state?.armor ?? 0),
    money: Number(raw?.player?.state?.money ?? 0),
    flashed: Number(raw?.player?.state?.flashed ?? 0),
    smoked: Number(raw?.player?.state?.smoked ?? 0),
    burning: Number(raw?.player?.state?.burning ?? 0),
    // CS GSI has no reliable shot-direction; we infer "under fire" from hp/armor drop in loop
    // when you die, gsi player becomes the guy you watch. compare provider vs player.
    spectating,
    providerId,
    alive: selfHealth > 0 && !spectating && activity !== "menu",
    activity,
    roundTime: Number(raw?.phase_countdowns?.phase_ends_in || 0),
    weapon: String(active.name || ""),
    weaponType: String(active.type || ""),
    holdingC4: String(active.name || "") === "weapon_c4" || String(active.type || "") === "C4",
    ammo: Number(active.ammo_clip ?? 0),
    ammoReserve: Number(active.ammo_reserve ?? 0),
    ammoMax: Number(active.ammo_clip_max ?? 0),
    flashes: count("weapon_flashbang"),
    smokes: count("weapon_smokegrenade"),
    hes: count("weapon_hegrenade"),
    molly: count("weapon_molotov") + count("weapon_incgrenade"),
    hasC4: weapons.some((w) => w && w.name === "weapon_c4"),
    hasRifle: weapons.some((w) =>
      /ak47|m4a1|awp|galilar|famas|sg556|aug|scar20|g3sg1|ssg08|mp9|mac10|ump|p90|mp7|mp5/i.test(String(w?.name || ""))
    ),
    hasStarGun: weapons.some((w) => /ak47|awp/i.test(String(w?.name || ""))),
    loadout: weapons
      .filter((w) => w && w.name)
      .map((w) => String(w.name).replace(/^weapon_/, "") + (w.state === "active" ? "*" : ""))
      .join(" "),
    helmet: Boolean(raw?.player?.state?.helmet),
    kit: Boolean(raw?.player?.state?.defusekit),
    steamId: String(raw?.player?.steamid || ""),
    mode: String(raw?.map?.mode || ""),
    over: ["gameover", "intermission"].includes(String(raw?.map?.phase || "")),
    warmup: String(raw?.map?.phase || "") === "warmup" || String(raw?.round?.phase || "") === "warmup",
    inMenu: String(raw?.player?.activity || "") === "menu" || !raw?.map?.name,
    kills: Number(stats.kills ?? 0),
    assists: Number(stats.assists ?? 0),
    deaths: Number(stats.deaths ?? 0),
    mvps: Number(stats.mvps ?? 0),
    score: Number(stats.score ?? 0),
    ...navFromRaw(raw)
  };
}

export function parseVec(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    const p = v.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
    if (p.length >= 2) return { x: p[0], y: p[1], z: p[2] || 0 };
  }
  if (typeof v === "object" && Number.isFinite(Number(v.x))) {
    return { x: Number(v.x), y: Number(v.y), z: Number(v.z) || 0 };
  }
  return null;
}

export function isT(team) {
  const t = String(team || "").toUpperCase();
  return t === "T" || t === "TERRORIST";
}

function navFromRaw(raw) {
  const bombObj = raw?.bomb && typeof raw.bomb === "object" ? raw.bomb : {};
  const pos =
    parseVec(raw?.player?.position) ||
    parseVec(raw?.player?.state?.position) ||
    null;
  const forward =
    parseVec(raw?.player?.forward) ||
    parseVec(raw?.player?.state?.forward) ||
    null;
  const players = [];
  const all = raw?.allplayers;
  if (all && typeof all === "object") {
    for (const [id, p] of Object.entries(all)) {
      if (!p || typeof p !== "object") continue;
      players.push({
        id: String(id),
        team: String(p.team || ""),
        health: Number(p.state?.health ?? 0),
        name: String(p.name || ""),
        pos: parseVec(p.position),
        forward: parseVec(p.forward)
      });
    }
  }
  const myTeam = String(raw?.player?.team || "");
  const myId = String(raw?.player?.steamid || "");
  const selfRow = players.find((p) => p.id === myId);
  const fwd = forward || selfRow?.forward || null;
  const foes = [];
  const allies = [];
  for (const p of players) {
    if (p.id === myId) continue;
    if ((p.health || 0) <= 0) continue;
    if (!p.team || !myTeam) continue;
    (p.team === myTeam ? allies : foes).push(p);
  }
  return {
    pos: pos || selfRow?.pos || null,
    forward: fwd,
    allplayerN: players.length,
    foes: foes.map((p) => ({ name: p.name, team: p.team, pos: p.pos, health: p.health })),
    allies: allies.map((p) => ({ name: p.name, team: p.team, pos: p.pos, health: p.health })),
    bombState: String(bombObj.state || raw?.round?.bomb || ""),
    bombPos: parseVec(bombObj.position),
    bombCountdown: Number(bombObj.countdown ?? 0),
    gsiKeys: raw && typeof raw === "object" ? Object.keys(raw) : []
  };
}

/** fake radar from gsi xyz: enemies only, never teammates. needs our pos + move facing. */
export function gsiRadar(gsi, prevPos) {
  const me = gsi?.pos;
  const foes = Array.isArray(gsi?.foes) ? gsi.foes : [];
  if (!me || !foes.length) {
    return { ok: false, wall_ahead: false, enemies: [], enemy_count: 0, allies: gsi?.allies || [] };
  }
  let facing = 0;
  let facingOk = false;
  if (prevPos && me) {
    const dx = me.x - prevPos.x;
    const dy = me.y - prevPos.y;
    if (dx * dx + dy * dy > 9) {
      facing = (Math.atan2(dx, dy) * 180) / Math.PI;
      facingOk = true;
    }
  }
  const enemies = [];
  for (const p of foes) {
    if (!p.pos) continue;
    const dx = p.pos.x - me.x;
    const dy = p.pos.y - me.y;
    const distM = Math.hypot(dx, dy);
    const ang = (Math.atan2(dx, dy) * 180) / Math.PI;
    const rel = facingOk ? ((ang - facing + 540) % 360) - 180 : 0;
    enemies.push({
      ang: Math.round(ang * 10) / 10,
      rel: Math.round(rel * 10) / 10,
      dist: Math.min(1, distM / 1800),
      src: "gsi_foe"
    });
  }
  enemies.sort((a, b) => a.dist - b.dist);
  return {
    ok: enemies.length > 0 && facingOk,
    wall_ahead: false,
    enemies,
    enemy_count: enemies.length,
    allies: gsi?.allies || [],
    facing_deg: facing,
    facingOk,
    self: me
  };
}
