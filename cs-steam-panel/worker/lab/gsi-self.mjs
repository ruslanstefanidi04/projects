import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { startGsi, parseGsi } from "../gsi.mjs";
import { FARM_ROOT } from "../vm/defaults.mjs";
import { isT } from "../round-clock.mjs";

const SELF = path.join(FARM_ROOT, "ops", "vision", "self.json");

export function dumpSelf(gsi) {
  const team = String(gsi?.team || "");
  const t = isT(team);
  const body = {
    team,
    t,
    dm: Boolean(gsi?.dm),
    foe: gsi?.dm ? "all" : t ? "CT" : team ? "T" : "",
    ally: gsi?.dm ? "none" : t ? "T" : team ? "CT" : "",
    ammo: Number(gsi?.ammo || 0),
    ammoReserve: Number(gsi?.ammoReserve || 0),
    bomb: gsi?.bombState || gsi?.bomb || "",
    bombCountdown: Number(gsi?.bombCountdown || 0),
    clock: gsi?.clock || "",
    freeze: gsi?.phase === "freezetime" || gsi?.mapPhase === "freezetime",
    weapon: gsi?.weapon || "",
    hasStarGun: Boolean(gsi?.hasStarGun),
    alive: Boolean(gsi?.alive),
    spectating: Boolean(gsi?.spectating),
    map: String(gsi?.map || ""),
    phase: String(gsi?.phase || ""),
    activity: String(gsi?.activity || ""),
    inMenu: Boolean(gsi?.inMenu),
    pos: gsi?.pos || null,
    forward: gsi?.forward || null,
    allplayerN: Number(gsi?.allplayerN || 0),
    gsiKeys: gsi?.gsiKeys || [],
    health: Number(gsi?.health || 0),
    armor: Number(gsi?.armor || 0),
    money: Number(gsi?.money || 0),
    helmet: Boolean(gsi?.helmet),
    kit: Boolean(gsi?.kit),
    loadout: String(gsi?.loadout || ""),
    flashes: Number(gsi?.flashes || 0),
    smokes: Number(gsi?.smokes || 0),
    hes: Number(gsi?.hes || 0),
    molly: Number(gsi?.molly || 0),
    at: Date.now()
  };
  mkdirSync(path.dirname(SELF), { recursive: true });
  writeFileSync(SELF, JSON.stringify(body));
  return body;
}

export function startLabGsi() {
  const port = Number(process.env.BOT_GSI_PORT || 32222);
  const token = process.env.BOT_GSI_TOKEN || "csfarm";
  const gsi = startGsi({
    port,
    token,
    onState(raw) {
      dumpSelf(parseGsi(raw));
      try {
        writeFileSync(path.join(FARM_ROOT, "ops", "vision", "gsi-last.json"), JSON.stringify({
          keys: raw && typeof raw === "object" ? Object.keys(raw) : [],
          player: raw?.player ? Object.keys(raw.player) : [],
          state: raw?.player?.state ? Object.keys(raw.player.state) : [],
          pos: raw?.player?.position || raw?.player?.state?.position || null,
          fwd: raw?.player?.forward || null,
          allN: raw?.allplayers ? Object.keys(raw.allplayers).length : 0
        }));
      } catch {}
    }
  });
  return { port, gsi };
}
