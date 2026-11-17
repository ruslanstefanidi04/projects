import http from "http";

export function startGsi({ port, token, onState, host = "127.0.0.1" }) {
  let last = null;
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
        onState(body);
      } catch {}
    });
  });
  server.on("error", (e) => {
    console.error("gsi", e.code || e.message);
  });
  server.listen(port, host);
  return { server, snapshot: () => last };
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
  return {
    map: String(raw?.map?.name || ""),
    mapPhase: String(raw?.map?.phase || ""),
    round: Number(raw?.map?.round ?? 0),
    phase: String(raw?.round?.phase || raw?.map?.phase || ""),
    bomb: String(raw?.round?.bomb || ""),
    winTeam: String(raw?.round?.win_team || ""),
    team: String(raw?.player?.team || ""),
    health,
    armor: Number(raw?.player?.state?.armor ?? 0),
    money: Number(raw?.player?.state?.money ?? 0),
    flashed: Number(raw?.player?.state?.flashed ?? 0),
    smoked: Number(raw?.player?.state?.smoked ?? 0),
    burning: Number(raw?.player?.state?.burning ?? 0),
    alive: health > 0 && String(raw?.player?.activity || "playing") !== "menu",
    activity: String(raw?.player?.activity || ""),
    roundTime: Number(raw?.phase_countdowns?.phase_ends_in || 0),
    weapon: String(active.name || ""),
    weaponType: String(active.type || ""),
    ammo: Number(active.ammo_clip ?? 0),
    flashes: count("weapon_flashbang"),
    smokes: count("weapon_smokegrenade"),
    hes: count("weapon_hegrenade"),
    molly: count("weapon_molotov") + count("weapon_incgrenade"),
    hasC4: weapons.some((w) => w && w.name === "weapon_c4"),
    steamId: String(raw?.player?.steamid || ""),
    mode: String(raw?.map?.mode || ""),
    over: ["gameover", "intermission"].includes(String(raw?.map?.phase || "")),
    warmup: String(raw?.map?.phase || "") === "warmup" || String(raw?.round?.phase || "") === "warmup",
    inMenu: String(raw?.player?.activity || "") === "menu" || !raw?.map?.name,
    kills: Number(stats.kills ?? 0),
    assists: Number(stats.assists ?? 0),
    deaths: Number(stats.deaths ?? 0),
    mvps: Number(stats.mvps ?? 0),
    score: Number(stats.score ?? 0)
  };
}
